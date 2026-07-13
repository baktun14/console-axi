import { existsSync, rmSync } from "node:fs";
import { basename } from "node:path";

import type { Command } from "commander";

import { removeCodex } from "../agents/codex.js";
import { removeOpencode } from "../agents/opencode.js";
import { configDir } from "../config/config.js";
import { action } from "../context.js";
import { printResult } from "../output/render.js";
import { removeClaudeHook, removeClaudeSkill } from "./setup.js";

export function registerUninstall(program: Command): void {
  program
    .command("uninstall")
    .description("Remove console-axi: the session hook, the installed skill, and the binary (--no-self keeps it)")
    .option("--no-hook", "keep session hooks / AGENTS.md blocks")
    .option("--no-skill", "keep installed skills")
    .option("--no-self", "keep the console-axi binary in place")
    .option("--purge", "also delete the config dir (API key + cached settings)", false)
    .action(
      action((opts: { hook: boolean; skill: boolean; self: boolean; purge: boolean }) => {
        const result: Record<string, unknown> = { ok: true };

        // Sweep every supported agent; removals are idempotent (absent = no-op),
        // so agents that were never set up just report "absent".
        const codex = removeCodexArtifacts(opts);
        const opencode = removeOpencodeArtifacts(opts);
        if (opts.hook) result.hook = removeClaudeHook().status;
        if (opts.skill) result.skill = removeClaudeSkill().status;
        if (codex) result.codex = codex;
        if (opencode) result.opencode = opencode;

        if (opts.purge) {
          const dir = configDir();
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true });
            result.config = "removed";
          } else {
            result.config = "absent";
          }
        } else {
          result.config = "kept";
        }

        if (opts.self) {
          const bin = process.execPath;
          // Guard: only ever delete a real console-axi binary — never a node/tsx dev runner.
          if (basename(bin).startsWith("console-axi")) {
            try {
              rmSync(bin, { force: true });
              result.binary = `removed: ${bin}`;
            } catch (e) {
              result.binary = `remove failed (${(e as Error).message}); run: rm ${bin}`;
            }
          } else {
            result.binary = `skipped (dev run: ${basename(bin)})`;
          }
        }

        printResult(result);
      })
    );
}

function removeCodexArtifacts(opts: { hook: boolean; skill: boolean }): Record<string, string> | undefined {
  if (!opts.hook && !opts.skill) return undefined;
  return removeCodex({ instructions: opts.hook, skill: opts.skill }) as Record<string, string>;
}

function removeOpencodeArtifacts(opts: { hook: boolean; skill: boolean }): Record<string, string> | undefined {
  if (!opts.hook && !opts.skill) return undefined;
  return removeOpencode({ instructions: opts.hook, skill: opts.skill }) as Record<string, string>;
}
