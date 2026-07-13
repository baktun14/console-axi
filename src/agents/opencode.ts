import { homedir } from "node:os";
import { join } from "node:path";

import { buildBlockBody } from "./block-content.js";
import type { AgentInstallOptions, AgentInstallResult, AgentRemoveResult } from "./codex.js";
import { removeManagedBlock, upsertManagedBlock } from "./managed-block.js";
import { installSkillFile, removeSkillDir } from "./skill-file.js";

/**
 * opencode layout (verified against a live install + docs, 2026-07): config
 * root ~/.config/opencode (XDG-aware), skills at skill/<name>/SKILL.md (the
 * documented singular path; a plural skills/ mirror exists from cross-agent
 * installers but skill/ is canonical), global instructions at AGENTS.md.
 * opencode.json is deliberately never touched.
 */
export function opencodeDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "opencode");
}

export function installOpencode(command: string, opts: AgentInstallOptions = {}): AgentInstallResult {
  const result: AgentInstallResult = {};
  if (opts.instructions ?? true) {
    result.instructionsPath = join(opencodeDir(), "AGENTS.md");
    result.instructions = upsertManagedBlock(result.instructionsPath, buildBlockBody(command));
  }
  if (opts.skill ?? true) {
    result.skillPath = join(opencodeDir(), "skill", "console-axi", "SKILL.md");
    result.skill = installSkillFile(result.skillPath);
  }
  return result;
}

export function removeOpencode(opts: AgentInstallOptions = {}): AgentRemoveResult {
  const result: AgentRemoveResult = {};
  if (opts.instructions ?? true) result.instructions = removeManagedBlock(join(opencodeDir(), "AGENTS.md"));
  if (opts.skill ?? true) result.skill = removeSkillDir(join(opencodeDir(), "skill", "console-axi"));
  return result;
}
