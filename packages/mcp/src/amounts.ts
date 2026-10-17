/**
 * Human decimal amounts <-> integer base units, with string/BigInt math only (never JS floats).
 * "1.5" USDC (6 decimals) <-> "1500000".
 */

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

const DECIMAL_RE = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;

/**
 * Convert a human decimal ("100", "0.25", ".5") into an integer base-unit string.
 * Rejects negatives, zero, exponents, separators and more fractional digits than `decimals`.
 */
export function toBaseUnits(human: string | number, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77) throw new AmountError(`Invalid token decimals: ${decimals}`);
  const s = typeof human === "number" ? numberToPlain(human) : human.trim();
  const m = DECIMAL_RE.exec(s);
  if (!m) {
    throw new AmountError(
      `Invalid amount "${String(human)}". Use a positive decimal number in human units with "." as the separator, e.g. "100" or "0.25".`,
    );
  }
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? m[3] ?? "").replace(/0+$/, "");
  if (frac.length > decimals) {
    throw new AmountError(`Amount "${s}" has more than ${decimals} decimal places, which this token does not support.`);
  }
  const base = BigInt(whole + frac.padEnd(decimals, "0"));
  if (base <= 0n) throw new AmountError("Amount must be greater than 0.");
  return base.toString();
}

/** Convert integer base units into a human decimal string with trailing zeros trimmed ("1500000", 6 -> "1.5"). */
export function fromBaseUnits(base: string | bigint, decimals: number): string {
  const v = typeof base === "bigint" ? base : BigInt(base);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  if (decimals === 0) return (neg ? "-" : "") + abs.toString();
  const s = abs.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? `.${frac}` : "");
}

/** Like fromBaseUnits but cut to at most `maxFraction` decimals (rounded down) for display. */
export function displayAmount(base: string | bigint, decimals: number, maxFraction = 6): string {
  const full = fromBaseUnits(base, decimals);
  const [w, f] = full.split(".");
  if (!f || f.length <= maxFraction) return full;
  const cut = f.slice(0, maxFraction).replace(/0+$/, "");
  if (!cut && w === "0") return `<0.${"0".repeat(maxFraction - 1)}1`;
  return cut ? `${w}.${cut}` : (w as string);
}

function numberToPlain(n: number): string {
  if (!Number.isFinite(n)) throw new AmountError(`Invalid amount: ${n}`);
  const s = String(n);
  if (/e/i.test(s)) {
    throw new AmountError(`Amount ${s} is in exponent notation; pass it as a plain decimal string instead, e.g. "0.0000001".`);
  }
  return s;
}
