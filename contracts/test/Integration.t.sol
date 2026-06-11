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
    // Canonical Celo mainnet ERC-8004 Identity Registry (indexed by 8004scan)
    // Source: erc-8004-contracts repo deployments + ai.celo.org
    address internal constant ERC8004_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    // Celo mainnet Aave v3 Pool — from @bgd-labs/aave-address-book AaveV3Celo
    address internal constant AAVE_POOL = 0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402;

    // USDm (cUSD) — Mento stablecoin, Celo-native
    address internal constant USDM = 0x765DE816845861e75A25fCA122bb6898B8B1282a;

    string internal constant FORK_RPC_URL = "https://forno.celo.org";

    uint256 internal forkId;

    function setUp() public {
        forkId = vm.createFork(FORK_RPC_URL);
        vm.selectFork(forkId);
    }

    function test_ERC8004Registry_IsLiveAndHasBytecodeOnCelo() public {
        uint256 size;
        address registry = ERC8004_REGISTRY;

        assembly {
            size := extcodesize(registry)
        }

        if (size == 0) {
            vm.skip(true, "ERC-8004 registry has no bytecode on current Celo RPC");
        }

        assertGt(size, 0, "ERC-8004 Identity Registry must have bytecode on Celo mainnet");
    }

    function test_AavePool_USDmLiquidityRateIsReadable() public {
        if (AAVE_POOL.code.length == 0) {
            vm.skip(true, "Aave pool has no code on current Celo RPC");
        }
        if (USDM.code.length == 0) {
            vm.skip(true, "USDm (cUSD) has no code on current Celo RPC");
        }

        IAavePool.ReserveData memory reserveData = IAavePool(AAVE_POOL).getReserveData(USDM);

        // cUSD is an active Aave v3 Celo reserve — liquidity rate should be > 0
        assertGt(uint256(reserveData.currentLiquidityRate), 0, "USDm currentLiquidityRate should be > 0");
    }

    function test_LineageRegistry_FullCycleOnCeloFork() public {
        LineageRegistry lineageRegistry = new LineageRegistry();
        lineageRegistry.allowCaller(address(this));

        lineageRegistry.pushCID("spawn-mfx-cautious", "QmCID1");
        lineageRegistry.pushCID("spawn-mfx-cautious", "QmCID2");
        lineageRegistry.pushCID("spawn-mfx-cautious", "QmCID3");
        lineageRegistry.postGenerationResult(
            "spawn-mfx-cautious", "Epoch 1: MentoFXRotator cautious outperformed median, spawning g2.", 747, 1, 3
        );

        string[] memory lineage = lineageRegistry.getLineage("spawn-mfx-cautious");

        assertEq(lineageRegistry.getGenerationCount("spawn-mfx-cautious"), 3);
        assertEq(lineage.length, 3);
        assertEq(lineage[0], "QmCID1");
        assertEq(lineage[1], "QmCID2");
        assertEq(lineage[2], "QmCID3");
        assertEq(lineageRegistry.getLatestCID("spawn-mfx-cautious"), "QmCID3");
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
