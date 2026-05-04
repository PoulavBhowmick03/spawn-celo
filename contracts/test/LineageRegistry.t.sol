// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/LineageRegistry.sol";

contract LineageRegistryTest is Test {
    event LineageUpdated(string indexed lineageKey, string cid, uint256 generation, uint256 timestamp);
    event CallerAllowed(address indexed caller);
    event CallerRevoked(address indexed caller);
    event GenerationResult(
        string indexed lineageKey,
        string summary,
        uint256 avgYieldBps,
        uint256 agentsTerminated,
        uint256 generation,
        uint256 timestamp
    );

    LineageRegistry internal registry;
    address internal unauthorized = makeAddr("unauthorized");
    address internal extraCaller = makeAddr("extraCaller");

    function setUp() public {
        registry = new LineageRegistry();
        registry.allowCaller(address(this));
    }

    function test_Constructor_SetsOwnerAndAllowsDeployer() public view {
        assertEq(registry.owner(), address(this));
        assertTrue(registry.allowedCallers(address(this)));
    }

    function test_AllowCaller_AllowsAddressToPushCID() public {
        vm.expectEmit(true, false, false, true);
        emit CallerAllowed(extraCaller);
        registry.allowCaller(extraCaller);

        vm.prank(extraCaller);
        registry.pushCID("alpha", "QmCID1");

        assertEq(registry.generation("alpha"), 1);
    }

    function test_AllowCaller_RevertsForZeroAddress() public {
        vm.expectRevert(LineageRegistry.ZeroAddress.selector);
        registry.allowCaller(address(0));
    }

    function test_AllowCaller_RevertsForNonOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert(bytes("Not owner"));
        registry.allowCaller(extraCaller);
    }

    function test_RevokeCaller_PreventsFuturePushCID() public {
        registry.allowCaller(extraCaller);

        vm.expectEmit(true, false, false, true);
        emit CallerRevoked(extraCaller);
        registry.revokeCaller(extraCaller);

        vm.prank(extraCaller);
        vm.expectRevert(LineageRegistry.NotAllowed.selector);
        registry.pushCID("alpha", "QmCID1");
    }

    function test_PushCID_RevertsForUnauthorizedCaller() public {
        vm.prank(unauthorized);
        vm.expectRevert(LineageRegistry.NotAllowed.selector);
        registry.pushCID("alpha", "QmCID1");
    }

    function test_PushCID_IncrementsGeneration() public {
        registry.pushCID("alpha", "QmCID1");

        assertEq(registry.generation("alpha"), 1);
        assertEq(registry.getGenerationCount("alpha"), 1);
    }

    function test_PushCID_AppendsSecondCIDAndIncrementsAgain() public {
        registry.pushCID("alpha", "QmCID1");
        registry.pushCID("alpha", "QmCID2");

        string[] memory lineage = registry.getLineage("alpha");
        assertEq(registry.generation("alpha"), 2);
        assertEq(registry.getGenerationCount("alpha"), 2);
        assertEq(lineage.length, 2);
        assertEq(lineage[0], "QmCID1");
        assertEq(lineage[1], "QmCID2");
    }

    function test_PushCID_EmitsLineageUpdatedEvent() public {
        vm.warp(1_700_000_001);

        vm.expectEmit(true, false, false, true);
        emit LineageUpdated("alpha", "QmCID1", 1, block.timestamp);

        registry.pushCID("alpha", "QmCID1");
    }

    function test_PostGenerationResult_EmitsGenerationResultEvent() public {
        vm.warp(1_700_000_002);

        vm.expectEmit(true, false, false, true);
        emit GenerationResult(
            "alpha",
            "Venice summary: Gen 2 reduced drawdown while preserving positive carry.",
            747,
            2,
            2,
            block.timestamp
        );

        registry.postGenerationResult(
            "alpha", "Venice summary: Gen 2 reduced drawdown while preserving positive carry.", 747, 2, 2
        );
    }

    function test_PostGenerationResult_RevertsForUnauthorizedCaller() public {
        vm.prank(unauthorized);
        vm.expectRevert(LineageRegistry.NotAllowed.selector);
        registry.postGenerationResult("alpha", "malicious summary", 0, 0, 1);
    }

    function test_PostGenerationResult_DoesNotMutateLineageCount() public {
        registry.pushCID("alpha", "QmCID1");

        registry.postGenerationResult("alpha", "summary", 747, 0, 1);

        assertEq(registry.getGenerationCount("alpha"), 1);
        assertEq(registry.generation("alpha"), 1);
        assertEq(registry.getLatestCID("alpha"), "QmCID1");
    }

    function test_PushCID_MultipleLineageKeysAreIndependent() public {
        registry.pushCID("alpha", "QmAlpha1");
        registry.pushCID("beta", "QmBeta1");
        registry.pushCID("alpha", "QmAlpha2");

        string[] memory alpha = registry.getLineage("alpha");
        string[] memory beta = registry.getLineage("beta");

        assertEq(registry.generation("alpha"), 2);
        assertEq(registry.generation("beta"), 1);
        assertEq(alpha.length, 2);
        assertEq(beta.length, 1);
        assertEq(alpha[0], "QmAlpha1");
        assertEq(alpha[1], "QmAlpha2");
        assertEq(beta[0], "QmBeta1");
    }

    function test_GetLineage_ReturnsEmptyArrayForUnknownKey() public view {
        string[] memory lineage = registry.getLineage("unknown");

        assertEq(lineage.length, 0);
    }

    function test_GetLineage_ReturnsAllCIDsInOrderAfterMultiplePushes() public {
        registry.pushCID("alpha", "QmCID1");
        registry.pushCID("alpha", "QmCID2");
        registry.pushCID("alpha", "QmCID3");

        string[] memory lineage = registry.getLineage("alpha");

        assertEq(lineage.length, 3);
        assertEq(lineage[0], "QmCID1");
        assertEq(lineage[1], "QmCID2");
        assertEq(lineage[2], "QmCID3");
    }

    function test_GetLineage_PreservesInsertionOrder() public {
        registry.pushCID("alpha", "QmThird");
        registry.pushCID("alpha", "QmFirst");
        registry.pushCID("alpha", "QmSecond");

        string[] memory lineage = registry.getLineage("alpha");

        assertEq(lineage.length, 3);
        assertEq(lineage[0], "QmThird");
        assertEq(lineage[1], "QmFirst");
        assertEq(lineage[2], "QmSecond");
    }

    function test_GetLatestCID_RevertsForUnknownKey() public {
        vm.expectRevert(bytes("No lineage"));
        registry.getLatestCID("unknown");
    }

    function test_GetLatestCID_ReturnsLastAfterSinglePush() public {
        registry.pushCID("alpha", "QmCID1");

        assertEq(registry.getLatestCID("alpha"), "QmCID1");
    }

    function test_GetLatestCID_ReturnsLastAfterMultiplePushes() public {
        registry.pushCID("alpha", "QmCID1");
        registry.pushCID("alpha", "QmCID2");
        registry.pushCID("alpha", "QmCID3");

        assertEq(registry.getLatestCID("alpha"), "QmCID3");
    }

    function test_GetGenerationCount_ReturnsZeroForUnknownKey() public view {
        assertEq(registry.getGenerationCount("unknown"), 0);
    }

    function test_GetGenerationCount_ReturnsCorrectCountAfterMultiplePushes() public {
        registry.pushCID("alpha", "QmCID1");
        registry.pushCID("alpha", "QmCID2");
        registry.pushCID("alpha", "QmCID3");
        registry.pushCID("alpha", "QmCID4");

        assertEq(registry.getGenerationCount("alpha"), 4);
        assertEq(registry.generation("alpha"), 4);
    }
}
