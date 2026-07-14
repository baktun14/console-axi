import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { claudeDir } from "../commands/setup.js";
import type { RemoveStatus, WriteStatus } from "./managed-block.js";

/**
 * Claude Code reads its own model backend from env vars in settings.json, so
 * "installing" AkashML for claude means merging a fixed env block rather than
 * writing an AGENTS.md-style managed block. `--project` writes the untracked
 * settings.local.json instead (never settings.json, which is typically
 * committed to source control and would leak the key).
 */
const MANAGED_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "API_TIMEOUT_MS",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL"
] as const;

interface ClaudeEnvSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface InstallClaudeAkashmlOptions {
  baseUrl: string;
  apiKey: string;
  sonnet: string;
  opus: string;
  haiku: string;
  /** Write ./.claude/settings.local.json instead of the global settings.json. */
  project?: boolean;
}

export interface RemoveClaudeAkashmlOptions {
  project?: boolean;
}

function settingsPath(project?: boolean): string {
  return project ? join(process.cwd(), ".claude", "settings.local.json") : join(claudeDir(), "settings.json");
}

function readSettings(path: string): ClaudeEnvSettings {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as ClaudeEnvSettings;
}

function persist(path: string, settings: ClaudeEnvSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Merge the six AkashML env keys into the target settings file. */
export function installClaudeAkashmlEnv(opts: InstallClaudeAkashmlOptions): { path: string; status: WriteStatus } {
  const path = settingsPath(opts.project);
  const settings = readSettings(path);
  settings.env ??= {};
  const env = settings.env;

  const next: Record<(typeof MANAGED_KEYS)[number], string> = {
    ANTHROPIC_BASE_URL: `${opts.baseUrl}/anthropic`,
    ANTHROPIC_AUTH_TOKEN: opts.apiKey,
    API_TIMEOUT_MS: "3000000",
    ANTHROPIC_DEFAULT_SONNET_MODEL: opts.sonnet,
    ANTHROPIC_DEFAULT_OPUS_MODEL: opts.opus,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: opts.haiku
  };

  const wasAbsent = MANAGED_KEYS.every((key) => env[key] === undefined);
  const allEqual = MANAGED_KEYS.every((key) => env[key] === next[key]);
  if (!wasAbsent && allEqual) return { path, status: "unchanged" };

  for (const key of MANAGED_KEYS) env[key] = next[key];
  persist(path, settings);
  return { path, status: wasAbsent ? "installed" : "updated" };
}

/** Remove the six managed keys, but only when this scope is actually configured for AkashML. */
export function removeClaudeAkashmlEnv(opts: RemoveClaudeAkashmlOptions = {}): { path: string; status: RemoveStatus } {
  const path = settingsPath(opts.project);
  if (!existsSync(path)) return { path, status: "absent" };

  const settings = readSettings(path);
  const env = settings.env;
  // Guard: never touch another provider's ANTHROPIC_BASE_URL.
  if (!env || typeof env.ANTHROPIC_BASE_URL !== "string" || !env.ANTHROPIC_BASE_URL.includes("akashml")) {
    return { path, status: "absent" };
  }

  for (const key of MANAGED_KEYS) delete env[key];
  if (Object.keys(env).length === 0) delete settings.env;

  persist(path, settings);
  return { path, status: "removed" };
}
