/** Base units → human string ("1500000", 6 → "1.5"). Exact: BigInt only, never floats. */
export function formatUnits(base: string, decimals: number): string {
  if (!/^\d+$/.test(base)) return base;
  if (decimals === 0) return base.replace(/^0+(?=\d)/, "");
  const s = base.padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Human string → base units ("1.5", 6 → "1500000"). Throws on bad input or too many decimals. */
export function parseUnits(human: string, decimals: number): string {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(human.trim());
  if (!m || (m[1] === "" && !m[2])) throw new Error(`Invalid amount: ${human}`);
  const int = m[1] ?? "";
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`Amount ${human} has more than ${decimals} decimals`);
  const out = (int + frac.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  return out === "" ? "0" : out;
}

/** Plain-text table, columns padded to the widest cell. */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

export function json(v: unknown): string {
  return JSON.stringify(v, null, 2);
}
