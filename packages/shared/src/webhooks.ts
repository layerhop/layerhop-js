/**
 * Webhook signatures (docs/PLATFORM_SPEC.md §Webhook delivery).
 *
 * Header: `LayerHop-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>`
 *
 * Uses Web Crypto (globalThis.crypto.subtle), so it works in Node ≥ 20, Deno, Bun, edge runtimes and
 * browsers without pulling in node:crypto.
 */

export const WEBHOOK_SIGNATURE_HEADER = "LayerHop-Signature";
export const WEBHOOK_EVENT_HEADER = "LayerHop-Event";
export const WEBHOOK_DELIVERY_HEADER = "LayerHop-Delivery";

async function hmacHex(secret: string, message: string): Promise<string> {
  // Created per call, not at import: importing the SDK must work where TextEncoder is missing.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Build a `LayerHop-Signature` header value for `rawBody` (exact bytes sent, as a string). */
export async function signWebhookPayload(secret: string, rawBody: string, timestampSec = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestampSec},v1=${await hmacHex(secret, `${timestampSec}.${rawBody}`)}`;
}

/**
 * Verify a `LayerHop-Signature` header against the raw request body (do NOT re-serialize parsed JSON).
 * Returns false when the header is malformed, the timestamp is outside `toleranceSec` of now
 * (replay protection), or no `v1` signature matches.
 */
export async function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret || !header) return false;
  let t: number | undefined;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t" && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t === undefined || v1.length === 0) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return v1.some((s) => timingSafeEqualStr(s, expected));
}
