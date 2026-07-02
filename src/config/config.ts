import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { AxiError } from "../errors.js";

export const DEFAULT_BASE_URL = "https://console-api.akash.network";
export const DEFAULT_PROVIDER_PROXY_URL = "https://console-provider-proxy.akash.network";

export interface StoredConfig {
  apiKey?: string;
  baseUrl?: string;
  providerProxyUrl?: string;
}

/** Fully-resolved settings for a single invocation. */
export interface ResolvedConfig {
  apiKey?: string;
  baseUrl: string;
  providerProxyUrl: string;
}

export interface Overrides {
  /** `--url` flag, overrides the API base URL for this invocation only. */
  url?: string;
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "console-axi");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function readStoredConfig(): StoredConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as StoredConfig;
  } catch {
    throw new AxiError({ code: "config", message: `Config file at ${path} is not valid JSON.` });
  }
}

export function writeStoredConfig(config: StoredConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  // The file holds the API key; keep it readable only by the owner.
  chmodSync(path, 0o600);
}

export function clearStoredConfig(): void {
  const path = configPath();
  if (existsSync(path)) rmSync(path);
}

/**
 * Resolve effective settings. Precedence: env > stored config > prod defaults.
 * `--url` overrides the base URL last.
 */
export function resolveConfig(overrides: Overrides = {}): ResolvedConfig {
  const stored = readStoredConfig();
  const apiKey = process.env.CONSOLE_API_KEY ?? stored.apiKey;
  const baseUrl = overrides.url ?? process.env.CONSOLE_API_URL ?? stored.baseUrl ?? DEFAULT_BASE_URL;
  const providerProxyUrl =
    process.env.CONSOLE_PROVIDER_PROXY_URL ?? stored.providerProxyUrl ?? DEFAULT_PROVIDER_PROXY_URL;
  return { apiKey, baseUrl: stripTrailingSlash(baseUrl), providerProxyUrl: stripTrailingSlash(providerProxyUrl) };
}

/** Resolve config and assert an API key is present, else a friendly auth error. */
export function requireAuth(overrides: Overrides = {}): ResolvedConfig & { apiKey: string } {
  const config = resolveConfig(overrides);
  if (!config.apiKey) {
    throw new AxiError({
      code: "unauthorized",
      message: "No API key configured. Log in with a key or set CONSOLE_API_KEY.",
      help: ["console-axi login --with-key <key>"]
    });
  }
  return { ...config, apiKey: config.apiKey };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
