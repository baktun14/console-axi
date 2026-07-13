import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";

import { completionScript, registerCompletion } from "./completion.js";
import { registerDeployment } from "./deployment.js";
import { registerHome } from "./home.js";
import { registerSdl } from "./sdl.js";
import { registerWallet } from "./wallet.js";

/**
 * Build a representative tree from the real register functions (cli.ts cannot
 * be imported — it runs main() at module load).
 */
function buildTree(): Command {
  const program = new Command();
  program
    .name("console-axi")
    .exitOverride()
    .option("--url <url>", "override the Console API base URL")
    .option("--json", "emit JSON instead of TOON on stdout");
  registerHome(program);
  registerSdl(program);
  registerDeployment(program);
  registerWallet(program);
  registerCompletion(program);
  return program;
}

describe("completion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bash script covers commands, subcommands and global flags, skips hidden", () => {
    const script = completionScript(buildTree(), "bash");

    expect(script).toContain("_console_axi");
    expect(script).toContain("deployment");
    expect(script).toContain("wallet");
    expect(script).toContain("validate"); // sdl subcommand
    expect(script).toContain("--json");
    expect(script).not.toContain("home"); // hidden command
    expect(script).toContain("complete -F _console_axi console-axi");
  });

  it("zsh script is a #compdef file", () => {
    const script = completionScript(buildTree(), "zsh");

    expect(script.startsWith("#compdef console-axi")).toBe(true);
    expect(script).toContain("deployment");
    expect(script).toContain("--json");
  });

  it("fish script emits complete lines per command", () => {
    const script = completionScript(buildTree(), "fish");

    expect(script).toContain("complete -c console-axi");
    expect(script).toContain("deployment");
    expect(script).toContain("status");
  });

  it("unknown shells are a usage error via the command", async () => {
    const program = buildTree();
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(chunk.toString());
      return true;
    });

    await program.parseAsync(["completion", "powershell"], { from: "user" });

    expect(process.exitCode).toBe(2);
    expect(lines.join("")).toContain("usage");
    process.exitCode = 0;
  });
});
