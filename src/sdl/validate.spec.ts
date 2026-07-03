import { describe, expect, it } from "vitest";

import { AxiError } from "../errors.js";
import { assertSdlValid, validateSdl } from "./validate.js";

const VALID = `version: "2.0"
services:
  web:
    image: nginx:1.27
    expose:
      - port: 80
        as: 80
        to:
          - global: true
profiles:
  compute:
    web:
      resources:
        cpu: { units: 0.5 }
        memory: { size: 512Mi }
        storage: { size: 512Mi }
  placement:
    dcloud:
      pricing:
        web: { denom: uact, amount: 10000 }
deployment:
  web:
    dcloud: { profile: web, count: 1 }`;

/** Return VALID with one substring replaced, to build focused invalid cases. */
function mutate(find: string, replace: string): string {
  return VALID.replace(find, replace);
}

describe("validateSdl", () => {
  it("accepts a well-formed SDL and returns the parsed doc", () => {
    const result = validateSdl(VALID);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.parsed?.version).toBe("2.0");
  });

  it("reports a YAML parse error as a single root issue", () => {
    const result = validateSdl("version: '2.0'\n  bad: : indent");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.path).toBe("(root)");
    expect(result.errors[0]?.message).toMatch(/Invalid YAML/);
  });

  it("rejects empty or non-mapping input", () => {
    expect(validateSdl("").valid).toBe(false);
    expect(validateSdl("- a\n- b").valid).toBe(false);
  });

  it("flags a missing pricing cross-reference (chain-sdk relational rule)", () => {
    const result = validateSdl(mutate("profile: web", "profile: nope"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /pricing/i.test(e.message) || /nope/.test(e.message))).toBe(true);
  });

  it("flags a :latest image via the local lint rule", () => {
    const result = validateSdl(mutate("nginx:1.27", "nginx:latest"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "/services/web/image" && /latest/.test(e.message))).toBe(true);
  });

  it("flags an untagged image", () => {
    const result = validateSdl(mutate("nginx:1.27", "nginx"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "/services/web/image" && /no tag/.test(e.message))).toBe(true);
  });

  it("accepts a registry host:port image without treating the port as a tag", () => {
    const result = validateSdl(mutate("nginx:1.27", "registry.example.com:5000/app:1.0"));
    expect(result.valid).toBe(true);
  });
});

describe("assertSdlValid", () => {
  it("does not throw for a valid SDL", () => {
    expect(() => assertSdlValid(VALID)).not.toThrow();
  });

  it("throws a usage AxiError for an invalid SDL", () => {
    try {
      assertSdlValid(mutate("nginx:1.27", "nginx:latest"));
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      expect((error as AxiError).code).toBe("usage");
      expect((error as AxiError).help).toContain("re-run with --skip-validation to bypass this check");
    }
  });
});
