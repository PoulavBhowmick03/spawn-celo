import { publicClient, getWalletClient } from "./chain";
import { formatUnits, parseUnits } from "viem";

function requireAddress(envKey: string): `0x${string}` {
  const val = process.env[envKey];
  if (!val || val === "" || val.startsWith("0x_")) {
    throw new Error(
      `[aave.ts] ${envKey} is not set or is a placeholder. ` +
      `Fetch the correct address from mantlescan.xyz and set it in .env.`
    );
  }
  if (!val.startsWith("0x") || val.length !== 42) {
    throw new Error(
      `[aave.ts] ${envKey}="${val}" is not a valid EVM address (must be 0x + 40 hex chars).`
    );
  }
  return val as `0x${string}`;
}

function optionalAddress(envKey: string): `0x${string}` | undefined {
  const val = process.env[envKey];
  if (!val || val === "" || val.startsWith("0x_")) return undefined;
  if (!val.startsWith("0x") || val.length !== 42) return undefined;
  return val as `0x${string}`;
}

function requireDecimals(envKey: string, fallback: number, tokenName: string): number {
  const val = process.env[envKey];
  if (!val) {
    console.warn(
      `[aave.ts] ${envKey} not set — using fallback ${fallback} for ${tokenName}. ` +
      `Verify this matches the token contract on mantlescan.xyz.`
    );
    return fallback;
  }
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 0 || parsed > 18) {
    throw new Error(`[aave.ts] ${envKey}="${val}" is not a valid decimals value (expected 0–18).`);
  }
  return parsed;
}

const AAVE_POOL = requireAddress("AAVE_POOL_ADDRESS");
const USDE = requireAddress("USDE_ADDRESS");
const USDE_DECIMALS = requireDecimals("USDE_DECIMALS", 18, "USDe");
const USDE_ATOKEN = optionalAddress("USDE_ATOKEN");
// METH has 0x bytecode on Mantle — kept as optional stub for forward compatibility
const METH = optionalAddress("METH_ADDRESS");
const METH_DECIMALS = METH ? parseInt(process.env.METH_DECIMALS ?? "18", 10) : 18;

