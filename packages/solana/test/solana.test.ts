// Every wallet and RPC here is a mock: nothing is signed with a real key and nothing hits a network.
import type { SvmTx } from "@layerhop/sdk";
import type { BaseSignerWalletAdapter } from "@solana/wallet-adapter-base";
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  bytesToBase58,
  bytesToBase64,
  decodeSvmTx,
  executeSolanaQuote,
  fromInjectedProvider,
  fromWalletAdapter,
  fromWalletStandard,
  LayerHopSolanaError,
  sendSvmTx,
  solanaSendMode,
  type SolanaSigner,
} from "../src/index.js";

const USER = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const COSIGNER = new PublicKey("So11111111111111111111111111111111111111112");
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";

function serialized({ cosigned = false } = {}): string {
  const ix = SystemProgram.transfer({ fromPubkey: USER, toPubkey: COSIGNER, lamports: 1000 });
  if (cosigned) ix.keys.push({ pubkey: COSIGNER, isSigner: true, isWritable: false });
  const msg = new TransactionMessage({ payerKey: USER, recentBlockhash: BLOCKHASH, instructions: [ix] }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  if (cosigned) vtx.signatures[1] = new Uint8Array(64).fill(9); // the provider's signature, already there
  return bytesToBase64(vtx.serialize());
}

const svm = (over: Partial<SvmTx> = {}): SvmTx => ({ vm: "svm", serializedTx: serialized(), ...over });

/** The base58 signature the mock wallet produces (fee-payer slot filled with 7s). */
const SIGNED = bytesToBase58(new Uint8Array(64).fill(7));
const noSleep = async () => undefined;

/** A mock wallet: "signs" by filling the fee-payer slot with 7s (no key involved). */
function mockSigner(withSend = true) {
  const signTransaction = vi.fn(async (tx: VersionedTransaction) => {
    tx.signatures[0] = new Uint8Array(64).fill(7);
    return tx;
  });
  const signAndSendTransaction = vi.fn(async () => "walletSig");
  const signer: SolanaSigner = withSend ? { signTransaction, signAndSendTransaction } : { signTransaction };
  return { signer, signTransaction, signAndSendTransaction };
}

/**
 * A mock RPC. `pendingPolls`: how many status polls see nothing before the tx shows up. Block height
 * starts at 1000 and moves `blocksPerPoll` per height read.
 */
function mockConnection(status: "confirmed" | "failed" | "never" = "confirmed", { pendingPolls = 0, blocksPerPoll = 0 } = {}) {
  let polls = 0;
  let height = 1000;
  const sendRawTransaction = vi.fn(async (_raw: Uint8Array, _opts?: unknown) => "rpcSig");
  const getSignatureStatuses = vi.fn(async () => {
    const seen = status !== "never" && polls++ >= pendingPolls;
    return {
      context: { slot: 1 },
      value: [!seen ? null : status === "failed" ? { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" } : { err: null, confirmationStatus: "confirmed" }],
    };
  });
  const getBlockHeight = vi.fn(async () => {
    const h = height;
    height += blocksPerPoll;
    return h;
  });
  return { connection: { sendRawTransaction, getSignatureStatuses, getBlockHeight } as unknown as Connection, sendRawTransaction, getSignatureStatuses, getBlockHeight };
}

describe("helpers", () => {
  it("decodes the base64 SvmTx", () => {
    const vtx = decodeSvmTx(svm());
    expect(vtx.message.staticAccountKeys[0]!.equals(USER)).toBe(true);
    expect(decodeSvmTx(svm().serializedTx).signatures).toHaveLength(1);
  });

  it("picks the send mode: api, co-signed or wallet", () => {
    const empty = new Uint8Array(64);
    expect(solanaSendMode(true, [empty])).toBe("api");
    expect(solanaSendMode(false, [empty, new Uint8Array(64).fill(1)])).toBe("cosigned");
    expect(solanaSendMode(undefined, [new Uint8Array(64).fill(1), empty])).toBe("wallet");
  });

  it("base58-encodes like Solana (leading zeros become 1s)", () => {
    expect(bytesToBase58(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(bytesToBase58(USER.toBytes())).toBe(USER.toBase58());
  });
});

describe("sendSvmTx", () => {
  it("plain tx: the wallet only signs, we broadcast the signed bytes through our RPC", async () => {
    const { signer, signAndSendTransaction, signTransaction } = mockSigner();
    const { connection, sendRawTransaction } = mockConnection();
    const r = await sendSvmTx(signer, svm(), { connection, sleep: noSleep });
    expect(r).toMatchObject({ signature: SIGNED, mode: "wallet" });
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
    expect(VersionedTransaction.deserialize(sendRawTransaction.mock.calls[0]![0]).signatures[0]).toEqual(new Uint8Array(64).fill(7));
    expect(await r.wait()).toBe(true);
  });

  it("re-sends the same signed bytes every interval until the tx lands", async () => {
    const { signer } = mockSigner();
    const { connection, sendRawTransaction } = mockConnection("confirmed", { pendingPolls: 4 });
    const sleeps: number[] = [];
    const r = await sendSvmTx(signer, svm(), { connection, sleep: async (ms) => void sleeps.push(ms) });
    // The signature is back as soon as the first broadcast is accepted (the order flow reports it at once).
    expect(r.signature).toBe(SIGNED);
    expect(await r.wait()).toBe(true);
    // 1 broadcast + 4 re-sends (one after each poll that saw nothing), all the exact same bytes.
    expect(sendRawTransaction).toHaveBeenCalledTimes(5);
    const first = sendRawTransaction.mock.calls[0]![0];
    for (const [bytes, opts] of sendRawTransaction.mock.calls.slice(1)) {
      expect(bytes).toEqual(first);
      expect(opts).toEqual({ skipPreflight: true, maxRetries: 0 });
    }
    expect(sleeps.every((ms) => ms === 2000)).toBe(true);
  });

  it("stops re-sending once the blockhash expired and reports it as expired", async () => {
    const { signer } = mockSigner();
    // Never lands; 20 blocks pass per height read, so the 150-block window closes after a few polls.
    const { connection, sendRawTransaction } = mockConnection("never", { blocksPerPoll: 20 });
    const r = await sendSvmTx(signer, svm(), { connection, sleep: noSleep });
    const err = await r.wait().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LayerHopSolanaError);
    expect(err).toMatchObject({ code: "BLOCKHASH_EXPIRED" });
    expect((err as Error).message).toMatch(/block height exceeded/);
    const sends = sendRawTransaction.mock.calls.length;
    expect(sends).toBeGreaterThan(1);
    expect(sends).toBeLessThan(12);
    await new Promise((res) => setTimeout(res, 10));
    expect(sendRawTransaction.mock.calls.length).toBe(sends);
  });

  it("a tx found right at expiry still counts", async () => {
    const { signer } = mockSigner();
    // The final status check after the window closed sees it (pending for the first 8 polls).
    const { connection } = mockConnection("confirmed", { pendingPolls: 8, blocksPerPoll: 20 });
    const r = await sendSvmTx(signer, svm(), { connection, sleep: noSleep });
    expect(await r.wait()).toBe(true);
  });

  it("a stale RPC's 'Blockhash not found' preflight is retried without preflight; a real simulation failure throws", async () => {
    const { signer } = mockSigner();
    const { connection, sendRawTransaction } = mockConnection();
    sendRawTransaction.mockRejectedValueOnce(new Error("failed to send transaction: Transaction simulation failed: Blockhash not found"));
    const r = await sendSvmTx(signer, svm(), { connection, sleep: noSleep });
    expect(r.signature).toBe(SIGNED);
    expect(sendRawTransaction.mock.calls[1]![1]).toEqual({ skipPreflight: true, maxRetries: 0 });

    const bad = mockConnection();
    bad.sendRawTransaction.mockRejectedValueOnce(new Error("Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1771"));
    await expect(sendSvmTx(mockSigner().signer, svm(), { connection: bad.connection, sleep: noSleep })).rejects.toThrow(/0x1771/);
    expect(bad.sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("wait() can be cancelled and times out while the tx is still pending", async () => {
    const { signer } = mockSigner();
    const { connection } = mockConnection("never");
    const r = await sendSvmTx(signer, svm(), { connection, landTimeoutMs: 200, sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))) });
    expect(await r.wait({ isCancelled: () => true })).toBe(false);
    await expect(r.wait({ timeoutMs: 20, pollMs: 5 })).rejects.toMatchObject({ code: "CONFIRMATION_TIMEOUT" });
  });

  it("an empty wallet answer is a clear WALLET_NO_SIGNATURE error, never a TypeError", async () => {
    const { connection, sendRawTransaction } = mockConnection();
    const unsigned: SolanaSigner = { signTransaction: async (tx) => tx };
    const nothing = { signTransaction: async () => undefined } as unknown as SolanaSigner;
    const noSigs = { signTransaction: async () => ({}) } as unknown as SolanaSigner;
    for (const s of [unsigned, nothing, noSigs]) {
      await expect(sendSvmTx(s, svm(), { connection })).rejects.toMatchObject({ name: "LayerHopSolanaError", code: "WALLET_NO_SIGNATURE" });
    }
    expect(sendRawTransaction).not.toHaveBeenCalled();
    // A sign-and-send wallet (fallback path) that answers without a signature.
    const provider = { signAndSendTransaction: vi.fn(async () => ({}) as { signature: string }) } as unknown as Parameters<typeof fromInjectedProvider>[0];
    await expect(sendSvmTx(fromInjectedProvider(provider), svm(), { connection })).rejects.toMatchObject({ code: "WALLET_NO_SIGNATURE" });
    const empty = { signAndSendTransaction: vi.fn(async () => undefined) } as unknown as Parameters<typeof fromInjectedProvider>[0];
    await expect(sendSvmTx(fromInjectedProvider(empty), svm(), { connection })).rejects.toMatchObject({ code: "WALLET_NO_SIGNATURE" });
  });

  it("falls back to the wallet's sign-and-send only when it can't sign alone; a rejection is never retried", async () => {
    const { connection, sendRawTransaction } = mockConnection();
    // No signTransaction at all (some mobile adapters).
    const sendOnly = { signAndSendTransaction: vi.fn(async () => "walletSig") } as unknown as Parameters<typeof fromInjectedProvider>[0];
    const r = await sendSvmTx(fromInjectedProvider(sendOnly), svm(), { connection, sleep: noSleep });
    expect(r).toMatchObject({ signature: "walletSig", mode: "wallet" });
    expect(sendRawTransaction).not.toHaveBeenCalled();
    expect(await r.wait()).toBe(true);
    // signTransaction exists but the wallet says the method is unsupported.
    const unsupported = { signTransaction: vi.fn(async () => Promise.reject(Object.assign(new Error("Method not supported"), { code: 4200 }))), signAndSendTransaction: vi.fn(async () => ({ signature: "wcSig" })) };
    expect((await sendSvmTx(fromInjectedProvider(unsupported), svm(), { connection, sleep: noSleep })).signature).toBe("wcSig");
    // A user rejection stays a rejection.
    const rejecting = { signTransaction: vi.fn(async () => Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 }))), signAndSendTransaction: vi.fn(async () => "x") };
    await expect(sendSvmTx(fromInjectedProvider(rejecting), svm(), { connection })).rejects.toThrow(/rejected/);
    expect(rejecting.signAndSendTransaction).not.toHaveBeenCalled();
    // Co-signed transactions never fall back (the wallet could rewrite them).
    await expect(sendSvmTx(fromInjectedProvider(sendOnly), svm({ serializedTx: serialized({ cosigned: true }) }), { connection })).rejects.toMatchObject({ code: "SIGN_UNSUPPORTED" });
  });

  it("co-signed tx: sign only and broadcast the exact bytes (never sign-and-send)", async () => {
    const { signer, signAndSendTransaction } = mockSigner();
    const { connection, sendRawTransaction } = mockConnection();
    const r = await sendSvmTx(signer, svm({ serializedTx: serialized({ cosigned: true }) }), { connection, sleep: noSleep });
    expect(r.mode).toBe("cosigned");
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    const bytes = sendRawTransaction.mock.calls[0]![0];
    const sent = VersionedTransaction.deserialize(bytes);
    expect(sent.signatures[1]).toEqual(new Uint8Array(64).fill(9));
    expect(sent.signatures[0]).toEqual(new Uint8Array(64).fill(7));
  });

  it("submitViaApi: sign only, then POST /v1/orders/submit", async () => {
    const { signer, signAndSendTransaction } = mockSigner();
    const { connection, sendRawTransaction } = mockConnection();
    const client = { submit: vi.fn(async (_quoteId: string, _signed: string) => "apiSig") };
    const steps: string[] = [];
    const r = await sendSvmTx(signer, svm({ submitViaApi: true }), { connection, client, quoteId: "q_1", onStep: (s) => steps.push(s) });
    expect(r).toMatchObject({ signature: "apiSig", mode: "api" });
    expect(client.submit).toHaveBeenCalledWith("q_1", expect.any(String));
    const signed = decodeSvmTx(client.submit.mock.calls[0]![1]);
    expect(signed.signatures[0]).toEqual(new Uint8Array(64).fill(7));
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(sendRawTransaction).not.toHaveBeenCalled();
    expect(steps).toEqual(["signing", "submitting"]);
    await expect(sendSvmTx(signer, svm({ submitViaApi: true }), { connection })).rejects.toThrow(/client/);
  });

  it("refuses sandbox and EVM transactions", async () => {
    const { signer, signTransaction } = mockSigner();
    const { connection } = mockConnection();
    await expect(sendSvmTx(signer, svm({ sandbox: true }), { connection })).rejects.toBeInstanceOf(LayerHopSolanaError);
    await expect(sendSvmTx(signer, { vm: "evm" } as never, { connection })).rejects.toThrow(/@layerhop\/wagmi/);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("wait() is false when the transaction failed", async () => {
    const { signer } = mockSigner();
    const { connection } = mockConnection("failed");
    expect(await (await sendSvmTx(signer, svm(), { connection, sleep: noSleep })).wait()).toBe(false);
  });
});

describe("executeSolanaQuote", () => {
  it("builds, sends and reports the signature", async () => {
    const { signer } = mockSigner();
    const { connection } = mockConnection();
    const client = { buildTx: vi.fn(async () => svm()), submit: vi.fn(), reportSubmitted: vi.fn(async () => ({})) };
    const steps: string[] = [];
    const r = await executeSolanaQuote(signer, { quote: { quoteId: "q_1" }, client, connection, onStep: (s) => steps.push(s) });
    expect(r).toMatchObject({ signature: SIGNED, mode: "wallet", quoteId: "q_1", reported: true });
    expect(client.reportSubmitted).toHaveBeenCalledWith("q_1", SIGNED);
    expect(steps).toEqual(["building", "signing", "reporting"]);
  });

  it("test mode: never touches the wallet, reports a placeholder signature", async () => {
    const { signer, signTransaction, signAndSendTransaction } = mockSigner();
    const { connection } = mockConnection();
    const client = { buildTx: vi.fn(async () => svm({ sandbox: true })), submit: vi.fn(), reportSubmitted: vi.fn(async () => ({})) };
    const r = await executeSolanaQuote(signer, { quote: { quoteId: "q_test" }, client, connection });
    expect(r.mode).toBe("sandbox");
    expect(r.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{60,90}$/);
    expect(signTransaction).not.toHaveBeenCalled();
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(client.reportSubmitted).toHaveBeenCalledWith("q_test", r.signature);
  });
});

describe("wallet stacks", () => {
  it("fromWalletAdapter: signTransaction first, sendTransaction(tx, connection, options) only without it", async () => {
    const sendTransaction = vi.fn(async () => "adapterSig");
    const signTransaction = vi.fn(async <T extends VersionedTransaction>(tx: T) => {
      tx.signatures[0] = new Uint8Array(64).fill(7);
      return tx;
    });
    const { connection } = mockConnection();
    expect((await sendSvmTx(fromWalletAdapter({ signTransaction, sendTransaction }), svm(), { connection, sleep: noSleep })).signature).toBe(SIGNED);
    expect(sendTransaction).not.toHaveBeenCalled();
    expect((await sendSvmTx(fromWalletAdapter({ sendTransaction }), svm(), { connection, sleep: noSleep })).signature).toBe("adapterSig");
    expect(sendTransaction).toHaveBeenCalledWith(expect.any(VersionedTransaction), connection, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    // A real adapter instance type-checks as the input.
    const typed = (a: BaseSignerWalletAdapter) => fromWalletAdapter(a);
    expect(typeof typed).toBe("function");
  });

  it("fromWalletStandard: solana:signTransaction, and solana:signAndSendTransaction (base58) only without it", async () => {
    const account = { address: USER.toBase58(), publicKey: USER.toBytes(), chains: ["solana:mainnet"], features: [] };
    const sig = new Uint8Array(64).fill(3);
    const signAndSendTransaction = vi.fn(async () => [{ signature: sig }]);
    const signTransaction = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => {
      const t = VersionedTransaction.deserialize(transaction);
      t.signatures[0] = new Uint8Array(64).fill(7);
      return [{ signedTransaction: t.serialize() }];
    });
    const { connection, sendRawTransaction } = mockConnection();
    const both = fromWalletStandard({ features: { "solana:signAndSendTransaction": { signAndSendTransaction }, "solana:signTransaction": { signTransaction } } }, account);
    expect((await sendSvmTx(both, svm(), { connection, sleep: noSleep })).signature).toBe(SIGNED);
    expect(signTransaction).toHaveBeenCalledWith(expect.objectContaining({ account, chain: "solana:mainnet", transaction: expect.any(Uint8Array) }));
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(sendRawTransaction).toHaveBeenCalledOnce();
    const sendOnly = fromWalletStandard({ features: { "solana:signAndSendTransaction": { signAndSendTransaction } } }, account);
    expect((await sendSvmTx(sendOnly, svm(), { connection, sleep: noSleep })).signature).toBe(bytesToBase58(sig));
    expect(signAndSendTransaction).toHaveBeenCalledWith(expect.objectContaining({ account, chain: "solana:mainnet", transaction: expect.any(Uint8Array) }));
    // An empty answer from the wallet is a classified error.
    const blank = fromWalletStandard({ features: { "solana:signAndSendTransaction": { signAndSendTransaction: async () => [{}] } } }, account);
    await expect(sendSvmTx(blank, svm(), { connection })).rejects.toMatchObject({ code: "WALLET_NO_SIGNATURE" });
  });

  it("fromInjectedProvider: Reown / Phantom-style providers sign only; sign-and-send (string or { signature }) is the fallback", async () => {
    const { connection } = mockConnection();
    const provider = {
      signTransaction: vi.fn(async <T extends VersionedTransaction>(tx: T) => {
        tx.signatures[0] = new Uint8Array(64).fill(7);
        return tx;
      }),
      signAndSendTransaction: vi.fn(async () => ({ signature: "phantomSig" })),
    };
    expect((await sendSvmTx(fromInjectedProvider(provider), svm(), { connection, sleep: noSleep })).signature).toBe(SIGNED);
    expect(provider.signAndSendTransaction).not.toHaveBeenCalled();
    const sendOnly = { signAndSendTransaction: vi.fn(async () => "plainSig") } as unknown as Parameters<typeof fromInjectedProvider>[0];
    expect((await sendSvmTx(fromInjectedProvider(sendOnly), svm(), { connection, sleep: noSleep })).signature).toBe("plainSig");
  });
});
