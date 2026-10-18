/**
 * What LayerHop's status page tracks (status.layerhop.com). The worker probes each component every
 * minute; the API serves the history and watches the worker's own heartbeat.
 */
import type { ProviderId } from "./types.js";

export type MonitorGroup = "Core" | "Payments" | "Developer tools" | "Liquidity providers";

export interface MonitorComponent {
  id: string;
  name: string;
  group: MonitorGroup;
  /** http: GET `url` expecting 2xx. provider: a quote probe. heartbeat: the worker's own tick. */
  kind: "http" | "provider" | "heartbeat";
  url?: string;
  provider?: ProviderId;
}

export const MONITOR_COMPONENTS: readonly MonitorComponent[] = [
  { id: "api", name: "API", group: "Core", kind: "http", url: "https://api.layerhop.com/v1/health" },
  { id: "web", name: "Swap app & website", group: "Core", kind: "http", url: "https://layerhop.com/" },
  { id: "worker", name: "Order tracking & webhooks", group: "Core", kind: "heartbeat" },
  { id: "checkout", name: "Checkout & payment buttons", group: "Payments", kind: "http", url: "https://layerhop.com/checkout.js" },
  { id: "dashboard", name: "Developer dashboard", group: "Developer tools", kind: "http", url: "https://dashboard.layerhop.com/" },
  { id: "docs", name: "Documentation", group: "Developer tools", kind: "http", url: "https://docs.layerhop.com/" },
  { id: "mcp", name: "MCP server", group: "Developer tools", kind: "http", url: "https://mcp.layerhop.com/healthz" },
  { id: "bot", name: "Telegram bot", group: "Developer tools", kind: "http", url: "https://bot.layerhop.com/healthz" },
  { id: "provider:jupiter", name: "Jupiter", group: "Liquidity providers", kind: "provider", provider: "jupiter" },
  { id: "provider:relay", name: "Relay", group: "Liquidity providers", kind: "provider", provider: "relay" },
  { id: "provider:debridge", name: "deBridge", group: "Liquidity providers", kind: "provider", provider: "debridge" },
  { id: "provider:lifi", name: "LI.FI", group: "Liquidity providers", kind: "provider", provider: "lifi" },
  { id: "provider:zerox", name: "0x", group: "Liquidity providers", kind: "provider", provider: "zerox" },
  { id: "provider:kyberswap", name: "KyberSwap", group: "Liquidity providers", kind: "provider", provider: "kyberswap" },
];

/** Consecutive failed probes that open an incident (and alert). */
export const MONITOR_FAIL_THRESHOLD = 2;
/** The worker counts as down when its heartbeat is older than this. */
export const HEARTBEAT_STALE_MS = 3 * 60_000;
