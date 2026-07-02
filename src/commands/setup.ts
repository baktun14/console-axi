import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Command } from "commander";

import { action } from "../context.js";
import { AxiError } from "../errors.js";
import { printResult } from "../output/render.js";

const DEFAULT_HOOK_COMMAND = "console-axi home --trimmed";
/** Identifies our hook so setup is idempotent and repairable. */
const HOOK_MARKER = "console-axi home";

interface ClaudeHookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: { SessionStart?: ClaudeHookEntry[]; [key: string]: unknown };
  [key: string]: unknown;
}

function claudeSettingsPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  return join(dir, "settings.json");
}

/** Install or repair the Claude Code SessionStart hook. Returns the action taken. */
function installClaudeHook(command: string): { path: string; status: "installed" | "repaired" | "unchanged" } {
  const path = claudeSettingsPath();
  const settings: ClaudeSettings = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings)
    : {};

  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  const sessionStart = settings.hooks.SessionStart;

  // Find any existing console-axi hook (repair path drift / command changes).
  let found: { type: string; command: string } | undefined;
  for (const entry of sessionStart) {
    found = entry.hooks?.find((h) => typeof h.command === "string" && h.command.includes(HOOK_MARKER));
    if (found) break;
  }

  if (found) {
    if (found.command === command) return { path, status: "unchanged" };
    found.command = command;
    persist(path, settings);
    return { path, status: "repaired" };
  }

  sessionStart.push({ hooks: [{ type: "command", command }] });
  persist(path, settings);
  return { path, status: "installed" };
}

function persist(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("Install a session hook that injects a compact status view at agent start")
    .option("--agent <agent>", "claude | codex | opencode", "claude")
    .option("--command <cmd>", "the hook command to run", DEFAULT_HOOK_COMMAND)
    .action(
      action((opts: { agent: string; command: string }) => {
        const agent = opts.agent.toLowerCase();
        if (agent === "claude") {
          const result = installClaudeHook(opts.command);
          printResult(
            { ok: true, agent: "claude", status: result.status, settings: result.path, hook: opts.command },
            { help: ["console-axi home --trimmed"] }
          );
          return;
        }
        if (agent === "codex" || agent === "opencode") {
          // These harnesses lack a stable file schema we can safely edit here;
          // emit the exact command to wire up manually rather than risk
          // corrupting the user's config.
          printResult({
            agent,
            status: "manual",
            message: `Add this command as a session-start hook in your ${agent} config:`,
            command: opts.command
          });
          return;
        }
        throw new AxiError({
          code: "usage",
          message: `Unknown --agent "${opts.agent}". Use claude, codex, or opencode.`
        });
      })
    );
}
