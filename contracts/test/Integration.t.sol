// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/SpawnFactory.sol";
import "../src/ChildAgent.sol";
import "../src/LineageRegistry.sol";

contract MockERC8004RegistryFork {
    uint256 private counter;
    mapping(address => uint256) public agentIds;

    function register(address agent) external returns (uint256 id) {
        id = ++counter;
        agentIds[agent] = id;
    }
}

interface IAavePool {
    struct ReserveConfigurationMap {
        uint256 data;
    }

    struct ReserveData {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex;
        uint128 currentLiquidityRate;
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }

    function getReserveData(address asset) external view returns (ReserveData memory);
}

contract IntegrationTest is Test {
    address internal constant ERC8004_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;
    string internal constant FORK_RPC_URL = "https://rpc.mantle.xyz";

    uint256 internal forkId;

    function setUp() public {
        forkId = vm.createFork(FORK_RPC_URL);
        vm.selectFork(forkId);
    }

    function test_ERC8004Registry_IsLiveAndHasBytecode() public {
        uint256 size;
        address registry = ERC8004_REGISTRY;

        assembly {
            size := extcodesize(registry)
        }

        if (size == 0) {
            vm.skip(true, "ERC-8004 registry has no bytecode on current Mantle RPC");
        }

        assertGt(size, 0, "ERC-8004 registry has no bytecode on Mantle mainnet");
    }

    function test_AaveReserveData_USDYLiquidityRateIsReadable() public {
        address aavePool = vm.envOr("AAVE_POOL_ADDRESS", address(0));
        address usdy = vm.envOr("USDY_ADDRESS", address(0));

        if (aavePool == address(0) || usdy == address(0)) {
            vm.skip(true);
        }

        if (aavePool.code.length == 0 || usdy.code.length == 0) {
            vm.skip(true, "Aave pool or USDY address has no code on current Mantle RPC");
        }

        IAavePool.ReserveData memory reserveData = IAavePool(aavePool).getReserveData(usdy);

        assertGt(uint256(reserveData.currentLiquidityRate), 0, "currentLiquidityRate should be > 0");
    }

    function test_LineageRegistry_FullCycleOnMantleFork() public {
        LineageRegistry lineageRegistry = new LineageRegistry();
        lineageRegistry.allowCaller(address(this));

        lineageRegistry.pushCID("test-agent", "QmCID1");
        lineageRegistry.pushCID("test-agent", "QmCID2");
        lineageRegistry.pushCID("test-agent", "QmCID3");
        lineageRegistry.postGenerationResult(
            "test-agent", "Venice summary: successor should prefer stable carry over churn.", 747, 1, 3
        );

        string[] memory lineage = lineageRegistry.getLineage("test-agent");

        assertEq(lineageRegistry.getGenerationCount("test-agent"), 3);
        assertEq(lineage.length, 3);
        assertEq(lineage[0], "QmCID1");
        assertEq(lineage[1], "QmCID2");
        assertEq(lineage[2], "QmCID3");
        assertEq(lineageRegistry.getLatestCID("test-agent"), "QmCID3");
    }

    function test_SpawnFactoryAndLineageRegistry_RegistersSequentialIdsOnFork() public {
        MockERC8004RegistryFork mockRegistryImplementation = new MockERC8004RegistryFork();
        vm.etch(ERC8004_REGISTRY, address(mockRegistryImplementation).code);

        ChildAgent childImplementation = new ChildAgent();
        LineageRegistry lineageRegistry = new LineageRegistry();
        SpawnFactory factory = new SpawnFactory(address(childImplementation), address(lineageRegistry));

        address childWalletOne = makeAddr("childWalletOne");
        address childWalletTwo = makeAddr("childWalletTwo");

        (address childOne, uint256 agentIdOne) = factory.spawnChild("spawn-alpha", 1, childWalletOne);
        (address childTwo, uint256 agentIdTwo) = factory.spawnChild("spawn-alpha", 2, childWalletTwo);

        assertEq(agentIdOne, 1);
        assertEq(agentIdTwo, 2);
        assertNotEq(childOne, childTwo);
        assertEq(MockERC8004RegistryFork(ERC8004_REGISTRY).agentIds(childOne), 1);
        assertEq(MockERC8004RegistryFork(ERC8004_REGISTRY).agentIds(childTwo), 2);
    }
}
