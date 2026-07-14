import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestHome, type TestHome } from "./helpers/env.js";
import { FakeConsoleApi } from "./helpers/fake-console-api.js";
import { runCli } from "./helpers/run-cli.js";

/** A model row shaped like a real `GET /v1/models` entry. */
function model(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
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

/** Build a raw SSE body the way AkashML's streaming endpoint frames chunks. */
function sseBody(events: unknown[]): string {
  return [...events.map((e) => `data: ${JSON.stringify(e)}`), "data: [DONE]"].join("\n\n") + "\n\n";
}

describe("akashml e2e", () => {
  let home: TestHome;
  let api: FakeConsoleApi;

  beforeEach(async () => {
    home = makeTestHome();
    api = await FakeConsoleApi.start();
  });

  afterEach(async () => {
    await api.close();
    home.cleanup();
  });

  const env = (extra: Record<string, string> = {}) => home.env({ AKASHML_API_URL: api.url, ...extra });
  const configFile = () => join(home.configDir, "config.json");

  describe("login", () => {
    it("probes GET /v1/models with a bearer token, persists the key, and masks it in config get", async () => {
      api.on("GET", "/v1/models", { body: { data: [model()] } });

      const result = await runCli(["akashml", "login", "--with-key", "akml-x"], { env: env() });

      expect(result.code).toBe(0);
      expect(result.toon()).toMatchObject({ ok: true, modelsAvailable: 1 });

      const probe = api.calls("GET", "/v1/models")[0];
      expect(probe?.headers.authorization).toBe("Bearer akml-x");
      expect(probe?.headers["x-api-key"]).toBeUndefined();

      const stored = JSON.parse(readFileSync(configFile(), "utf8"));
      expect(stored.akashmlApiKey).toBe("akml-x");

      const configGet = await runCli(["config", "get", "akashmlApiKey"], { env: env() });
      expect(configGet.code).toBe(0);
      const body = configGet.toon();
      expect(body.value).toBe("****");
      expect(String(body.value)).not.toContain("akml-x");
    });
  });

  describe("models", () => {
    it("renders the TOON model table from the fixture", async () => {
      api.on("GET", "/v1/models", {
        body: {
          data: [
            model({ id: "MiniMaxAI/MiniMax-M2.5", supported_features: ["chat", "tools", "streaming"] }),
            model({ id: "Qwen/Qwen3-235B", quantization: "bf16", pricing: { input: 0.2, output: 0.6 } })
          ]
        }
      });

      const result = await runCli(["akashml", "models"], { env: env({ AKASHML_API_KEY: "akml-test-key" }) });

      expect(result.code).toBe(0);
      const body = result.toon() as { models: Array<Record<string, unknown>> };
      expect(body.models).toHaveLength(2);
      expect(body.models).toContainEqual(
        expect.objectContaining({ id: "MiniMaxAI/MiniMax-M2.5", ctx: 128000, inUsd: "$0.10", outUsd: "$0.30" })
      );
      expect(body.models).toContainEqual(
        expect.objectContaining({ id: "Qwen/Qwen3-235B", quant: "bf16", inUsd: "$0.20", outUsd: "$0.60" })
      );
    });
  });

  describe("chat streaming", () => {
    const events = [
      { choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { reasoning_content: "thinking about greetings" }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: "lo " }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: "there" }, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } }
    ];

    beforeEach(() => {
      api.on("POST", "/v1/chat/completions", { raw: sseBody(events) });
    });

    it("writes exactly the concatenated content deltas plus one trailing newline to stdout, no reasoning", async () => {
      const result = await runCli(
        ["akashml", "chat", "--model", "Org/Model", "hi"],
        { env: env({ AKASHML_API_KEY: "akml-test-key" }) }
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("Hello there\n");
      expect(result.stderr).not.toContain("thinking about greetings");

      const call = api.calls("POST", "/v1/chat/completions")[0];
      expect(call?.headers.authorization).toBe("Bearer akml-test-key");
      const sentBody = JSON.parse(call?.body ?? "{}");
      expect(sentBody).toMatchObject({ model: "Org/Model", stream: true });
    });

    it("streams reasoning deltas to stderr only, never stdout, when --show-reasoning is set", async () => {
      const result = await runCli(
        ["akashml", "chat", "--model", "Org/Model", "--show-reasoning", "hi"],
        { env: env({ AKASHML_API_KEY: "akml-test-key" }) }
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("Hello there\n");
      expect(result.stderr).toContain("thinking about greetings");
    });
  });

  describe("chat --no-stream --json", () => {
    it("returns structured JSON with content and usage", async () => {
      api.on("POST", "/v1/chat/completions", {
        body: {
          id: "cmpl-1",
          model: "Org/Model",
          choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
        }
      });

      const result = await runCli(
        ["akashml", "chat", "--model", "Org/Model", "--no-stream", "--json", "hi"],
        { env: env({ AKASHML_API_KEY: "akml-test-key" }) }
      );

      expect(result.code).toBe(0);
      const body = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "Org/Model", content: "hi there", finishReason: "stop" });
      expect(body.usage).toMatchObject({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });

      const call = api.calls("POST", "/v1/chat/completions")[0];
      const sentBody = JSON.parse(call?.body ?? "{}");
      expect(sentBody.stream).toBe(false);
    });
  });

  describe("logout scoping", () => {
    /** Seed both a Console apiKey and an akashmlApiKey directly, bypassing any live probe. */
    const seedBoth = async (): Promise<void> => {
      await runCli(["config", "set", "apiKey", "sk-console-key"], { env: env() });
      await runCli(["config", "set", "akashmlApiKey", "akml-stored-key"], { env: env() });
    };

    it("global logout leaves akashmlApiKey intact and clears Console fields", async () => {
      await seedBoth();

      const result = await runCli(["logout"], { env: env() });
      expect(result.code).toBe(0);

      const stored = JSON.parse(readFileSync(configFile(), "utf8"));
      expect(stored.apiKey).toBeUndefined();
      expect(stored.akashmlApiKey).toBe("akml-stored-key");
    });

    it("akashml logout leaves Console apiKey intact and clears only akashmlApiKey", async () => {
      await seedBoth();

      const result = await runCli(["akashml", "logout"], { env: env() });
      expect(result.code).toBe(0);

      const stored = JSON.parse(readFileSync(configFile(), "utf8"));
      expect(stored.akashmlApiKey).toBeUndefined();
      expect(stored.apiKey).toBe("sk-console-key");
    });
  });

  describe("errors", () => {
    it("402 becomes insufficient_funds with exit code 1", async () => {
      api.on("GET", "/v1/models", { status: 402, body: { message: "Insufficient AkashML balance" } });

      const result = await runCli(["akashml", "models"], { env: env({ AKASHML_API_KEY: "akml-test-key" }) });

      expect(result.code).toBe(1);
      expect(result.toon()).toMatchObject({ error: { code: "insufficient_funds", exit: 1 } });
    });

    it("402 with --json surfaces insufficient_funds in the JSON error", async () => {
      api.on("GET", "/v1/models", { status: 402, body: { message: "Insufficient AkashML balance" } });

      const result = await runCli(["akashml", "models", "--json"], { env: env({ AKASHML_API_KEY: "akml-test-key" }) });

      expect(result.code).toBe(1);
      const body = JSON.parse(result.stdout) as { error: { code: string } };
      expect(body.error.code).toBe("insufficient_funds");
    });

    it("429 with Retry-After becomes rate_limited with details.retryAfter", async () => {
      api.on("GET", "/v1/models", {
        status: 429,
        body: { message: "slow down" },
        headers: { "retry-after": "30" }
      });

      const result = await runCli(["akashml", "models"], { env: env({ AKASHML_API_KEY: "akml-test-key" }) });

      expect(result.code).toBe(1);
      expect(result.toon()).toMatchObject({ error: { code: "rate_limited", details: { retryAfter: "30" } } });
    });
  });

  describe("setup", () => {
    let agentHome: string;

    beforeEach(() => {
      agentHome = join(home.dir, "agents");
      mkdirSync(agentHome, { recursive: true });
    });

    // These setup tests always pass --no-verify, so no HTTP call ever reaches
    // the fake server; the base URL just needs to satisfy the claude remover's
    // "only touch settings whose ANTHROPIC_BASE_URL mentions akashml" guard.
    const AGENT_BASE_URL = "https://gateway.akashml.example";

    const agentEnv = (extra: Record<string, string> = {}) =>
      home.env({
        AKASHML_API_KEY: "akml-test-key",
        AKASHML_API_URL: AGENT_BASE_URL,
        CLAUDE_CONFIG_DIR: join(agentHome, ".claude"),
        CODEX_HOME: join(agentHome, ".codex"),
        ...extra
      });

    it("writes the 6 env keys into claude settings.json", async () => {
      const result = await runCli(
        ["akashml", "setup", "--agent", "claude", "--model", "Org/Model", "--no-verify"],
        { env: agentEnv() }
      );

      expect(result.code).toBe(0);
      expect(result.toon()).toMatchObject({ ok: true, status: "installed" });

      const settingsPath = join(agentHome, ".claude", "settings.json");
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.env).toMatchObject({
        ANTHROPIC_BASE_URL: `${AGENT_BASE_URL}/anthropic`,
        ANTHROPIC_AUTH_TOKEN: "akml-test-key",
        API_TIMEOUT_MS: "3000000",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "Org/Model",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "Org/Model",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "Org/Model"
      });
    });

    it("writes codex config.toml with an env-reference provider (never the literal key)", async () => {
      const result = await runCli(
        ["akashml", "setup", "--agent", "codex", "--model", "Org/Model", "--no-verify"],
        { env: agentEnv() }
      );

      expect(result.code).toBe(0);
      const tomlPath = join(agentHome, ".codex", "config.toml");
      const config = parseToml(readFileSync(tomlPath, "utf8")) as Record<string, unknown>;
      expect(config.model).toBe("Org/Model");
      expect(config.model_provider).toBe("akashml");
      const provider = (config.model_providers as Record<string, unknown>).akashml as Record<string, unknown>;
      expect(provider.env_key).toBe("AKASHML_API_KEY");
      expect(JSON.stringify(provider)).not.toContain("akml-test-key");
    });

    it("writes opencode.json with an env-reference provider (never the literal key)", async () => {
      const result = await runCli(
        ["akashml", "setup", "--agent", "opencode", "--model", "Org/Model", "--no-verify"],
        { env: agentEnv() }
      );

      expect(result.code).toBe(0);
      const opencodePath = join(home.dir, "xdg", "opencode", "opencode.json");
      const config = JSON.parse(readFileSync(opencodePath, "utf8"));
      expect(config.model).toBe("akashml/Org/Model");
      expect(config.provider.akashml.options.apiKey).toBe("{env:AKASHML_API_KEY}");
      expect(JSON.stringify(config)).not.toContain("akml-test-key");
    });

    it("global uninstall sweeps all three AkashML agent configs away", async () => {
      await runCli(["akashml", "setup", "--agent", "claude", "--model", "Org/Model", "--no-verify"], { env: agentEnv() });
      await runCli(["akashml", "setup", "--agent", "codex", "--model", "Org/Model", "--no-verify"], { env: agentEnv() });
      await runCli(["akashml", "setup", "--agent", "opencode", "--model", "Org/Model", "--no-verify"], { env: agentEnv() });

      const result = await runCli(["uninstall"], { env: agentEnv() });

      expect(result.code).toBe(0);
      const body = result.toon() as { akashml: Record<string, string> };
      expect(body.akashml).toMatchObject({ claude: "removed", codex: "removed", opencode: "removed" });

      const claudeSettings = JSON.parse(readFileSync(join(agentHome, ".claude", "settings.json"), "utf8"));
      expect(claudeSettings.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();

      const codexConfig = parseToml(readFileSync(join(agentHome, ".codex", "config.toml"), "utf8")) as Record<string, unknown>;
      expect(codexConfig.model).toBeUndefined();
      expect(codexConfig.model_provider).toBeUndefined();

      const opencodeConfig = JSON.parse(readFileSync(join(home.dir, "xdg", "opencode", "opencode.json"), "utf8"));
      expect(opencodeConfig.model).toBeUndefined();
      expect(opencodeConfig.provider?.akashml).toBeUndefined();
    });
  });

  describe("completions", () => {
    it("includes the akashml subcommands", async () => {
      const bash = await runCli(["completion", "bash"], { env: env() });
      expect(bash.code).toBe(0);
      expect(bash.stdout).toContain("akashml");

      const zsh = await runCli(["completion", "zsh"], { env: env() });
      expect(zsh.code).toBe(0);
      expect(zsh.stdout).toContain("akashml");

      const fish = await runCli(["completion", "fish"], { env: env() });
      expect(fish.code).toBe(0);
      expect(fish.stdout).toContain("akashml");
    });
  });
});
