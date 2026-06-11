// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/interfaces/IERC8004Identity.sol";

contract RegisterERC8004 is Script {
    // Canonical Celo mainnet ERC-8004 Identity Registry (indexed by 8004scan).
    // Source: erc-8004-contracts repo deployments + ai.celo.org
    address constant ERC8004_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // The agent contract address to register — set via env or pass as arg
        address agentToRegister = vm.envOr("AGENT_TO_REGISTER", vm.addr(deployerKey));
        require(agentToRegister != address(0), "RegisterERC8004: zero agent");

        vm.startBroadcast(deployerKey);

        try IERC8004Identity(ERC8004_REGISTRY).register(agentToRegister) returns (uint256 id) {
            console.log("Registered agentId:", id);
            require(id > 0, "RegisterERC8004: registration returned zero agentId");
        } catch {
            console.log("ERC-8004 registry call failed -- check the canonical Celo address");
        }

        vm.stopBroadcast();

        console.log("=== ERC-8004 Registration (Celo mainnet) ===");
        console.log("Registry:    ", ERC8004_REGISTRY);
        console.log("Agent:       ", agentToRegister);
        console.log("Verify at:   https://celoscan.io/address/", ERC8004_REGISTRY);
        console.log("8004scan:    https://www.8004scan.io/agents/celo");
    }
}
