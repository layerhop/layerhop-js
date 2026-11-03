import { VersionedTransaction, type Connection, type SendOptions } from "@solana/web3.js";
import { LayerHopSolanaError, walletSignature } from "./send.js";

/**
 * The two wallet operations a LayerHop Solana send needs. Build one from your wallet stack with
 * `fromWalletAdapter`, `fromWalletStandard` or `fromInjectedProvider`. Nothing here holds keys.
 */
export interface SolanaSigner {
  /**
   * Sign only. Every send asks for this first: we broadcast and re-send the signed bytes ourselves.
   * Throw `LayerHopSolanaError("SIGN_UNSUPPORTED")` when the wallet can't sign without sending.
   */
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
  /** Sign and broadcast in the wallet; resolves to the signature (base58). Only used when sign-only is unsupported. Optional. */
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
      if (!sign) throw new LayerHopSolanaError("SIGN_UNSUPPORTED", "This wallet cannot sign transactions without sending them.");
      return sign(tx);
    },
    ...(send
      ? { signAndSendTransaction: async (tx: VersionedTransaction, { connection, sendOptions }: { connection: Connection; sendOptions: SendOptions }) => walletSignature(await send(tx, connection, sendOptions)) }
      : {}),
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
      if (!signFeature) throw new LayerHopSolanaError("SIGN_UNSUPPORTED", "This wallet does not support solana:signTransaction.");
      const [out] = (await signFeature.signTransaction({ account, transaction: tx.serialize(), chain })) ?? [];
      if (!(out?.signedTransaction instanceof Uint8Array)) throw new LayerHopSolanaError("WALLET_NO_SIGNATURE", "The wallet returned no signed transaction, so nothing was sent.");
      return VersionedTransaction.deserialize(out.signedTransaction);
    },
    ...(sendFeature
      ? {
          signAndSendTransaction: async (tx: VersionedTransaction, { sendOptions }: { sendOptions: SendOptions }) => {
            const [out] = (await sendFeature.signAndSendTransaction({
              account, transaction: tx.serialize(), chain,
              options: { skipPreflight: sendOptions.skipPreflight, maxRetries: sendOptions.maxRetries, preflightCommitment: sendOptions.preflightCommitment },
            })) ?? [];
            return walletSignature(out?.signature);
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
  signAndSendTransaction?: (tx: VersionedTransaction, options?: SendOptions) => Promise<string | { signature: string | Uint8Array } | undefined>;
}

/** A `SolanaSigner` from an injected-style provider (see `InjectedProviderLike`). */
export function fromInjectedProvider(provider: InjectedProviderLike): SolanaSigner {
  const send = typeof provider.signAndSendTransaction === "function" ? provider.signAndSendTransaction.bind(provider) : undefined;
  return {
    signTransaction: async (tx) => {
      // Typed as required, but some mobile / WalletConnect providers only sign-and-send.
      if (typeof provider.signTransaction !== "function") throw new LayerHopSolanaError("SIGN_UNSUPPORTED", "This wallet cannot sign transactions without sending them.");
      return provider.signTransaction(tx);
    },
    ...(send ? { signAndSendTransaction: async (tx: VersionedTransaction, { sendOptions }: { sendOptions: SendOptions }) => walletSignature(await send(tx, sendOptions)) } : {}),
  };
}
