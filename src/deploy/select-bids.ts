import { rawAmount } from "../output/price.js";

export interface BidLike {
  bid: {
    id: { dseq: string; gseq: number; oseq: number; provider: string };
    state: string;
    price: { denom: string; amount: string };
  };
}

export interface SelectedBid {
  dseq: string;
  gseq: number;
  oseq: number;
  provider: string;
  amount: number;
}

export type AcceptStrategy = "cheapest" | "first" | { provider: string };

/**
 * Choose exactly one bid per order group (keyed by gseq/oseq). A deployment with
 * multiple placement groups produces multiple orders; each needs its own lease.
 *
 *  - "cheapest": lowest raw per-block amount in the group (exact integer compare).
 *  - "first":    first open bid encountered in the group.
 *  - {provider}: the bid from that provider in the group.
 *
 * Returns the selected bids, or throws-worthy info if any group has no candidate.
 */
export function selectBids(
  bids: BidLike[],
  strategy: AcceptStrategy
): { selected: SelectedBid[]; unmatchedGroups: string[] } {
  const open = bids.filter((b) => b.bid.state === "open");
  const groups = new Map<string, BidLike[]>();
  for (const b of open) {
    const key = `${b.bid.id.gseq}/${b.bid.id.oseq}`;
    const list = groups.get(key);
    if (list) list.push(b);
    else groups.set(key, [b]);
  }

  const selected: SelectedBid[] = [];
  const unmatchedGroups: string[] = [];

  for (const [key, groupBids] of groups) {
    const chosen = pickFromGroup(groupBids, strategy);
    if (!chosen) {
      unmatchedGroups.push(key);
      continue;
    }
    selected.push({
      dseq: chosen.bid.id.dseq,
      gseq: chosen.bid.id.gseq,
      oseq: chosen.bid.id.oseq,
      provider: chosen.bid.id.provider,
      amount: rawAmount(chosen.bid.price.amount)
    });
  }

  return { selected, unmatchedGroups };
}

function pickFromGroup(groupBids: BidLike[], strategy: AcceptStrategy): BidLike | undefined {
  if (typeof strategy === "object") {
    return groupBids.find((b) => b.bid.id.provider === strategy.provider);
  }
  if (strategy === "first") {
    return groupBids[0];
  }
  // cheapest
  return groupBids.reduce<BidLike | undefined>((best, b) => {
    if (!best) return b;
    return rawAmount(b.bid.price.amount) < rawAmount(best.bid.price.amount) ? b : best;
  }, undefined);
}

/** Parse the `--accept` flag value into a strategy. */
export function parseAcceptStrategy(value: string): AcceptStrategy {
  if (value === "cheapest" || value === "first") return value;
  return { provider: value };
}
