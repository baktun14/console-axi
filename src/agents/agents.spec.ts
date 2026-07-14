import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SKILL_MD } from "../skill/skill-content.js";
import { codexDir, installCodex, removeCodex } from "./codex.js";
import { installOpencode, opencodeDir, removeOpencode } from "./opencode.js";

const COMMAND = "console-axi home --trimmed";

describe("codex agent setup", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "axi-codex-"));
    vi.stubEnv("CODEX_HOME", join(home, ".codex"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("installs the AGENTS.md block and the skill file", () => {
    const result = installCodex(COMMAND);

    expect(result.instructions).toBe("installed");
    expect(result.skill).toBe("installed");
    const agents = readFileSync(join(codexDir(), "AGENTS.md"), "utf8");
    expect(agents).toContain("console-axi:begin");
    expect(agents).toContain(COMMAND);
    expect(readFileSync(join(codexDir(), "skills", "console-axi", "SKILL.md"), "utf8")).toBe(SKILL_MD);
  });

  it("re-running is unchanged; uninstall preserves foreign AGENTS.md content", () => {
    writeFileSync(join(home, ".codex-agents-seed"), "");
    installCodex(COMMAND);
    expect(installCodex(COMMAND)).toMatchObject({ instructions: "unchanged", skill: "unchanged" });

    const agentsPath = join(codexDir(), "AGENTS.md");
    writeFileSync(agentsPath, `# user stuff\n\n${readFileSync(agentsPath, "utf8")}`);
    expect(installCodex(COMMAND).instructions).toBe("unchanged");

    const removed = removeCodex();
    expect(removed).toMatchObject({ instructions: "removed", skill: "removed" });
    expect(readFileSync(agentsPath, "utf8")).toContain("# user stuff");
    expect(existsSync(join(codexDir(), "skills", "console-axi"))).toBe(false);

    expect(removeCodex()).toMatchObject({ instructions: "absent", skill: "absent" });
  });
});

describe("opencode agent setup", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "axi-oc-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("installs into the opencode config dir and round-trips", () => {
    const result = installOpencode(COMMAND);

    expect(result).toMatchObject({ instructions: "installed", skill: "installed" });
    expect(readFileSync(join(opencodeDir(), "AGENTS.md"), "utf8")).toContain(COMMAND);
    expect(readFileSync(join(opencodeDir(), "skill", "console-axi", "SKILL.md"), "utf8")).toBe(SKILL_MD);

    expect(removeOpencode()).toMatchObject({ instructions: "removed", skill: "removed" });
    expect(existsSync(join(opencodeDir(), "AGENTS.md"))).toBe(false);
  });
});
