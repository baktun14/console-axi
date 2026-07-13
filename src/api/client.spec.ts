import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedConfig } from "../config/config.js";
import { resetDebug, setDebug } from "../debug.js";
import { AxiError } from "../errors.js";
import { createApiClient } from "./client.js";

const CONFIG: ResolvedConfig = {
  apiKey: "sk-test-secret-key",
  baseUrl: "https://api.test",
  providerProxyUrl: "https://proxy.test",
  network: "mainnet",
  consoleWebUrl: "https://console.test"
};

describe("createApiClient debug instrumentation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetDebug();
  });

  it("logs one redacted http line to stderr when debug is enabled", async () => {
    const stderr = captureStderr();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: { username: "max" } }))
    );
    setDebug(true);

    await createApiClient(CONFIG).GET("/v1/user/me");

    const debugLines = stderr().filter((line) => line.startsWith("[debug] http"));
    expect(debugLines).toHaveLength(1);
    expect(debugLines[0]).toMatch(/GET https:\/\/api\.test\/v1\/user\/me -> 200 \(\d+ms\)/);
    expect(debugLines[0]).not.toContain("sk-test-secret-key");
  });

  it("writes nothing to stderr when debug is disabled", async () => {
    const stderr = captureStderr();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: {} }))
    );

    await createApiClient(CONFIG).GET("/v1/user/me");

    expect(stderr()).toHaveLength(0);
  });

  it("still throws the network AxiError on transport failure and logs it", async () => {
    const stderr = captureStderr();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    setDebug(true);

    await expect(createApiClient(CONFIG).GET("/v1/user/me")).rejects.toSatisfy(
      (error: unknown) => error instanceof AxiError && error.code === "network"
    );
    expect(stderr().some((line) => line.includes("network error"))).toBe(true);
  });

  function captureStderr() {
    const lines: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(chunk.toString());
      return true;
    });
    return () => lines;
  }

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
});
