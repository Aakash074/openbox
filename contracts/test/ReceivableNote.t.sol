// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeliveryCheckout} from "../src/DeliveryCheckout.sol";
import {ReceivableNote} from "../src/ReceivableNote.sol";
import {MockUSDT} from "./mocks/MockUSDT.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ReceivableNoteTest is Test {
    DeliveryCheckout dc;
    ReceivableNote rn;
    MockUSDT usdt;

    uint256 sellerPk = 0xA11CE;
    uint256 buyerPk = 0xB0B;
    uint256 attesterPk = 0xA77E57;
    uint256 inspectorPk = 0x1A5BEC7;
    address seller;
    address buyer;
    address inspector;
    address courier = address(0xC0C0);
    address lender = address(0x1E4D);
    address lender2 = address(0x1E4D2);
    address stranger = address(0x5157);

    bytes32 constant ALICE = keccak256("world:alice-courier");
    bytes32 constant SERIAL = keccak256("SN-OPENBOX-0001");
    bytes32 constant SOAP = keccak256("");
    bytes32 constant ID = "INV-1";

    uint256 constant AMOUNT = 100e6;
    uint256 constant FEE = 5e6;
    uint256 constant FACE = AMOUNT - FEE; // 95
    uint256 constant ADVANCE = 90e6; // lender pays 90 for a 95 receivable
    uint256 constant HOLDBACK = 9.5e6; // 10% of face kept as the seller's bond

    function setUp() public {
        vm.warp(1_700_000_000);
        seller = vm.addr(sellerPk);
        buyer = vm.addr(buyerPk);
        inspector = vm.addr(inspectorPk);
        usdt = new MockUSDT();
        dc = new DeliveryCheckout(IERC20(address(usdt)), address(this), vm.addr(attesterPk));
        dc.setInspector(inspector, true);
        rn = new ReceivableNote(IERC20(address(usdt)), dc, address(this));
        dc.setFinancier(address(rn), true);
        rn.setLender(lender, true);
        rn.setLender(lender2, true);
        usdt.mint(buyer, 1_000e6);
        for (uint256 i; i < 3; ++i) {
            address l = [lender, lender2, stranger][i];
            usdt.mint(l, 1_000e6);
            vm.prank(l);
            usdt.approve(address(rn), type(uint256).max);
        }
    }

    // ------------------------------------------------------------------ helpers

    function _signDc(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", dc.domainSeparator(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _signDigest(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _pay(bytes32 id) internal {
        DeliveryCheckout.OrderTerms memory t = DeliveryCheckout.OrderTerms({
            orderId: id,
            seller: seller,
            amount: AMOUNT,
            courierFee: FEE,
            deliveryWindow: 3 days,
            inspectionWindow: 120,
            returnWindow: 7 days,
            deadline: block.timestamp + 1 hours
        });
        bytes memory sSig = _signDc(sellerPk, dc.hashTerms(t));
        vm.prank(buyer);
        usdt.approve(address(dc), AMOUNT);
        vm.prank(buyer);
        dc.createOrder(t, sSig); // buyer is msg.sender on this path
    }

    function _lockSig(bytes32 id, uint256 deadline) internal view returns (bytes memory) {
        return _signDc(sellerPk, keccak256(abi.encode(dc.LOCK_PAYOUT_TYPEHASH(), id, address(rn), deadline)));
    }

    function _offerSig(uint256 pk, bytes32 id, uint256 adv, uint256 hold, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        return _signDigest(pk, rn.hashFinanceOffer(id, adv, hold, deadline));
    }

    function _sigs(bytes32 id) internal view returns (uint256 dl, bytes memory offer, bytes memory lockSig) {
        dl = block.timestamp + 10 minutes;
        offer = _offerSig(sellerPk, id, ADVANCE, HOLDBACK, dl);
        lockSig = _lockSig(id, dl);
    }

    function _finance(address who, bytes32 id) internal returns (uint256) {
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory offer = _offerSig(sellerPk, id, ADVANCE, HOLDBACK, dl);
        bytes memory lockSig = _lockSig(id, dl);
        vm.prank(who);
        return rn.finance(id, ADVANCE, HOLDBACK, dl, offer, lockSig);
    }

    function _handover(bytes32 id) internal {
        DeliveryCheckout.DispatchAttestation memory d =
            DeliveryCheckout.DispatchAttestation(id, ALICE, courier, block.timestamp + 5 minutes);
        dc.dispatch(d, _signDc(attesterPk, dc.hashDispatch(d)));
        DeliveryCheckout.Label memory l = DeliveryCheckout.Label(id, SERIAL, ALICE, 1);
        DeliveryCheckout.CourierAttestation memory c =
            DeliveryCheckout.CourierAttestation(id, ALICE, dc.hashLabel(l), block.timestamp + 5 minutes);
        dc.handover(l, _signDc(sellerPk, dc.hashLabel(l)), c, _signDc(attesterPk, dc.hashCourierAttestation(c)));
    }

    function _settle(bytes32 id, DeliveryCheckout.Outcome o, uint16 bps, bytes32 read) internal {
        DeliveryCheckout.Verdict memory v =
            DeliveryCheckout.Verdict(id, uint8(o), bps, read, keccak256("frame"), 7, block.timestamp + 5 minutes);
        dc.settle(v, _signDc(inspectorPk, dc.hashVerdict(v)));
    }

    // ------------------------------------------------------------------ funding

    function test_finance_paysSellerMintsNoteLocksPayout() public {
        _pay(ID);
        uint256 s0 = usdt.balanceOf(seller);
        uint256 id = _finance(lender, ID);

        assertEq(id, uint256(ID));
        assertEq(rn.ownerOf(id), lender);
        assertEq(dc.payoutLockedTo(ID), address(rn));
        assertEq(usdt.balanceOf(seller) - s0, ADVANCE - HOLDBACK, "seller gets advance minus bond today");
        assertEq(usdt.balanceOf(address(rn)), HOLDBACK, "bond held by the note contract");
        ReceivableNote.Note memory n = rn.getNote(id);
        assertEq(n.face, FACE);
        assertEq(n.advance, ADVANCE);
        assertEq(n.holdback, HOLDBACK);
        assertEq(uint8(n.status), uint8(ReceivableNote.NoteStatus.Active));
        assertEq(rn.activeCount(), 1);
        assertEq(rn.totalFunded(), ADVANCE);
    }

    function test_finance_afterHandover() public {
        _pay(ID);
        _handover(ID);
        _finance(lender, ID);
        assertEq(rn.ownerOf(uint256(ID)), lender);
    }

    function test_finance_revertsForNonLender() public {
        _pay(ID);
        (uint256 dl, bytes memory offer, bytes memory lockSig) = _sigs(ID);
        vm.prank(stranger);
        vm.expectRevert(ReceivableNote.NotLender.selector);
        rn.finance(ID, ADVANCE, HOLDBACK, dl, offer, lockSig);
    }

    function test_finance_revertsOnForgedOffer() public {
        _pay(ID);
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory forged = _offerSig(0xBAD, ID, ADVANCE, HOLDBACK, dl);
        bytes memory lockSig = _lockSig(ID, dl);
        vm.prank(lender);
        vm.expectRevert(ReceivableNote.BadSignature.selector);
        rn.finance(ID, ADVANCE, HOLDBACK, dl, forged, lockSig);
    }

    function test_finance_revertsWhenLenderChangesPrice() public {
        _pay(ID);
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory offer = _offerSig(sellerPk, ID, ADVANCE, HOLDBACK, dl);
        bytes memory lockSig = _lockSig(ID, dl);
        vm.prank(lender);
        vm.expectRevert(ReceivableNote.BadSignature.selector);
        rn.finance(ID, ADVANCE - 10e6, HOLDBACK, dl, offer, lockSig); // pays less than the seller agreed
    }

    function test_finance_revertsAdvanceAboveFace() public {
        _pay(ID);
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory offer = _offerSig(sellerPk, ID, FACE + 1, 0, dl);
        bytes memory lockSig = _lockSig(ID, dl);
        vm.prank(lender);
        vm.expectRevert(ReceivableNote.BadOffer.selector);
        rn.finance(ID, FACE + 1, 0, dl, offer, lockSig);
    }

    function test_finance_revertsExpired() public {
        _pay(ID);
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory offer = _offerSig(sellerPk, ID, ADVANCE, HOLDBACK, dl);
        bytes memory lockSig = _lockSig(ID, dl);
        vm.warp(dl + 1);
        vm.prank(lender);
        vm.expectRevert(ReceivableNote.Expired.selector);
        rn.finance(ID, ADVANCE, HOLDBACK, dl, offer, lockSig);
    }

    function test_finance_cannotDoubleFinance() public {
        _pay(ID);
        _finance(lender, ID);
        (uint256 dl, bytes memory offer, bytes memory lockSig) = _sigs(ID);
        vm.prank(lender2);
        vm.expectRevert(DeliveryCheckout.AlreadyLocked.selector);
        rn.finance(ID, ADVANCE, HOLDBACK, dl, offer, lockSig);
    }

    function test_finance_revertsAfterSettlement() public {
        _pay(ID);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Match, 0, SERIAL);
        (uint256 dl, bytes memory offer, bytes memory lockSig) = _sigs(ID);
        vm.prank(lender);
        vm.expectRevert(abi.encodeWithSelector(DeliveryCheckout.BadStatus.selector, DeliveryCheckout.Status.Settled));
        rn.finance(ID, ADVANCE, HOLDBACK, dl, offer, lockSig);
    }

    // ------------------------------------------------------------------ repayment

    function test_match_repaysFaceAndReturnsBond() public {
        _pay(ID);
        _finance(lender, ID);
        uint256 l0 = usdt.balanceOf(lender);
        uint256 s0 = usdt.balanceOf(seller);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Match, 0, SERIAL);

        assertEq(usdt.balanceOf(lender) - l0, FACE, "lender repaid in full: 90 in, 95 back");
        assertEq(usdt.balanceOf(seller) - s0, HOLDBACK, "bond returned to seller");
        assertEq(usdt.balanceOf(address(rn)), 0);
        ReceivableNote.Note memory n = rn.getNote(uint256(ID));
        assertEq(uint8(n.status), uint8(ReceivableNote.NoteStatus.Repaid));
        assertEq(n.repaid, FACE);
        assertEq(n.outcome, uint8(DeliveryCheckout.Outcome.Match));
        assertEq(rn.activeCount(), 0);
        vm.expectRevert();
        rn.ownerOf(uint256(ID)); // burned
    }

    function test_mismatch_bondCoversLender() public {
        _pay(ID);
        _finance(lender, ID);
        uint256 l0 = usdt.balanceOf(lender);
        uint256 s0 = usdt.balanceOf(seller);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Mismatch, 0, SOAP);

        assertEq(usdt.balanceOf(lender) - l0, HOLDBACK, "lender recovers the bond");
        assertEq(usdt.balanceOf(seller), s0, "seller gets nothing more");
        assertEq(uint8(rn.getNote(uint256(ID)).status), uint8(ReceivableNote.NoteStatus.Shortfall));
    }

    function test_damaged_partialRepayment() public {
        _pay(ID);
        _finance(lender, ID);
        uint256 l0 = usdt.balanceOf(lender);
        uint256 s0 = usdt.balanceOf(seller);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Damaged, 1500, SERIAL); // 15% back to the buyer

        uint256 received = FACE - (FACE * 1500) / 10_000; // 80.75
        assertEq(usdt.balanceOf(lender) - l0, received + HOLDBACK, "payout + bond, capped at face"); // 90.25
        assertEq(usdt.balanceOf(seller), s0);
        assertEq(uint8(rn.getNote(uint256(ID)).status), uint8(ReceivableNote.NoteStatus.Shortfall));
    }

    function test_damaged_smallRefund_bondCoversItAndRemainderToSeller() public {
        _pay(ID);
        _finance(lender, ID);
        uint256 l0 = usdt.balanceOf(lender);
        uint256 s0 = usdt.balanceOf(seller);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Damaged, 500, SERIAL); // 5% refund = 4.75 < 9.5 bond

        assertEq(usdt.balanceOf(lender) - l0, FACE, "lender still made whole");
        assertEq(usdt.balanceOf(seller) - s0, HOLDBACK - (FACE * 500) / 10_000, "rest of bond back to seller");
        assertEq(uint8(rn.getNote(uint256(ID)).status), uint8(ReceivableNote.NoteStatus.Repaid));
    }

    function test_timeout_repaysFace() public {
        _pay(ID);
        _finance(lender, ID);
        uint256 l0 = usdt.balanceOf(lender);
        _handover(ID);
        vm.warp(block.timestamp + 121);
        dc.timeoutRelease(ID);
        assertEq(usdt.balanceOf(lender) - l0, FACE);
    }

    function test_cancelledDelivery_bondCoversLender() public {
        _pay(ID);
        _finance(lender, ID);
        uint256 l0 = usdt.balanceOf(lender);
        vm.warp(block.timestamp + 3 days + 1);
        dc.cancelUndelivered(ID);
        assertEq(usdt.balanceOf(buyer), 1_000e6, "buyer fully refunded, never blocked by financing");
        assertEq(usdt.balanceOf(lender) - l0, HOLDBACK);
        assertEq(uint8(rn.getNote(uint256(ID)).status), uint8(ReceivableNote.NoteStatus.Shortfall));
    }

    // ------------------------------------------------------------------ secondary transfer

    function test_transferBetweenLenders_newHolderIsRepaid() public {
        _pay(ID);
        _finance(lender, ID);
        vm.prank(lender);
        rn.transferFrom(lender, lender2, uint256(ID));
        uint256 l1 = usdt.balanceOf(lender);
        uint256 l2 = usdt.balanceOf(lender2);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Match, 0, SERIAL);
        assertEq(usdt.balanceOf(lender2) - l2, FACE, "current holder is repaid");
        assertEq(usdt.balanceOf(lender), l1, "original funder gets nothing after selling the note");
    }

    function test_transferToNonLender_reverts() public {
        _pay(ID);
        _finance(lender, ID);
        vm.prank(lender);
        vm.expectRevert(ReceivableNote.NotLender.selector);
        rn.transferFrom(lender, stranger, uint256(ID));
    }

    // ------------------------------------------------------------------ guards

    function test_onlyCheckoutCanCallHook() public {
        _pay(ID);
        _finance(lender, ID);
        vm.expectRevert(ReceivableNote.NotCheckout.selector);
        rn.onOrderSettled(ID, 1, FACE, 0);
    }

    function test_resolve_revertsWhileOrderOpen_andAfterClose() public {
        _pay(ID);
        _finance(lender, ID);
        vm.expectRevert(ReceivableNote.OrderStillOpen.selector);
        rn.resolve(ID);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Match, 0, SERIAL);
        vm.expectRevert(ReceivableNote.NotActive.selector);
        rn.resolve(ID); // already closed by the callback: cannot be paid twice
    }

    function test_tokenURI_onChainMetadata() public {
        _pay(ID);
        _finance(lender, ID);
        string memory uri = rn.tokenURI(uint256(ID));
        assertEq(bytes(uri).length > 40, true);
        assertEq(_startsWith(uri, "data:application/json;base64,"), true);
    }

    function testFuzz_closeConservesFunds(uint16 bps, uint64 adv, uint64 hold) public {
        bps = uint16(bound(bps, 1, 10_000));
        uint256 advance = bound(adv, 1, FACE);
        uint256 holdback = bound(hold, 0, advance);
        _pay(ID);
        uint256 dl = block.timestamp + 10 minutes;
        bytes memory offer = _offerSig(sellerPk, ID, advance, holdback, dl);
        bytes memory lockSig = _lockSig(ID, dl);
        vm.prank(lender);
        rn.finance(ID, advance, holdback, dl, offer, lockSig);
        uint256 l0 = usdt.balanceOf(lender);
        uint256 s0 = usdt.balanceOf(seller);
        _handover(ID);
        _settle(ID, DeliveryCheckout.Outcome.Damaged, bps, SERIAL);
        uint256 received = FACE - (FACE * bps) / 10_000;
        uint256 toLender = usdt.balanceOf(lender) - l0;
        uint256 toSeller = usdt.balanceOf(seller) - s0;
        assertEq(toLender + toSeller, received + holdback, "nothing created or lost");
        assertLe(toLender, FACE, "holder never gets more than face");
        assertEq(usdt.balanceOf(address(rn)), 0, "note contract keeps nothing");
    }

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(p);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; ++i) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }
}
