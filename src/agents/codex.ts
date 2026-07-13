import { homedir } from "node:os";
import { join } from "node:path";

import { buildBlockBody } from "./block-content.js";
import { removeManagedBlock, type RemoveStatus, upsertManagedBlock, type WriteStatus } from "./managed-block.js";
import { installSkillFile, removeSkillDir } from "./skill-file.js";

/**
 * Codex CLI layout (verified against a live install + docs, 2026-07):
 * config root $CODEX_HOME (default ~/.codex), skills at skills/<name>/SKILL.md,
 * global instructions at AGENTS.md. No exec-hook mechanism exists, so the
 * managed AGENTS.md block is the session-start equivalent.
 */
export function codexDir(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

export interface AgentInstallOptions {
  /** Write the AGENTS.md instructions block (the hook equivalent). */
  instructions?: boolean;
  /** Write the packaged skill file. */
  skill?: boolean;
}

export interface AgentInstallResult {
  instructions?: WriteStatus;
  instructionsPath?: string;
  skill?: WriteStatus;
  skillPath?: string;
}

export interface AgentRemoveResult {
  instructions?: RemoveStatus;
  skill?: RemoveStatus;
}

export function installCodex(command: string, opts: AgentInstallOptions = {}): AgentInstallResult {
  const result: AgentInstallResult = {};
  if (opts.instructions ?? true) {
    result.instructionsPath = join(codexDir(), "AGENTS.md");
    result.instructions = upsertManagedBlock(result.instructionsPath, buildBlockBody(command));
  }
  if (opts.skill ?? true) {
    result.skillPath = join(codexDir(), "skills", "console-axi", "SKILL.md");
    result.skill = installSkillFile(result.skillPath);
  }
  return result;
}

export function removeCodex(opts: AgentInstallOptions = {}): AgentRemoveResult {
  const result: AgentRemoveResult = {};
  if (opts.instructions ?? true) result.instructions = removeManagedBlock(join(codexDir(), "AGENTS.md"));
  if (opts.skill ?? true) result.skill = removeSkillDir(join(codexDir(), "skills", "console-axi"));
  return result;
}
