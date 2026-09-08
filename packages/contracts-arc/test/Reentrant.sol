// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockUSDC} from "./MockUSDC.sol";
import {SigilStake} from "../src/SigilStake.sol";

/// @dev Malicious USDC: when SigilStake pays out via transfer(), re-enter the stake mid-payout.
contract ReentrantUSDC is MockUSDC {
    enum Attack { None, Resolve, Withdraw }

    Attack public attack;
    bytes32 public claimId;

    function arm(Attack attack_, bytes32 claimId_) external {
        attack = attack_;
        claimId = claimId_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        Attack a = attack;
        attack = Attack.None;
        if (a == Attack.Resolve) SigilStake(msg.sender).resolve(claimId);
        if (a == Attack.Withdraw) SigilStake(msg.sender).withdrawUnchallenged(claimId);
        return super.transfer(to, amount);
    }
}
