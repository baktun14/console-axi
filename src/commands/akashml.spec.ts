import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { decode } from "@toon-format/toon";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../akashml/client.js", () => ({ listModels: vi.fn(), chat: vi.fn(), chatStream: vi.fn() }));
vi.mock("../input.js", () => ({ readFileOrStdin: vi.fn() }));

import type { AkashmlChatCompletion, AkashmlChatRequest, AkashmlModel } from "../akashml/client.js";
import { chat, chatStream, listModels } from "../akashml/client.js";
import { configPath, type StoredConfig } from "../config/config.js";
import { resetDebug, setDebug } from "../debug.js";
import { AxiError } from "../errors.js";
import { readFileOrStdin } from "../input.js";
import { resetOutputFormat, setOutputFormat } from "../output/render.js";
import { registerAkashml } from "./akashml.js";

const listModelsMock = vi.mocked(listModels);
const chatMock = vi.mocked(chat);
const chatStreamMock = vi.mocked(chatStream);
const readFileOrStdinMock = vi.mocked(readFileOrStdin);

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
    chatMock.mockReset();
    chatStreamMock.mockReset();
    readFileOrStdinMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = 0;
    resetOutputFormat();
    resetDebug();
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

  describe("chat", () => {
    beforeEach(() => {
      vi.stubEnv("AKASHML_API_KEY", "akml-test-key");
    });

    function sampleCompletion(overrides: Partial<AkashmlChatCompletion> = {}): AkashmlChatCompletion {
      return {
        id: "cmpl-1",
        model: "MiniMaxAI/MiniMax-M2.5",
        choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        ...overrides
      };
    }

    function lastStreamRequest(): AkashmlChatRequest {
      const call = chatStreamMock.mock.calls[0];
      if (!call) throw new Error("chatStream was not called");
      return call[1];
    }

    it("requires --model with a usage error pointing at akashml models", async () => {
      const { line } = setup();

      await run("akashml", "chat", "hi");

      expect(process.exitCode).toBe(2);
      const body = decode(line(0)) as { error: { code: string }; help: string[] };
      expect(body.error.code).toBe("usage");
      expect(body.help).toContain("console-axi akashml models");
      expect(chatMock).not.toHaveBeenCalled();
      expect(chatStreamMock).not.toHaveBeenCalled();
    });

    it("requires AkashML auth before chatting", async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("XDG_CONFIG_HOME", dir);
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "hi");

      expect(process.exitCode).toBe(1);
      expect(decode(line(0))).toMatchObject({ error: { code: "unauthorized" } });
      expect(chatStreamMock).not.toHaveBeenCalled();
    });

    it("streams content deltas raw to stdout with exactly one trailing newline; reasoning never reaches stdout", async () => {
      chatStreamMock.mockImplementation(async (_cfg, _req, onDelta) => {
        onDelta({ content: "Hel" });
        onDelta({ reasoning_content: "thinking..." });
        onDelta({ content: "lo" });
        return { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }, finishReason: "stop" };
      });
      const { lines, stderrLines } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "hi");

      expect(lines.join("")).toBe("Hello\n");
      expect(stderrLines.join("")).not.toMatch(/thinking/);
      expect(chatMock).not.toHaveBeenCalled();
    });

    it("streams reasoning deltas to stderr only when --show-reasoning is set", async () => {
      chatStreamMock.mockImplementation(async (_cfg, _req, onDelta) => {
        onDelta({ content: "answer" });
        onDelta({ reasoning_content: "because X" });
        return {};
      });
      const { stderrLines } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--show-reasoning", "hi");

      expect(stderrLines.join("")).toContain("because X");
    });

    it("never writes reasoning deltas to stderr without --show-reasoning", async () => {
      chatStreamMock.mockImplementation(async (_cfg, _req, onDelta) => {
        onDelta({ reasoning_content: "because X" });
        onDelta({ content: "answer" });
        return {};
      });
      const { stderrLines } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "hi");

      expect(stderrLines).toHaveLength(0);
    });

    it("prints usage stats to stderr only under --verbose when streaming", async () => {
      chatStreamMock.mockResolvedValue({
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        finishReason: "stop"
      });

      const quiet = setup();
      await run("akashml", "chat", "--model", "Org/Model", "hi");
      expect(quiet.stderrLines).toHaveLength(0);

      setDebug(true);
      const verbose = setup();
      await run("akashml", "chat", "--model", "Org/Model", "hi");
      expect(verbose.stderrLines.join("")).toMatch(/total.*2/);
    });

    it("--no-stream forces a single non-streaming request with structured output", async () => {
      chatMock.mockResolvedValue(sampleCompletion());
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--no-stream", "hi");

      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(chatStreamMock).not.toHaveBeenCalled();
      const body = decode(line(0)) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: "MiniMaxAI/MiniMax-M2.5",
        content: "hi there",
        finishReason: "stop"
      });
      expect(body).not.toHaveProperty("reasoning");
      expect(body.usage).toBeTruthy();
    });

    it("includes reasoning in structured output only when the response carries it", async () => {
      chatMock.mockResolvedValue(
        sampleCompletion({
          choices: [
            { index: 0, message: { role: "assistant", content: "hi", reasoning_content: "because" }, finish_reason: "stop" }
          ]
        })
      );
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--no-stream", "hi");

      const body = decode(line(0)) as Record<string, unknown>;
      expect(body.reasoning).toBe("because");
    });

    it("--json forces non-streaming even without --no-stream", async () => {
      setOutputFormat("json");
      chatMock.mockResolvedValue(sampleCompletion());
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "hi");

      expect(chatMock).toHaveBeenCalledTimes(1);
      expect(chatStreamMock).not.toHaveBeenCalled();
      const body = JSON.parse(line(0)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "MiniMaxAI/MiniMax-M2.5", content: "hi there", finishReason: "stop" });
      expect(body.usage).toBeTruthy();
    });

    it("sends no reasoning field when no reasoning flags are given", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "hi");

      expect(lastStreamRequest()).not.toHaveProperty("reasoning");
    });

    it("sends reasoning with exclude:true when --effort is set alone", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "--effort", "high", "hi");

      expect(lastStreamRequest().reasoning).toMatchObject({ effort: "high", exclude: true });
    });

    it("sends reasoning with exclude:true when --reasoning-max-tokens is set alone", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "--reasoning-max-tokens", "256", "hi");

      expect(lastStreamRequest().reasoning).toMatchObject({ max_tokens: 256, exclude: true });
    });

    it("omits exclude (or sets it false) when --show-reasoning is set", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "--show-reasoning", "hi");

      expect(lastStreamRequest().reasoning?.exclude).not.toBe(true);
    });

    it("normalizes Org--Model to Org/Model", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "MiniMaxAI--MiniMax-M2.5", "hi");

      expect(lastStreamRequest().model).toBe("MiniMaxAI/MiniMax-M2.5");
    });

    it("leaves an already-slashed model id untouched", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "MiniMaxAI/MiniMax-M2.5", "hi");

      expect(lastStreamRequest().model).toBe("MiniMaxAI/MiniMax-M2.5");
    });

    it("joins variadic prompt args with a space", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "hello", "there");

      expect(lastStreamRequest().messages.at(-1)).toMatchObject({ role: "user", content: "hello there" });
    });

    it("includes a system message when --system is given", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "--system", "be terse", "hi");

      expect(lastStreamRequest().messages[0]).toMatchObject({ role: "system", content: "be terse" });
    });

    it("reads stdin when no prompt args are given", async () => {
      chatStreamMock.mockResolvedValue({});
      readFileOrStdinMock.mockReturnValue("piped content");
      setup();

      await run("akashml", "chat", "--model", "Org/Model");

      expect(readFileOrStdinMock).toHaveBeenCalledWith("-");
      expect(lastStreamRequest().messages.at(-1)).toMatchObject({ role: "user", content: "piped content" });
    });

    it("reads stdin when the prompt arg is a literal '-'", async () => {
      chatStreamMock.mockResolvedValue({});
      readFileOrStdinMock.mockReturnValue("from pipe");
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "-");

      expect(readFileOrStdinMock).toHaveBeenCalledWith("-");
      expect(lastStreamRequest().messages.at(-1)).toMatchObject({ role: "user", content: "from pipe" });
    });

    it("passes through --max-tokens and --temperature", async () => {
      chatStreamMock.mockResolvedValue({});
      setup();

      await run("akashml", "chat", "--model", "Org/Model", "--max-tokens", "128", "--temperature", "0.5", "hi");

      const req = lastStreamRequest();
      expect(req.max_tokens).toBe(128);
      expect(req.temperature).toBe(0.5);
    });

    it("rejects a non-numeric --max-tokens with a usage error instead of sending NaN", async () => {
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--max-tokens", "abc", "hi");

      expect(process.exitCode).toBe(2);
      expect(decode(line(0))).toMatchObject({ error: { code: "usage" } });
      expect(chatStreamMock).not.toHaveBeenCalled();
      expect(chatMock).not.toHaveBeenCalled();
    });

    it("rejects a non-integer --max-tokens", async () => {
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--max-tokens", "12.5", "hi");

      expect(process.exitCode).toBe(2);
      expect(decode(line(0))).toMatchObject({ error: { code: "usage" } });
    });

    it("rejects a non-numeric --temperature with a usage error", async () => {
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--temperature", "warm", "hi");

      expect(process.exitCode).toBe(2);
      expect(decode(line(0))).toMatchObject({ error: { code: "usage" } });
      expect(chatStreamMock).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric --reasoning-max-tokens with a usage error", async () => {
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--reasoning-max-tokens", "lots", "hi");

      expect(process.exitCode).toBe(2);
      expect(decode(line(0))).toMatchObject({ error: { code: "usage" } });
      expect(chatStreamMock).not.toHaveBeenCalled();
    });

    it("rejects an --effort value outside minimal|low|medium|high|xhigh", async () => {
      const { line } = setup();

      await run("akashml", "chat", "--model", "Org/Model", "--effort", "extreme", "hi");

      expect(process.exitCode).toBe(2);
      const body = decode(line(0)) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("usage");
      expect(body.error.message).toContain("--effort");
      expect(chatStreamMock).not.toHaveBeenCalled();
    });

    it("accepts each valid --effort level", async () => {
      for (const level of ["minimal", "low", "medium", "high", "xhigh"]) {
        chatStreamMock.mockReset();
        chatStreamMock.mockResolvedValue({});
        setup();

        await run("akashml", "chat", "--model", "Org/Model", "--effort", level, "hi");

        expect(lastStreamRequest().reasoning).toMatchObject({ effort: level });
      }
    });
  });

  describe("setup", () => {
    let claudeHome: string;
    let codexHome: string;

    beforeEach(() => {
      vi.stubEnv("AKASHML_API_KEY", "akml-secret-key-value");
      claudeHome = mkdtempSync(join(tmpdir(), "axi-akml-setup-claude-"));
      codexHome = mkdtempSync(join(tmpdir(), "axi-akml-setup-codex-"));
      vi.stubEnv("CLAUDE_CONFIG_DIR", join(claudeHome, ".claude"));
      vi.stubEnv("CODEX_HOME", join(codexHome, ".codex"));
    });

    afterEach(() => {
      rmSync(claudeHome, { recursive: true, force: true });
      rmSync(codexHome, { recursive: true, force: true });
    });

    it("errors when --agent is missing", async () => {
      const { line } = setup();

      await run("akashml", "setup", "--model", "Org/Model");

      expect(process.exitCode).toBe(2);
      expect(decode(line(0))).toMatchObject({ error: { code: "usage" } });
    });

    it("errors when --model is missing (not removing), pointing at akashml models", async () => {
      const { line } = setup();

      await run("akashml", "setup", "--agent", "claude");

      expect(process.exitCode).toBe(2);
      const body = decode(line(0)) as { error: { code: string }; help: string[] };
      expect(body.error.code).toBe("usage");
      expect(body.help).toContain("console-axi akashml models");
    });

    it("rejects claude-only flags for codex", async () => {
      const { line } = setup();

      await run("akashml", "setup", "--agent", "codex", "--model", "Org/Model", "--sonnet", "Org/Other");

      expect(process.exitCode).toBe(2);
      expect(decode(line(0))).toMatchObject({ error: { code: "usage" } });
    });

    it("rejects --project for codex", async () => {
      const { line } = setup();

      await run("akashml", "setup", "--agent", "codex", "--model", "Org/Model", "--project");

      expect(process.exitCode).toBe(2);
      expect(decode(line(0))).toMatchObject({ error: { code: "usage" } });
    });

    it("validates --model against live listModels and errors on an unknown id", async () => {
      listModelsMock.mockResolvedValue([sampleModel({ id: "Org/Known" })]);
      const { line } = setup();

      await run("akashml", "setup", "--agent", "codex", "--model", "Org/Unknown");

      expect(process.exitCode).toBe(2);
      const body = decode(line(0)) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("usage");
      expect(body.error.message).toContain("Org/Unknown");
    });

    it("skips validation with --no-verify", async () => {
      const { line } = setup();

      await run("akashml", "setup", "--agent", "codex", "--model", "Org/Unknown", "--no-verify");

      expect(listModelsMock).not.toHaveBeenCalled();
      expect(decode(line(0))).toMatchObject({ ok: true, status: "installed" });
    });

    it("installs codex config and includes a masked export note without the real key", async () => {
      const { line } = setup();

      await run("akashml", "setup", "--agent", "codex", "--model", "Org/Model", "--no-verify");

      const body = decode(line(0)) as { note: string };
      expect(body.note).toContain("export AKASHML_API_KEY=");
      expect(body.note).not.toContain("akml-secret-key-value");
    });

    it("installs opencode config and includes a masked export note without the real key", async () => {
      const opencodeHome = mkdtempSync(join(tmpdir(), "axi-akml-setup-oc-"));
      vi.stubEnv("XDG_CONFIG_HOME", join(opencodeHome, ".config"));
      const { line } = setup();

      await run("akashml", "setup", "--agent", "opencode", "--model", "Org/Model", "--no-verify");

      const body = decode(line(0)) as { note: string };
      expect(body.note).toContain("export AKASHML_API_KEY=");
      expect(body.note).not.toContain("akml-secret-key-value");
      rmSync(opencodeHome, { recursive: true, force: true });
    });

    it("installs claude env and notes the key was written into settings (not masked as an export line)", async () => {
      const { line } = setup();

      await run("akashml", "setup", "--agent", "claude", "--model", "Org/Model", "--no-verify");

      const body = decode(line(0)) as { note: string; settings: string };
      expect(body.note).not.toContain("export AKASHML_API_KEY=");
      expect(body.settings).toContain("settings.json");
    });

    it("--remove works without any AkashML auth configured", async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("XDG_CONFIG_HOME", dir);
      vi.stubEnv("CODEX_HOME", join(codexHome, ".codex"));
      const { line } = setup();

      await run("akashml", "setup", "--agent", "codex", "--remove");

      expect(process.exitCode ?? 0).toBe(0);
      const body = decode(line(0)) as { status: string };
      expect(body.status).toBe("absent");
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
