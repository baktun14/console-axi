import { existsSync } from "node:fs";

import type { Command } from "commander";

import {
  configPath,
  readStoredConfig,
  resolveConfig,
  type StoredConfig,
  writeStoredConfig
} from "../config/config.js";
import { action, overridesFrom } from "../context.js";
import { AxiError } from "../errors.js";
import { printResult } from "../output/render.js";

interface KeySpec {
  env: string;
  hasDefault: boolean;
}

const KEYS: Record<keyof StoredConfig, KeySpec> = {
  apiKey: { env: "CONSOLE_API_KEY", hasDefault: false },
  baseUrl: { env: "CONSOLE_API_URL", hasDefault: true },
  providerProxyUrl: { env: "CONSOLE_PROVIDER_PROXY_URL", hasDefault: true },
  network: { env: "CONSOLE_NETWORK", hasDefault: true },
  consoleWebUrl: { env: "CONSOLE_WEB_URL", hasDefault: true }
};

type ConfigKey = keyof StoredConfig;

function assertKey(key: string): ConfigKey {
  if (key in KEYS) return key as ConfigKey;
  throw new AxiError({
    code: "usage",
    message: `Unknown config key "${key}".`,
    details: { allowed: Object.keys(KEYS).join(",") }
  });
}

function mask(value: string): string {
  return value.length <= 8 ? "****" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function display(key: ConfigKey, value: string | undefined): string | null {
  if (value === undefined) return null;
  return key === "apiKey" ? mask(value) : value;
}

/** Provenance of the effective value, mirroring resolveConfig precedence. */
function sourceOf(key: ConfigKey, stored: StoredConfig, urlOverride?: string): string {
  if (key === "baseUrl" && urlOverride) return "flag";
  if (process.env[KEYS[key].env]) return "env";
  if (stored[key] !== undefined) return "file";
  return KEYS[key].hasDefault ? "default" : "unset";
}

export function registerConfig(program: Command): void {
  const config = program.command("config").description("inspect or edit the stored CLI configuration");

  config
    .command("get [key]")
    .description("show effective config values and where each comes from")
    .action(
      action(async (key: string | undefined, _opts: unknown, command: Command) => {
        const overrides = overridesFrom(command);
        const stored = readStoredConfig();
        const resolved = resolveConfig(overrides);
        const row = (k: ConfigKey): Record<string, unknown> => ({
          key: k,
          value: display(k, resolved[k]),
          source: sourceOf(k, stored, overrides.url)
        });
        if (key) {
          printResult(row(assertKey(key)));
          return;
        }
        printResult({ config: (Object.keys(KEYS) as ConfigKey[]).map(row) });
      })
    );

  config
    .command("set <key> <value>")
    .description("persist a config value to the config file")
    .action(
      action(async (key: string, value: string) => {
        const k = assertKey(key);
        const stored = readStoredConfig();
        stored[k] = value;
        writeStoredConfig(stored);
        const help = ["console-axi config get"];
        if (k === "apiKey") help.push("console-axi login --with-key <key>  # validates the key against the API");
        printResult({ ok: true, key: k, value: display(k, value) }, { help });
      })
    );

  config
    .command("unset <key>")
    .description("remove a value from the config file (no-op if absent)")
    .action(
      action(async (key: string) => {
        const k = assertKey(key);
        if (existsSync(configPath())) {
          const stored = readStoredConfig();
          if (stored[k] !== undefined) {
            delete stored[k];
            writeStoredConfig(stored);
          }
        }
        printResult({ ok: true, key: k });
      })
    );

  config
    .command("path")
    .description("print the config file location")
    .action(
      action(async () => {
        printResult({ path: configPath(), exists: existsSync(configPath()) });
      })
    );
}
