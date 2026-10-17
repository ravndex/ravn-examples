/**
 * The RAVN client every example shares: the official SDK, `@ravnexchange/sdk`, plus a few helpers.
 *
 * The SDK is a zero-dependency, typed wrapper around /api/v1 (quote, execute, submit-signature,
 * submit-transaction, status). Its `executeAndTrack` runs a whole swap in the right order: the
 * approval mined first, 0x Gasless's `approvalData`, RAVN's fee payment, and status polling with
 * execute's quoteToken, its statusRef and the fee payment's hash. SDK 0.2.0 (in progress) adds
 * progress callbacks and retries.
 *
 * Docs: https://docs.ravn.exchange/sdks/core
 */
import { RavnClient } from "@ravnexchange/sdk";

export const RAVN_BASE = process.env.RAVN_BASE_URL ?? "https://app.ravn.exchange/api/v1";

export const ravn = new RavnClient({
  baseUrl: RAVN_BASE,
  // Optional. Anonymous works at 30 req/min; a free key raises it to 120.
  apiKey: process.env.RAVN_API_KEY || undefined,
});

/** Native coin sentinel — use as a token address for ETH, BNB, AVAX, etc. */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const CHAIN = {
  ethereum: 1,
  optimism: 10,
  bnb: 56,
  unichain: 130,
  monad: 143,
  polygon: 137,
  zksync: 324,
  worldchain: 480,
  hyperevm: 999,
  robinhood: 4663,
  base: 8453,
  arbitrum: 42161,
  linea: 59144,
  avalanche: 43114,
  /** Native Bitcoin. Not wrapped, not cbBTC. */
  bitcoin: -1,
  solana: -2,
} as const;

/** Human amount → smallest unit, without floating-point error. */
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

/** Smallest unit → human string, for display only. */
export function fromBaseUnits(amount: string, decimals: number): string {
  const s = amount.padStart(decimals + 1, "0");
  const out = `${s.slice(0, -decimals) || "0"}.${s.slice(-decimals)}`.replace(/\.?0+$/, "");
  return out || "0";
}
