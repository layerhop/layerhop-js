import { VersionedTransaction, type Connection, type SendOptions } from "@solana/web3.js";
import { bytesToBase58 } from "./bytes.js";

/**
 * The two wallet operations a LayerHop Solana send needs. Build one from your wallet stack with
 * `fromWalletAdapter`, `fromWalletStandard` or `fromInjectedProvider`. Nothing here holds keys.
 */
export interface SolanaSigner {
  /** Sign only (submit-via-API and co-signed transactions must not be rewritten by the wallet). */
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  /** Sign and broadcast in the wallet; resolves to the signature (base58). Optional. */
  signAndSendTransaction?(tx: VersionedTransaction, ctx: { connection: Connection; sendOptions: SendOptions }): Promise<string>;
}

/** The parts of `useWallet()` (@solana/wallet-adapter-react) or a wallet adapter instance we use. */
export interface WalletAdapterLike {
  signTransaction?: (<T extends VersionedTransaction>(tx: T) => Promise<T>) | undefined;
  sendTransaction?: (tx: VersionedTransaction, connection: Connection, options?: SendOptions) => Promise<string>;
}

/** A `SolanaSigner` from `@solana/wallet-adapter` (`useWallet()` or an adapter instance). */
export function fromWalletAdapter(wallet: WalletAdapterLike): SolanaSigner {
  const sign = wallet.signTransaction;
  const send = wallet.sendTransaction;
  return {
    signTransaction: async (tx) => {
      if (!sign) throw new Error("This wallet cannot sign transactions without sending them.");
      return sign(tx);
    },
    ...(send ? { signAndSendTransaction: (tx: VersionedTransaction, { connection, sendOptions }: { connection: Connection; sendOptions: SendOptions }) => send(tx, connection, sendOptions) } : {}),
  };
}

/** A Wallet Standard account (`@wallet-standard/base` `WalletAccount`), structurally. */
export interface StandardAccountLike {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
}

/** A Wallet Standard wallet with the `solana:signTransaction` / `solana:signAndSendTransaction` features. */
export interface StandardWalletLike {
  features: Record<string, unknown>;
}

type StdSign = {
  signTransaction(...inputs: { account: StandardAccountLike; transaction: Uint8Array; chain?: string }[]): Promise<readonly { signedTransaction: Uint8Array }[]>;
};
type StdSignAndSend = {
  signAndSendTransaction(
    ...inputs: { account: StandardAccountLike; transaction: Uint8Array; chain: string; options?: { skipPreflight?: boolean; maxRetries?: number; preflightCommitment?: string } }[]
  ): Promise<readonly { signature: Uint8Array }[]>;
};

/**
 * A `SolanaSigner` from a Wallet Standard wallet (`@wallet-standard/app` `getWallets()`, or the
 * wallet behind `@solana/wallet-adapter`'s standard adapter). `chain` defaults to `solana:mainnet`.
 */
export function fromWalletStandard(wallet: StandardWalletLike, account: StandardAccountLike, chain = "solana:mainnet"): SolanaSigner {
  const signFeature = wallet.features["solana:signTransaction"] as StdSign | undefined;
  const sendFeature = wallet.features["solana:signAndSendTransaction"] as StdSignAndSend | undefined;
  return {
    signTransaction: async (tx) => {
      if (!signFeature) throw new Error("This wallet does not support solana:signTransaction.");
      const [out] = await signFeature.signTransaction({ account, transaction: tx.serialize(), chain });
      if (!out) throw new Error("The wallet returned no signed transaction.");
      return VersionedTransaction.deserialize(out.signedTransaction);
    },
    ...(sendFeature
      ? {
          signAndSendTransaction: async (tx: VersionedTransaction, { sendOptions }: { sendOptions: SendOptions }) => {
            const [out] = await sendFeature.signAndSendTransaction({
              account, transaction: tx.serialize(), chain,
              options: { skipPreflight: sendOptions.skipPreflight, maxRetries: sendOptions.maxRetries, preflightCommitment: sendOptions.preflightCommitment },
            });
            if (!out) throw new Error("The wallet returned no signature.");
            return bytesToBase58(out.signature);
          },
        }
      : {}),
  };
}

/**
 * An injected-style Solana provider: Reown AppKit's Solana `walletProvider`, `window.phantom.solana`,
 * Privy / Dynamic Solana wallets and most embedded wallets expose `signTransaction` and usually
 * `signAndSendTransaction`.
 */
export interface InjectedProviderLike {
  signTransaction<T extends VersionedTransaction>(tx: T): Promise<T>;
  signAndSendTransaction?: (tx: VersionedTransaction, options?: SendOptions) => Promise<string | { signature: string }>;
}

/** A `SolanaSigner` from an injected-style provider (see `InjectedProviderLike`). */
export function fromInjectedProvider(provider: InjectedProviderLike): SolanaSigner {
  const send = provider.signAndSendTransaction?.bind(provider);
  return {
    signTransaction: (tx) => provider.signTransaction(tx),
    ...(send
      ? {
          signAndSendTransaction: async (tx: VersionedTransaction, { sendOptions }: { sendOptions: SendOptions }) => {
            const r = await send(tx, sendOptions);
            return typeof r === "string" ? r : r.signature;
          },
        }
      : {}),
  };
}
