/**
 * x402 payment protocol (Phase 6) — self-hosted "exact" scheme on Celo.
 *
 * Wire format follows the x402 spec (HTTP 402 + base64 X-PAYMENT header);
 * settlement is EIP-3009 transferWithAuthorization on Celo's native USDC
 * (verified onchain: EIP-712 domain "USDC"/"2", typehash present), submitted
 * by the payee itself — every paid call is a real USDC transfer on Celoscan.
 * No external facilitator required (THIRDWEB_SECRET_KEY absent; swap in the
 * thirdweb facilitator later if desired).
 */

import { randomBytes } from "node:crypto";
import {
  erc20Abi,
  hexToSignature,
  parseUnits,
  verifyTypedData,
  type Address,
  type Hex,
} from "viem";
import type { HDAccount } from "viem/accounts";
import { FEE_CURRENCIES, TOKENS, explorerTx } from "./addresses.js";
import { celoPublicClient, celoWalletClient, maybeFee } from "./chain.js";
import { logActivity } from "./activity-log.js";

export const X402_VERSION = 1;
export const SIGNAL_AGENT_HD_INDEX = 30;
export const SIGNAL_PRICE_USDC = "0.002"; // $0.002 per call
export const SIGNAL_PRICE_UNITS = parseUnits(SIGNAL_PRICE_USDC, 6);

const EIP3009_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: 42220,
  verifyingContract: TOKENS.USDC,
} as const;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const TRANSFER_WITH_AUTH_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export type PaymentRequirements = {
  scheme: "exact";
  network: "celo";
  asset: Address;
  payTo: Address;
  maxAmountRequired: string; // USDC base units as string
  resource: string;
  description: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type PaymentAuthorization = {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

export type PaymentPayload = {
  x402Version: number;
  scheme: "exact";
  network: "celo";
  payload: { signature: Hex; authorization: PaymentAuthorization };
};

export function buildRequirements(payTo: Address, resource: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: "celo",
    asset: TOKENS.USDC,
    payTo,
    maxAmountRequired: SIGNAL_PRICE_UNITS.toString(),
    resource,
    description: `Spawn swarm market signal — $${SIGNAL_PRICE_USDC} in USDC via EIP-3009`,
    maxTimeoutSeconds: 120,
    extra: { name: EIP3009_DOMAIN.name, version: EIP3009_DOMAIN.version },
  };
}

/** CLIENT: sign an exact-scheme payment and encode the X-PAYMENT header. */
export async function signPayment(
  account: HDAccount,
  req: PaymentRequirements,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const authorization: PaymentAuthorization = {
    from: account.address,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: ("0x" + randomBytes(32).toString("hex")) as Hex,
  };
  const signature = await account.signTypedData({
    domain: EIP3009_DOMAIN,
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: "celo",
    payload: { signature, authorization },
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** SERVER: decode + verify an X-PAYMENT header against requirements. */
export async function verifyPayment(
  header: string,
  req: PaymentRequirements,
): Promise<PaymentPayload> {
  const payload = JSON.parse(Buffer.from(header, "base64").toString()) as PaymentPayload;
  if (payload.x402Version !== X402_VERSION || payload.scheme !== "exact" || payload.network !== "celo") {
    throw new Error("unsupported payment payload");
  }
  const a = payload.payload.authorization;
  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) throw new Error("payment not addressed to payee");
  if (BigInt(a.value) < BigInt(req.maxAmountRequired)) throw new Error("payment amount too small");
  const now = Math.floor(Date.now() / 1000);
  if (now <= Number(a.validAfter) || now >= Number(a.validBefore)) throw new Error("payment authorization expired");

  const valid = await verifyTypedData({
    address: a.from,
    domain: EIP3009_DOMAIN,
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: a.from,
      to: a.to,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
      nonce: a.nonce,
    },
    signature: payload.payload.signature,
  });
  if (!valid) throw new Error("invalid payment signature");

  const balance = await celoPublicClient.readContract({
    address: TOKENS.USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [a.from],
  });
  if (balance < BigInt(a.value)) throw new Error("payer has insufficient USDC");
  return payload;
}

/** SERVER: settle onchain — the payee submits transferWithAuthorization. */
export async function settlePayment(
  payee: HDAccount,
  payload: PaymentPayload,
  buyerSlug: string,
): Promise<Hex> {
  const a = payload.payload.authorization;
  const { v, r, s } = hexToSignature(payload.payload.signature);
  const wallet = celoWalletClient(payee);
  const txHash = await wallet.writeContract({
    address: TOKENS.USDC,
    abi: TRANSFER_WITH_AUTH_ABI,
    functionName: "transferWithAuthorization",
    args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(v), r, s],
    feeCurrency: maybeFee(FEE_CURRENCIES.USDm),
    ...(maybeFee(FEE_CURRENCIES.USDm) ? { gas: 200_000n } : {}),
  });
  const receipt = await celoPublicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error(`x402 settlement reverted: ${explorerTx(txHash)}`);

  logActivity({
    agentId: "signal-oracle",
    action: "x402-settlement",
    rationale: `x402 payment settled: ${buyerSlug} paid $${SIGNAL_PRICE_USDC} USDC for one market-signal call via EIP-3009 transferWithAuthorization (exact scheme). Real agent-to-agent commerce — the buyer signed the authorization, the signal oracle submitted it and pays gas in cUSD.`,
    txHash,
    buyer: a.from,
    valueUsdc: SIGNAL_PRICE_USDC,
  });
  return txHash;
}
