import type { LayerHopClient } from "./core/client.js";
import type { QuoteCache } from "./core/resolve.js";
import { UserInputError } from "./core/resolve.js";
import { SandboxTxError, toTransactionRequests, type EvmTxRequest, type Hex } from "./core/txs.js";

/**
 * Hands LayerHop's UNSIGNED transactions to a signer the HOST app provides (its own wallet,
 * AgentKit wallet provider, GOAT wallet client, ElizaOS wallet service...). LayerHop never sees or
 * holds keys: this module only builds requests, calls the host's `send`, and reports the hash.
 * Hosts must only call it after the user explicitly confirmed the quote.
 */

export interface EvmSigner {
  /** The wallet address that signs (must be the quote's sender). */
  address: string;
  /** The chain the wallet is on, when it is bound to one (AgentKit / GOAT wallets are). */
  chainId?: number;
  /** Current ERC-20 allowance; lets the executor skip an approval that is already in place. */
  getAllowance?(token: Hex, owner: Hex, spender: Hex): Promise<bigint>;
  /** Sign and broadcast one transaction with the host's wallet; returns the tx hash. */
  sendTransaction(req: EvmTxRequest): Promise<string>;
  /** Wait until a tx is mined (used after an approval, before the swap). */
  waitForReceipt?(hash: string): Promise<unknown>;
}

export interface SvmSigner {
  address: string;
  /** Sign and broadcast a base64 VersionedTransaction; returns the signature. */
  signAndSendTransaction(serializedTxBase64: string): Promise<string>;
  /** Only sign (for submitViaApi transactions); returns the signed tx as base64. */
  signTransaction?(serializedTxBase64: string): Promise<string>;
}

export interface ExecuteSwapResult extends Record<string, unknown> {
  quoteId: string;
  provider: string;
  approvalTxHash?: string;
  txHash: string;
  extraTxHashes?: string[];
  reported: boolean;
  summary: string;
}

interface ExecDeps {
  client: LayerHopClient;
  quotes: QuoteCache;
  /** Tool name mapper, for messages. */
  toolName?: (base: string) => string;
}

const sameAddress = (a: string, b: string) => (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);

function checkQuote(deps: ExecDeps, quoteId: string, signer: string) {
  const t = deps.toolName ?? ((n: string) => n);
  const ctx = deps.quotes.get(quoteId);
  if (!ctx) {
    throw new UserInputError(`Unknown quoteId ${quoteId}. Get a fresh quote with ${t("get_quote")} (sender = the wallet address ${signer}), show it to the user and get explicit confirmation first.`);
  }
  if (!sameAddress(ctx.sender, signer)) {
    throw new UserInputError(`Quote ${quoteId} was made for sender ${ctx.sender}, but this wallet is ${signer}. Get a new quote with sender ${signer}.`);
  }
  if (ctx.expiresAt * 1000 < Date.now()) {
    throw new UserInputError(`Quote ${quoteId} expired. Get a fresh quote with ${t("get_quote")} and show the user the new numbers before executing.`);
  }
  return ctx;
}

async function report(deps: ExecDeps, quoteId: string, hash: string): Promise<boolean> {
  try {
    await deps.client.reportSubmitted(quoteId, hash);
    return true;
  } catch {
    return false; // tracking by provider + hash still works
  }
}

