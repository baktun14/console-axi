import { describe, expect, it } from "vitest";

import { cpuCores, humanBytes } from "./units.js";

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
});
