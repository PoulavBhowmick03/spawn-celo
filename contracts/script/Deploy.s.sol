// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ChildAgent.sol";
import "../src/LineageRegistry.sol";
import "../src/SpawnFactory.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        require(deployer.balance > 0.1 ether, "Deploy: deployer has no MNT for gas");

        // Broadcast is signed with DEPLOYER_PRIVATE_KEY from env.
        vm.startBroadcast(deployerKey);

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

        // 2. Deploy LineageRegistry
        LineageRegistry lineageRegistry = new LineageRegistry();
        require(address(lineageRegistry) != address(0), "Deploy: LineageRegistry deploy failed");
        // Deployer is auto-allowed. Call allowCaller(parentEOA) if parent EOA differs from deployer.
        console.log("LineageRegistry:", address(lineageRegistry));

        // 3. Deploy SpawnFactory
        SpawnFactory factory = new SpawnFactory(address(childImpl), address(lineageRegistry));
        require(address(factory) != address(0), "Deploy: SpawnFactory deploy failed");
        console.log("SpawnFactory:", address(factory));

        vm.stopBroadcast();

        console.log("\n=== Mantle Spawn Protocol - Phase 1 Deploy ===");
        console.log("Deployer:         ", deployer);
        console.log("ChildAgent (impl):", address(childImpl));
        console.log("LineageRegistry:  ", address(lineageRegistry));
        console.log("SpawnFactory:     ", address(factory));
        console.log("ERC-8004 Registry:", 0x8004A818BFB912233c491871b3d84c89A494BD9e);
        console.log("\n=== Add these to .env ===");
        console.log("SPAWN_FACTORY_ADDRESS=", address(factory));
        console.log("LINEAGE_REGISTRY_ADDRESS=", address(lineageRegistry));
        console.log("CHILD_AGENT_IMPLEMENTATION=", address(childImpl));
        console.log("========================");
    }
}
