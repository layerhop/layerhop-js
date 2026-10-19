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

function mockConnection(status: "confirmed" | "failed" = "confirmed") {
  const sendRawTransaction = vi.fn(async (_raw: Uint8Array, _opts?: unknown) => "rpcSig");
  const getSignatureStatuses = vi.fn(async () => ({
    context: { slot: 1 },
    value: [status === "failed" ? { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" } : { err: null, confirmationStatus: "confirmed" }],
  }));
  return { connection: { sendRawTransaction, getSignatureStatuses } as unknown as Connection, sendRawTransaction, getSignatureStatuses };
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
  it("plain tx: the wallet signs and sends", async () => {
    const { signer, signAndSendTransaction, signTransaction } = mockSigner();
    const { connection, sendRawTransaction } = mockConnection();
    const r = await sendSvmTx(signer, svm(), { connection });
    expect(r).toMatchObject({ signature: "walletSig", mode: "wallet" });
    expect(signAndSendTransaction).toHaveBeenCalledOnce();
    expect(signTransaction).not.toHaveBeenCalled();
    expect(sendRawTransaction).not.toHaveBeenCalled();
    expect(await r.wait()).toBe(true);
  });

  it("plain tx with a sign-only wallet: we broadcast the signed bytes", async () => {
    const { signer } = mockSigner(false);
    const { connection, sendRawTransaction } = mockConnection();
    expect((await sendSvmTx(signer, svm(), { connection })).signature).toBe("rpcSig");
    expect(sendRawTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), { skipPreflight: false, maxRetries: 3 });
  });

  it("co-signed tx: sign only and broadcast the exact bytes (never sign-and-send)", async () => {
    const { signer, signAndSendTransaction } = mockSigner();
    const { connection, sendRawTransaction } = mockConnection();
    const r = await sendSvmTx(signer, svm({ serializedTx: serialized({ cosigned: true }) }), { connection });
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
    expect(await (await sendSvmTx(signer, svm(), { connection })).wait()).toBe(false);
  });
});

describe("executeSolanaQuote", () => {
  it("builds, sends and reports the signature", async () => {
    const { signer } = mockSigner();
    const { connection } = mockConnection();
    const client = { buildTx: vi.fn(async () => svm()), submit: vi.fn(), reportSubmitted: vi.fn(async () => ({})) };
    const steps: string[] = [];
    const r = await executeSolanaQuote(signer, { quote: { quoteId: "q_1" }, client, connection, onStep: (s) => steps.push(s) });
    expect(r).toMatchObject({ signature: "walletSig", mode: "wallet", quoteId: "q_1", reported: true });
    expect(client.reportSubmitted).toHaveBeenCalledWith("q_1", "walletSig");
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
  it("fromWalletAdapter: signTransaction + sendTransaction(tx, connection, options)", async () => {
    const sendTransaction = vi.fn(async () => "adapterSig");
    const signTransaction = vi.fn(async <T,>(tx: T) => tx);
    const { connection } = mockConnection();
    const signer = fromWalletAdapter({ signTransaction, sendTransaction });
    expect((await sendSvmTx(signer, svm(), { connection })).signature).toBe("adapterSig");
    expect(sendTransaction).toHaveBeenCalledWith(expect.any(VersionedTransaction), connection, { skipPreflight: false, maxRetries: 3 });
    // A real adapter instance type-checks as the input.
    const typed = (a: BaseSignerWalletAdapter) => fromWalletAdapter(a);
    expect(typeof typed).toBe("function");
  });

  it("fromWalletStandard: solana:signAndSendTransaction with bytes, signature to base58", async () => {
    const account = { address: USER.toBase58(), publicKey: USER.toBytes(), chains: ["solana:mainnet"], features: [] };
    const sig = new Uint8Array(64).fill(3);
    const signAndSendTransaction = vi.fn(async () => [{ signature: sig }]);
    const signTransaction = vi.fn(async ({ transaction }: { transaction: Uint8Array }) => [{ signedTransaction: transaction }]);
    const wallet = { features: { "solana:signAndSendTransaction": { signAndSendTransaction }, "solana:signTransaction": { signTransaction } } };
    const { connection, sendRawTransaction } = mockConnection();
    const signer = fromWalletStandard(wallet, account);
    expect((await sendSvmTx(signer, svm(), { connection })).signature).toBe(bytesToBase58(sig));
    expect(signAndSendTransaction).toHaveBeenCalledWith(expect.objectContaining({ account, chain: "solana:mainnet", transaction: expect.any(Uint8Array) }));
    // Co-signed goes through solana:signTransaction and our RPC.
    await sendSvmTx(signer, svm({ serializedTx: serialized({ cosigned: true }) }), { connection });
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("fromInjectedProvider: Reown / Phantom-style providers (string or { signature })", async () => {
    const { connection } = mockConnection();
    const provider = {
      signTransaction: vi.fn(async <T,>(tx: T) => tx),
      signAndSendTransaction: vi.fn(async () => ({ signature: "phantomSig" })),
    };
    expect((await sendSvmTx(fromInjectedProvider(provider), svm(), { connection })).signature).toBe("phantomSig");
  });
});
