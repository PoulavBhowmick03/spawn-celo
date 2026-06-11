// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ChildAgent.sol";
import "../src/SpawnFactory.sol";

contract Deploy is Script {
    function run() external {
        // Broadcast is signed by the external Forge wallet, e.g. --account myaccount.
        vm.startBroadcast();

        // v2 deployment — adds recordDecisionHash event for on-chain decision proof
        // 1. Deploy ChildAgent implementation (will be cloned for each child)
        ChildAgent childImpl = new ChildAgent();
        require(address(childImpl) != address(0), "Deploy: ChildAgent deploy failed");

        uint256 implSize;
        address implAddr = address(childImpl);
        assembly {
            implSize := extcodesize(implAddr)
        }
        require(implSize > 0, "Deploy: ChildAgent has no code after deploy");

        console.log("ChildAgent (impl):", address(childImpl));

        // 2. Reuse existing LineageRegistry so lineage history stays intact.
        address lineageRegistryAddress = vm.envAddress("LINEAGE_REGISTRY_ADDRESS");
        require(lineageRegistryAddress != address(0), "Deploy: zero LineageRegistry");
        require(lineageRegistryAddress.code.length > 0, "Deploy: LineageRegistry has no code");
        console.log("LineageRegistry:", lineageRegistryAddress);

        // 3. Deploy SpawnFactory
        SpawnFactory factory = new SpawnFactory(address(childImpl), lineageRegistryAddress);
        require(address(factory) != address(0), "Deploy: SpawnFactory deploy failed");
        console.log("SpawnFactory:", address(factory));

        vm.stopBroadcast();

        console.log("\n=== Celo Spawn Protocol - Deploy ===");
        console.log("Chain:            Celo mainnet (42220)");
        console.log("Signer:           external Forge wallet");
        console.log("ChildAgent (impl):", address(childImpl));
        console.log("LineageRegistry:  ", lineageRegistryAddress);
        console.log("SpawnFactory:     ", address(factory));
        console.log("ERC-8004 Registry:", 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432);
        console.log("\n=== Add these to .env ===");
        console.log("SPAWN_FACTORY_ADDRESS=", address(factory));
        console.log("LINEAGE_REGISTRY_ADDRESS=", lineageRegistryAddress);
        console.log("CHILD_AGENT_IMPLEMENTATION=", address(childImpl));
        console.log("========================");
    }
}
