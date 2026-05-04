// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SpawnFactory.sol";
import "../src/ChildAgent.sol";
import "../src/LineageRegistry.sol";

contract MockERC8004Registry {
    uint256 private counter;
    mapping(address => uint256) public agentIds;

    function register(address agent) external returns (uint256 id) {
        id = ++counter;
        agentIds[agent] = id;
    }
}

contract RevertingERC8004Registry {
    function register(address) external pure returns (uint256) {
        revert("registry down");
    }
}

contract SpawnFactoryTest is Test {
    event ChildSpawned(
        address indexed child, uint256 indexed agentId, string lineageKey, uint256 generation, uint256 timestamp
    );

    address internal constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    ChildAgent internal childImplementation;
    LineageRegistry internal lineageRegistry;
    SpawnFactory internal factory;

    address internal parent = makeAddr("parent");
    address internal childWallet = makeAddr("childWallet");
    address internal secondChildWallet = makeAddr("secondChildWallet");

    function setUp() public {
        MockERC8004Registry mockRegistryImplementation = new MockERC8004Registry();
        vm.etch(ERC8004_REGISTRY, address(mockRegistryImplementation).code);

        childImplementation = new ChildAgent();
        lineageRegistry = new LineageRegistry();
        lineageRegistry.allowCaller(address(this));
        factory = new SpawnFactory(address(childImplementation), address(lineageRegistry));
    }

    function test_Constructor_SetsImplementationRegistryAndOwner() public view {
        assertEq(factory.childImplementation(), address(childImplementation));
        assertEq(factory.lineageRegistry(), address(lineageRegistry));
        assertEq(factory.owner(), address(this));
        assertEq(factory.ERC8004_REGISTRY(), ERC8004_REGISTRY);
    }

    function test_Constructor_RevertsWithZeroImplementation() public {
        vm.expectRevert("SpawnFactory: zero implementation");
        new SpawnFactory(address(0), address(lineageRegistry));
    }

    function test_Constructor_RevertsWithZeroRegistry() public {
        vm.expectRevert("SpawnFactory: zero registry");
        new SpawnFactory(address(childImplementation), address(0));
    }

    function test_Constructor_RevertsWithNoCodeImplementation() public {
        vm.expectRevert("SpawnFactory: implementation has no code");
        new SpawnFactory(address(0xDEAD), address(lineageRegistry));
    }

    function test_SpawnChild_DeploysNewClone() public {
        vm.prank(parent);
        (address child,) = factory.spawnChild("spawn-alpha", 1, childWallet);

        assertNotEq(child, address(0));
        assertNotEq(child, address(childImplementation));
        assertGt(child.code.length, 0);
    }

    function test_SpawnChild_RevertsWithZeroChildWallet() public {
        vm.expectRevert("SpawnFactory: zero child wallet");
        factory.spawnChild("spawn-alpha", 1, address(0));
    }

    function test_SpawnChild_InitializesCloneWithCallerAndWallet() public {
        vm.prank(parent);
        (address child,) = factory.spawnChild("spawn-alpha", 1, childWallet);

        assertEq(ChildAgent(child).parent(), parent);
        assertEq(ChildAgent(child).wallet(), childWallet);
        assertTrue(ChildAgent(child).active());
    }

    function test_SpawnChild_RegistersCloneInMockERC8004Registry() public {
        vm.prank(parent);
        (address child, uint256 agentId) = factory.spawnChild("spawn-alpha", 1, childWallet);

        uint256 registeredAgentId = MockERC8004Registry(ERC8004_REGISTRY).agentIds(child);

        assertGt(agentId, 0);
        assertEq(agentId, registeredAgentId);
    }

    function test_SpawnChild_EmitsChildSpawnedEvent() public {
        vm.warp(1_700_000_300);
        address expectedChild = vm.computeCreateAddress(address(factory), 1);
        uint256 expectedAgentId = 1;

        vm.expectEmit(true, true, false, true);
        emit ChildSpawned(expectedChild, expectedAgentId, "spawn-alpha", 1, block.timestamp);

        vm.prank(parent);
        (address child, uint256 agentId) = factory.spawnChild("spawn-alpha", 1, childWallet);

        assertEq(child, expectedChild);
        assertGt(agentId, 0);
        assertEq(agentId, MockERC8004Registry(ERC8004_REGISTRY).agentIds(child));
    }

    function test_SpawnChild_TwoCallsSameLineageProduceDifferentCloneAddresses() public {
        vm.startPrank(parent);
        (address childOne, uint256 agentIdOne) = factory.spawnChild("spawn-alpha", 1, childWallet);
        (address childTwo, uint256 agentIdTwo) = factory.spawnChild("spawn-alpha", 2, secondChildWallet);
        vm.stopPrank();

        assertNotEq(childOne, childTwo);
        assertGt(agentIdOne, 0);
        assertGt(agentIdTwo, agentIdOne);
        assertEq(MockERC8004Registry(ERC8004_REGISTRY).agentIds(childOne), agentIdOne);
        assertEq(MockERC8004Registry(ERC8004_REGISTRY).agentIds(childTwo), agentIdTwo);
    }

    function test_CloneIndependence_RecallOnOneCloneDoesNotAffectOther() public {
        vm.startPrank(parent);
        (address childOne,) = factory.spawnChild("spawn-alpha", 1, childWallet);
        (address childTwo,) = factory.spawnChild("spawn-alpha", 2, secondChildWallet);
        ChildAgent(childOne).recallChild("below threshold", "QmCID1");
        vm.stopPrank();

        assertFalse(ChildAgent(childOne).active());
        assertTrue(ChildAgent(childTwo).active());
        assertEq(ChildAgent(childTwo).parent(), parent);
        assertEq(ChildAgent(childTwo).wallet(), secondChildWallet);
    }

    function test_SpawnChild_ContinuesWhenRegistryRegistrationFails() public {
        RevertingERC8004Registry revertingRegistry = new RevertingERC8004Registry();
        vm.etch(ERC8004_REGISTRY, address(revertingRegistry).code);

        vm.warp(1_700_000_400);
        address expectedChild = vm.computeCreateAddress(address(factory), 1);

        vm.expectEmit(true, true, false, true);
        emit ChildSpawned(expectedChild, 0, "spawn-alpha", 1, block.timestamp);

        vm.prank(parent);
        (address child, uint256 agentId) = factory.spawnChild("spawn-alpha", 1, childWallet);

        assertEq(child, expectedChild);
        assertEq(agentId, 0);
        assertTrue(ChildAgent(child).active());
        assertEq(ChildAgent(child).parent(), parent);
        assertEq(ChildAgent(child).wallet(), childWallet);
    }

    function test_SpawnChild_ContinuesWhenRegistryHasNoCode() public {
        vm.etch(ERC8004_REGISTRY, "");

        vm.warp(1_700_000_500);
        address expectedChild = vm.computeCreateAddress(address(factory), 1);

        vm.expectEmit(true, true, false, true);
        emit ChildSpawned(expectedChild, 0, "spawn-alpha", 1, block.timestamp);

        vm.prank(parent);
        (address child, uint256 agentId) = factory.spawnChild("spawn-alpha", 1, childWallet);

        assertEq(child, expectedChild);
        assertEq(agentId, 0);
        assertTrue(ChildAgent(child).active());
        assertEq(ChildAgent(child).parent(), parent);
        assertEq(ChildAgent(child).wallet(), childWallet);
    }
}
