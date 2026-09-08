// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IResolver} from "./interfaces/IResolver.sol";

/// @notice USDC escrow for Sigil claims: holds a stake and, once disputed, a counter-bond, and pays the
///         whole pot to whichever party the resolver names. The only contract that holds funds.
/// @dev    No owner, no setters, no upgrade path. Every parameter is a constructor immutable, so there is
///         no key that can move user funds. Payout is push (safeTransfer to the winner): USDC on Arc has no
///         transfer hooks, so pull-payment would only add a second function and a second state.
contract SigilStake is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { None, Live, Disputed, Resolved }

    // Field order is the public ABI (`stakes(bytes32)` tuple); do not reorder.
    struct Stake {
        bytes32 claimId;
        address staker;
        uint256 amount;
        address disputer;
        uint256 counterBond;
        State state;
        uint64 createdAt;
        bytes32 traceHash;
    }

    IERC20 public immutable usdc;
    IResolver public immutable resolver;
    uint256 public immutable minStake;   // USDC base units (6dp)
    uint256 public immutable minBondBps; // counter-bond floor as basis points of the stake
    uint64 public immutable cooldown;    // seconds a Live claim must age before withdrawUnchallenged

    mapping(bytes32 => Stake) public stakes;

    event ClaimOpened(bytes32 indexed claimId, address staker, uint256 amount);
    event Disputed(bytes32 indexed claimId, address disputer, uint256 bond, bytes32 traceHash);
    event Resolved(bytes32 indexed claimId, address winner, uint256 payout, bytes32 reason);
    event Withdrawn(bytes32 indexed claimId, address staker, uint256 amount);

    constructor(IERC20 usdc_, IResolver resolver_, uint256 minStake_, uint256 minBondBps_, uint64 cooldown_) {
        usdc = usdc_;
        resolver = resolver_;
        minStake = minStake_;
        minBondBps = minBondBps_;
        cooldown = cooldown_;
    }

    /// @notice Lock `amount` USDC behind `claimId`. Caller must have approved this contract.
    function openClaim(bytes32 claimId, uint256 amount) external nonReentrant {
        Stake storage s = stakes[claimId];
        require(s.state == State.None, "claim exists");
        require(amount >= minStake, "below min stake");
        s.claimId = claimId;
        s.staker = msg.sender;
        s.amount = amount;
        s.state = State.Live;
        s.createdAt = uint64(block.timestamp);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit ClaimOpened(claimId, msg.sender, amount);
    }

    /// @notice Challenge a Live claim with a counter-bond and the hash of a reproducible trace.
    function dispute(bytes32 claimId, uint256 counterBond, bytes32 traceHash) external nonReentrant {
        Stake storage s = stakes[claimId];
        require(s.state == State.Live, "not live");
        require(msg.sender != s.staker, "own claim");
        require(counterBond >= s.amount * minBondBps / 10_000, "below min bond");
        s.disputer = msg.sender;
        s.counterBond = counterBond;
        s.traceHash = traceHash;
        s.state = State.Disputed;
        usdc.safeTransferFrom(msg.sender, address(this), counterBond);
        emit Disputed(claimId, msg.sender, counterBond, traceHash);
    }

    /// @notice Settle a Disputed claim: ask the resolver who won, pay them stake + counter-bond.
    /// @dev    The resolver is consulted before the state write because its answer decides the payee;
    ///         it is a deployer-chosen immutable and the function is nonReentrant, so that is safe.
    function resolve(bytes32 claimId) external nonReentrant {
        Stake storage s = stakes[claimId];
        require(s.state == State.Disputed, "not disputed");
        (address winner, bytes32 reason) = resolver.resolve(claimId);
        require(winner == s.staker || winner == s.disputer, "bad winner");
        s.state = State.Resolved;
        uint256 payout = s.amount + s.counterBond;
        usdc.safeTransfer(winner, payout);
        emit Resolved(claimId, winner, payout, reason);
    }

    /// @notice Staker reclaims a claim nobody disputed within the cooldown.
    function withdrawUnchallenged(bytes32 claimId) external nonReentrant {
        Stake storage s = stakes[claimId];
        require(s.state == State.Live, "not live");
        require(msg.sender == s.staker, "not staker");
        require(block.timestamp >= s.createdAt + cooldown, "cooldown");
        s.state = State.Resolved;
        usdc.safeTransfer(msg.sender, s.amount);
        emit Withdrawn(claimId, msg.sender, s.amount);
    }
}
