/**
 * Write skills/console-axi/SKILL.md from the embedded skill string.
 * The content lives in src/skill/skill-content.ts (the single source of truth,
 * also bundled into the CLI so `console-axi setup` can install it); this script
 * materializes the repo copy shipped in the npm tarball and seeding the upstream
 * akash-network/akash-skill contribution.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SKILL_MD } from "../src/skill/skill-content.js";

const out = resolve(import.meta.dirname, "../skills/console-axi/SKILL.md");

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, SKILL_MD);
process.stderr.write(`Wrote ${out}\n`);
