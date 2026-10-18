export interface McpConfig {
  /** LayerHop API base URL. Env LAYERHOP_API_URL, default https://api.layerhop.com. */
  apiUrl: string;
  /** Optional API key (`lh_live_…`). Env LAYERHOP_API_KEY. */
  apiKey?: string;
  /** Optional partner id for partner fees. Env LAYERHOP_INTEGRATOR. */
  integrator?: string;
  /** Web app used for deep links. Env LAYERHOP_APP_URL, default https://layerhop.com. */
  appUrl: string;
  /** Docs site (llms.txt). Env LAYERHOP_DOCS_URL, default https://docs.layerhop.com. */
  docsUrl: string;
}

export const VERSION = "0.5.0";

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  return {
    apiUrl: (clean(env.LAYERHOP_API_URL) ?? "https://api.layerhop.com").replace(/\/$/, ""),
    apiKey: clean(env.LAYERHOP_API_KEY),
    integrator: clean(env.LAYERHOP_INTEGRATOR),
    appUrl: (clean(env.LAYERHOP_APP_URL) ?? "https://layerhop.com").replace(/\/$/, ""),
    docsUrl: (clean(env.LAYERHOP_DOCS_URL) ?? "https://docs.layerhop.com").replace(/\/$/, ""),
  };
}
