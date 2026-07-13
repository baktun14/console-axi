import { describe, expect, it } from "vitest";

import { aggregateSpec, hasGpu } from "./estimate.js";
import type { ScreeningResource } from "./resources.js";

function resource(opts: { cpu: string; memory: string; storage?: string[]; gpu?: string; count?: number }): ScreeningResource {
  return {
    resource: {
      id: 1,
      cpu: { units: { val: opts.cpu }, attributes: [] },
      memory: { quantity: { val: opts.memory }, attributes: [] },
      gpu: { units: { val: opts.gpu ?? "0" }, attributes: [] },
      storage: (opts.storage ?? ["536870912"]).map((val, i) => ({
        name: i === 0 ? "default" : `vol${i}`,
        quantity: { val },
        attributes: []
      }))
    },
    count: opts.count ?? 1,
    price: { denom: "uact", amount: "0" }
  };
}

describe("estimate aggregation", () => {
  it("multiplies each service by its replica count", () => {
    const spec = aggregateSpec([resource({ cpu: "500", memory: "536870912", count: 2 })]);

    expect(spec).toEqual({ cpu: 1000, memory: 1073741824, storage: 1073741824 });
  });

  it("sums across services and all storage volumes", () => {
    const spec = aggregateSpec([
      resource({ cpu: "1000", memory: "1073741824", storage: ["1073741824", "5368709120"] }),
      resource({ cpu: "250", memory: "268435456" })
    ]);

    expect(spec.cpu).toBe(1250);
    expect(spec.memory).toBe(1073741824 + 268435456);
    expect(spec.storage).toBe(1073741824 + 5368709120 + 536870912);
  });

  it("detects gpu workloads", () => {
    expect(hasGpu([resource({ cpu: "1000", memory: "1", gpu: "1" })])).toBe(true);
    expect(hasGpu([resource({ cpu: "1000", memory: "1" })])).toBe(false);
  });
});
