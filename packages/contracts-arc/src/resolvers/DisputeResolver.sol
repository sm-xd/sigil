// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IResolver, CLAIM_BROKEN, CLAIM_UPHELD} from "../interfaces/IResolver.sol";
import {SigilStake} from "../SigilStake.sol";

/// @notice Default resolver. One verifier key (held by the gateway) posts whether the disputer's trace
///         reproduced in the deterministic sandbox. That key is the trust boundary: it decides disputes,
///         but cannot touch funds outside one, and every verdict is re-runnable from the HCS-1 bundle.
contract DisputeResolver is IResolver {
    struct Verdict {
        bytes32 observedHash;
        bool reproduced;
        bool set;
    }

    address public immutable verifier;
    mapping(bytes32 => Verdict) public verdicts;

    event VerdictSubmitted(bytes32 indexed claimId, bytes32 observedHash, bool reproduced);

    constructor(address verifier_) {
        verifier = verifier_;
    }

    // `reproduced` is the verdict; resolve() additionally refuses a "reproduced" verdict whose observedHash is not the
    // disputer's traceHash, so a lying verifier cannot break a claim with a hash that never matched the evidence.
    // Added after the 2026-09-12 Arc testnet deployment (0xb741…e1a8 lacks this check); included in the next deploy.
    function submitVerdict(bytes32 claimId, bytes32 observedHash, bool reproduced) external {
        require(msg.sender == verifier, "not verifier");
        verdicts[claimId] = Verdict({observedHash: observedHash, reproduced: reproduced, set: true});
        emit VerdictSubmitted(claimId, observedHash, reproduced);
    }

    /// @dev Caller must be a SigilStake that holds this claim: its stakes(claimId) has to echo the id back.
    function resolve(bytes32 claimId) external view returns (address winner, bytes32 reason) {
        (bytes32 id, address staker,, address disputer,,,, bytes32 traceHash) = SigilStake(msg.sender).stakes(claimId);
        require(id == claimId, "unknown claim");
        Verdict storage v = verdicts[claimId];
        require(v.set, "no verdict");
        require(!v.reproduced || v.observedHash == traceHash, "hash mismatch");
        return v.reproduced ? (disputer, CLAIM_BROKEN) : (staker, CLAIM_UPHELD);
    }
}
