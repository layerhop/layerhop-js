/**
 * Hyperliquid referral link for users LayerHop deposits into Hyperliquid on its own surfaces
 * (layerhop.com's swap app, the widget only when framed by layerhop.com's own landing pages, and the
 * Telegram bot). Never added to API responses, SDKs or the widget on other sites: those users belong
 * to the integrator (D-031).
 *
 * Program terms (https://hyperliquid.gitbook.io/hyperliquid-docs/referrals, checked
 * {@link HL_REFERRAL_TERMS_CHECKED}): the referrer gets 10% of referred users' fees, less any discount
 * they receive, for the user's first $1B of volume; a user who joins with a code gets a 4% fee
 * discount on their first $25M of volume; the discount doesn't apply to vaults or sub-accounts. The
 * code is created by the owner on app.hyperliquid.xyz/referrals (needs $10,000 of their own volume).
 *
 * Code format: Hyperliquid's docs don't state one. The `registerReferrer` exchange action takes a
 * 1-20 character code (Chainstack's API reference); we accept letters and digits only, 1-20.
 */

/** Date the program terms above were read. */
export const HL_REFERRAL_TERMS_CHECKED = "2026-10-21";
export const HL_REFERRAL_TERMS_URL = "https://hyperliquid.gitbook.io/hyperliquid-docs/referrals";

/** Referee fee discount and the volume it applies to, as published in the terms above. */
export const HL_REFERRAL_DISCOUNT = "4%";
export const HL_REFERRAL_DISCOUNT_VOLUME = "$25M";

export const HL_REFERRAL_CODE_RE = /^[A-Za-z0-9]{1,20}$/;

/** The configured code if it is valid, else undefined (feature off). Surrounding spaces are ignored. */
export function parseHyperliquidReferralCode(raw: string | undefined | null): string | undefined {
  const code = raw?.trim();
  return code && HL_REFERRAL_CODE_RE.test(code) ? code : undefined;
}

/** `https://app.hyperliquid.xyz/join/<CODE>`; throws on an invalid code. */
export function hyperliquidReferralLink(code: string): string {
  if (!HL_REFERRAL_CODE_RE.test(code)) throw new Error("invalid Hyperliquid referral code");
  return `https://app.hyperliquid.xyz/join/${code}`;
}
