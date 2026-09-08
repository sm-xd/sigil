// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Pluggable resolution. SigilStake calls resolve() once a claim is Disputed and pays `winner` the pot.
///         Which resolver is installed is a SigilStake constructor argument and nothing else.
interface IResolver {
    /// @return winner  address receiving the pot (must be the claim's staker or disputer)
    /// @return reason  short machine-readable code, recorded on HCS
    function resolve(bytes32 claimId) external returns (address winner, bytes32 reason);
}

// Shared reason vocabulary. Consumers see only these two codes, never resolver internals.
bytes32 constant CLAIM_BROKEN = "CLAIM_BROKEN";
bytes32 constant CLAIM_UPHELD = "CLAIM_UPHELD";