/** Build the quote's tx and send it with the host's EVM signer: approval (if needed) -> swap -> extra calls. */
export async function executeEvmSwap(deps: ExecDeps, quoteId: string, signer: EvmSigner): Promise<ExecuteSwapResult> {
  const ctx = checkQuote(deps, quoteId, signer.address);
  const built = await deps.client.buildOrder(quoteId);
  const tx = built.tx;
  if (tx.sandbox) throw new SandboxTxError();
  if (tx.vm !== "evm") throw new UserInputError(`Quote ${quoteId} is a Solana transaction; this wallet is an EVM wallet.`);
  if (signer.chainId !== undefined && signer.chainId !== tx.chainId) {
    throw new UserInputError(`The swap must be sent on chain ${tx.chainId} (${ctx.srcChain.name}) but the wallet is on chain ${signer.chainId}. Switch the wallet's network first.`);
  }
  const reqs = toTransactionRequests(tx).filter((r): r is EvmTxRequest => r.vm === "evm");
  let approvalTxHash: string | undefined;
  const approval = reqs.find((r) => r.kind === "approval");
  if (approval && tx.approval) {
    const needed = BigInt(tx.approval.amount);
    const current = signer.getAllowance ? await signer.getAllowance(tx.approval.token as Hex, signer.address as Hex, tx.approval.spender as Hex) : 0n;
    if (current < needed) {
      approvalTxHash = await signer.sendTransaction(approval);
      if (signer.waitForReceipt) await signer.waitForReceipt(approvalTxHash);
    }
  }
  const swap = reqs.find((r) => r.kind === "swap")!;
  const txHash = await signer.sendTransaction(swap);
  const extraTxHashes: string[] = [];
  for (const r of reqs.filter((x) => x.kind === "extra")) extraTxHashes.push(await signer.sendTransaction(r));
  const reported = await report(deps, quoteId, txHash);
  const t = deps.toolName ?? ((n: string) => n);
  return {
    quoteId,
    provider: built.provider,
    ...(approvalTxHash ? { approvalTxHash } : {}),
    txHash,
    ...(extraTxHashes.length ? { extraTxHashes } : {}),
    reported,
    summary: `Sent ${ctx.amount} ${ctx.srcToken.symbol} on ${ctx.srcChain.name} -> ${ctx.dstToken.symbol} on ${ctx.dstChain.name} (tx ${txHash}${approvalTxHash ? `, approval ${approvalTxHash}` : ""}). Track it with ${t("get_order_status")} { provider: "${built.provider}", txHash: "${txHash}" }.`,
  };
}

/** Build the quote's Solana tx and hand it to the host's SVM signer (sign-only + LayerHop submit when required). */
export async function executeSvmSwap(deps: ExecDeps, quoteId: string, signer: SvmSigner): Promise<ExecuteSwapResult> {
  const ctx = checkQuote(deps, quoteId, signer.address);
  const built = await deps.client.buildOrder(quoteId);
  const tx = built.tx;
  if (tx.sandbox) throw new SandboxTxError();
  if (tx.vm !== "svm") throw new UserInputError(`Quote ${quoteId} is an EVM transaction; this wallet is a Solana wallet.`);
  let txHash: string;
  if (tx.submitViaApi) {
    if (!signer.signTransaction) throw new UserInputError("This route needs a sign-only Solana wallet (submitViaApi); the wallet cannot sign without sending.");
    const signed = await signer.signTransaction(tx.serializedTx);
    txHash = await deps.client.sdk.submit(quoteId, signed);
  } else {
    txHash = await signer.signAndSendTransaction(tx.serializedTx);
  }
  const reported = await report(deps, quoteId, txHash);
  const t = deps.toolName ?? ((n: string) => n);
  return {
    quoteId,
    provider: built.provider,
    txHash,
    reported,
    summary: `Sent ${ctx.amount} ${ctx.srcToken.symbol} on ${ctx.srcChain.name} -> ${ctx.dstToken.symbol} on ${ctx.dstChain.name} (signature ${txHash}). Track it with ${t("get_order_status")} { provider: "${built.provider}", txHash: "${txHash}" }.`,
  };
}

/** One line a host can show the user before asking for confirmation. */
export function describeQuoteForConfirmation(quotes: QuoteCache, quoteId: string): string | undefined {
  const c = quotes.get(quoteId);
  if (!c) return undefined;
  return `Swap ${c.amount} ${c.srcToken.symbol} on ${c.srcChain.name} to ${c.dstToken.symbol} on ${c.dstChain.name}, recipient ${c.recipient}, via ${c.provider}.`;
}
