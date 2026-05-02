import { publicClient, getWalletClient } from "./chain";
import { parseUnits } from "viem";

const AAVE_POOL = process.env.AAVE_POOL_ADDRESS as `0x${string}`;
const USDE = process.env.USDE_ADDRESS as `0x${string}`;
const METH = process.env.METH_ADDRESS as `0x${string}` | undefined;

const USDE_DECIMALS = parseInt(process.env.USDE_DECIMALS ?? "18", 10);
const METH_DECIMALS = parseInt(process.env.METH_DECIMALS ?? "18", 10);

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

export async function getAaveYield(asset: "USDE" | "METH"): Promise<number> {
  const assetAddr = asset === "USDE" ? USDE : METH;
  if (!assetAddr) return 0;
  const data = await publicClient.readContract({
    address: AAVE_POOL,
    abi: POOL_ABI,
    functionName: "getReserveData",
    args: [assetAddr],
  }) as any;
  return (Number(data.currentLiquidityRate) / 1e27) * 100;
}

export async function supplyToAave(
  privateKey: `0x${string}`,
  asset: "USDE" | "METH",
  amountUSD: number
): Promise<string> {
  const walletClient = getWalletClient(privateKey);
  const assetAddr = asset === "USDE" ? USDE : METH;
  if (!assetAddr) throw new Error(`[Aave] ${asset} address not configured`);
  const decimals = asset === "USDE" ? USDE_DECIMALS : METH_DECIMALS;
  const amount = parseUnits(amountUSD.toString(), decimals);
  const hash = await walletClient.writeContract({
    address: AAVE_POOL,
    abi: POOL_ABI,
    functionName: "supply",
    args: [assetAddr, amount, walletClient.account.address, 0],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function withdrawFromAave(
  privateKey: `0x${string}`,
  asset: "USDE" | "METH",
  amountUSD: number
): Promise<string> {
  const walletClient = getWalletClient(privateKey);
  const assetAddr = asset === "USDE" ? USDE : METH;
  if (!assetAddr) throw new Error(`[Aave] ${asset} address not configured`);
  const decimals = asset === "USDE" ? USDE_DECIMALS : METH_DECIMALS;
  const amount = parseUnits(amountUSD.toString(), decimals);
  const hash = await walletClient.writeContract({
    address: AAVE_POOL,
    abi: POOL_ABI,
    functionName: "withdraw",
    args: [assetAddr, amount, walletClient.account.address],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
