// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// Implemented by financing contracts (e.g. ReceivableNote) that took over an order's seller payout.
interface IPayoutReceiver {
    function onOrderSettled(bytes32 orderId, uint8 outcome, uint256 sellerAmount, uint256 buyerRefund) external;
}

/// @title OpenBox DeliveryCheckout: checkout with verified release
/// @notice The buyer's USDT is held against one order. At dispatch, the courier's World-verified identity
///         hash is bound to the order. At the door, a fresh World check by the same person plus the
///         seller-signed one-time label records the handover. The buyer opens the box on camera and one
///         `settle` call, on an independent inspector's signed verdict, pays the courier fee and the seller
///         (or refunds the buyer). No inspection within the window releases to courier + seller.
///         Returns refund from a merchant refund pool only if the returned serial matches the one packed.
contract DeliveryCheckout is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        None,
        Paid,
        Dispatched,
        HandedOver,
        Settled,
        Returned,
        Cancelled
    }

    enum Outcome {
        None,
        Match,
        Mismatch,
        Damaged,
        Timeout
    }

    enum PayMethod {
        Approve,
        Permit,
        Authorization
    }

    /// Signed by the seller when the order is created at checkout.
    struct OrderTerms {
        bytes32 orderId;
        address seller;
        uint256 amount; // total the buyer pays, courier fee included
        uint256 courierFee;
        uint64 deliveryWindow; // seconds after payment the buyer may cancel if not handed over
        uint64 inspectionWindow; // seconds after handover to inspect before auto-release
        uint64 returnWindow; // seconds after settlement during which a serial-checked return is allowed
        uint256 deadline; // terms expiry
    }

    /// Printed into the parcel QR. Signed by the seller at packing.
    struct Label {
        bytes32 orderId;
        bytes32 serialHash;
        bytes32 courierHash; // World-derived id of the courier assigned to carry this parcel
        uint256 labelNonce;
    }

    /// Signed by the OpenBox backend after validating the courier's World check at assignment.
    struct DispatchAttestation {
        bytes32 orderId;
        bytes32 courierHash;
        address payout;
        uint256 deadline;
    }

    /// Signed by the OpenBox backend after validating a fresh World check at the door (same person).
    struct CourierAttestation {
        bytes32 orderId;
        bytes32 courierHash;
        bytes32 labelHash;
        uint256 deadline;
    }

    /// Signed by an allowlisted inspection service.
    struct Verdict {
        bytes32 orderId;
        uint8 outcome; // Outcome.Match | Mismatch | Damaged
        uint16 refundBps; // only for Damaged
        bytes32 serialReadHash;
        bytes32 frameHash;
        uint64 hcsSeq; // sequence number of the verdict on the Hedera HCS audit topic
        uint256 deadline;
    }

    struct ReturnVerdict {
        bytes32 orderId;
        bytes32 returnedSerialHash;
        bytes32 frameHash;
        uint64 hcsSeq;
        uint256 deadline;
    }

    struct PermitSig {
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct AuthSig {
        uint256 validAfter;
        uint256 validBefore;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct Order {
        address buyer;
        address seller;
        address courier;
        Status status;
        Outcome outcome;
        uint16 refundBps;
        uint128 amount;
        uint128 courierFee;
        uint128 buyerRefunded;
        uint128 sellerPaid;
        bytes32 courierHash;
        bytes32 serialHash;
        uint64 createdAt;
        uint64 handoverAt;
        uint64 settledAt;
        uint64 deliveryWindow;
        uint64 inspectionWindow;
        uint64 returnWindow;
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    bytes32 public constant ORDER_TERMS_TYPEHASH = keccak256(
        "OrderTerms(bytes32 orderId,address seller,uint256 amount,uint256 courierFee,uint64 deliveryWindow,uint64 inspectionWindow,uint64 returnWindow,uint256 deadline)"
    );
    bytes32 public constant ORDER_INTENT_TYPEHASH =
        keccak256("OrderIntent(bytes32 orderId,address buyer,bytes32 termsHash)");
    bytes32 public constant LABEL_TYPEHASH =
        keccak256("Label(bytes32 orderId,bytes32 serialHash,bytes32 courierHash,uint256 labelNonce)");
    bytes32 public constant DISPATCH_ATTESTATION_TYPEHASH =
        keccak256("DispatchAttestation(bytes32 orderId,bytes32 courierHash,address payout,uint256 deadline)");
    bytes32 public constant COURIER_ATTESTATION_TYPEHASH =
        keccak256("CourierAttestation(bytes32 orderId,bytes32 courierHash,bytes32 labelHash,uint256 deadline)");
    bytes32 public constant LOCK_PAYOUT_TYPEHASH =
        keccak256("LockPayout(bytes32 orderId,address financier,uint256 deadline)");
    bytes32 public constant VERDICT_TYPEHASH = keccak256(
        "Verdict(bytes32 orderId,uint8 outcome,uint16 refundBps,bytes32 serialReadHash,bytes32 frameHash,uint64 hcsSeq,uint256 deadline)"
    );
    bytes32 public constant RETURN_VERDICT_TYPEHASH = keccak256(
        "ReturnVerdict(bytes32 orderId,bytes32 returnedSerialHash,bytes32 frameHash,uint64 hcsSeq,uint256 deadline)"
    );

    uint64 public constant MIN_WINDOW = 60;
    uint64 public constant MAX_WINDOW = 7 days;
    uint64 public constant MAX_RETURN_WINDOW = 30 days;
    uint16 public constant BPS = 10_000;

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------

    IERC20 public immutable token;
    address public attester;
    mapping(address => bool) public isInspector;
    mapping(bytes32 => Order) private _orders;
    mapping(bytes32 => bool) public labelUsed;
    mapping(address => uint256) public refundPool;
    mapping(address => bool) public isFinancier;
    mapping(bytes32 => address) public payoutLockedTo;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event OrderCreated(
        bytes32 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 courierFee,
        PayMethod method
    );
    event Dispatched(bytes32 indexed orderId, address indexed courier, bytes32 courierHash);
    event HandedOver(
        bytes32 indexed orderId, address indexed courier, bytes32 courierHash, bytes32 serialHash, bytes32 labelHash
    );
    event ReturnToSender(bytes32 indexed orderId, address indexed courier);
    event PayoutLocked(bytes32 indexed orderId, address indexed financier);
    event FinancierSet(address financier, bool allowed);
    event FinancierHookFailed(bytes32 indexed orderId, address financier);
    event CourierPaid(bytes32 indexed orderId, address indexed courier, uint256 amount);
    event Settled(
        bytes32 indexed orderId,
        Outcome outcome,
        uint256 sellerAmount,
        uint256 buyerRefund,
        uint16 refundBps,
        uint64 hcsSeq,
        address inspector
    );
    event SellerPaid(bytes32 indexed orderId, address indexed seller, uint256 amount);
    event BuyerRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amount, Outcome reason);
    event TimeoutReleased(bytes32 indexed orderId, uint256 sellerAmount);
    event ReturnRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amount, uint64 hcsSeq);
    event DeliveryCancelled(bytes32 indexed orderId, address indexed buyer, uint256 amount);
    event RefundPoolDeposited(address indexed seller, uint256 amount);
    event RefundPoolWithdrawn(address indexed seller, uint256 amount);
    event AttesterSet(address attester);
    event InspectorSet(address inspector, bool allowed);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error OrderExists();
    error BadStatus(Status current);
    error Expired();
    error BadTerms();
    error BadSignature();
    error LabelAlreadyUsed();
    error WrongCourier();
    error NotInspector();
    error InspectionWindowClosed();
    error InspectionWindowOpen();
    error DeliveryWindowOpen();
    error ReturnWindowClosed();
    error SerialMismatch();
    error SerialMustDiffer();
    error BadOutcome();
    error RefundPoolTooLow();
    error ShortTransfer();
    error NotFinancier();
    error AlreadyLocked();

    constructor(IERC20 token_, address owner_, address attester_) EIP712("OpenBox", "1") Ownable(owner_) {
        token = token_;
        attester = attester_;
        emit AttesterSet(attester_);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setAttester(address a) external onlyOwner {
        attester = a;
        emit AttesterSet(a);
    }

    function setInspector(address i, bool allowed) external onlyOwner {
        isInspector[i] = allowed;
        emit InspectorSet(i, allowed);
    }

    function setFinancier(address f, bool allowed) external onlyOwner {
        isFinancier[f] = allowed;
        emit FinancierSet(f, allowed);
    }

    // ---------------------------------------------------------------------
    // Checkout
    // ---------------------------------------------------------------------

    /// Gasless path A: EIP-2612 permit. The relayer submits; `buyerSig` binds the permit to this order.
    function createOrderWithPermit(
        OrderTerms calldata t,
        bytes calldata sellerSig,
        address buyer,
        bytes calldata buyerSig,
        PermitSig calldata p
    ) external nonReentrant {
        bytes32 termsHash = _checkTerms(t, sellerSig);
        _checkIntent(t.orderId, buyer, termsHash, buyerSig);
        // try/catch: a front-run permit must not brick the order if the allowance is already in place.
        try IERC20Permit(address(token)).permit(buyer, address(this), t.amount, p.deadline, p.v, p.r, p.s) {} catch {}
        _pull(buyer, t.amount);
        _open(t, buyer, PayMethod.Permit);
    }

    /// Gasless path B: EIP-3009 receiveWithAuthorization. The nonce is derived from the order, so the
    /// authorization can only ever fund this order.
    function createOrderWithAuthorization(
        OrderTerms calldata t,
        bytes calldata sellerSig,
        address buyer,
        bytes calldata buyerSig,
        AuthSig calldata a
    ) external nonReentrant {
        bytes32 termsHash = _checkTerms(t, sellerSig);
        _checkIntent(t.orderId, buyer, termsHash, buyerSig);
        uint256 before = token.balanceOf(address(this));
        IERC3009(address(token)).receiveWithAuthorization(
            buyer, address(this), t.amount, a.validAfter, a.validBefore, authNonce(t.orderId, buyer), a.v, a.r, a.s
        );
        if (token.balanceOf(address(this)) - before != t.amount) revert ShortTransfer();
        _open(t, buyer, PayMethod.Authorization);
    }

    /// Path C: plain allowance. Used by the OpenBoxAccount smart-account fallback (approve + createOrder
    /// batched in one relayer-submitted call), where msg.sender is the buyer's account.
    function createOrder(OrderTerms calldata t, bytes calldata sellerSig) external nonReentrant {
        _checkTerms(t, sellerSig);
        _pull(msg.sender, t.amount);
        _open(t, msg.sender, PayMethod.Approve);
    }

    /// If the parcel is never handed over within the delivery window, the buyer gets everything back.
    function cancelUndelivered(bytes32 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.status != Status.Paid && o.status != Status.Dispatched) revert BadStatus(o.status);
        if (block.timestamp <= o.createdAt + o.deliveryWindow) revert DeliveryWindowOpen();
        o.status = Status.Cancelled;
        o.buyerRefunded = o.amount;
        token.safeTransfer(o.buyer, o.amount);
        emit DeliveryCancelled(orderId, o.buyer, o.amount);
        _notifyFinancier(orderId, Outcome.None, 0, o.amount);
    }

    // ---------------------------------------------------------------------
    // Dispatch: bind the World-verified courier to the order
    // ---------------------------------------------------------------------

    function dispatch(DispatchAttestation calldata d, bytes calldata attesterSig) external nonReentrant {
        Order storage o = _orders[d.orderId];
        if (o.status != Status.Paid) revert BadStatus(o.status);
        if (block.timestamp > d.deadline) revert Expired();
        if (ECDSA.recover(_hashTypedDataV4(hashDispatch(d)), attesterSig) != attester) revert BadSignature();
        o.status = Status.Dispatched;
        o.courierHash = d.courierHash;
        o.courier = d.payout;
        emit Dispatched(d.orderId, d.payout, d.courierHash);
    }

    // ---------------------------------------------------------------------
    // Doorbell handover
    // ---------------------------------------------------------------------

    /// Records the doorbell handover. Pays nothing: payment happens on the verdict (or timeout).
    function handover(
        Label calldata l,
        bytes calldata sellerSig,
        CourierAttestation calldata c,
        bytes calldata attesterSig
    ) external nonReentrant {
        Order storage o = _orders[l.orderId];
        bytes32 labelHash = hashLabel(l);
        if (labelUsed[labelHash]) revert LabelAlreadyUsed();
        if (o.status != Status.Dispatched) revert BadStatus(o.status);
        if (!SignatureChecker.isValidSignatureNow(o.seller, _hashTypedDataV4(labelHash), sellerSig)) {
            revert BadSignature();
        }
        if (c.orderId != l.orderId || c.labelHash != labelHash) revert BadSignature();
        if (block.timestamp > c.deadline) revert Expired();
        // Same person at the door as at dispatch, and the label names that courier.
        if (c.courierHash != o.courierHash || l.courierHash != o.courierHash) revert WrongCourier();
        if (ECDSA.recover(_hashTypedDataV4(hashCourierAttestation(c)), attesterSig) != attester) {
            revert BadSignature();
        }

        labelUsed[labelHash] = true;
        o.status = Status.HandedOver;
        o.serialHash = l.serialHash;
        o.handoverAt = uint64(block.timestamp);
        emit HandedOver(l.orderId, o.courier, c.courierHash, l.serialHash, labelHash);
    }

    // ---------------------------------------------------------------------
    // Open-box inspection
    // ---------------------------------------------------------------------

    function settle(Verdict calldata v, bytes calldata inspectorSig) external nonReentrant {
        Order storage o = _orders[v.orderId];
        if (o.status != Status.HandedOver) revert BadStatus(o.status);
        if (block.timestamp > o.handoverAt + o.inspectionWindow) revert InspectionWindowClosed();
        if (block.timestamp > v.deadline) revert Expired();
        address inspector = ECDSA.recover(_hashTypedDataV4(hashVerdict(v)), inspectorSig);
        if (!isInspector[inspector]) revert NotInspector();

        uint256 share = uint256(o.amount) - o.courierFee;
        uint256 refund;
        Outcome outcome = Outcome(v.outcome);
        uint16 bps;
        if (outcome == Outcome.Match) {
            if (v.serialReadHash != o.serialHash) revert SerialMismatch();
        } else if (outcome == Outcome.Mismatch) {
            if (v.serialReadHash == o.serialHash) revert SerialMustDiffer();
            bps = BPS;
            refund = share;
        } else if (outcome == Outcome.Damaged) {
            if (v.serialReadHash != o.serialHash) revert SerialMismatch();
            if (v.refundBps == 0 || v.refundBps > BPS) revert BadOutcome();
            bps = v.refundBps;
            refund = (share * bps) / BPS;
        } else {
            revert BadOutcome();
        }
        uint256 toSeller = share - refund;

        o.status = Status.Settled;
        o.outcome = outcome;
        o.refundBps = bps;
        o.settledAt = uint64(block.timestamp);
        o.buyerRefunded = uint128(refund);
        o.sellerPaid = uint128(toSeller);

        emit Settled(v.orderId, outcome, toSeller, refund, bps, v.hcsSeq, inspector);
        _payCourier(v.orderId, o);
        if (refund > 0) {
            token.safeTransfer(o.buyer, refund);
            emit BuyerRefunded(v.orderId, o.buyer, refund, outcome);
        }
        if (outcome == Outcome.Mismatch) emit ReturnToSender(v.orderId, o.courier);
        _paySeller(v.orderId, o, outcome, toSeller, refund);
    }

    /// No inspection within the window: the seller is paid. Callable by anyone (keeper / household agent).
    function timeoutRelease(bytes32 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.status != Status.HandedOver) revert BadStatus(o.status);
        if (block.timestamp <= o.handoverAt + o.inspectionWindow) revert InspectionWindowOpen();
        uint256 share = uint256(o.amount) - o.courierFee;
        o.status = Status.Settled;
        o.outcome = Outcome.Timeout;
        o.settledAt = uint64(block.timestamp);
        o.sellerPaid = uint128(share);
        emit TimeoutReleased(orderId, share);
        emit Settled(orderId, Outcome.Timeout, share, 0, 0, 0, address(0));
        _payCourier(orderId, o);
        _paySeller(orderId, o, Outcome.Timeout, share, 0);
    }

    // ---------------------------------------------------------------------
    // Financing hook: an allowlisted financier (e.g. ReceivableNote) takes over one order's seller payout
    // ---------------------------------------------------------------------

    function lockPayout(bytes32 orderId, uint256 deadline, bytes calldata sellerSig) external nonReentrant {
        if (!isFinancier[msg.sender]) revert NotFinancier();
        Order storage o = _orders[orderId];
        if (o.status != Status.Paid && o.status != Status.Dispatched && o.status != Status.HandedOver) {
            revert BadStatus(o.status);
        }
        if (payoutLockedTo[orderId] != address(0)) revert AlreadyLocked();
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(LOCK_PAYOUT_TYPEHASH, orderId, msg.sender, deadline)));
        if (!SignatureChecker.isValidSignatureNow(o.seller, digest, sellerSig)) revert BadSignature();
        payoutLockedTo[orderId] = msg.sender;
        emit PayoutLocked(orderId, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Returns
    // ---------------------------------------------------------------------

    function depositRefundPool(uint256 amount) external nonReentrant {
        _pull(msg.sender, amount);
        refundPool[msg.sender] += amount;
        emit RefundPoolDeposited(msg.sender, amount);
    }

    function withdrawRefundPool(uint256 amount) external nonReentrant {
        if (refundPool[msg.sender] < amount) revert RefundPoolTooLow();
        refundPool[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit RefundPoolWithdrawn(msg.sender, amount);
    }

    /// The returned item is inspected; the buyer is refunded what the seller received only if the
    /// returned serial equals the one packed. Paid from the seller's refund pool.
    function returnRefund(ReturnVerdict calldata r, bytes calldata inspectorSig) external nonReentrant {
        Order storage o = _orders[r.orderId];
        if (o.status != Status.Settled) revert BadStatus(o.status);
        if (o.outcome == Outcome.Mismatch) revert BadOutcome();
        if (block.timestamp > o.settledAt + o.returnWindow) revert ReturnWindowClosed();
        if (block.timestamp > r.deadline) revert Expired();
        address inspector = ECDSA.recover(_hashTypedDataV4(hashReturnVerdict(r)), inspectorSig);
        if (!isInspector[inspector]) revert NotInspector();
        if (r.returnedSerialHash != o.serialHash) revert SerialMismatch();

        uint256 amount = o.sellerPaid;
        if (refundPool[o.seller] < amount) revert RefundPoolTooLow();
        refundPool[o.seller] -= amount;
        o.status = Status.Returned;
        o.buyerRefunded += uint128(amount);
        token.safeTransfer(o.buyer, amount);
        emit ReturnRefunded(r.orderId, o.buyer, amount, r.hcsSeq);
    }

    // ---------------------------------------------------------------------
    // Views / hashing helpers (also used by off-chain signers and tests)
    // ---------------------------------------------------------------------

    function hashDispatch(DispatchAttestation calldata d) public pure returns (bytes32) {
        return keccak256(abi.encode(DISPATCH_ATTESTATION_TYPEHASH, d.orderId, d.courierHash, d.payout, d.deadline));
    }

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function authNonce(bytes32 orderId, address buyer) public pure returns (bytes32) {
        return keccak256(abi.encode(orderId, buyer));
    }

    function hashTerms(OrderTerms calldata t) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TERMS_TYPEHASH,
                t.orderId,
                t.seller,
                t.amount,
                t.courierFee,
                t.deliveryWindow,
                t.inspectionWindow,
                t.returnWindow,
                t.deadline
            )
        );
    }

    function hashLabel(Label calldata l) public pure returns (bytes32) {
        return keccak256(abi.encode(LABEL_TYPEHASH, l.orderId, l.serialHash, l.courierHash, l.labelNonce));
    }

    function hashCourierAttestation(CourierAttestation calldata c) public pure returns (bytes32) {
        return keccak256(
            abi.encode(COURIER_ATTESTATION_TYPEHASH, c.orderId, c.courierHash, c.labelHash, c.deadline)
        );
    }

    function hashVerdict(Verdict calldata v) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                VERDICT_TYPEHASH, v.orderId, v.outcome, v.refundBps, v.serialReadHash, v.frameHash, v.hcsSeq, v.deadline
            )
        );
    }

    function hashReturnVerdict(ReturnVerdict calldata r) public pure returns (bytes32) {
        return keccak256(
            abi.encode(RETURN_VERDICT_TYPEHASH, r.orderId, r.returnedSerialHash, r.frameHash, r.hcsSeq, r.deadline)
        );
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _checkTerms(OrderTerms calldata t, bytes calldata sellerSig) internal view returns (bytes32 termsHash) {
        if (_orders[t.orderId].status != Status.None) revert OrderExists();
        if (block.timestamp > t.deadline) revert Expired();
        if (
            t.seller == address(0) || t.amount == 0 || t.courierFee > t.amount || t.amount > type(uint128).max
                || t.inspectionWindow < MIN_WINDOW || t.inspectionWindow > MAX_WINDOW || t.deliveryWindow < MIN_WINDOW
                || t.deliveryWindow > 30 days || t.returnWindow > MAX_RETURN_WINDOW
        ) revert BadTerms();
        termsHash = hashTerms(t);
        if (!SignatureChecker.isValidSignatureNow(t.seller, _hashTypedDataV4(termsHash), sellerSig)) {
            revert BadSignature();
        }
    }

    function _checkIntent(bytes32 orderId, address buyer, bytes32 termsHash, bytes calldata buyerSig) internal view {
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(ORDER_INTENT_TYPEHASH, orderId, buyer, termsHash)));
        if (!SignatureChecker.isValidSignatureNow(buyer, digest, buyerSig)) revert BadSignature();
    }

    function _pull(address from, uint256 amount) internal {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - before != amount) revert ShortTransfer();
    }

    function _payCourier(bytes32 orderId, Order storage o) internal {
        if (o.courierFee > 0) token.safeTransfer(o.courier, o.courierFee);
        emit CourierPaid(orderId, o.courier, o.courierFee);
    }

    function _paySeller(bytes32 orderId, Order storage o, Outcome outcome, uint256 toSeller, uint256 refund) internal {
        address fin = payoutLockedTo[orderId];
        address to = fin == address(0) ? o.seller : fin;
        if (toSeller > 0) {
            token.safeTransfer(to, toSeller);
            emit SellerPaid(orderId, to, toSeller);
        }
        if (fin != address(0)) _notifyFinancier(orderId, outcome, toSeller, refund);
    }

    /// Financier bookkeeping must never block a buyer refund or a payout, so failures are logged, not bubbled.
    function _notifyFinancier(bytes32 orderId, Outcome outcome, uint256 toSeller, uint256 refund) internal {
        address fin = payoutLockedTo[orderId];
        if (fin == address(0)) return;
        try IPayoutReceiver(fin).onOrderSettled(orderId, uint8(outcome), toSeller, refund) {}
        catch {
            emit FinancierHookFailed(orderId, fin);
        }
    }

    function _open(OrderTerms calldata t, address buyer, PayMethod method) internal {
        Order storage o = _orders[t.orderId];
        o.buyer = buyer;
        o.seller = t.seller;
        o.status = Status.Paid;
        o.amount = uint128(t.amount);
        o.courierFee = uint128(t.courierFee);
        o.createdAt = uint64(block.timestamp);
        o.deliveryWindow = t.deliveryWindow;
        o.inspectionWindow = t.inspectionWindow;
        o.returnWindow = t.returnWindow;
        emit OrderCreated(t.orderId, buyer, t.seller, t.amount, t.courierFee, method);
    }
}
