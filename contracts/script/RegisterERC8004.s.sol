// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/interfaces/IERC8004Identity.sol";

contract RegisterERC8004 is Script {
    address constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // The agent contract address to register — set via env or pass as arg
        address agentToRegister = vm.envOr("AGENT_TO_REGISTER", vm.addr(deployerKey));

        vm.startBroadcast(deployerKey);

        uint256 agentId = IERC8004Identity(ERC8004_REGISTRY).register(agentToRegister);

        vm.stopBroadcast();

        console.log("=== ERC-8004 Registration ===");
        console.log("Registry:    ", ERC8004_REGISTRY);
        console.log("Agent:       ", agentToRegister);
        console.log("Agent ID:    ", agentId);
        console.log("Verify at:   https://mantlescan.xyz/address/", ERC8004_REGISTRY);
    }
}
