import { describe, expect, it } from "vitest";

import { truncate } from "./truncate.js";

describe("truncate", () => {
  it("leaves short text untouched", () => {
    expect(truncate("hello", false)).toBe("hello");
  });

  it("truncates long text and appends a machine-readable marker", () => {
    const text = "a".repeat(500);

    const result = truncate(text, false, 100);

    expect(result.startsWith("a".repeat(100))).toBe(true);
    expect(result).toContain("truncated, 500 chars total");
    expect(result).toContain("--full");
  });

  it("returns the full text when full=true regardless of length", () => {
    const text = "b".repeat(500);

    expect(truncate(text, true, 100)).toBe(text);
  });
});
