/**
 * Money conversions. On Akash today prices are always denominated in `uact`
 * (micro-ACT) and ACT is pegged 1:1 to USD, so USD = amount / 1e6 exactly with
 * no exchange rate. `uakt` no longer exists and must never appear in output.
 */
const UACT_PER_ACT = 1_000_000;

/** Minimum initial deployment deposit in USD, enforced client-side (the server enforces it too). */
export const MIN_DEPOSIT_USD = 0.5;

/** Average block time in seconds (used to convert per-block price to monthly). */
const BLOCK_TIME_SECONDS = 6;
const SECONDS_PER_MONTH = 60 * 60 * 24 * 30;
const BLOCKS_PER_MONTH = SECONDS_PER_MONTH / BLOCK_TIME_SECONDS;

/** Convert a raw micro-denom amount to USD. */
export function uactToUsd(amount: number | string): number {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return n / UACT_PER_ACT;
}

/** Format a USD number for display, e.g. 12.3 -> "$12.30". */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Convert a per-block `uact` price to an estimated USD/month string. */
export function blockPriceToUsdPerMonth(amountPerBlock: number | string): string {
  const perBlockUsd = uactToUsd(amountPerBlock);
  return `${formatUsd(perBlockUsd * BLOCKS_PER_MONTH)}/mo`;
}

/** Raw numeric per-block amount, for exact cheapest-bid comparison. */
export function rawAmount(amount: number | string): number {
  return typeof amount === "string" ? Number(amount) : amount;
}
