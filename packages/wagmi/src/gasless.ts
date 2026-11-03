import type { Address, Hex } from "viem";
import type { Config } from "wagmi";
import { getAccount, signTypedData, switchChain } from "wagmi/actions";
import { gaslessProblems, type Eip712TypedData, type GaslessExpectation, type GaslessSignatures, type GaslessSignRequest } from "@layerhop/sdk";
import { LayerHopWalletError, type SendStep } from "./core.js";

/** The wallet operations a gasless order needs: no transaction is ever sent from the wallet. */
export interface GaslessSigner {
  getAccount(): Promise<{ address?: Address; chainId?: number }>;
  switchChain(chainId: number): Promise<void>;
  /** `eth_signTypedData_v4` of the typed data exactly as given; resolves to the 65-byte signature. */
  signTypedData(typed: Eip712TypedData): Promise<Hex>;
}

/** What the user asked for (from the quote request); the signer is the connected wallet. */
export type GaslessExpectationForSigner = Omit<GaslessExpectation, "sender">;

/**
 * Sign a gasless order (D-043): check the typed data against what the user asked for (`expect`:
 * chain, sell token and amount, recipient, buy token, minimum out; see `gaslessProblems`), switch to
 * its chain (wallets refuse typed data for another chain), then sign the gasless approval when there
 * is one (`approving`) and the trade (`signing`). Send the result to `submitGasless`. Nothing is
 * broadcast here; the provider's relayer sends the transaction. Typed data that would do anything
 * else (another spender, recipient, token, amount, chain or a far deadline) throws `GASLESS_UNSAFE`
 * before the wallet is asked.
 */
export async function signGasless(
  signer: GaslessSigner,
  req: GaslessSignRequest,
  opts: { expect: GaslessExpectationForSigner; onStep?: (step: SendStep) => void },
): Promise<GaslessSignatures> {
  const { address, chainId } = await signer.getAccount();
  if (!address) throw new LayerHopWalletError("NO_ACCOUNT", "Connect a wallet to sign the swap");
  const problems = gaslessProblems(req, { ...opts.expect, sender: address });
  if (problems.length) throw new LayerHopWalletError("GASLESS_UNSAFE", `Refusing to sign: ${problems.join("; ")}`);
  if (chainId !== req.chainId) {
    opts.onStep?.("switching");
    await signer.switchChain(req.chainId);
  }
  let approval: Hex | undefined;
  if (req.approval) {
    opts.onStep?.("approving");
    approval = await signer.signTypedData(req.approval.eip712);
  }
  opts.onStep?.("signing");
  const trade = await signer.signTypedData(req.trade.eip712);
  return approval ? { approval, trade } : { trade };
}

/** A `GaslessSigner` on a wagmi `Config` (its active connection). */
export function wagmiGaslessSigner(config: Config): GaslessSigner {
  return {
    getAccount: async () => {
      const a = getAccount(config);
      return { address: a.address, chainId: a.chainId };
    },
    switchChain: async (chainId) => {
      await switchChain(config, { chainId });
    },
    // The provider's typed data is passed through unchanged (its own EIP712Domain field order included).
    signTypedData: (t) => signTypedData(config, t as unknown as Parameters<typeof signTypedData>[1]),
  };
}
