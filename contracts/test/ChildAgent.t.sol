// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ChildAgent.sol";

contract ChildAgentTest is Test {
    event RecallChild(address indexed child, string reason, string ipfsCid, uint256 timestamp);

    ChildAgent internal agent;
    address internal parent = makeAddr("parent");
    address internal wallet = makeAddr("wallet");
    address internal nonParent = makeAddr("nonParent");

    function setUp() public {
        agent = new ChildAgent();
    }

    function test_Initialize_SetsStateAndTimestamp() public {
        vm.warp(1_700_000_100);

        agent.initialize(parent, wallet);

        assertEq(agent.parent(), parent);
        assertEq(agent.wallet(), wallet);
        assertTrue(agent.active());
        assertEq(agent.spawnTimestamp(), 1_700_000_100);
    }

    function test_Initialize_RevertsWhenCalledTwice() public {
        agent.initialize(parent, wallet);

        vm.expectRevert(bytes("Already initialized"));
        agent.initialize(parent, wallet);
    }

    function test_Initialize_RevertsWithZeroParent() public {
        vm.expectRevert(bytes("ChildAgent: zero parent"));
        agent.initialize(address(0), wallet);
    }

    function test_Initialize_RevertsWithZeroWallet() public {
        vm.expectRevert(bytes("ChildAgent: zero wallet"));
        agent.initialize(parent, address(0));
    }

    function test_RecallChild_SetsInactiveAndEmitsEvent() public {
        agent.initialize(parent, wallet);
        vm.warp(1_700_000_200);

        vm.expectEmit(true, false, false, true);
        emit RecallChild(address(agent), "below threshold", "QmCID1", block.timestamp);

        vm.prank(parent);
        agent.recallChild("below threshold", "QmCID1");

        assertFalse(agent.active());
    }

    function test_RecallChild_RevertsForNonParent() public {
        agent.initialize(parent, wallet);

        vm.prank(nonParent);
        vm.expectRevert(bytes("Only parent"));
        agent.recallChild("below threshold", "QmCID1");
    }

    function test_RecallChild_EventContainsIpfsCid() public {
        agent.initialize(parent, wallet);

        vm.expectEmit(true, false, false, true);
        emit RecallChild(address(agent), "rebalance failed", "QmPostMortemCID", block.timestamp);

        vm.prank(parent);
        agent.recallChild("rebalance failed", "QmPostMortemCID");
    }

    function test_StateAfterRecall_PreservesParentAndWallet() public {
        agent.initialize(parent, wallet);

        vm.prank(parent);
        agent.recallChild("below threshold", "QmCID1");

        assertFalse(agent.active());
        assertEq(agent.parent(), parent);
        assertEq(agent.wallet(), wallet);
    }
}
