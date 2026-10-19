import type { BuiltTx } from "@layerhop/shared";

/**
 * Turns a LayerHop BuiltTx into the ordered list of UNSIGNED transaction requests a host wallet
 * must send (ERC-20 approval first, then the swap, then any extra calls). Pure data: nothing here
 * can sign or broadcast. Hosts hand these to their own signer after the user confirmed.
 */

export type Hex = `0x${string}`;

export interface EvmTxRequest {
  kind: "approval" | "swap" | "extra";
  vm: "evm";
  chainId: number;
  to: Hex;
  data: Hex;
  /** wei, integer string */
  value: string;
  description: string;
}

export interface SvmTxRequest {
  kind: "swap";
  vm: "svm";
  /** base64 VersionedTransaction */
  serializedTx: string;
  /** true: the wallet must only SIGN; the signed tx goes to LayerHop's submit endpoint (sdk.submit). */
  submitViaApi: boolean;
  description: string;
}

export type TxRequest = EvmTxRequest | SvmTxRequest;

/** Minimal ERC-20 ABI (allowance / approve) for wallets that read or write through an ABI. */
export const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const word = (hexNo0x: string) => hexNo0x.toLowerCase().padStart(64, "0");

/** Calldata for ERC-20 approve(spender, amount). amount: integer string in base units. */
export function encodeApprove(spender: string, amount: string | bigint): Hex {
  if (!/^0x[0-9a-fA-F]{40}$/.test(spender)) throw new Error(`Invalid spender address: ${spender}`);
  const v = BigInt(amount);
  if (v < 0n || v >= 2n ** 256n) throw new Error(`Invalid approval amount: ${amount}`);
  return `0x095ea7b3${word(spender.slice(2))}${word(v.toString(16))}`;
}

/** Calldata for ERC-20 allowance(owner, spender) (for an eth_call). */
export function encodeAllowance(owner: string, spender: string): Hex {
  return `0xdd62ed3e${word(owner.slice(2))}${word(spender.slice(2))}`;
}

/** Thrown for test-mode placeholder transactions, which must never be broadcast. */
export class SandboxTxError extends Error {
  constructor() {
    super("This is a test-mode (sandbox) placeholder transaction: it moves no funds and must never be broadcast. Use a live API key for real swaps.");
    this.name = "SandboxTxError";
  }
}

export function isSandboxTx(tx: BuiltTx): boolean {
  return tx.sandbox === true;
}

export function toTransactionRequests(tx: BuiltTx): TxRequest[] {
  if (tx.vm === "svm") {
    return [
      {
        kind: "swap",
        vm: "svm",
        serializedTx: tx.serializedTx,
        submitViaApi: tx.submitViaApi === true,
        description: tx.submitViaApi
          ? "Sign this Solana transaction with the user's wallet (do not broadcast it); send the signed transaction to LayerHop's submit endpoint."
          : "Sign and send this Solana transaction from the user's wallet.",
      },
    ];
  }
  const out: TxRequest[] = [];
  if (tx.approval) {
    out.push({
      kind: "approval",
      vm: "evm",
      chainId: tx.chainId,
      to: tx.approval.token as Hex,
      data: encodeApprove(tx.approval.spender, tx.approval.amount),
      value: "0",
      description: `ERC-20 approve(${tx.approval.spender}, ${tx.approval.amount}) on token ${tx.approval.token}. Send first and wait until it is mined.`,
    });
  }
  out.push({
    kind: "swap",
    vm: "evm",
    chainId: tx.chainId,
    to: tx.to as Hex,
    data: tx.data as Hex,
    value: tx.value,
    description: `The swap: send to ${tx.to} with value ${tx.value} wei.`,
  });
  for (const x of tx.extraTxs ?? []) {
    out.push({ kind: "extra", vm: "evm", chainId: tx.chainId, to: x.to as Hex, data: x.data as Hex, value: x.value, description: `Follow-up call to ${x.to}, after the swap.` });
  }
  return out;
}
