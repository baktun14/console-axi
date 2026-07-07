import { describe, expect, it } from "vitest";

import { deriveResources } from "./resources.js";
import { parseSdlYaml } from "./validate.js";

function parse(yaml: string) {
  const { parsed, error } = parseSdlYaml(yaml);
  if (!parsed) throw new Error(`fixture did not parse: ${error?.message}`);
  return parsed;
}

const WEB_COUNT_2 = `version: "2.0"
services:
  web:
    image: nginx:1.27
    expose:
      - port: 80
        to:
          - global: true
profiles:
  compute:
    web:
      resources:
        cpu: { units: 0.5 }
        memory: { size: 512Mi }
        storage: { size: 1Gi }
  placement:
    dcloud:
      pricing:
        web: { denom: uact, amount: 10000 }
deployment:
  web:
    dcloud: { profile: web, count: 2 }`;

describe("deriveResources", () => {
  it("builds one screening resource per service with decoded string vals, count and price", () => {
    const screening = deriveResources(parse(WEB_COUNT_2));
    expect(screening).toHaveLength(1);
    const entry = screening[0]!;
    expect(entry.count).toBe(2);
    expect(entry.price).toEqual({ denom: "uact", amount: "10000" });
    expect(entry.resource.cpu.units.val).toBe("500");
    expect(entry.resource.memory.quantity.val).toBe(String(512 * 1024 * 1024));
    expect(entry.resource.storage[0]!.quantity.val).toBe(String(1024 * 1024 * 1024));
  });

  it("encodes gpu units and nvidia model attributes for screening", () => {
    const gpu = parse(WEB_COUNT_2.replace(
      "storage: { size: 1Gi }",
      "storage: { size: 1Gi }\n        gpu:\n          units: 1\n          attributes:\n            vendor:\n              nvidia:\n                - model: a100"
    ));
    const screening = deriveResources(gpu);
    expect(screening[0]!.resource.gpu.units.val).toBe("1");
    expect(screening[0]!.resource.gpu.attributes).toContainEqual({ key: "vendor/nvidia/model/a100", value: "true" });
  });
});
