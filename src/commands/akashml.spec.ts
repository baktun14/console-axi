import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { decode } from "@toon-format/toon";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../akashml/client.js", () => ({ listModels: vi.fn() }));

import type { AkashmlModel } from "../akashml/client.js";
import { listModels } from "../akashml/client.js";
import { configPath, type StoredConfig } from "../config/config.js";
import { AxiError } from "../errors.js";
import { registerAkashml } from "./akashml.js";

const listModelsMock = vi.mocked(listModels);

function sampleModel(overrides: Partial<AkashmlModel> = {}): AkashmlModel {
  return {
    id: "MiniMaxAI/MiniMax-M2.5",
    name: "MiniMax M2.5",
    context_length: 128000,
    max_output_length: 4096,
    quantization: "fp8",
    supported_features: ["chat", "tools", "streaming"],
    pricing: { input: 0.1, output: 0.3 },
    ...overrides
  };
}

describe("akashml command", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "axi-akashml-cmd-"));
    vi.stubEnv("XDG_CONFIG_HOME", dir);
    listModelsMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  describe("login", () => {
    it("warns on stderr when the key lacks the akml- prefix but still logs in", async () => {
      listModelsMock.mockResolvedValue([]);
      const { stderrLines, line } = setup();

      await run("akashml", "login", "--with-key", "sk-not-prefixed");

      expect(stderrLines.join("")).toMatch(/akml-/);
      expect(decode(line(0))).toMatchObject({ ok: true });
    });

    it("does not warn when the key has the akml- prefix", async () => {
      listModelsMock.mockResolvedValue([]);
      const { stderrLines } = setup();

      await run("akashml", "login", "--with-key", "akml-good-key");

      expect(stderrLines).toHaveLength(0);
    });

    it("probes with the provided key (and url) before persisting", async () => {
      listModelsMock.mockResolvedValue([]);
      setup();

      await run("akashml", "login", "--with-key", "akml-abc", "--url", "https://custom.akashml.test/");

      expect(listModelsMock).toHaveBeenCalledWith(
        expect.objectContaining({ akashmlApiKey: "akml-abc", akashmlBaseUrl: "https://custom.akashml.test" })
      );
    });

    it("persists akashmlApiKey only (no url change) when --url is not given", async () => {
      listModelsMock.mockResolvedValue([]);
      setup();

      await run("akashml", "login", "--with-key", "akml-abc");

      const stored = JSON.parse(readFileSync(configPath(), "utf8")) as StoredConfig;
      expect(stored.akashmlApiKey).toBe("akml-abc");
      expect(stored.akashmlBaseUrl).toBeUndefined();
    });

    it("persists akashmlBaseUrl when --url is given", async () => {
      listModelsMock.mockResolvedValue([]);
      setup();

      await run("akashml", "login", "--with-key", "akml-abc", "--url", "https://custom.akashml.test/");

      const stored = JSON.parse(readFileSync(configPath(), "utf8")) as StoredConfig;
      expect(stored.akashmlBaseUrl).toBe("https://custom.akashml.test");
    });

    it("does not persist anything when the probe fails", async () => {
      listModelsMock.mockRejectedValue(new AxiError({ code: "unauthorized", message: "nope" }));
      setup();

      await run("akashml", "login", "--with-key", "akml-bad");

      expect(process.exitCode).toBe(1);
      expect(existsSync(configPath())).toBe(false);
    });
  });

  describe("logout", () => {
    it("removes only akashmlApiKey, leaving Console apiKey and akashmlBaseUrl intact", async () => {
      seed({
        apiKey: "sk-console",
        baseUrl: "https://custom-console.example",
        akashmlApiKey: "akml-remove-me",
        akashmlBaseUrl: "https://keep-me-akashml.example"
      });
      const { line } = setup();

      await run("akashml", "logout");

      expect(decode(line(0))).toMatchObject({ ok: true });
      const stored = JSON.parse(readFileSync(configPath(), "utf8")) as StoredConfig;
      expect(stored.akashmlApiKey).toBeUndefined();
      expect(stored.apiKey).toBe("sk-console");
      expect(stored.baseUrl).toBe("https://custom-console.example");
      expect(stored.akashmlBaseUrl).toBe("https://keep-me-akashml.example");
    });

    it("is a no-op when no config file exists", async () => {
      const { line } = setup();

      await run("akashml", "logout");

      expect(process.exitCode ?? 0).toBe(0);
      expect(decode(line(0))).toMatchObject({ ok: true });
      expect(existsSync(configPath())).toBe(false);
    });
  });

  describe("models", () => {
    beforeEach(() => {
      vi.stubEnv("AKASHML_API_KEY", "akml-test-key");
    });

    it("filters by --model substring, case-insensitively", async () => {
      listModelsMock.mockResolvedValue([
        sampleModel({ id: "MiniMaxAI/MiniMax-M2.5" }),
        sampleModel({ id: "Qwen/Qwen3-235B" })
      ]);
      const { line } = setup();

      await run("akashml", "models", "--model", "minimax");

      const body = decode(line(0)) as { models: Array<{ id: string }> };
      expect(body.models).toHaveLength(1);
      expect(body.models[0]?.id).toBe("MiniMaxAI/MiniMax-M2.5");
    });

    it("filters by --tools", async () => {
      listModelsMock.mockResolvedValue([
        sampleModel({ id: "with-tools", supported_features: ["chat", "tools"] }),
        sampleModel({ id: "without-tools", supported_features: ["chat"] })
      ]);
      const { line } = setup();

      await run("akashml", "models", "--tools");

      const body = decode(line(0)) as { models: Array<{ id: string }> };
      expect(body.models).toHaveLength(1);
      expect(body.models[0]?.id).toBe("with-tools");
    });

    it("filters by --reasoning", async () => {
      listModelsMock.mockResolvedValue([
        sampleModel({ id: "with-reasoning", supported_features: ["chat", "reasoning"] }),
        sampleModel({ id: "without-reasoning", supported_features: ["chat"] })
      ]);
      const { line } = setup();

      await run("akashml", "models", "--reasoning");

      const body = decode(line(0)) as { models: Array<{ id: string }> };
      expect(body.models).toHaveLength(1);
      expect(body.models[0]?.id).toBe("with-reasoning");
    });

    it("renders the documented row shape", async () => {
      listModelsMock.mockResolvedValue([sampleModel()]);
      const { line } = setup();

      await run("akashml", "models");

      const body = decode(line(0)) as { models: Array<Record<string, unknown>> };
      expect(body.models[0]).toMatchObject({
        id: "MiniMaxAI/MiniMax-M2.5",
        ctx: 128000,
        maxOut: 4096,
        inUsd: "$0.10",
        outUsd: "$0.30",
        features: "chat, tools, streaming",
        quant: "fp8"
      });
    });

    it("requires AkashML auth before listing", async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("XDG_CONFIG_HOME", dir);
      const { line } = setup();

      await run("akashml", "models");

      expect(process.exitCode).toBe(1);
      expect(decode(line(0))).toMatchObject({ error: { code: "unauthorized" } });
      expect(listModelsMock).not.toHaveBeenCalled();
    });
  });

  function seed(stored: StoredConfig): void {
    const path = configPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(stored));
  }

  async function run(...argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerAkashml(program);
    await program.parseAsync(argv, { from: "user" });
  }

  function setup() {
    const lines: string[] = [];
    const stderrLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(chunk.toString());
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderrLines.push(chunk.toString());
      return true;
    });
    return { lines, stderrLines, line: (i: number): string => lines[i] ?? "" };
  }
});
