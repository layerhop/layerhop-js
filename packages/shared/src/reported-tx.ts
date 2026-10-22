/**
 * Read-only check of a source transaction a client reported for an order
 * (`POST /v1/orders/{quoteId}/submitted`), shared by the API and the worker. Never signs or sends.
 *
 * - EVM (`eth_getTransactionByHash`, pending transactions included): `from` must be the order's
 *   sender and `to` a target of a transaction LayerHop built for the order. A smart-wallet call
 *   (`from` is an owner key or a bundler) is accepted when its input contains the built calldata.
 *   Orders without a stored built transaction are checked by `from` only.
 * - Solana (`getTransaction`, confirmed): the order's sender must be one of the signers.
 *
 * `notfound` covers "not visible yet" and "could not ask" (no RPC, RPC error): the hash can be
 * recorded as provisional, never as verified.
 */
import { getChain } from "./chains.js";
import type { ChainId } from "./types.js";

export type ReportedTxCheck = { result: "verified" } | { result: "notfound"; reason: string } | { result: "mismatch"; reason: string };

/** Fingerprint of a built tx as stored on the order (`orders.built_txs`, see the API's tx-fingerprint.ts). */
type Fingerprint = { vm: "evm"; to: string; data: string; value: string } | { vm: "svm"; ixs: unknown[] };

export interface ReportedTxOrder {
  srcChainId: number;
  sender: string;
  builtTxs?: unknown;
}

export interface ReportedTxDeps {
  fetch: typeof fetch;
  rpcUrl(chainId: ChainId): string | undefined;
  timeoutMs?: number;
}

/** Shortest built calldata accepted inside a wrapped (smart-wallet) call: selector + one word. */
const MIN_WRAPPED_DATA = 2 + 8 + 64;

async function rpc<T>(deps: ReportedTxDeps, url: string, method: string, params: unknown[]): Promise<T> {
  const res = await deps.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(deps.timeoutMs ?? 6_000),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message?: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message ?? "rpc error"}`);
  return j.result as T;
}

export async function checkReportedTx(o: ReportedTxOrder, hash: string, deps: ReportedTxDeps): Promise<ReportedTxCheck> {
  const chain = getChain(String(o.srcChainId));
  const url = deps.rpcUrl(o.srcChainId);
  if (!chain || !url) return { result: "notfound", reason: `no RPC for chain ${o.srcChainId}` };
  try {
    return chain.vm === "evm" ? await checkEvm(o, hash, url, deps) : await checkSvm(o, hash, url, deps);
  } catch (e) {
    return { result: "notfound", reason: e instanceof Error ? e.message : String(e) };
  }
}

async function checkEvm(o: ReportedTxOrder, hash: string, url: string, deps: ReportedTxDeps): Promise<ReportedTxCheck> {
  const tx = await rpc<{ from?: string; to?: string | null; input?: string } | null>(deps, url, "eth_getTransactionByHash", [hash]);
  if (!tx?.from) return { result: "notfound", reason: "transaction not found yet" };
  const from = tx.from.toLowerCase();
  const to = (tx.to ?? "").toLowerCase();
  const input = (tx.input ?? "0x").toLowerCase();
  const fps = (Array.isArray(o.builtTxs) ? (o.builtTxs as Fingerprint[]) : []).filter((f): f is Extract<Fingerprint, { vm: "evm" }> => f?.vm === "evm");
  const wrapped = fps.some((f) => f.data.length >= MIN_WRAPPED_DATA && input.includes(f.data.slice(2)));
  if (from !== o.sender.toLowerCase()) {
    if (wrapped) return { result: "verified" };
    return { result: "mismatch", reason: "the transaction was not sent by this order's sender" };
  }
  if (fps.length === 0 || wrapped || fps.some((f) => f.to === to)) return { result: "verified" };
  return { result: "mismatch", reason: "the transaction does not call the contract this order was built for" };
}

async function checkSvm(o: ReportedTxOrder, sig: string, url: string, deps: ReportedTxDeps): Promise<ReportedTxCheck> {
  type Key = string | { pubkey: string; signer?: boolean };
  const tx = await rpc<{ transaction?: { message?: { accountKeys?: Key[]; header?: { numRequiredSignatures?: number } } } } | null>(
    deps, url, "getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
  );
  const msg = tx?.transaction?.message;
  if (!msg?.accountKeys) return { result: "notfound", reason: "transaction not found yet" };
  const n = msg.header?.numRequiredSignatures ?? 1;
  const signers = msg.accountKeys.slice(0, n).map((k) => (typeof k === "string" ? k : k.pubkey));
  if (signers.includes(o.sender)) return { result: "verified" };
  return { result: "mismatch", reason: "the transaction was not signed by this order's sender" };
}
