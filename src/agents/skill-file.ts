import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { SKILL_MD } from "../skill/skill-content.js";
import type { RemoveStatus, WriteStatus } from "./managed-block.js";

/** Write the packaged skill to a harness skill path, keeping it in sync. */
export function installSkillFile(path: string): WriteStatus {
  if (existsSync(path) && readFileSync(path, "utf8") === SKILL_MD) return "unchanged";
  const existed = existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, SKILL_MD);
  return existed ? "updated" : "installed";
}

/** Remove an installed skill directory (only ever console-axi's own). */
export function removeSkillDir(dir: string): RemoveStatus {
  if (!existsSync(dir)) return "absent";
  rmSync(dir, { recursive: true, force: true });
  return "removed";
}
