// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SigilStake} from "../src/SigilStake.sol";
import {IResolver, CLAIM_BROKEN, CLAIM_UPHELD} from "../src/interfaces/IResolver.sol";
import {DisputeResolver} from "../src/resolvers/DisputeResolver.sol";
import {AttestorResolver} from "../src/resolvers/AttestorResolver.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {ReentrantUSDC} from "./Reentrant.sol";

/// @dev Resolver that names a stranger as winner; SigilStake must refuse to pay it.
contract BadResolver is IResolver {
    function resolve(bytes32) external pure returns (address, bytes32) {
        return (address(0xBAD), "BAD");
    }
}

contract SigilStakeTest is Test {
    uint256 constant MIN_STAKE = 10e6;
    uint256 constant MIN_BOND_BPS = 2500;
    uint64 constant COOLDOWN = 60;
    uint256 constant STAKE = 100e6;
    uint256 constant BOND = 25e6; // exactly 25% of STAKE
    uint256 constant FUNDS = 1000e6;
    bytes32 constant CLAIM = keccak256("claim-1");
    bytes32 constant TRACE = keccak256("trace");

    address staker = makeAddr("staker");
    address disputer = makeAddr("disputer");
    address verifier = makeAddr("verifier");
    address attestor = makeAddr("attestor");

    MockUSDC usdc;
    DisputeResolver resolver;
    SigilStake stake;

    function setUp() public {
        usdc = new MockUSDC();
        resolver = new DisputeResolver(verifier);
        stake = _deploy(usdc, resolver);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _deploy(MockUSDC token, IResolver r) internal returns (SigilStake s) {
        s = new SigilStake(token, r, MIN_STAKE, MIN_BOND_BPS, COOLDOWN);
        _fund(token, s, staker);
        _fund(token, s, disputer);
    }

    function _fund(MockUSDC token, SigilStake s, address who) internal {
        token.mint(who, FUNDS - token.balanceOf(who)); // top up to exactly FUNDS, however many stakes share the token
        vm.prank(who);
        token.approve(address(s), type(uint256).max);
    }

    function _open(SigilStake s) internal {
        vm.prank(staker);
        s.openClaim(CLAIM, STAKE);
    }

    function _dispute(SigilStake s) internal {
        vm.prank(disputer);
        s.dispute(CLAIM, BOND, TRACE);
    }

    function _verdict(bool reproduced) internal {
        vm.prank(verifier);
        resolver.submitVerdict(CLAIM, TRACE, reproduced);
    }

    function _state(SigilStake s) internal view returns (uint8) {
        SigilStake.State st;
        (,,,,, st,,) = s.stakes(CLAIM);
        return uint8(st);
    }

    // ── open ─────────────────────────────────────────────────────────────────

    function test_openClaim_storesStake_andPullsUsdc() public {
        vm.expectEmit(address(stake));
        emit SigilStake.ClaimOpened(CLAIM, staker, STAKE);
        _open(stake);

        (
            bytes32 id,
            address st,
            uint256 amt,
            address d,
            uint256 bond,
            SigilStake.State state,
            uint64 createdAt,
            bytes32 th
        ) = stake.stakes(CLAIM);
        assertEq(id, CLAIM);
        assertEq(st, staker);
        assertEq(amt, STAKE);
        assertEq(d, address(0));
        assertEq(bond, 0);
        assertEq(uint8(state), uint8(SigilStake.State.Live));
        assertEq(createdAt, uint64(block.timestamp));
        assertEq(th, bytes32(0));
        assertEq(usdc.balanceOf(address(stake)), STAKE);
        assertEq(usdc.balanceOf(staker), FUNDS - STAKE);
    }

    function test_openClaim_belowMinStake_reverts() public {
        vm.prank(staker);
        vm.expectRevert("below min stake");
        stake.openClaim(CLAIM, MIN_STAKE - 1);
    }

    function test_openClaim_duplicate_reverts() public {
        _open(stake);
        vm.prank(disputer);
        vm.expectRevert("claim exists");
        stake.openClaim(CLAIM, STAKE);
    }

    // ── withdraw unchallenged ────────────────────────────────────────────────

    function test_withdrawUnchallenged_afterCooldown() public {
        _open(stake);
        vm.warp(block.timestamp + COOLDOWN);
        vm.expectEmit(address(stake));
        emit SigilStake.Withdrawn(CLAIM, staker, STAKE);
        vm.prank(staker);
        stake.withdrawUnchallenged(CLAIM);

        assertEq(_state(stake), uint8(SigilStake.State.Resolved));
        assertEq(usdc.balanceOf(staker), FUNDS);
        assertEq(usdc.balanceOf(address(stake)), 0);
    }

    function test_withdrawUnchallenged_beforeCooldown_reverts() public {
        _open(stake);
        vm.warp(block.timestamp + COOLDOWN - 1);
        vm.prank(staker);
        vm.expectRevert("cooldown");
        stake.withdrawUnchallenged(CLAIM);
    }

    function test_withdrawUnchallenged_notStaker_reverts() public {
        _open(stake);
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(disputer);
        vm.expectRevert("not staker");
        stake.withdrawUnchallenged(CLAIM);
    }

    function test_withdrawUnchallenged_afterDispute_reverts() public {
        _open(stake);
        _dispute(stake);
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(staker);
        vm.expectRevert("not live");
        stake.withdrawUnchallenged(CLAIM);
    }

    // ── dispute ──────────────────────────────────────────────────────────────

    function test_dispute_storesBondAndTrace() public {
        _open(stake);
        vm.expectEmit(address(stake));
        emit SigilStake.Disputed(CLAIM, disputer, BOND, TRACE);
        _dispute(stake);

        (,,, address d, uint256 bond, SigilStake.State state,, bytes32 th) = stake.stakes(CLAIM);
        assertEq(d, disputer);
        assertEq(bond, BOND);
        assertEq(uint8(state), uint8(SigilStake.State.Disputed));
        assertEq(th, TRACE);
        assertEq(usdc.balanceOf(address(stake)), STAKE + BOND);
    }

    function test_dispute_twice_reverts() public {
        _open(stake);
        _dispute(stake);
        vm.prank(disputer);
        vm.expectRevert("not live");
        stake.dispute(CLAIM, BOND, TRACE);
    }

    function test_dispute_belowMinBond_reverts() public {
        _open(stake);
        vm.prank(disputer);
        vm.expectRevert("below min bond");
        stake.dispute(CLAIM, BOND - 1, TRACE);
    }

    function test_dispute_byStaker_reverts() public {
        _open(stake);
        vm.prank(staker);
        vm.expectRevert("own claim");
        stake.dispute(CLAIM, BOND, TRACE);
    }

    function test_dispute_unknownClaim_reverts() public {
        vm.prank(disputer);
        vm.expectRevert("not live");
        stake.dispute(CLAIM, BOND, TRACE);
    }

    // ── resolve via DisputeResolver ──────────────────────────────────────────

    function test_resolve_reproduced_disputerTakesPot() public {
        _open(stake);
        _dispute(stake);
        _verdict(true);

        vm.expectEmit(address(stake));
        emit SigilStake.Resolved(CLAIM, disputer, STAKE + BOND, CLAIM_BROKEN);
        stake.resolve(CLAIM);

        assertEq(_state(stake), uint8(SigilStake.State.Resolved));
        assertEq(usdc.balanceOf(disputer), FUNDS + STAKE);
        assertEq(usdc.balanceOf(staker), FUNDS - STAKE);
        assertEq(usdc.balanceOf(address(stake)), 0);
    }

    function test_resolve_reproducedWithWrongHash_reverts() public {
        _open(stake);
        _dispute(stake);
        vm.prank(verifier);
        resolver.submitVerdict(CLAIM, keccak256("some other trace"), true); // "reproduced" but not the disputer's evidence

        vm.expectRevert("hash mismatch");
        stake.resolve(CLAIM);
        assertEq(_state(stake), uint8(SigilStake.State.Disputed));
    }

    function test_resolve_notReproduced_stakerTakesPot() public {
        _open(stake);
        _dispute(stake);
        _verdict(false);

        vm.expectEmit(address(stake));
        emit SigilStake.Resolved(CLAIM, staker, STAKE + BOND, CLAIM_UPHELD);
        stake.resolve(CLAIM);

        assertEq(usdc.balanceOf(staker), FUNDS + BOND);
        assertEq(usdc.balanceOf(disputer), FUNDS - BOND);
        assertEq(usdc.balanceOf(address(stake)), 0);
    }

    function test_resolve_beforeDispute_reverts() public {
        _open(stake);
        _verdict(true);
        vm.expectRevert("not disputed");
        stake.resolve(CLAIM);
    }

    function test_resolve_beforeVerdict_reverts() public {
        _open(stake);
        _dispute(stake);
        vm.expectRevert("no verdict");
        stake.resolve(CLAIM);
    }

    function test_resolve_twice_reverts() public {
        _open(stake);
        _dispute(stake);
        _verdict(true);
        stake.resolve(CLAIM);
        vm.expectRevert("not disputed");
        stake.resolve(CLAIM);
    }

    function test_resolve_winnerOutsideClaim_reverts() public {
        SigilStake bad = _deploy(usdc, new BadResolver());
        _open(bad);
        _dispute(bad);
        vm.expectRevert("bad winner");
        bad.resolve(CLAIM);
    }

    // ── resolver access control ──────────────────────────────────────────────

    function test_submitVerdict_notVerifier_reverts() public {
        vm.prank(disputer);
        vm.expectRevert("not verifier");
        resolver.submitVerdict(CLAIM, TRACE, true);
    }

    function test_resolverResolve_fromEoa_reverts() public {
        _verdict(true);
        vm.prank(makeAddr("eoa"));
        vm.expectRevert();
        resolver.resolve(CLAIM);
    }

    function test_resolverResolve_fromStakeWithoutClaim_reverts() public {
        _open(stake);
        _dispute(stake);
        _verdict(true);
        SigilStake other = new SigilStake(usdc, resolver, MIN_STAKE, MIN_BOND_BPS, COOLDOWN);
        vm.prank(address(other));
        vm.expectRevert("unknown claim");
        resolver.resolve(CLAIM);
    }

    // ── reentrancy ───────────────────────────────────────────────────────────

    function test_reentrancy_onResolve_reverts() public {
        ReentrantUSDC evil = new ReentrantUSDC();
        SigilStake s = _deploy(evil, resolver);
        _open(s);
        _dispute(s);
        _verdict(true);
        evil.arm(ReentrantUSDC.Attack.Resolve, CLAIM);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        s.resolve(CLAIM);
        assertEq(_state(s), uint8(SigilStake.State.Disputed));
        assertEq(evil.balanceOf(address(s)), STAKE + BOND);
    }

    function test_reentrancy_onWithdraw_reverts() public {
        ReentrantUSDC evil = new ReentrantUSDC();
        SigilStake s = _deploy(evil, resolver);
        _open(s);
        vm.warp(block.timestamp + COOLDOWN);
        evil.arm(ReentrantUSDC.Attack.Withdraw, CLAIM);

        vm.prank(staker);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        s.withdrawUnchallenged(CLAIM);
        assertEq(_state(s), uint8(SigilStake.State.Live));
        assertEq(evil.balanceOf(address(s)), STAKE);
    }

    // ── AttestorResolver full cycle ──────────────────────────────────────────

    function test_attestor_holds_stakerTakesPot() public {
        AttestorResolver att = new AttestorResolver(attestor);
        SigilStake s = _deploy(usdc, att);
        _open(s);
        _dispute(s);
        vm.prank(attestor);
        att.attest(CLAIM, true);

        vm.expectEmit(address(s));
        emit SigilStake.Resolved(CLAIM, staker, STAKE + BOND, CLAIM_UPHELD);
        s.resolve(CLAIM);
        assertEq(usdc.balanceOf(staker), FUNDS + BOND);
        assertEq(usdc.balanceOf(disputer), FUNDS - BOND);
    }

    function test_attestor_broken_disputerTakesPot() public {
        AttestorResolver att = new AttestorResolver(attestor);
        SigilStake s = _deploy(usdc, att);
        _open(s);
        _dispute(s);
        vm.prank(attestor);
        att.attest(CLAIM, false);

        vm.expectEmit(address(s));
        emit SigilStake.Resolved(CLAIM, disputer, STAKE + BOND, CLAIM_BROKEN);
        s.resolve(CLAIM);
        assertEq(usdc.balanceOf(disputer), FUNDS + STAKE);
        assertEq(usdc.balanceOf(staker), FUNDS - STAKE);
    }

    function test_attestor_beforeAttest_reverts() public {
        AttestorResolver att = new AttestorResolver(attestor);
        SigilStake s = _deploy(usdc, att);
        _open(s);
        _dispute(s);
        vm.expectRevert("no attestation");
        s.resolve(CLAIM);
    }

    function test_attest_notAttestor_reverts() public {
        AttestorResolver att = new AttestorResolver(attestor);
        vm.prank(disputer);
        vm.expectRevert("not attestor");
        att.attest(CLAIM, true);
    }
}
