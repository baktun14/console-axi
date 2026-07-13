import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decode } from "@toon-format/toon";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configPath } from "../config/config.js";
import { registerConfig } from "./config.js";

describe("config command", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "axi-config-cmd-"));
    vi.stubEnv("XDG_CONFIG_HOME", dir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it("set then get round-trips through the config file", async () => {
    const { output } = setup();

    await run("config", "set", "network", "sandbox");
    await run("config", "get", "network");

    const rows = output().map((raw) => decode(raw) as Record<string, unknown>);
    expect(rows[0]).toMatchObject({ ok: true, key: "network", value: "sandbox" });
    expect(rows[1]).toMatchObject({ key: "network", value: "sandbox", source: "file" });
    expect(JSON.parse(readFileSync(configPath(), "utf8"))).toEqual({ network: "sandbox" });
  });

  it("reports source=env when the environment overrides a stored value", async () => {
    const { line } = setup();
    await run("config", "set", "network", "sandbox");
    vi.stubEnv("CONSOLE_NETWORK", "mainnet");

    await run("config", "get", "network");

    expect(decode(line(1))).toMatchObject({ key: "network", value: "mainnet", source: "env" });
  });

  it("lists all keys with defaults when nothing is configured", async () => {
    const { line } = setup();

    await run("config", "get");

    const body = decode(line(0)) as { config: Array<{ key: string; source: string }> };
    const byKey = Object.fromEntries(body.config.map((row) => [row.key, row]));
    expect(Object.keys(byKey).sort()).toEqual(["apiKey", "baseUrl", "consoleWebUrl", "network", "providerProxyUrl"]);
    expect(byKey.network?.source).toBe("default");
    expect(byKey.apiKey?.source).toBe("unset");
  });

  it("always masks the apiKey and never prints the full secret", async () => {
    const { output, line } = setup();
    const secret = "sk-live-abcdefghijklmnop";

    await run("config", "set", "apiKey", secret);
    await run("config", "get", "apiKey");
    await run("config", "get");

    const everything = output().join("\n");
    expect(everything).not.toContain(secret);
    expect(decode(line(1))).toMatchObject({ key: "apiKey", source: "file" });
    expect((decode(line(1)) as { value: string }).value).toMatch(/^sk-l…\S{4}$|^sk-l.*mnop$/);
  });

  it("rejects unknown keys with a usage error and exit 2", async () => {
    const { line } = setup();

    await run("config", "set", "nonsense", "x");

    expect(process.exitCode).toBe(2);
    expect(decode(line(0))).toMatchObject({ error: { code: "usage", exit: 2 } });
  });

  it("unset is idempotent", async () => {
    const { line } = setup();
    await run("config", "set", "network", "sandbox");

    await run("config", "unset", "network");
    await run("config", "unset", "network");

    expect(decode(line(1))).toMatchObject({ ok: true, key: "network" });
    expect(decode(line(2))).toMatchObject({ ok: true, key: "network" });
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("keeps the config file private (0600) after set", async () => {
    setup();

    await run("config", "set", "apiKey", "sk-live-abcdefghijklmnop");

    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it("config path reports the file location and existence", async () => {
    const { line } = setup();

    await run("config", "path");

    expect(decode(line(0))).toMatchObject({ path: configPath(), exists: false });
    expect(existsSync(configPath())).toBe(false);
  });

  async function run(...argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerConfig(program);
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