const POOL_ABI = [
  {
    name: "supply",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "configuration", type: "tuple", components: [{ name: "data", type: "uint256" }] },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

const ATOKEN_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "scaledBalanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC20_APPROVAL_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const MAX_UINT256 = (1n << 256n) - 1n;

export async function getAaveYield(asset: "USDE" | "METH"): Promise<number> {
  const assetAddr = asset === "USDE" ? USDE : METH;
  // METH has no configured/deployed address on Mantle — treat as unavailable
  // by throwing so callers fall back deterministically rather than reading a fake 0.
  if (!assetAddr) {
    throw new Error(`[Aave] ${asset} address not configured — cannot read live yield`);
  }
  // NOTE: do NOT swallow errors here. A swallowed error returning 0 would make the
  // documented benchmark fallback (AAVE_USDE_BENCHMARK=4.50) unreachable — a 0%
  // benchmark is presented as if it were a real live read. Propagate instead so
  // getBenchmarkYield's catch hits the configured fallback. (P3c)
  try {
    const data = await publicClient.readContract({
      address: AAVE_POOL,
      abi: POOL_ABI,
      functionName: "getReserveData",
      args: [assetAddr],
    }) as any;
    // currentLiquidityRate is in ray units (1e27) — convert to APY %
    return (Number(data.currentLiquidityRate) / 1e27) * 100;
  } catch (err: any) {
    console.error(`[Aave] getReserveData(${asset}) failed:`, err?.message);
    throw new Error(`[Aave] getReserveData(${asset}) failed: ${err?.message ?? String(err)}`);
  }
}

export async function getBenchmarkYield(): Promise<number> {
  try {
    const live = await getAaveYield("USDE");
    // Require 0.25% above live rate — achievable and produces meaningful signal
    const target = live + 0.25;
    console.log(`[Aave] Live benchmark set: ${live.toFixed(4)}% + 0.25% = ${target.toFixed(4)}%`);
    return target;
  } catch (err: any) {
    // RPC failure — fall back to the env-configured static benchmark. This is now
    // reachable because getAaveYield throws (instead of returning a misleading 0).
    const fallback = parseFloat(process.env.AAVE_USDE_BENCHMARK ?? "4.50");
    console.warn(
      `[Aave] Live benchmark read failed (${err?.message ?? String(err)}); ` +
      `using AAVE_USDE_BENCHMARK fallback ${fallback.toFixed(4)}%.`
    );
    return fallback;
  }
}

// Live-vs-fallback benchmark with an explicit source marker so callers/UI can
// distinguish a real chain read from the static env fallback. (P2b)
export type BenchmarkYieldResult = {
  benchmarkYieldPct: number;
  liveAaveYieldPct: number | null;
  source: "live" | "fallback";
};

export async function getBenchmarkYieldWithSource(): Promise<BenchmarkYieldResult> {
  try {
    const live = await getAaveYield("USDE");
    return {
      benchmarkYieldPct: live + 0.25,
      liveAaveYieldPct: live,
      source: "live",
    };
  } catch (err: any) {
    const fallback = parseFloat(process.env.AAVE_USDE_BENCHMARK ?? "4.50");
    console.warn(
      `[Aave] getBenchmarkYieldWithSource: live read failed (${err?.message ?? String(err)}); ` +
      `using AAVE_USDE_BENCHMARK fallback ${fallback.toFixed(4)}%.`
    );
    return { benchmarkYieldPct: fallback, liveAaveYieldPct: null, source: "fallback" };
  }
}

// Returns the wallet's aUSDe balance, which equals USDe supplied + accrued interest (1:1)
export async function getUSDEAavePosition(walletAddress: `0x${string}`): Promise<number> {
  if (!USDE_ATOKEN) return 0;
  try {
    const balance = await publicClient.readContract({
      address: USDE_ATOKEN,
      abi: ATOKEN_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    }) as bigint;
    return Number(formatUnits(balance, 18));
  } catch {
    return 0;
  }
}

export async function supplyToAave(
  privateKey: `0x${string}`,
  asset: "USDE" | "METH",
  amountUSD: number
): Promise<string> {
  const assetAddr = asset === "USDE" ? USDE : METH;
  if (!assetAddr) throw new Error(`[Aave] ${asset} address not configured`);
  const walletClient = getWalletClient(privateKey);
  const decimals = asset === "USDE" ? USDE_DECIMALS : METH_DECIMALS;
  const amount = parseUnits(amountUSD.toString(), decimals);
  try {
    const allowance = await publicClient.readContract({
      address: assetAddr,
      abi: ERC20_APPROVAL_ABI,
      functionName: "allowance",
      args: [walletClient.account.address, AAVE_POOL],
    }) as bigint;

    if (allowance < amount) {
      const approveHash = await walletClient.writeContract({
        address: assetAddr,
        abi: ERC20_APPROVAL_ABI,
        functionName: "approve",
        args: [AAVE_POOL, MAX_UINT256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log(`[Aave] approve(${asset}, Aave Pool) → ${approveHash}`);
    }

    const hash = await walletClient.writeContract({
      address: AAVE_POOL,
      abi: POOL_ABI,
      functionName: "supply",
      args: [assetAddr, amount, walletClient.account.address, 0],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[Aave] supply(${asset}, $${amountUSD}) → ${hash}`);
    return hash;
  } catch (err: any) {
    throw new Error(
      `[Aave] supply(${asset}, $${amountUSD}) failed. ` +
      `Pool=${AAVE_POOL} token=${assetAddr} decimals=${decimals}. ` +
      `Error: ${err?.message ?? String(err)}`
    );
  }
}

export async function withdrawFromAave(
  privateKey: `0x${string}`,
  asset: "USDE" | "METH",
  amountUSD: number
): Promise<string> {
  const assetAddr = asset === "USDE" ? USDE : METH;
  if (!assetAddr) throw new Error(`[Aave] ${asset} address not configured`);
  const walletClient = getWalletClient(privateKey);
  const decimals = asset === "USDE" ? USDE_DECIMALS : METH_DECIMALS;
  const amount = parseUnits(amountUSD.toString(), decimals);
  try {
    const hash = await walletClient.writeContract({
      address: AAVE_POOL,
      abi: POOL_ABI,
      functionName: "withdraw",
      args: [assetAddr, amount, walletClient.account.address],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[Aave] withdraw(${asset}, $${amountUSD}) → ${hash}`);
    return hash;
  } catch (err: any) {
    throw new Error(
      `[Aave] withdraw(${asset}, $${amountUSD}) failed. ` +
      `Pool=${AAVE_POOL} token=${assetAddr} decimals=${decimals}. ` +
      `Error: ${err?.message ?? String(err)}`
    );
  }
}
