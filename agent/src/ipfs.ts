import { createHash, createHmac } from "crypto";

const FILEBASE_ENDPOINT = "s3.filebase.com";
const FILEBASE_REGION = "us-east-1";
const FILEBASE_BUCKET = process.env.FILEBASE_BUCKET ?? "spawn-yield";

// ─── AWS Sig V4 helpers ───────────────────────────────────────────────────────

function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function signingKey(secret: string, date: string): Buffer {
  const kDate    = hmac(Buffer.from(`AWS4${secret}`), date);
  const kRegion  = hmac(kDate, FILEBASE_REGION);
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

async function putFilebaseObject(key: string, body: string): Promise<string> {
  const accessKey = process.env.FILEBASE_API_KEY;
  const secretKey = process.env.FILEBASE_SECRET;
  if (!accessKey || !secretKey) {
    throw new Error("[IPFS] FILEBASE_API_KEY / FILEBASE_SECRET not set");
  }

  const now        = new Date();
  const amzDate    = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp  = amzDate.slice(0, 8);
  const host       = `${FILEBASE_BUCKET}.${FILEBASE_ENDPOINT}`;
  const contentType = "application/json";
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${key}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${FILEBASE_REGION}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signature = hmac(signingKey(secretKey, dateStamp), stringToSign).toString("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}/${key}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "Host": host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      "Authorization": authorization,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`[IPFS] Filebase PUT failed: HTTP ${response.status} — ${text}`);
  }

  const cid = response.headers.get("x-amz-meta-cid");
  if (!cid) throw new Error("[IPFS] Filebase response missing x-amz-meta-cid header");

  return cid;
}

// ─── Local fallback ───────────────────────────────────────────────────────────

function localFallbackCID(payload: unknown): string {
  const seed = JSON.stringify(payload).slice(0, 120);
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  }
  return `local:fallback-${Date.now()}-${hash.toString(16)}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function pinToIPFS(data: object): Promise<string> {
  const key  = `postmortem-${Date.now()}.json`;
  const body = JSON.stringify(data);
  const cid  = await putFilebaseObject(key, body);
  console.log(`[IPFS] Pinned to Filebase → CID: ${cid}`);
  console.log(`[IPFS] Gateway: https://ipfs.filebase.io/ipfs/${cid}`);
  return cid;
}

export async function pinTerminationMemory(report: object): Promise<string | null> {
  try {
    return await pinToIPFS(report);
  } catch (err: any) {
    console.warn(`[IPFS] Filebase upload failed — using local fallback: ${err?.message}`);
    return localFallbackCID(report);
  }
}
