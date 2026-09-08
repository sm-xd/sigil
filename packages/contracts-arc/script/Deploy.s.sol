// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SigilStake} from "../src/SigilStake.sol";
import {DisputeResolver} from "../src/resolvers/DisputeResolver.sol";

/// @notice Deploys DisputeResolver(verifier) then SigilStake(usdc, resolver, ...). Driven by scripts/deploy.ts.
/// @dev    Env: ARC_USDC_ADDRESS, VERIFIER_ADDRESS, ARC_DEPLOYER_KEY (0x-hex). Gas on Arc is paid in USDC.
contract Deploy is Script {
    uint256 constant MIN_STAKE = 10e6;    // 10 USDC
    uint256 constant MIN_BOND_BPS = 2500; // counter-bond >= 25% of stake
    // ponytail: 60s so the testnet demo is watchable. Mainnet: set 86400 (24h) before deploying.
    uint64 constant COOLDOWN = 60;

    function run() external {
        address usdc = vm.envAddress("ARC_USDC_ADDRESS");
        address verifier = vm.envAddress("VERIFIER_ADDRESS");

        vm.startBroadcast(vm.envUint("ARC_DEPLOYER_KEY"));
        DisputeResolver resolver = new DisputeResolver(verifier);
        SigilStake stake = new SigilStake(IERC20(usdc), resolver, MIN_STAKE, MIN_BOND_BPS, COOLDOWN);
        vm.stopBroadcast();

        console.log("DisputeResolver", address(resolver));
        console.log("SigilStake     ", address(stake));
    }
}
