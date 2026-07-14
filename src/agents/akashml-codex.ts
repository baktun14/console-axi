import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parse, stringify } from "smol-toml";

import { codexDir } from "./codex.js";
import type { RemoveStatus, WriteStatus } from "./managed-block.js";

/**
 * Codex reads its model backend from $CODEX_HOME/config.toml. The key is
 * delivered by reference only (`env_key`), never written literally into the
 * file. Re-stringifying via smol-toml loses comments on rewrite — accepted
 * tradeoff for a config the user rarely hand-edits.
 */
interface AkashmlProvider {
  name: string;
  base_url: string;
  env_key: string;
  wire_api: string;
}

interface CodexConfig {
  model?: string;
  model_provider?: string;
  model_providers?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InstallCodexAkashmlOptions {
  baseUrl: string;
  model: string;
}

function configPath(): string {
  return join(codexDir(), "config.toml");
}

function readConfig(path: string): CodexConfig {
  if (!existsSync(path)) return {};
  return parse(readFileSync(path, "utf8")) as CodexConfig;
}

function persist(path: string, config: CodexConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(config as never));
}

function providerFor(baseUrl: string): AkashmlProvider {
  return { name: "AkashML", base_url: `${baseUrl}/v1`, env_key: "AKASHML_API_KEY", wire_api: "chat" };
}

export function installCodexAkashml(opts: InstallCodexAkashmlOptions): { path: string; status: WriteStatus } {
  const path = configPath();
  const config = readConfig(path);
  config.model_providers ??= {};
  const providers = config.model_providers;

  const nextProvider = providerFor(opts.baseUrl);
  const existingProvider = providers.akashml;
  const wasAbsent = existingProvider === undefined;
  const providerUnchanged = !wasAbsent && JSON.stringify(existingProvider) === JSON.stringify(nextProvider);
  const topUnchanged = config.model === opts.model && config.model_provider === "akashml";

  if (providerUnchanged && topUnchanged) return { path, status: "unchanged" };

  providers.akashml = nextProvider;
  config.model = opts.model;
  config.model_provider = "akashml";
  persist(path, config);
  return { path, status: wasAbsent ? "installed" : "updated" };
}

/** Delete the akashml provider table; only clear model/model_provider if akashml is the active backend. */
export function removeCodexAkashml(): { path: string; status: RemoveStatus } {
  const path = configPath();
  if (!existsSync(path)) return { path, status: "absent" };

  const config = readConfig(path);
  const providers = config.model_providers;
  const hasProvider = providers !== undefined && Object.prototype.hasOwnProperty.call(providers, "akashml");
  const isActiveProvider = config.model_provider === "akashml";

  if (!hasProvider && !isActiveProvider) return { path, status: "absent" };

  if (providers) {
    delete providers.akashml;
    if (Object.keys(providers).length === 0) delete config.model_providers;
  }
  if (isActiveProvider) {
    delete config.model;
    delete config.model_provider;
  }

  persist(path, config);
  return { path, status: "removed" };
}
