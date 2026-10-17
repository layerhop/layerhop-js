import { LayerHopError } from "./errors.js";

/** JSON fetch with timeout that turns HTTP/provider failures into LayerHopError. */
export async function fetchJson<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 8_000, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchFn(url, { ...rest, signal: combined });
  } catch (e) {
    if (timeout.aborted) throw new LayerHopError("PROVIDER_TIMEOUT", `Timed out: ${new URL(url).host}`);
    throw new LayerHopError("PROVIDER_ERROR", `Network error: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new LayerHopError(res.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR", `${new URL(url).host} ${res.status}`, body);
  }
  return body as T;
}
