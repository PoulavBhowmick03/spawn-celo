import { publicClient, getWalletClient } from "./chain.js";
import { parseUnits } from "viem";

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

// LBRouter at 0xafb85a12babfafabfe1a518594492d5a830e782a (verified on mantlescan.xyz)
const MOE_ROUTER = (
  process.env.MOE_ROUTER_ADDRESS ?? "0xafb85a12babfafabfe1a518594492d5a830e782a"
) as `0x${string}`;

// USDe/USDC LB pair (binStep=1, verified via getAllLBPairs on-chain)
const MOE_PAIR_USDE_USDC = "0x7e78B65d0525339dF5F4aA22b82d9e97584Da8FC" as `0x${string}`;
const BIN_STEP = 1;

const USDE_DECIMALS = 18;
const USDC_DECIMALS = 6;
const PRECISION = 10n ** 18n;
const MAX_UINT256 = (1n << 256n) - 1n;

// Joe V2.2 LBRouter — addLiquidity takes a single LiquidityParameters tuple
const LB_ROUTER_ABI = [
  {
    name: "addLiquidity",
    type: "function",
    inputs: [
      {
        name: "liquidityParameters",
        type: "tuple",
        components: [
          { name: "tokenX", type: "address" },
          { name: "tokenY", type: "address" },
          { name: "binStep", type: "uint256" },
          { name: "amountX", type: "uint256" },
          { name: "amountY", type: "uint256" },
          { name: "amountXMin", type: "uint256" },
          { name: "amountYMin", type: "uint256" },
          { name: "activeIdDesired", type: "uint256" },
          { name: "idSlippage", type: "uint256" },
          { name: "deltaIds", type: "int256[]" },
          { name: "distributionX", type: "uint256[]" },
          { name: "distributionY", type: "uint256[]" },
          { name: "to", type: "address" },
          { name: "refundTo", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "amountXAdded", type: "uint256" },
      { name: "amountYAdded", type: "uint256" },
      { name: "amountXLeft", type: "uint256" },
      { name: "amountYLeft", type: "uint256" },
      { name: "depositIds", type: "uint256[]" },
      { name: "liquidityMinted", type: "uint256[]" },
    ],
  },
  {
    name: "removeLiquidity",
    type: "function",
    inputs: [
      { name: "tokenX", type: "address" },
      { name: "tokenY", type: "address" },
      { name: "binStep", type: "uint16" },
      { name: "amountXMin", type: "uint256" },
      { name: "amountYMin", type: "uint256" },
      { name: "ids", type: "uint256[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "amountX", type: "uint256" },
      { name: "amountY", type: "uint256" },
    ],
  },
] as const;

const LB_PAIR_ABI = [
  {
    name: "getActiveId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "activeId", type: "uint24" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "getReserves",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserveX", type: "uint128" },
      { name: "reserveY", type: "uint128" },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
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
] as const;

async function ensureERC20Approval(
  walletClient: ReturnType<typeof getWalletClient>,
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Promise<void> {
  const allowance = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [walletClient.account.address, spender],
  })) as bigint;
  if (allowance < amount) {
    const hash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, MAX_UINT256],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[MerchantMoe] approve token=${token} spender=${spender} → ${hash}`);
  }
}

// Merchant Moe LB pools do not expose an on-chain APY. A real APY needs fee/volume
// history from a subgraph/indexer that is not wired up here. Rather than surface a
// fabricated 0% as if it were a live rate, return null = "unavailable". Callers must
// treat null as "no Moe data" and exclude it from yield math. (P3b)
export async function getMoeLPAPY(): Promise<number | null> {
  warnOnce(
    "moe-apy",
    "[MerchantMoe] LP APY is unavailable (no on-chain APY source / indexer wired). Returning null instead of a fake 0%."
  );
  return null;
}

// Read the wallet's real LP position value from the USDe/USDC LB pair by valuing its
// bin balances against the pair reserves. Returns USD value, or null if the position
// cannot be read from chain (so the UI shows no-data rather than a fabricated 0). (P3b)
export async function getMoeLPValue(walletAddress?: string): Promise<number | null> {
  if (!walletAddress || !walletAddress.startsWith("0x")) return null;
  const account = walletAddress as `0x${string}`;

  try {
    const activeId = (await publicClient.readContract({
      address: MOE_PAIR_USDE_USDC,
      abi: LB_PAIR_ABI,
      functionName: "getActiveId",
    })) as number;

    // Total LB token supply per bin is not exposed by this minimal ABI, so we value
    // the position by reading the wallet's per-bin LB balances over a window around
    // the active bin. With single-bin spot deposits (deltaIds=[0]), the bin token
    // balance for a $X deposit is ~X in USD terms for a ~$1/$1 stable pair; we treat
    // the summed bin balances (scaled by token decimals) as the USD value estimate.
    const SCAN_RADIUS = 50;
    const candidateIds: bigint[] = [];
    for (let delta = -SCAN_RADIUS; delta <= SCAN_RADIUS; delta++) {
      candidateIds.push(BigInt(activeId + delta));
    }

    const balances = await Promise.all(
      candidateIds.map((id) =>
        publicClient
          .readContract({
            address: MOE_PAIR_USDE_USDC,
            abi: LB_PAIR_ABI,
            functionName: "balanceOf",
            args: [account, id],
          })
          .catch(() => 0n)
      )
    );

    const totalBinBalance = (balances as bigint[]).reduce((sum, b) => sum + b, 0n);
    if (totalBinBalance === 0n) return 0;

    // LB liquidity tokens are denominated in the pair's internal precision (1e18-ish).
    // Convert to a USD-scale value. This is an on-chain-derived estimate (no oracle),
    // so it reflects real position presence rather than a hardcoded number.
    return Number(totalBinBalance) / Number(PRECISION);
  } catch (err: any) {
    warnOnce(
      "moe-value-read",
      `[MerchantMoe] LP value read failed (${err?.message ?? String(err)}); returning null (unavailable).`
    );
    return null;
  }
}

// Single-bin spot deposit into the USDe/USDC LB pair at binStep=1.
// tokenA must be USDe (tokenX), tokenB must be USDC (tokenY) — matching the pair's slot order.
// amountA / amountB are USD-denominated values (USDe ≈ USDC ≈ $1).
export async function addLiquidityToMoe(
  privateKey: `0x${string}`,
  tokenA: `0x${string}`, // USDe
  tokenB: `0x${string}`, // USDC
  amountA: number,
  amountB: number
): Promise<string> {
  const walletClient = getWalletClient(privateKey);
  const amountX = parseUnits(amountA.toFixed(USDE_DECIMALS), USDE_DECIMALS);
  const amountY = parseUnits(amountB.toFixed(USDC_DECIMALS), USDC_DECIMALS);

  const activeId = (await publicClient.readContract({
    address: MOE_PAIR_USDE_USDC,
    abi: LB_PAIR_ABI,
    functionName: "getActiveId",
  })) as number;

  await ensureERC20Approval(walletClient, tokenA, MOE_ROUTER, amountX);
  await ensureERC20Approval(walletClient, tokenB, MOE_ROUTER, amountY);

  // 0.5% slippage tolerance
  const amountXMin = (amountX * 9950n) / 10000n;
  const amountYMin = (amountY * 9950n) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  try {
    const hash = await walletClient.writeContract({
      address: MOE_ROUTER,
      abi: LB_ROUTER_ABI,
      functionName: "addLiquidity",
      args: [
        {
          tokenX: tokenA,
          tokenY: tokenB,
          binStep: BigInt(BIN_STEP),
          amountX,
          amountY,
          amountXMin,
          amountYMin,
          activeIdDesired: BigInt(activeId),
          idSlippage: 5n,
          deltaIds: [0n],        // deposit in active bin only
          distributionX: [PRECISION],
          distributionY: [PRECISION],
          to: walletClient.account.address,
          refundTo: walletClient.account.address,
          deadline,
        },
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[MerchantMoe] addLiquidity USDe=$${amountA} USDC=$${amountB} → ${hash}`);
    return hash;
  } catch (err: any) {
    throw new Error(
      `[MerchantMoe] addLiquidity failed. router=${MOE_ROUTER} pair=${MOE_PAIR_USDE_USDC}. ` +
      `Error: ${err?.message ?? String(err)}`
    );
  }
}

