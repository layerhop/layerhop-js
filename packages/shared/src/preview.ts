import type { Vm } from "./types.js";

/**
 * Addresses used ONLY to fetch indicative quotes before a user's wallet is known (landing page,
 * Telegram bot). Partners reject burn/system addresses (0x…dEaD, 1111…1111) on many routes, so these
 * are ordinary, publicly known wallet accounts. Never build or send a transaction for them.
 */
export const PREVIEW_ADDRESS: Readonly<Record<Vm, string>> = {
  evm: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  svm: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
};
