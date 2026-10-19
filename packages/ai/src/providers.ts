import type { ProviderId } from "@layerhop/shared";

/** Providers an order can be tracked with (same list as the MCP server). */
export const PROVIDERS = ["jupiter", "relay", "debridge", "mayan", "zerox", "kyberswap", "odos", "lifi", "mock"] as const satisfies readonly ProviderId[];
