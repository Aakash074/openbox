// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeliveryCheckout} from "../src/DeliveryCheckout.sol";
import {OpenBoxAccount, OpenBoxAccountFactory} from "../src/OpenBoxAccount.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract DeliveryCheckoutTest is Test {
    DeliveryCheckout dc;
    MockUSDT usdt;

    uint256 sellerPk = 0xA11CE;
    uint256 buyerPk = 0xB0B;
    uint256 attesterPk = 0xA77E57;
    uint256 inspectorPk = 0x1A5BEC7;
    uint256 roguePk = 0xBAD;
    address seller;
    address buyer;
    address attester;
    address inspector;
    address courier = address(0xC0C0);
    address relayer = address(0x7E1A7);

    bytes32 constant ALICE = keccak256("world:alice-courier");
    bytes32 constant MALLORY = keccak256("world:mallory");
    bytes32 constant SERIAL = keccak256("SN-OPENBOX-0001");
    bytes32 constant SOAP = keccak256("");

    uint256 constant AMOUNT = 100e6;
    uint256 constant FEE = 5e6;
    uint256 constant SHARE = AMOUNT - FEE;

    function setUp() public {
        vm.warp(1_700_000_000);
        seller = vm.addr(sellerPk);
        buyer = vm.addr(buyerPk);
        attester = vm.addr(attesterPk);
        inspector = vm.addr(inspectorPk);
        usdt = new MockUSDT();
        dc = new DeliveryCheckout(IERC20(address(usdt)), address(this), attester);
        dc.setInspector(inspector, true);
        usdt.mint(buyer, 1_000e6);
        usdt.mint(seller, 1_000e6);
    }

    // ------------------------------------------------------------------ helpers

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", dc.domainSeparator(), structHash));
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(structHash));
        return abi.encodePacked(r, s, v);
    }

    function _terms(bytes32 id) internal view returns (DeliveryCheckout.OrderTerms memory) {
        return DeliveryCheckout.OrderTerms({
            orderId: id,
            seller: seller,
            amount: AMOUNT,
            courierFee: FEE,
            deliveryWindow: 3 days,
            inspectionWindow: 120,
            returnWindow: 7 days,
            deadline: block.timestamp + 1 hours
        });
    }

    function _intentSig(uint256 pk, bytes32 id, address who, bytes32 termsHash) internal view returns (bytes memory) {
        return _sign(pk, keccak256(abi.encode(dc.ORDER_INTENT_TYPEHASH(), id, who, termsHash)));
    }

    function _payPermit(bytes32 id) internal {
        DeliveryCheckout.OrderTerms memory t = _terms(id);
        bytes32 th = dc.hashTerms(t);
        bytes memory sSig = _sign(sellerPk, th);
        bytes memory bSig = _intentSig(buyerPk, id, buyer, th);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 permitHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                buyer,
                address(dc),
                AMOUNT,
                usdt.nonces(buyer),
                dl
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(buyerPk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), permitHash)));
        vm.prank(relayer);
        dc.createOrderWithPermit(t, sSig, buyer, bSig, DeliveryCheckout.PermitSig(dl, v, r, s));
    }

    function _label(bytes32 id, bytes32 serial, bytes32 courierHash)
        internal
        view
        returns (DeliveryCheckout.Label memory l, bytes memory sig)
    {
        l = DeliveryCheckout.Label(id, serial, courierHash, 1);
        sig = _sign(sellerPk, dc.hashLabel(l));
    }

    function _attest(bytes32 id, bytes32 courierHash, bytes32 labelHash, uint256 pk)
        internal
        view
        returns (DeliveryCheckout.CourierAttestation memory c, bytes memory sig)
    {
        c = DeliveryCheckout.CourierAttestation(id, courierHash, labelHash, block.timestamp + 5 minutes);
        sig = _sign(pk, dc.hashCourierAttestation(c));
    }

    function _dispatch(bytes32 id, bytes32 courierHash) internal {
        DeliveryCheckout.DispatchAttestation memory d =
            DeliveryCheckout.DispatchAttestation(id, courierHash, courier, block.timestamp + 5 minutes);
        bytes memory sig = _sign(attesterPk, dc.hashDispatch(d));
        dc.dispatch(d, sig);
    }

    function _handover(bytes32 id) internal {
        _dispatch(id, ALICE);
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label(id, SERIAL, ALICE);
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest(id, ALICE, dc.hashLabel(l), attesterPk);
        dc.handover(l, ls, c, cs);
    }

    function _verdict(bytes32 id, DeliveryCheckout.Outcome o, uint16 bps, bytes32 read, uint256 pk)
        internal
        view
        returns (DeliveryCheckout.Verdict memory v, bytes memory sig)
    {
        v = DeliveryCheckout.Verdict(id, uint8(o), bps, read, keccak256("frame"), 42, block.timestamp + 5 minutes);
        sig = _sign(pk, dc.hashVerdict(v));
    }

    // ------------------------------------------------------------------ checkout paths

    function test_permitCheckout_holdsFunds() public {
        _payPermit("A");
        assertEq(usdt.balanceOf(address(dc)), AMOUNT);
        assertEq(uint8(dc.getOrder("A").status), uint8(DeliveryCheckout.Status.Paid));
        assertEq(dc.getOrder("A").buyer, buyer);
    }

    function test_authorizationCheckout() public {
        bytes32 id = "AUTH";
        DeliveryCheckout.OrderTerms memory t = _terms(id);
        bytes32 th = dc.hashTerms(t);
        bytes32 authHash = keccak256(
            abi.encode(
                usdt.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(),
                buyer,
                address(dc),
                AMOUNT,
                0,
                block.timestamp + 1 hours,
                dc.authNonce(id, buyer)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(buyerPk, keccak256(abi.encodePacked("\x19\x01", usdt.DOMAIN_SEPARATOR(), authHash)));
        vm.prank(relayer);
        dc.createOrderWithAuthorization(
            t,
            _sign(sellerPk, th),
            buyer,
            _intentSig(buyerPk, id, buyer, th),
            DeliveryCheckout.AuthSig(0, block.timestamp + 1 hours, v, r, s)
        );
        assertEq(usdt.balanceOf(address(dc)), AMOUNT);
    }

    function test_smartAccountCheckout_noPermitNo3009() public {
        usdt.setFeatures(false, false);
        OpenBoxAccountFactory f = new OpenBoxAccountFactory();
        address acct = f.accountAddress(buyer);
        usdt.mint(acct, AMOUNT); // funds arrive before the account exists
        vm.prank(relayer);
        f.createAccount(buyer);

        bytes32 id = "SA";
        DeliveryCheckout.OrderTerms memory t = _terms(id);
        OpenBoxAccount.Call[] memory calls = new OpenBoxAccount.Call[](2);
        calls[0] = OpenBoxAccount.Call(address(usdt), 0, abi.encodeCall(IERC20.approve, (address(dc), AMOUNT)));
        calls[1] = OpenBoxAccount.Call(
            address(dc), 0, abi.encodeCall(DeliveryCheckout.createOrder, (t, _sign(sellerPk, dc.hashTerms(t))))
        );
        OpenBoxAccount a = OpenBoxAccount(payable(acct));
        uint256 dl = block.timestamp + 1 hours;
        bytes32 sh = keccak256(abi.encode(a.EXECUTE_TYPEHASH(), a.hashCalls(calls), a.nonce(), dl));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(buyerPk, keccak256(abi.encodePacked("\x19\x01", a.domainSeparator(), sh)));
        vm.prank(relayer); // relayer pays gas, buyer only signed a message
        a.execute(calls, dl, abi.encodePacked(r, s, v));
        assertEq(dc.getOrder(id).buyer, acct);
        assertEq(usdt.balanceOf(address(dc)), AMOUNT);
    }

    function test_revert_relayerCannotReusePermitForOtherBuyerIntent() public {
        DeliveryCheckout.OrderTerms memory t = _terms("X");
        bytes32 th = dc.hashTerms(t);
        bytes memory bad = _intentSig(roguePk, "X", buyer, th);
        bytes memory sSig = _sign(sellerPk, th);
        vm.expectRevert(DeliveryCheckout.BadSignature.selector);
        dc.createOrderWithPermit(t, sSig, buyer, bad, DeliveryCheckout.PermitSig(0, 0, 0, 0));
    }

    function test_revert_forgedTerms() public {
        DeliveryCheckout.OrderTerms memory t = _terms("X");
        bytes32 th = dc.hashTerms(t);
        bytes memory sSig = _sign(roguePk, th);
        bytes memory bSig = _intentSig(buyerPk, "X", buyer, th);
        vm.expectRevert(DeliveryCheckout.BadSignature.selector);
        dc.createOrderWithPermit(t, sSig, buyer, bSig, DeliveryCheckout.PermitSig(0, 0, 0, 0));
    }

    function test_revert_duplicateOrder() public {
        _payPermit("A");
        DeliveryCheckout.OrderTerms memory t = _terms("A");
        bytes32 th = dc.hashTerms(t);
        bytes memory sSig = _sign(sellerPk, th);
        bytes memory bSig = _intentSig(buyerPk, "A", buyer, th);
        vm.expectRevert(DeliveryCheckout.OrderExists.selector);
        dc.createOrderWithPermit(t, sSig, buyer, bSig, DeliveryCheckout.PermitSig(0, 0, 0, 0));
    }

    function test_cancelUndelivered() public {
        _payPermit("A");
        vm.expectRevert(DeliveryCheckout.DeliveryWindowOpen.selector);
        dc.cancelUndelivered("A");
        vm.warp(block.timestamp + 3 days + 1);
        uint256 b = usdt.balanceOf(buyer);
        dc.cancelUndelivered("A");
        assertEq(usdt.balanceOf(buyer) - b, AMOUNT);
    }

    // ------------------------------------------------------------------ handover

    function test_handover_recordsButPaysNothing() public {
        _payPermit("A");
        _handover("A");
        assertEq(usdt.balanceOf(courier), 0);
        assertEq(uint8(dc.getOrder("A").status), uint8(DeliveryCheckout.Status.HandedOver));
    }

    function test_denied_reusedQr() public {
        _payPermit("A");
        _handover("A");
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label("A", SERIAL, ALICE);
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest("A", ALICE, dc.hashLabel(l), attesterPk);
        vm.expectRevert(DeliveryCheckout.LabelAlreadyUsed.selector);
        dc.handover(l, ls, c, cs);
        assertEq(usdt.balanceOf(courier), 0);
    }

    function test_denied_wrongCourier() public {
        _payPermit("A");
        _dispatch("A", ALICE);
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label("A", SERIAL, ALICE);
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest("A", MALLORY, dc.hashLabel(l), attesterPk);
        vm.expectRevert(DeliveryCheckout.WrongCourier.selector);
        dc.handover(l, ls, c, cs);
        assertEq(usdt.balanceOf(courier), 0);
    }

    function test_denied_forgedAttestation() public {
        _payPermit("A");
        _dispatch("A", ALICE);
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label("A", SERIAL, ALICE);
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) = _attest("A", ALICE, dc.hashLabel(l), roguePk);
        vm.expectRevert(DeliveryCheckout.BadSignature.selector);
        dc.handover(l, ls, c, cs);
    }

    function test_denied_expiredAttestation() public {
        _payPermit("A");
        _dispatch("A", ALICE);
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label("A", SERIAL, ALICE);
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest("A", ALICE, dc.hashLabel(l), attesterPk);
        vm.warp(block.timestamp + 6 minutes);
        vm.expectRevert(DeliveryCheckout.Expired.selector);
        dc.handover(l, ls, c, cs);
    }

    function test_denied_forgedLabel() public {
        _payPermit("A");
        _dispatch("A", ALICE);
        DeliveryCheckout.Label memory l = DeliveryCheckout.Label("A", SERIAL, ALICE, 1);
        bytes memory ls = _sign(roguePk, dc.hashLabel(l));
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest("A", ALICE, dc.hashLabel(l), attesterPk);
        vm.expectRevert(DeliveryCheckout.BadSignature.selector);
        dc.handover(l, ls, c, cs);
    }

    function test_denied_labelForOtherOrder() public {
        _payPermit("A");
        _payPermit("B");
        _dispatch("A", ALICE);
        _dispatch("B", ALICE);
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label("A", SERIAL, ALICE);
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest("B", ALICE, dc.hashLabel(l), attesterPk);
        vm.expectRevert(DeliveryCheckout.BadSignature.selector);
        dc.handover(l, ls, c, cs);
    }

    // ------------------------------------------------------------------ settlement

    function test_settle_match_paysSeller() public {
        _payPermit("B");
        _handover("B");
        uint256 s0 = usdt.balanceOf(seller);
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("B", DeliveryCheckout.Outcome.Match, 0, SERIAL, inspectorPk);
        dc.settle(v, sig);
        assertEq(usdt.balanceOf(seller) - s0, SHARE);
        assertEq(usdt.balanceOf(courier), FEE); // one settle call pays courier + seller
        assertEq(usdt.balanceOf(address(dc)), 0);
    }

    function test_settle_mismatch_refundsBuyer_courierKeepsFee() public {
        _payPermit("A");
        _handover("A");
        uint256 b0 = usdt.balanceOf(buyer);
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("A", DeliveryCheckout.Outcome.Mismatch, 0, SOAP, inspectorPk);
        dc.settle(v, sig);
        assertEq(usdt.balanceOf(buyer) - b0, SHARE);
        assertEq(usdt.balanceOf(courier), FEE);
    }

    function test_settle_damaged_partialRefund() public {
        _payPermit("C");
        _handover("C");
        uint256 b0 = usdt.balanceOf(buyer);
        uint256 s0 = usdt.balanceOf(seller);
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("C", DeliveryCheckout.Outcome.Damaged, 1500, SERIAL, inspectorPk);
        dc.settle(v, sig);
        assertEq(usdt.balanceOf(buyer) - b0, (SHARE * 1500) / 10_000);
        assertEq(usdt.balanceOf(seller) - s0, SHARE - (SHARE * 1500) / 10_000);
    }

    function testFuzz_damagedSplitConserves(uint16 bps) public {
        bps = uint16(bound(bps, 1, 10_000));
        _payPermit("C");
        _handover("C");
        uint256 b0 = usdt.balanceOf(buyer);
        uint256 s0 = usdt.balanceOf(seller);
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("C", DeliveryCheckout.Outcome.Damaged, bps, SERIAL, inspectorPk);
        dc.settle(v, sig);
        assertEq((usdt.balanceOf(buyer) - b0) + (usdt.balanceOf(seller) - s0), SHARE);
        assertEq(usdt.balanceOf(address(dc)), 0);
    }

    function test_revert_matchWithWrongSerial() public {
        _payPermit("A");
        _handover("A");
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("A", DeliveryCheckout.Outcome.Match, 0, SOAP, inspectorPk);
        vm.expectRevert(DeliveryCheckout.SerialMismatch.selector);
        dc.settle(v, sig);
    }

    function test_revert_mismatchWithSameSerial() public {
        _payPermit("A");
        _handover("A");
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("A", DeliveryCheckout.Outcome.Mismatch, 0, SERIAL, inspectorPk);
        vm.expectRevert(DeliveryCheckout.SerialMustDiffer.selector);
        dc.settle(v, sig);
    }

    function test_revert_nonInspector() public {
        _payPermit("A");
        _handover("A");
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("A", DeliveryCheckout.Outcome.Mismatch, 0, SOAP, roguePk);
        vm.expectRevert(DeliveryCheckout.NotInspector.selector);
        dc.settle(v, sig);
    }

    function test_revert_doubleSettle() public {
        _payPermit("B");
        _handover("B");
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("B", DeliveryCheckout.Outcome.Match, 0, SERIAL, inspectorPk);
        dc.settle(v, sig);
        vm.expectRevert(abi.encodeWithSelector(DeliveryCheckout.BadStatus.selector, DeliveryCheckout.Status.Settled));
        dc.settle(v, sig);
    }

    function test_revert_settleBeforeHandover() public {
        _payPermit("A");
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("A", DeliveryCheckout.Outcome.Mismatch, 0, SOAP, inspectorPk);
        vm.expectRevert(abi.encodeWithSelector(DeliveryCheckout.BadStatus.selector, DeliveryCheckout.Status.Paid));
        dc.settle(v, sig);
    }

    // ------------------------------------------------------------------ timeout

    function test_timeoutRelease() public {
        _payPermit("T");
        _handover("T");
        vm.expectRevert(DeliveryCheckout.InspectionWindowOpen.selector);
        dc.timeoutRelease("T");
        vm.warp(block.timestamp + 121);
        uint256 s0 = usdt.balanceOf(seller);
        dc.timeoutRelease("T");
        assertEq(usdt.balanceOf(seller) - s0, SHARE);
    }

    function test_revert_settleAfterWindow() public {
        _payPermit("T");
        _handover("T");
        vm.warp(block.timestamp + 121);
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("T", DeliveryCheckout.Outcome.Mismatch, 0, SOAP, inspectorPk);
        vm.expectRevert(DeliveryCheckout.InspectionWindowClosed.selector);
        dc.settle(v, sig);
    }

    // ------------------------------------------------------------------ returns

    function _returnVerdict(bytes32 id, bytes32 serial)
        internal
        view
        returns (DeliveryCheckout.ReturnVerdict memory r, bytes memory sig)
    {
        r = DeliveryCheckout.ReturnVerdict(id, serial, keccak256("rframe"), 43, block.timestamp + 5 minutes);
        sig = _sign(inspectorPk, dc.hashReturnVerdict(r));
    }

    function _settledMatch(bytes32 id) internal {
        _payPermit(id);
        _handover(id);
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict(id, DeliveryCheckout.Outcome.Match, 0, SERIAL, inspectorPk);
        dc.settle(v, sig);
    }

    function test_returnRefund_fromPool() public {
        _settledMatch("R");
        vm.startPrank(seller);
        usdt.approve(address(dc), 200e6);
        dc.depositRefundPool(200e6);
        vm.stopPrank();
        uint256 b0 = usdt.balanceOf(buyer);
        (DeliveryCheckout.ReturnVerdict memory r, bytes memory sig) = _returnVerdict("R", SERIAL);
        dc.returnRefund(r, sig);
        assertEq(usdt.balanceOf(buyer) - b0, SHARE);
        assertEq(dc.refundPool(seller), 200e6 - SHARE);
    }

    function test_revert_returnWrongSerial() public {
        _settledMatch("R");
        vm.startPrank(seller);
        usdt.approve(address(dc), 200e6);
        dc.depositRefundPool(200e6);
        vm.stopPrank();
        (DeliveryCheckout.ReturnVerdict memory r, bytes memory sig) = _returnVerdict("R", SOAP);
        vm.expectRevert(DeliveryCheckout.SerialMismatch.selector);
        dc.returnRefund(r, sig);
    }

    function test_revert_returnPoolTooLow() public {
        _settledMatch("R");
        (DeliveryCheckout.ReturnVerdict memory r, bytes memory sig) = _returnVerdict("R", SERIAL);
        vm.expectRevert(DeliveryCheckout.RefundPoolTooLow.selector);
        dc.returnRefund(r, sig);
    }

    function test_revert_returnAfterWindow() public {
        _settledMatch("R");
        vm.warp(block.timestamp + 7 days + 1);
        (DeliveryCheckout.ReturnVerdict memory r, bytes memory sig) = _returnVerdict("R", SERIAL);
        vm.expectRevert(DeliveryCheckout.ReturnWindowClosed.selector);
        dc.returnRefund(r, sig);
    }

    function test_withdrawRefundPool() public {
        vm.startPrank(seller);
        usdt.approve(address(dc), 50e6);
        dc.depositRefundPool(50e6);
        dc.withdrawRefundPool(50e6);
        vm.expectRevert(DeliveryCheckout.RefundPoolTooLow.selector);
        dc.withdrawRefundPool(1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ dispatch binding

    function test_dispatch_bindsCourier() public {
        _payPermit("A");
        _dispatch("A", ALICE);
        assertEq(dc.getOrder("A").courierHash, ALICE);
        assertEq(dc.getOrder("A").courier, courier);
    }

    function test_denied_sameCourierHashInLabelButDifferentPersonAtDoor() public {
        _payPermit("A");
        _dispatch("A", ALICE);
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label("A", SERIAL, ALICE);
        // backend would never sign this, but even a mis-signed attestation for Mallory is rejected on-chain
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest("A", MALLORY, dc.hashLabel(l), attesterPk);
        vm.expectRevert(DeliveryCheckout.WrongCourier.selector);
        dc.handover(l, ls, c, cs);
    }

    function test_revert_handoverWithoutDispatch() public {
        _payPermit("A");
        (DeliveryCheckout.Label memory l, bytes memory ls) = _label("A", SERIAL, ALICE);
        (DeliveryCheckout.CourierAttestation memory c, bytes memory cs) =
            _attest("A", ALICE, dc.hashLabel(l), attesterPk);
        vm.expectRevert(abi.encodeWithSelector(DeliveryCheckout.BadStatus.selector, DeliveryCheckout.Status.Paid));
        dc.handover(l, ls, c, cs);
    }

    function test_revert_dispatchForgedAttester() public {
        _payPermit("A");
        DeliveryCheckout.DispatchAttestation memory d =
            DeliveryCheckout.DispatchAttestation("A", ALICE, courier, block.timestamp + 5 minutes);
        bytes memory sig = _sign(roguePk, dc.hashDispatch(d));
        vm.expectRevert(DeliveryCheckout.BadSignature.selector);
        dc.dispatch(d, sig);
    }

    function test_timeout_paysCourierAndSeller() public {
        _payPermit("T");
        _handover("T");
        vm.warp(block.timestamp + 121);
        dc.timeoutRelease("T");
        assertEq(usdt.balanceOf(courier), FEE);
        assertEq(usdt.balanceOf(address(dc)), 0);
    }

    // ------------------------------------------------------------------ financing hook

    function _lock(bytes32 id, address fin) internal {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(sellerPk, keccak256(abi.encode(dc.LOCK_PAYOUT_TYPEHASH(), id, fin, dl)));
        vm.prank(fin);
        dc.lockPayout(id, dl, sig);
    }

    function test_lockPayout_routesSellerShareAndNotifies() public {
        MockFinancier fin = new MockFinancier();
        dc.setFinancier(address(fin), true);
        _payPermit("F");
        _lock("F", address(fin));
        _handover("F");
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("F", DeliveryCheckout.Outcome.Match, 0, SERIAL, inspectorPk);
        dc.settle(v, sig);
        assertEq(usdt.balanceOf(address(fin)), SHARE);
        assertEq(fin.lastOutcome(), uint8(DeliveryCheckout.Outcome.Match));
        assertEq(fin.lastSellerAmount(), SHARE);
    }

    function test_lockPayout_oneNotePerOrder() public {
        MockFinancier fin = new MockFinancier();
        dc.setFinancier(address(fin), true);
        _payPermit("F");
        _lock("F", address(fin));
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(sellerPk, keccak256(abi.encode(dc.LOCK_PAYOUT_TYPEHASH(), bytes32("F"), address(fin), dl)));
        vm.prank(address(fin));
        vm.expectRevert(DeliveryCheckout.AlreadyLocked.selector);
        dc.lockPayout("F", dl, sig);
    }

    function test_revert_lockPayoutNotFinancier() public {
        _payPermit("F");
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sign(sellerPk, keccak256(abi.encode(dc.LOCK_PAYOUT_TYPEHASH(), bytes32("F"), address(this), dl)));
        vm.expectRevert(DeliveryCheckout.NotFinancier.selector);
        dc.lockPayout("F", dl, sig);
    }

    function test_financierHookRevert_doesNotBlockRefund() public {
        RevertingFinancier fin = new RevertingFinancier();
        dc.setFinancier(address(fin), true);
        _payPermit("F");
        _lock("F", address(fin));
        _handover("F");
        uint256 b0 = usdt.balanceOf(buyer);
        (DeliveryCheckout.Verdict memory v, bytes memory sig) =
            _verdict("F", DeliveryCheckout.Outcome.Mismatch, 0, SOAP, inspectorPk);
        dc.settle(v, sig);
        assertEq(usdt.balanceOf(buyer) - b0, SHARE);
    }
}

contract MockFinancier {
    uint8 public lastOutcome;
    uint256 public lastSellerAmount;

    function onOrderSettled(bytes32, uint8 outcome, uint256 sellerAmount, uint256) external {
        lastOutcome = outcome;
        lastSellerAmount = sellerAmount;
    }
}

contract RevertingFinancier {
    function onOrderSettled(bytes32, uint8, uint256, uint256) external pure {
        revert("nope");
    }
}
