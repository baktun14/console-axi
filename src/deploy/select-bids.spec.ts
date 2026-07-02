import { describe, expect, it } from "vitest";

import { type BidLike, parseAcceptStrategy, selectBids } from "./select-bids.js";

describe("selectBids", () => {
  it("picks the cheapest bid per order group by exact raw amount", () => {
    const bids = setup([
      { gseq: 1, oseq: 1, provider: "p-a", amount: "300" },
      { gseq: 1, oseq: 1, provider: "p-b", amount: "100" },
      { gseq: 1, oseq: 1, provider: "p-c", amount: "200" }
    ]);

    const { selected, unmatchedGroups } = selectBids(bids, "cheapest");

    expect(unmatchedGroups).toEqual([]);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ provider: "p-b", amount: 100 });
  });

  it("selects one bid per distinct order group", () => {
    const bids = setup([
      { gseq: 1, oseq: 1, provider: "p-a", amount: "100" },
      { gseq: 2, oseq: 1, provider: "p-b", amount: "500" }
    ]);

    const { selected } = selectBids(bids, "cheapest");

    expect(selected).toHaveLength(2);
    expect(selected.map((s) => s.provider).sort()).toEqual(["p-a", "p-b"]);
  });

  it("uses the first open bid per group with the first strategy", () => {
    const bids = setup([
      { gseq: 1, oseq: 1, provider: "p-first", amount: "999" },
      { gseq: 1, oseq: 1, provider: "p-cheap", amount: "1" }
    ]);

    const { selected } = selectBids(bids, "first");

    expect(selected[0]?.provider).toBe("p-first");
  });

  it("selects the named provider's bid", () => {
    const bids = setup([
      { gseq: 1, oseq: 1, provider: "p-a", amount: "100" },
      { gseq: 1, oseq: 1, provider: "p-target", amount: "200" }
    ]);

    const { selected } = selectBids(bids, { provider: "p-target" });

    expect(selected[0]?.provider).toBe("p-target");
  });

  it("reports groups with no matching provider as unmatched", () => {
    const bids = setup([{ gseq: 1, oseq: 1, provider: "p-a", amount: "100" }]);

    const { selected, unmatchedGroups } = selectBids(bids, { provider: "p-missing" });

    expect(selected).toEqual([]);
    expect(unmatchedGroups).toEqual(["1/1"]);
  });

  it("ignores non-open bids", () => {
    const bids = [
      makeBid({ gseq: 1, oseq: 1, provider: "p-closed", amount: "1", state: "closed" }),
      makeBid({ gseq: 1, oseq: 1, provider: "p-open", amount: "500", state: "open" })
    ];

    const { selected } = selectBids(bids, "cheapest");

    expect(selected[0]?.provider).toBe("p-open");
  });

  it("returns nothing when there are no bids", () => {
    const { selected, unmatchedGroups } = selectBids([], "cheapest");

    expect(selected).toEqual([]);
    expect(unmatchedGroups).toEqual([]);
  });
});

describe("parseAcceptStrategy", () => {
  it("recognizes the cheapest and first keywords", () => {
    expect(parseAcceptStrategy("cheapest")).toBe("cheapest");
    expect(parseAcceptStrategy("first")).toBe("first");
  });

  it("treats any other value as a provider address", () => {
    expect(parseAcceptStrategy("akash1prov")).toEqual({ provider: "akash1prov" });
  });
});

function makeBid(input: { gseq: number; oseq: number; provider: string; amount: string; state?: string }): BidLike {
  return {
    bid: {
      id: { dseq: "100", gseq: input.gseq, oseq: input.oseq, provider: input.provider },
      state: input.state ?? "open",
      price: { denom: "uact", amount: input.amount }
    }
  };
}

function setup(entries: Array<{ gseq: number; oseq: number; provider: string; amount: string }>): BidLike[] {
  return entries.map(makeBid);
}
