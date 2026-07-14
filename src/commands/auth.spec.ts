import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { decode } from "@toon-format/toon";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configPath, type StoredConfig } from "../config/config.js";
import { registerAuth } from "./auth.js";

describe("auth command - logout", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "axi-auth-cmd-"));
    vi.stubEnv("XDG_CONFIG_HOME", dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("clears Console fields but leaves akashmlApiKey/akashmlBaseUrl intact", async () => {
    seed({
      apiKey: "sk-console",
      baseUrl: "https://custom-console.example",
      network: "sandbox",
      akashmlApiKey: "akml-keep-me",
      akashmlBaseUrl: "https://keep-me-akashml.example"
    });
    const { line } = setup();

    await run("logout");

    expect(decode(line(0))).toMatchObject({ ok: true });
    const stored = JSON.parse(readFileSync(configPath(), "utf8")) as StoredConfig;
    expect(stored.apiKey).toBeUndefined();
    expect(stored.baseUrl).toBeUndefined();
    expect(stored.network).toBeUndefined();
    expect(stored.akashmlApiKey).toBe("akml-keep-me");
    expect(stored.akashmlBaseUrl).toBe("https://keep-me-akashml.example");
  });

  it("exits 0 as a no-op when no config file exists", async () => {
    const { line } = setup();

    await run("logout");

    expect(process.exitCode ?? 0).toBe(0);
    expect(decode(line(0))).toMatchObject({ ok: true });
  });

  function seed(stored: StoredConfig): void {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(stored));
  }

  async function run(...argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerAuth(program);
    await program.parseAsync(argv, { from: "user" });
  }

  function setup() {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(chunk.toString());
      return true;
    });
    return { output: () => lines, line: (i: number): string => lines[i] ?? "" };
  }
});
