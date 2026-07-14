import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { AxiError } from "../errors.js";

export const DEFAULT_BASE_URL = "https://console-api.akash.network";
// WS relay lives behind the Console ingress at /provider-proxy-<network>, not on
// the console-provider-proxy host (that only serves the server-side HTTP proxy).
export const DEFAULT_PROVIDER_PROXY_URL = "https://console.akash.network/provider-proxy-%{NETWORK}";
export const DEFAULT_NETWORK = "mainnet";
// Base of the Console web app, used to build deployment deep-links for humans.
export const DEFAULT_CONSOLE_WEB_URL = "https://console.akash.network";
// AkashML is a separate managed-inference service (api.akashml.com), not the Console API.
export const DEFAULT_AKASHML_BASE_URL = "https://api.akashml.com";

export interface StoredConfig {
  apiKey?: string;
  baseUrl?: string;
  providerProxyUrl?: string;
  network?: string;
  consoleWebUrl?: string;
  akashmlApiKey?: string;
  akashmlBaseUrl?: string;
}

/** Fully-resolved settings for a single invocation. */
export interface ResolvedConfig {
  apiKey?: string;
  baseUrl: string;
  providerProxyUrl: string;
  network: string;
  consoleWebUrl: string;
  akashmlApiKey?: string;
  akashmlBaseUrl: string;
}

/** Console-specific fields, as opposed to the akashml* fields. Used to scope `logout`. */
const CONSOLE_KEYS: readonly (keyof StoredConfig)[] = [
  "apiKey",
  "baseUrl",
  "providerProxyUrl",
  "network",
  "consoleWebUrl"
];

export interface Overrides {
  /** `--url` flag, overrides the API base URL for this invocation only. */
  url?: string;
}

export function configDir(): string {
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

/** Wipe the entire config file, Console and akashml* fields alike. Reserved for `uninstall --purge`. */
export function clearStoredConfig(): void {
  const path = configPath();
  if (existsSync(path)) rmSync(path);
}

/**
 * Unset only the Console-specific fields, leaving akashml* fields untouched.
 * Used by the global `logout` command, which is scoped to Console credentials
 * (AkashML has its own `akashml logout`).
 */
export function clearConsoleConfig(): void {
  const path = configPath();
  if (!existsSync(path)) return;
  const stored = readStoredConfig();
  for (const key of CONSOLE_KEYS) delete stored[key];
  writeStoredConfig(stored);
}

/**
 * Resolve effective settings. Precedence: env > stored config > prod defaults.
 * `--url` overrides the base URL last.
 */
export function resolveConfig(overrides: Overrides = {}): ResolvedConfig {
  const stored = readStoredConfig();
  const apiKey = process.env.CONSOLE_API_KEY ?? stored.apiKey;
  const baseUrl = overrides.url ?? process.env.CONSOLE_API_URL ?? stored.baseUrl ?? DEFAULT_BASE_URL;
  const network = process.env.CONSOLE_NETWORK ?? stored.network ?? DEFAULT_NETWORK;
  const providerProxyUrl = (
    process.env.CONSOLE_PROVIDER_PROXY_URL ?? stored.providerProxyUrl ?? DEFAULT_PROVIDER_PROXY_URL
  ).replace("%{NETWORK}", network);
  const consoleWebUrl = process.env.CONSOLE_WEB_URL ?? stored.consoleWebUrl ?? DEFAULT_CONSOLE_WEB_URL;
  const akashmlApiKey = process.env.AKASHML_API_KEY ?? stored.akashmlApiKey;
  const akashmlBaseUrl = process.env.AKASHML_API_URL ?? stored.akashmlBaseUrl ?? DEFAULT_AKASHML_BASE_URL;
  return {
    apiKey,
    baseUrl: stripTrailingSlash(baseUrl),
    providerProxyUrl: stripTrailingSlash(providerProxyUrl),
    network,
    consoleWebUrl: stripTrailingSlash(consoleWebUrl),
    akashmlApiKey,
    akashmlBaseUrl: stripTrailingSlash(akashmlBaseUrl)
  };
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

/** Resolve config and assert an AkashML API key is present, else a friendly auth error. */
export function requireAkashmlAuth(overrides: Overrides = {}): ResolvedConfig & { akashmlApiKey: string } {
  const config = resolveConfig(overrides);
  if (!config.akashmlApiKey) {
    throw new AxiError({
      code: "unauthorized",
      message: "No AkashML API key configured. Log in with a key or set AKASHML_API_KEY.",
      help: ["console-axi akashml login --with-key <akml-...>"]
    });
  }
  return { ...config, akashmlApiKey: config.akashmlApiKey };
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
