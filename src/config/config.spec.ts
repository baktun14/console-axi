import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AxiError } from "../errors.js";
import {
  configPath,
  DEFAULT_BASE_URL,
  DEFAULT_CONSOLE_WEB_URL,
  requireAuth,
  resolveConfig,
  type StoredConfig
} from "./config.js";

describe("config resolution", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it("falls back to prod defaults when nothing is set", () => {
    setup();

    const config = resolveConfig();

    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.apiKey).toBeUndefined();
  });

  it("reads the stored config file when no env is set", () => {
    setup({ stored: { apiKey: "stored-key", baseUrl: "https://stored.example" } });

    const config = resolveConfig();

    expect(config.apiKey).toBe("stored-key");
    expect(config.baseUrl).toBe("https://stored.example");
  });

  it("prefers env vars over the stored config", () => {
    setup({
      stored: { apiKey: "stored-key", baseUrl: "https://stored.example" },
      env: { CONSOLE_API_KEY: "env-key", CONSOLE_API_URL: "https://env.example" }
    });

    const config = resolveConfig();

    expect(config.apiKey).toBe("env-key");
    expect(config.baseUrl).toBe("https://env.example");
  });

  it("lets --url override everything and strips a trailing slash", () => {
    setup({ env: { CONSOLE_API_URL: "https://env.example" } });

    const config = resolveConfig({ url: "https://override.example/" });

    expect(config.baseUrl).toBe("https://override.example");
  });

  it("substitutes the network into the default provider-proxy URL", () => {
    setup();

    expect(resolveConfig().providerProxyUrl).toBe("https://console.akash.network/provider-proxy-mainnet");
  });

  it("lets CONSOLE_NETWORK pick the provider-proxy network segment", () => {
    setup({ env: { CONSOLE_NETWORK: "sandbox" } });

    const config = resolveConfig();

    expect(config.network).toBe("sandbox");
    expect(config.providerProxyUrl).toBe("https://console.akash.network/provider-proxy-sandbox");
  });

  it("defaults the Console web URL when nothing is set", () => {
    setup();

    expect(resolveConfig().consoleWebUrl).toBe(DEFAULT_CONSOLE_WEB_URL);
  });

  it("prefers CONSOLE_WEB_URL over the stored value and strips a trailing slash", () => {
    setup({
      stored: { consoleWebUrl: "https://stored.console.example" },
      env: { CONSOLE_WEB_URL: "https://env.console.example/" }
    });

    expect(resolveConfig().consoleWebUrl).toBe("https://env.console.example");
  });

  it("throws a friendly auth error when requireAuth finds no key", () => {
    setup();

    expect(() => requireAuth()).toThrow(AxiError);
  });

  it("returns the key from requireAuth when configured", () => {
    setup({ env: { CONSOLE_API_KEY: "k" } });

    expect(requireAuth().apiKey).toBe("k");
  });

  function setup(input: { stored?: StoredConfig; env?: Record<string, string> } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "axi-config-"));
    tempDirs.push(dir);
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    // Clear inherited auth env unless the test opts in (undefined deletes the var).
    vi.stubEnv("CONSOLE_API_KEY", input.env?.CONSOLE_API_KEY);
    vi.stubEnv("CONSOLE_API_URL", input.env?.CONSOLE_API_URL);
    vi.stubEnv("CONSOLE_PROVIDER_PROXY_URL", input.env?.CONSOLE_PROVIDER_PROXY_URL);
    vi.stubEnv("CONSOLE_NETWORK", input.env?.CONSOLE_NETWORK);
    vi.stubEnv("CONSOLE_WEB_URL", input.env?.CONSOLE_WEB_URL);

    if (input.stored) {
      const path = configPath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(input.stored));
    }
    return { dir };
  }
});
