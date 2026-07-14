import { describe, expect, it } from "vitest";

import { cpuCores, humanBytes, humanDuration } from "./units.js";

describe("units", () => {
  it("humanizes byte counts to binary units", () => {
    expect(humanBytes(536870912)).toBe("512Mi");
    expect(humanBytes(1073741824)).toBe("1Gi");
    expect(humanBytes(1610612736)).toBe("1.5Gi");
    expect(humanBytes(2048)).toBe("2Ki");
    expect(humanBytes(500)).toBe("500B");
    expect(humanBytes(0)).toBe("0B");
  });

  it("converts millicores to cores", () => {
    expect(cpuCores(1000)).toBe("1");
    expect(cpuCores(500)).toBe("0.5");
    expect(cpuCores(2250)).toBe("2.25");
  });

  it("humanizes millisecond durations", () => {
    expect(humanDuration(86_400_000)).toBe("24h");
    expect(humanDuration(3_600_000)).toBe("1h");
    expect(humanDuration(90_000)).toBe("1.5m");
    expect(humanDuration(5000)).toBe("5s");
  });
});
