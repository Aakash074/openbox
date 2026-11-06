// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {DeliveryCheckout, IPayoutReceiver} from "./DeliveryCheckout.sol";

/// @title ReceivableNote: tokenized seller invoices backed by verified-delivery payouts.
/// @notice Once a buyer has paid, the seller's share of an OpenBox order is a receivable: it is paid when the
/// delivery is verified. A seller can sell that receivable to an allowlisted lender for an advance today.
/// The lender's capital pays the seller immediately (minus a holdback bond kept in this contract), the order's
/// payout is locked to this contract in `DeliveryCheckout`, and an ERC-721 note is minted to the lender.
/// When the order settles, the payout plus the bond repays the note holder up to the face value and any
/// remainder returns to the seller. If the box held the wrong item, was damaged, or never arrived, the bond
/// covers the lender first. Notes can be transferred only between allowlisted lenders.
contract ReceivableNote is ERC721, EIP712, Ownable, ReentrancyGuard, IPayoutReceiver {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    enum NoteStatus {
        None,
        Active,
        Repaid, // holder received the full face value
        Shortfall // holder received less than face (wrong item, damage or cancelled delivery)
    }

    struct Note {
        bytes32 orderId;
        address seller;
        address lender; // original funder
        uint128 face; // seller's share of the order (amount - courier fee)
        uint128 advance; // what the lender paid
        uint128 holdback; // part of the advance kept here as the seller's bond
        uint128 repaid; // what the holder got back at close
        uint64 fundedAt;
        uint64 closedAt;
        NoteStatus status;
        uint8 outcome; // DeliveryCheckout.Outcome at close
    }

    bytes32 public constant FINANCE_OFFER_TYPEHASH =
        keccak256("FinanceOffer(bytes32 orderId,uint256 advance,uint256 holdback,uint256 deadline)");

    IERC20 public immutable token;
    DeliveryCheckout public immutable checkout;

    mapping(address => bool) public isLender;
    mapping(uint256 => Note) private _notes;
    uint256 public activeCount;
    uint256 public totalFunded;
    uint256 public totalRepaid;

    event LenderSet(address indexed lender, bool allowed);
    event NoteFunded(
        uint256 indexed noteId,
        bytes32 indexed orderId,
        address indexed lender,
        address seller,
        uint256 face,
        uint256 advance,
        uint256 holdback
    );
    event NoteClosed(
        uint256 indexed noteId,
        bytes32 indexed orderId,
        address indexed holder,
        NoteStatus status,
        uint8 outcome,
        uint256 toHolder,
        uint256 toSeller
    );

    error NotLender();
    error NotCheckout();
    error BadOffer();
    error BadSignature();
    error Expired();
    error NotActive();
    error OrderStillOpen();

    constructor(IERC20 token_, DeliveryCheckout checkout_, address owner_)
        ERC721("OpenBox Receivable Note", "OBRN")
        EIP712("OpenBox Receivable", "1")
        Ownable(owner_)
    {
        token = token_;
        checkout = checkout_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setLender(address lender, bool allowed) external onlyOwner {
        isLender[lender] = allowed;
        emit LenderSet(lender, allowed);
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    /// @notice An allowlisted lender buys an order's receivable on the seller's signed terms.
    /// @param offerSig seller's EIP-712 `FinanceOffer` on this contract's domain (the price)
    /// @param lockSig  seller's EIP-712 `LockPayout(orderId, financier = this, deadline)` on DeliveryCheckout's domain
    function finance(
        bytes32 orderId,
        uint256 advance,
        uint256 holdback,
        uint256 deadline,
        bytes calldata offerSig,
        bytes calldata lockSig
    ) external nonReentrant returns (uint256 noteId) {
        if (!isLender[msg.sender]) revert NotLender();
        if (block.timestamp > deadline) revert Expired();
        DeliveryCheckout.Order memory o = checkout.getOrder(orderId);
        uint256 face = uint256(o.amount) - o.courierFee;
        if (advance == 0 || advance > face || holdback > advance) revert BadOffer();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(FINANCE_OFFER_TYPEHASH, orderId, advance, holdback, deadline)));
        if (!SignatureChecker.isValidSignatureNow(o.seller, digest, offerSig)) revert BadSignature();

        token.safeTransferFrom(msg.sender, address(this), advance);
        // Reverts unless the order is open, unlocked, and the seller agreed to route its payout here.
        checkout.lockPayout(orderId, deadline, lockSig);
        if (advance > holdback) token.safeTransfer(o.seller, advance - holdback);

        noteId = uint256(orderId);
        _notes[noteId] = Note({
            orderId: orderId,
            seller: o.seller,
            lender: msg.sender,
            face: uint128(face),
            advance: uint128(advance),
            holdback: uint128(holdback),
            repaid: 0,
            fundedAt: uint64(block.timestamp),
            closedAt: 0,
            status: NoteStatus.Active,
            outcome: 0
        });
        ++activeCount;
        totalFunded += advance;
        _mint(msg.sender, noteId);
        emit NoteFunded(noteId, orderId, msg.sender, o.seller, face, advance, holdback);
    }

    // ---------------------------------------------------------------------
    // Repayment
    // ---------------------------------------------------------------------

    /// @notice Called by DeliveryCheckout right after it has transferred `sellerAmount` here.
    function onOrderSettled(bytes32 orderId, uint8 outcome, uint256 sellerAmount, uint256) external nonReentrant {
        if (msg.sender != address(checkout)) revert NotCheckout();
        _close(uint256(orderId), outcome, sellerAmount);
    }

    /// @notice Fallback if the settlement callback ever failed: anyone can close a note once its order has ended.
    /// The payout itself was already transferred here by DeliveryCheckout before the callback ran.
    function resolve(bytes32 orderId) external nonReentrant {
        DeliveryCheckout.Order memory o = checkout.getOrder(orderId);
        if (o.status == DeliveryCheckout.Status.Cancelled) {
            _close(uint256(orderId), uint8(DeliveryCheckout.Outcome.None), 0);
        } else if (o.status == DeliveryCheckout.Status.Settled || o.status == DeliveryCheckout.Status.Returned) {
            _close(uint256(orderId), uint8(o.outcome), o.sellerPaid);
        } else {
            revert OrderStillOpen();
        }
    }

    function _close(uint256 noteId, uint8 outcome, uint256 received) internal {
        Note storage n = _notes[noteId];
        if (n.status != NoteStatus.Active) revert NotActive();
        address holder = ownerOf(noteId);
        uint256 pot = received + n.holdback;
        uint256 toHolder = pot < n.face ? pot : n.face;
        uint256 toSeller = pot - toHolder;

        n.status = toHolder == n.face ? NoteStatus.Repaid : NoteStatus.Shortfall;
        n.outcome = outcome;
        n.repaid = uint128(toHolder);
        n.closedAt = uint64(block.timestamp);
        --activeCount;
        totalRepaid += toHolder;
        _burn(noteId);

        if (toHolder > 0) token.safeTransfer(holder, toHolder);
        if (toSeller > 0) token.safeTransfer(n.seller, toSeller);
        emit NoteClosed(noteId, n.orderId, holder, n.status, outcome, toHolder, toSeller);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getNote(uint256 noteId) external view returns (Note memory) {
        return _notes[noteId];
    }

    function noteIdOf(bytes32 orderId) external pure returns (uint256) {
        return uint256(orderId);
    }

    function hashFinanceOffer(bytes32 orderId, uint256 advance, uint256 holdback, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(FINANCE_OFFER_TYPEHASH, orderId, advance, holdback, deadline)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// On-chain metadata so the note renders on explorers and wallets without a server.
    function tokenURI(uint256 noteId) public view override returns (string memory) {
        _requireOwned(noteId);
        Note memory n = _notes[noteId];
        string memory json = string.concat(
            '{"name":"OpenBox receivable ',
            _usdt(n.face),
            ' USDT","description":"Seller payout of OpenBox order ',
            uint256(n.orderId).toHexString(32),
            ', released when delivery is verified. Holder is repaid up to face value at settlement.",',
            '"attributes":[{"trait_type":"Face value (USDT)","value":"',
            _usdt(n.face),
            '"},{"trait_type":"Advance (USDT)","value":"',
            _usdt(n.advance),
            '"},{"trait_type":"Seller bond (USDT)","value":"',
            _usdt(n.holdback),
            '"},{"trait_type":"Seller","value":"',
            Strings.toHexString(n.seller),
            '"},{"trait_type":"Funded at","display_type":"date","value":',
            uint256(n.fundedAt).toString(),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _usdt(uint256 v) internal pure returns (string memory) {
        uint256 cents = (v % 1e6) / 1e4;
        return string.concat((v / 1e6).toString(), ".", cents < 10 ? "0" : "", cents.toString());
    }

    // ---------------------------------------------------------------------
    // Transfer restriction: notes move only between allowlisted lenders
    // ---------------------------------------------------------------------

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0) && !isLender[to]) revert NotLender();
    }
}