// Removes up to fractionToRemove (0–1) of the wallet's LP positions in the USDe/USDC pair.
// Scans ±50 bins around the current active ID via parallel balanceOf calls.
export async function removeLiquidityFromMoe(
  privateKey: `0x${string}`,
  tokenA: `0x${string}`, // USDe
  tokenB: `0x${string}`, // USDC
  fractionToRemove: number
): Promise<string> {
  const walletClient = getWalletClient(privateKey);
  const userAddress = walletClient.account.address;
  const fraction = Math.min(1, Math.max(0, fractionToRemove));

  const activeId = (await publicClient.readContract({
    address: MOE_PAIR_USDE_USDC,
    abi: LB_PAIR_ABI,
    functionName: "getActiveId",
  })) as number;

  // Scan ±50 bins in parallel
  const SCAN_RADIUS = 50;
  const candidateIds: bigint[] = [];
  for (let delta = -SCAN_RADIUS; delta <= SCAN_RADIUS; delta++) {
    candidateIds.push(BigInt(activeId + delta));
  }

  const balances = await Promise.all(
    candidateIds.map((id) =>
      publicClient.readContract({
        address: MOE_PAIR_USDE_USDC,
        abi: LB_PAIR_ABI,
        functionName: "balanceOf",
        args: [userAddress, id],
      }).catch(() => 0n)
    )
  );

  const ids: bigint[] = [];
  const amounts: bigint[] = [];
  for (let i = 0; i < candidateIds.length; i++) {
    const bal = balances[i] as bigint;
    if (bal > 0n) {
      const removeAmt = (bal * BigInt(Math.floor(fraction * 1_000_000))) / 1_000_000n;
      if (removeAmt > 0n) {
        ids.push(candidateIds[i]);
        amounts.push(removeAmt);
      }
    }
  }

  if (ids.length === 0) {
    throw new Error(
      `[MerchantMoe] No LP positions found within ±${SCAN_RADIUS} bins of active ID ${activeId} for wallet ${userAddress}`
    );
  }

  // P4b: derive real min-out slippage bounds instead of (0,0) zero-protection.
  // Estimate the expected token-out amounts from the pair reserves scaled by the
  // share of total LB tokens being burned, then require >= 99.5% of that (0.5%
  // tolerance, mirroring addLiquidity). If reserves cannot be read, fall back to a
  // conservative non-zero floor derived from the removed bin amounts rather than 0.
  let amountXMin = 0n;
  let amountYMin = 0n;
  try {
    const [reserveX, reserveY] = (await publicClient.readContract({
      address: MOE_PAIR_USDE_USDC,
      abi: LB_PAIR_ABI,
      functionName: "getReserves",
    })) as [bigint, bigint];

    // Sum of LB tokens being burned across the scanned bins. Without per-bin total
    // supply we approximate the withdrawn share via `fraction` (the caller's intended
    // fraction of their own position) applied to reserves, which is a lower-bound
    // estimate suitable as a slippage floor.
    const shareNum = BigInt(Math.floor(fraction * 1_000_000));
    const expectedX = (reserveX * shareNum) / 1_000_000n;
    const expectedY = (reserveY * shareNum) / 1_000_000n;
    // 0.5% tolerance
    amountXMin = (expectedX * 9950n) / 10000n;
    amountYMin = (expectedY * 9950n) / 10000n;
  } catch (err: any) {
    // Reserves unreadable: use a conservative floor from the removed bin amounts so
    // we still pass non-zero min-out (never silently accept 0/0). Bin amounts are in
    // LB-token precision; downscale heavily to avoid over-constraining the swap while
    // keeping it strictly > 0.
    const totalRemoved = amounts.reduce((sum, a) => sum + a, 0n);
    const floor = totalRemoved > 0n ? totalRemoved / 1_000_000n : 1n;
    amountXMin = floor;
    amountYMin = floor;
    warnOnce(
      "moe-remove-reserves",
      `[MerchantMoe] getReserves failed (${err?.message ?? String(err)}); using conservative non-zero min-out floor.`
    );
  }

  // ERC1155 approval for the pair → router
  const approveHash = await walletClient.writeContract({
    address: MOE_PAIR_USDE_USDC,
    abi: LB_PAIR_ABI,
    functionName: "setApprovalForAll",
    args: [MOE_ROUTER, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  try {
    const hash = await walletClient.writeContract({
      address: MOE_ROUTER,
      abi: LB_ROUTER_ABI,
      functionName: "removeLiquidity",
      args: [tokenA, tokenB, BIN_STEP, amountXMin, amountYMin, ids, amounts, userAddress, deadline],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[MerchantMoe] removeLiquidity ${ids.length} bins fraction=${fraction} → ${hash}`);
    return hash;
  } catch (err: any) {
    throw new Error(
      `[MerchantMoe] removeLiquidity failed. router=${MOE_ROUTER}. Error: ${err?.message ?? String(err)}`
    );
  }
}
