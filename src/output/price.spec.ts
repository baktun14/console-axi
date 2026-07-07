import { describe, expect, it } from "vitest";

import { blockPriceToUsdPerMonth, formatUsd, MIN_DEPOSIT_USD, rawAmount, uactToUsd } from "./price.js";

describe("uactToUsd", () => {
  it("converts micro-ACT to USD 1:1 (amount / 1e6)", () => {
    expect(uactToUsd(1_000_000)).toBe(1);
    expect(uactToUsd("2500000")).toBe(2.5);
  });
});

describe("formatUsd", () => {
  it("formats to two decimals with a dollar sign", () => {
    expect(formatUsd(12.3)).toBe("$12.30");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("blockPriceToUsdPerMonth", () => {
  it("scales a per-block uact price to an estimated USD/month string", () => {
    // 1 uact/block * 432000 blocks/month / 1e6 = $0.43/mo
    expect(blockPriceToUsdPerMonth(1)).toBe("$0.43/mo");
  });

  it("returns zero for a zero price", () => {
    expect(blockPriceToUsdPerMonth("0")).toBe("$0.00/mo");
  });
});

describe("rawAmount", () => {
  it("coerces string amounts to numbers for exact comparison", () => {
    expect(rawAmount("100")).toBe(100);
    expect(rawAmount(250)).toBe(250);
  });
});

describe("MIN_DEPOSIT_USD", () => {
  it("is the $0.50 minimum deposit and formats as shown in errors", () => {
    expect(MIN_DEPOSIT_USD).toBe(0.5);
    expect(formatUsd(MIN_DEPOSIT_USD)).toBe("$0.50");
  });
});
