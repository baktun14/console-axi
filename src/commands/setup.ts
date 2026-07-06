import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Command } from "commander";

import { action } from "../context.js";
import { AxiError } from "../errors.js";
import { printResult } from "../output/render.js";
import { SKILL_MD } from "../skill/skill-content.js";

const DEFAULT_HOOK_COMMAND = "console-axi home --trimmed";
/** Identifies our hook so setup is idempotent and uninstall can find it. */
const HOOK_MARKER = "console-axi home";
const SKILL_NAME = "console-axi";

type WriteStatus = "installed" | "repaired" | "updated" | "unchanged";
type RemoveStatus = "removed" | "absent";

interface ClaudeHookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: { SessionStart?: ClaudeHookEntry[]; [key: string]: unknown };
  [key: string]: unknown;
}

/** Root of the Claude Code config (honours CLAUDE_CONFIG_DIR). */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
}

function claudeSettingsPath(): string {
  return join(claudeDir(), "settings.json");
}

function skillPath(): string {
  return join(claudeDir(), "skills", SKILL_NAME, "SKILL.md");
}

function persist(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Install or repair the Claude Code SessionStart hook. */
export function installClaudeHook(command: string): { path: string; status: WriteStatus } {
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

/** Write the packaged skill into ~/.claude/skills/console-axi/, keeping it in sync. */
export function installClaudeSkill(): { path: string; status: WriteStatus } {
  const path = skillPath();
  if (existsSync(path) && readFileSync(path, "utf8") === SKILL_MD) {
    return { path, status: "unchanged" };
  }
  const existed = existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SKILL_MD);
  return { path, status: existed ? "updated" : "installed" };
}

/** Remove the console-axi SessionStart hook (idempotent; leaves other hooks intact). */
export function removeClaudeHook(): { path: string; status: RemoveStatus } {
  const path = claudeSettingsPath();
  if (!existsSync(path)) return { path, status: "absent" };
  const settings = JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
  const sessionStart = settings.hooks?.SessionStart;
  if (!sessionStart || sessionStart.length === 0) return { path, status: "absent" };

  let changed = false;
  for (let i = sessionStart.length - 1; i >= 0; i--) {
    const entry = sessionStart[i];
    if (!entry?.hooks) continue;
    const kept = entry.hooks.filter(
      (h) => !(typeof h.command === "string" && h.command.includes(HOOK_MARKER))
    );
    if (kept.length !== entry.hooks.length) {
      changed = true;
      entry.hooks = kept;
      if (kept.length === 0) sessionStart.splice(i, 1);
    }
  }
  if (!changed) return { path, status: "absent" };
  persist(path, settings);
  return { path, status: "removed" };
}

/** Remove the installed skill dir (only ~/.claude/skills/console-axi/). */
export function removeClaudeSkill(): { path: string; status: RemoveStatus } {
  const dir = join(claudeDir(), "skills", SKILL_NAME);
  if (!existsSync(dir)) return { path: dir, status: "absent" };
  rmSync(dir, { recursive: true, force: true });
  return { path: dir, status: "removed" };
}

export function registerSetup(program: Command): void {
  program
    .command("setup")
    .description("Install the session hook + Claude skill so agents can drive console-axi")
    .option("--agent <agent>", "claude | codex | opencode", "claude")
    .option("--command <cmd>", "the hook command to run", DEFAULT_HOOK_COMMAND)
    .option("--no-hook", "skip installing the session-start hook")
    .option("--no-skill", "skip installing the Claude skill")
    .action(
      action((opts: { agent: string; command: string; hook: boolean; skill: boolean }) => {
        const agent = opts.agent.toLowerCase();
        if (agent === "claude") {
          const result: Record<string, unknown> = { ok: true, agent: "claude" };
          if (opts.hook) {
            const hook = installClaudeHook(opts.command);
            result.hook = hook.status;
            result.settings = hook.path;
          }
          if (opts.skill) {
            const skill = installClaudeSkill();
            result.skill = skill.status;
            result.skillPath = skill.path;
          }
          printResult(result, { help: ["console-axi", "console-axi uninstall"] });
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
