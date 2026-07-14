import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { RemoveStatus, WriteStatus } from "./managed-block.js";
import { opencodeDir } from "./opencode.js";

/**
 * opencode reads its model backend from opencode.json. The key is delivered
 * by env reference only (`{env:AKASHML_API_KEY}`), never written literally.
 */
interface AkashmlProvider {
  npm: string;
  name: string;
  options: { baseURL: string; apiKey: string };
  models: Record<string, Record<string, never>>;
}

interface OpencodeConfig {
  model?: string;
  provider?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface InstallOpencodeAkashmlOptions {
  baseUrl: string;
  model: string;
}

function configPath(): string {
  return join(opencodeDir(), "opencode.json");
}

function readConfig(path: string): OpencodeConfig {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as OpencodeConfig;
}

function persist(path: string, config: OpencodeConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

function providerFor(baseUrl: string, model: string): AkashmlProvider {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "AkashML",
    options: { baseURL: `${baseUrl}/v1`, apiKey: "{env:AKASHML_API_KEY}" },
    models: { [model]: {} }
  };
}

export function installOpencodeAkashml(opts: InstallOpencodeAkashmlOptions): { path: string; status: WriteStatus } {
  const path = configPath();
  const config = readConfig(path);
  config.provider ??= {};
  const providers = config.provider;

  const nextProvider = providerFor(opts.baseUrl, opts.model);
  const nextModel = `akashml/${opts.model}`;
  const existingProvider = providers.akashml;
  const wasAbsent = existingProvider === undefined;
  const providerUnchanged = !wasAbsent && JSON.stringify(existingProvider) === JSON.stringify(nextProvider);
  const topUnchanged = config.model === nextModel;

  if (providerUnchanged && topUnchanged) return { path, status: "unchanged" };

  providers.akashml = nextProvider;
  config.model = nextModel;
  persist(path, config);
  return { path, status: wasAbsent ? "installed" : "updated" };
}

/** Delete provider.akashml; only reset top-level model if it currently points at akashml/. */
export function removeOpencodeAkashml(): { path: string; status: RemoveStatus } {
  const path = configPath();
  if (!existsSync(path)) return { path, status: "absent" };

  const config = readConfig(path);
  const providers = config.provider;
  const hasProvider = providers !== undefined && Object.prototype.hasOwnProperty.call(providers, "akashml");
  const isActiveModel = typeof config.model === "string" && config.model.startsWith("akashml/");

  if (!hasProvider && !isActiveModel) return { path, status: "absent" };

  if (providers) {
    delete providers.akashml;
    if (Object.keys(providers).length === 0) delete config.provider;
  }
  if (isActiveModel) delete config.model;

  persist(path, config);
  return { path, status: "removed" };
}
