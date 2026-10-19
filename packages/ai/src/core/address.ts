/** Address validation per VM. Pure functions, no chain access. */

export type Vm = "evm" | "svm";

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function isEvmAddress(a: string): boolean {
  return EVM_RE.test(a);
}

/** Decode base58 to bytes, or null when the string has non-base58 characters. */
export function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A Solana address (public key) is base58 that decodes to exactly 32 bytes. */
export function isSolanaAddress(a: string): boolean {
  if (a.length < 32 || a.length > 44) return false;
  return base58Decode(a)?.length === 32;
}

export function isValidAddress(vm: Vm, a: string): boolean {
  return vm === "evm" ? isEvmAddress(a) : isSolanaAddress(a);
}

export function vmOfAddress(a: string): Vm | undefined {
  if (isEvmAddress(a)) return "evm";
  if (isSolanaAddress(a)) return "svm";
  return undefined;
}

export function describeVm(vm: Vm): string {
  return vm === "evm" ? "an EVM address (0x followed by 40 hex characters)" : "a Solana address (base58 public key)";
}

/** Throws a message an LLM can act on when `a` is not a valid address for `vm`. */
export function assertAddress(vm: Vm, a: string, field: string, chainName: string): void {
  if (!isValidAddress(vm, a)) {
    throw new Error(`${field} "${a}" is not valid on ${chainName}: expected ${describeVm(vm)}.`);
  }
}

/** EVM tx hash (0x + 64 hex) or Solana signature (base58, 64 bytes). */
export function isTxHash(h: string): boolean {
  if (/^0x[0-9a-fA-F]{64}$/.test(h)) return true;
  if (h.length < 64 || h.length > 90) return false;
  return base58Decode(h)?.length === 64;
}
