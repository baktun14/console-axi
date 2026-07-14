import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AxiError } from "../errors.js";
import {
  clearConsoleConfig,
  configPath,
  DEFAULT_AKASHML_BASE_URL,
  DEFAULT_BASE_URL,
  DEFAULT_CONSOLE_WEB_URL,
  readStoredConfig,
  requireAkashmlAuth,
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

  it("defaults akashmlBaseUrl and leaves akashmlApiKey undefined when nothing is set", () => {
    setup();

    const config = resolveConfig();

    expect(config.akashmlApiKey).toBeUndefined();
    expect(config.akashmlBaseUrl).toBe(DEFAULT_AKASHML_BASE_URL);
  });

  it("reads akashml fields from the stored config file", () => {
    setup({ stored: { akashmlApiKey: "akml-stored", akashmlBaseUrl: "https://stored-akashml.example" } });

    const config = resolveConfig();

    expect(config.akashmlApiKey).toBe("akml-stored");
    expect(config.akashmlBaseUrl).toBe("https://stored-akashml.example");
  });

  it("prefers AKASHML_API_KEY/AKASHML_API_URL env over the stored akashml fields", () => {
    setup({
      stored: { akashmlApiKey: "akml-stored", akashmlBaseUrl: "https://stored-akashml.example" },
      env: { AKASHML_API_KEY: "akml-env", AKASHML_API_URL: "https://env-akashml.example/" }
    });

    const config = resolveConfig();

    expect(config.akashmlApiKey).toBe("akml-env");
    expect(config.akashmlBaseUrl).toBe("https://env-akashml.example");
  });

  it("throws a friendly auth error when requireAkashmlAuth finds no key", () => {
    setup();

    expect(() => requireAkashmlAuth()).toThrow(AxiError);
    try {
      requireAkashmlAuth();
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AxiError);
      const axiError = error as AxiError;
      expect(axiError.code).toBe("unauthorized");
      expect(axiError.help).toEqual(["console-axi akashml login --with-key <akml-...>"]);
    }
  });

  it("returns the key from requireAkashmlAuth when configured", () => {
    setup({ env: { AKASHML_API_KEY: "akml-k" } });

    expect(requireAkashmlAuth().akashmlApiKey).toBe("akml-k");
  });

  describe("clearConsoleConfig", () => {
    it("removes only Console fields, leaving akashml fields intact", () => {
      setup({
        stored: {
          apiKey: "sk-console",
          baseUrl: "https://custom-console.example",
          providerProxyUrl: "https://custom-proxy.example",
          network: "sandbox",
          consoleWebUrl: "https://custom-web.example",
          akashmlApiKey: "akml-keep-me",
          akashmlBaseUrl: "https://keep-me-akashml.example"
        }
      });

      clearConsoleConfig();

      const stored = readStoredConfig();
      expect(stored).toEqual({
        akashmlApiKey: "akml-keep-me",
        akashmlBaseUrl: "https://keep-me-akashml.example"
      });
    });

    it("is a no-op when no config file exists", () => {
      setup();

      expect(() => clearConsoleConfig()).not.toThrow();
      expect(existsSync(configPath())).toBe(false);
    });
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
    vi.stubEnv("AKASHML_API_KEY", input.env?.AKASHML_API_KEY);
    vi.stubEnv("AKASHML_API_URL", input.env?.AKASHML_API_URL);

    if (input.stored) {
      const path = configPath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(input.stored));
    }
    return { dir };
  }
});
