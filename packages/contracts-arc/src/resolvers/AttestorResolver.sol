// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IResolver, CLAIM_BROKEN, CLAIM_UPHELD} from "../interfaces/IResolver.sol";
import {SigilStake} from "../SigilStake.sol";

/// @notice Alternate resolver. A single attestor runs the predicate suite and posts whether the claim holds.
///         Same interface as DisputeResolver; switching is only the SigilStake constructor argument.
// ponytail: attestor bond/slashing not implemented; add when the alternate resolver is actually deployed.
contract AttestorResolver is IResolver {
    struct Attestation {
        bool holds;
        bool set;
    }

    address public immutable attestor;
    mapping(bytes32 => Attestation) public attestations;

    event Attested(bytes32 indexed claimId, bool holds);

    constructor(address attestor_) {
        attestor = attestor_;
    }

    function attest(bytes32 claimId, bool holds) external {
        require(msg.sender == attestor, "not attestor");
        attestations[claimId] = Attestation({holds: holds, set: true});
        emit Attested(claimId, holds);
    }

    /// @dev Caller must be a SigilStake that holds this claim: its stakes(claimId) has to echo the id back.
    function resolve(bytes32 claimId) external view returns (address winner, bytes32 reason) {
        (bytes32 id, address staker,, address disputer,,,,) = SigilStake(msg.sender).stakes(claimId);
        require(id == claimId, "unknown claim");
        Attestation storage a = attestations[claimId];
        require(a.set, "no attestation");
        return a.holds ? (staker, CLAIM_UPHELD) : (disputer, CLAIM_BROKEN);
    }
}
