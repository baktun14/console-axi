import { afterEach, describe, expect, it, vi } from "vitest";

import { debugLog, isDebugEnabled, redactSecrets, resetDebug, setDebug } from "./debug.js";

describe("debug", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetDebug();
  });

  describe("isDebugEnabled", () => {
    it("is off by default", () => {
      expect(isDebugEnabled()).toBe(false);
    });

    it("turns on via setDebug(true)", () => {
      setDebug(true);
      expect(isDebugEnabled()).toBe(true);
    });

    it.each([
      ["CONSOLE_AXI_DEBUG", "1", true],
      ["CONSOLE_AXI_DEBUG", "true", true],
      ["CONSOLE_AXI_DEBUG", "full", true],
      ["CONSOLE_AXI_DEBUG", "0", false],
      ["CONSOLE_AXI_DEBUG", "false", false],
      ["CONSOLE_AXI_DEBUG", "", false],
      ["DEBUG", "console-axi", true],
      ["DEBUG", "foo,console-axi", true],
      ["DEBUG", "*", true],
      ["DEBUG", "other", false]
    ])("%s=%s -> %s", (name, value, expected) => {
      vi.stubEnv(name, value);
      expect(isDebugEnabled()).toBe(expected);
    });

    it("lets the flag override the environment", () => {
      vi.stubEnv("CONSOLE_AXI_DEBUG", "0");
      setDebug(true);
      expect(isDebugEnabled()).toBe(true);
    });
  });

  describe("redactSecrets", () => {
    it("redacts x-api-key header values", () => {
      expect(redactSecrets("x-api-key: sk-abc123")).not.toContain("sk-abc123");
    });

    it("redacts three-part JWTs", () => {
      const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
      const out = redactSecrets(`auth token ${jwt} end`);
      expect(out).not.toContain(jwt);
      expect(out).toContain("[REDACTED:jwt]");
    });

    it("redacts key=value and quoted assignments", () => {
      expect(redactSecrets('apiKey="secret-value"')).not.toContain("secret-value");
      expect(redactSecrets("token=abc.def.ghi")).not.toContain("abc.def.ghi");
      expect(redactSecrets("password: hunter2")).not.toContain("hunter2");
    });

    it("redacts Authorization bearer headers", () => {
      const out = redactSecrets("Authorization: Bearer eyJa.eyJb.sig");
      expect(out).not.toContain("eyJa.eyJb.sig");
    });

    it("leaves ordinary text alone", () => {
      expect(redactSecrets("GET /v1/deployments -> 200 (34ms)")).toBe("GET /v1/deployments -> 200 (34ms)");
    });
  });

  describe("debugLog", () => {
    it("writes a redacted line to stderr when enabled", () => {
      const lines: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
        lines.push(chunk.toString());
        return true;
      });
      setDebug(true);

      debugLog("http", "GET /v1/user/me x-api-key: sk-live-999 -> 200");

      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("[debug] http");
      expect(lines[0]).not.toContain("sk-live-999");
    });

    it("writes nothing when disabled", () => {
      const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      debugLog("http", "GET / -> 200");

      expect(write).not.toHaveBeenCalled();
    });
  });
});
