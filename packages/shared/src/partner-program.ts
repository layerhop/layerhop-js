/**
 * Partner program (layerhop.com/partners, D-059): the lead form for apps, bots and communities that
 * want to send swaps through LayerHop, plus the numbers the page and the API share. Self-serve
 * partner profiles (D-023, dashboard) are separate; this is the "talk to us" path.
 */

/** Starter cap on a partner's own fee in bps (API env PARTNER_STARTER_MAX_FEE_BPS overrides). */
export const DEFAULT_PARTNER_STARTER_MAX_FEE_BPS = 50;
/** Cap on LayerHop's fee + the partner fee in bps (API env MAX_TOTAL_FEE_BPS overrides). */
export const DEFAULT_MAX_TOTAL_FEE_BPS = 150;

export const PARTNER_KINDS = ["wallet", "dapp", "bot", "community", "other"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  wallet: "Wallet",
  dapp: "App or dapp",
  bot: "Telegram or Discord bot",
  community: "Creator or community",
  other: "Something else",
};

export const PARTNER_INTEGRATIONS = ["widget", "button", "sdk", "api", "referral", "other"] as const;
export type PartnerIntegration = (typeof PARTNER_INTEGRATIONS)[number];
export const PARTNER_INTEGRATION_LABEL: Record<PartnerIntegration, string> = {
  widget: "Widget",
  button: "Buy button",
  sdk: "SDK",
  api: "REST API",
  referral: "Referral links",
  other: "Not sure yet",
};

export const PARTNER_VOLUMES = ["under_10k", "10k_100k", "100k_1m", "1m_10m", "over_10m"] as const;
export type PartnerVolume = (typeof PARTNER_VOLUMES)[number];
export const PARTNER_VOLUME_LABEL: Record<PartnerVolume, string> = {
  under_10k: "Under $10k a month",
  "10k_100k": "$10k to $100k a month",
  "100k_1m": "$100k to $1M a month",
  "1m_10m": "$1M to $10M a month",
  over_10m: "Over $10M a month",
};

export const PARTNER_APPLICATION_STATUSES = ["new", "contacted", "accepted", "declined"] as const;
export type PartnerApplicationStatus = (typeof PARTNER_APPLICATION_STATUSES)[number];

export const PARTNER_APPLICATION_NAME_MAX = 80;
export const PARTNER_APPLICATION_PROJECT_MAX = 80;
export const PARTNER_APPLICATION_CONTACT_MAX = 200;
export const PARTNER_APPLICATION_MESSAGE_MAX = 1000;

export interface PartnerApplicationInput {
  name: string;
  project: string;
  url: string;
  contact: string;
  kind: PartnerKind;
  integrations: PartnerIntegration[];
  expectedVolume: PartnerVolume;
  message?: string;
}

export interface PartnerApplication extends PartnerApplicationInput {
  id: string;
  status: PartnerApplicationStatus;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

/**
 * The highest partner fee a starter partner can set on a channel: the starter cap, limited so
 * LayerHop's fee plus the partner fee stays within the total cap.
 */
export function maxPartnerFeeBps(ourFeeBps: number, starterMaxBps = DEFAULT_PARTNER_STARTER_MAX_FEE_BPS, maxTotalBps = DEFAULT_MAX_TOTAL_FEE_BPS): number {
  return Math.max(0, Math.min(starterMaxBps, maxTotalBps - ourFeeBps));
}

/** A partner's fee income in USD on `volumeUsd` of swaps at `bps` (both clamped at 0). */
export function partnerEarningsUsd(volumeUsd: number, bps: number): number {
  if (!Number.isFinite(volumeUsd) || !Number.isFinite(bps)) return 0;
  return (Math.max(0, volumeUsd) * Math.max(0, bps)) / 10_000;
}
