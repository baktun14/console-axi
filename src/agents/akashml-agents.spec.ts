import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claudeDir } from "../commands/setup.js";
import { installClaudeAkashmlEnv, removeClaudeAkashmlEnv } from "./akashml-claude.js";
import { installCodexAkashml, removeCodexAkashml } from "./akashml-codex.js";
import { installOpencodeAkashml, removeOpencodeAkashml } from "./akashml-opencode.js";
import { codexDir } from "./codex.js";
import { opencodeDir } from "./opencode.js";

const BASE_URL = "https://api.akashml.com";
const API_KEY = "akml-secret-key-value";

describe("claude akashml env installer", () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "axi-akml-claude-"));
    cwd = mkdtempSync(join(tmpdir(), "axi-akml-claude-cwd-"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", join(home, ".claude"));
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  function install(overrides: Partial<Parameters<typeof installClaudeAkashmlEnv>[0]> = {}) {
    return installClaudeAkashmlEnv({
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      sonnet: "Org/Sonnet-Model",
      opus: "Org/Opus-Model",
      haiku: "Org/Haiku-Model",
      ...overrides
    });
  }

  it("fresh install writes the six managed env keys and returns installed", () => {
    const result = install();
    expect(result.status).toBe("installed");
    expect(result.path).toBe(join(claudeDir(), "settings.json"));

    const settings = JSON.parse(readFileSync(result.path, "utf8")) as { env: Record<string, string> };
    expect(settings.env).toMatchObject({
      ANTHROPIC_BASE_URL: `${BASE_URL}/anthropic`,
      ANTHROPIC_AUTH_TOKEN: API_KEY,
      API_TIMEOUT_MS: "3000000",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "Org/Sonnet-Model",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "Org/Opus-Model",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "Org/Haiku-Model"
    });
  });

  it("rerunning with identical args is unchanged", () => {
    install();
    expect(install().status).toBe("unchanged");
  });

  it("changed model returns updated and rewrites only the managed keys", () => {
    install();
    const result = install({ sonnet: "Org/New-Sonnet" });
    expect(result.status).toBe("updated");
    const settings = JSON.parse(readFileSync(result.path, "utf8")) as { env: Record<string, string> };
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("Org/New-Sonnet");
  });

  it("preserves foreign keys in env and the rest of the settings file", () => {
    const path = join(claudeDir(), "settings.json");
    mkdirSync(claudeDir(), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ foreignTopLevel: true, env: { FOREIGN_VAR: "keep-me" }, hooks: { SessionStart: [] } })
    );

    install();

    const settings = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(settings.foreignTopLevel).toBe(true);
    expect((settings.env as Record<string, string>).FOREIGN_VAR).toBe("keep-me");
    expect(settings.hooks).toEqual({ SessionStart: [] });
  });

  it("removes the managed keys and reports removed", () => {
    install();
    const result = removeClaudeAkashmlEnv();
    expect(result.status).toBe("removed");
    const settings = JSON.parse(readFileSync(result.path, "utf8")) as { env?: Record<string, string> };
    expect(settings.env?.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("remove is absent when the settings file does not exist", () => {
    const result = removeClaudeAkashmlEnv();
    expect(result.status).toBe("absent");
  });

  it("remove is absent and leaves foreign provider config untouched when ANTHROPIC_BASE_URL is not akashml", () => {
    const path = join(claudeDir(), "settings.json");
    mkdirSync(claudeDir(), { recursive: true });
    const foreign = { env: { ANTHROPIC_BASE_URL: "https://api.anthropic.com", FOREIGN_VAR: "keep-me" } };
    writeFileSync(path, JSON.stringify(foreign));

    const result = removeClaudeAkashmlEnv();

    expect(result.status).toBe("absent");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(foreign);
  });

  it("removes a custom-url install (ANTHROPIC_BASE_URL lacks 'akashml') via the akml- token marker", () => {
    install({ baseUrl: "https://my-gateway.example" });
    const installedSettings = JSON.parse(readFileSync(join(claudeDir(), "settings.json"), "utf8")) as {
      env: Record<string, string>;
    };
    expect(installedSettings.env.ANTHROPIC_BASE_URL).toBe("https://my-gateway.example/anthropic");

    const result = removeClaudeAkashmlEnv();

    expect(result.status).toBe("removed");
    const settings = JSON.parse(readFileSync(result.path, "utf8")) as { env?: Record<string, string> };
    expect(settings.env?.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(settings.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it("--project scope writes ./.claude/settings.local.json and never settings.json", () => {
    const result = install({ project: true });
    expect(result.path).toBe(join(cwd, ".claude", "settings.local.json"));
    expect(existsSync(join(cwd, ".claude", "settings.local.json"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(claudeDir(), "settings.json"))).toBe(false);
  });

  it("removes project scope from settings.local.json only", () => {
    install({ project: true });
    const result = removeClaudeAkashmlEnv({ project: true });
    expect(result.status).toBe("removed");
    expect(result.path).toBe(join(cwd, ".claude", "settings.local.json"));
  });
});

describe("codex akashml installer", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "axi-akml-codex-"));
    vi.stubEnv("CODEX_HOME", join(home, ".codex"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("fresh install writes model/model_provider and the provider table, key stays out of the file", () => {
    const result = installCodexAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    expect(result.status).toBe("installed");

    const toml = readFileSync(result.path, "utf8");
    expect(toml).not.toContain(API_KEY);
    expect(toml).not.toContain("akml-");

    const config = parse(toml) as Record<string, unknown>;
    expect(config.model).toBe("Org/Model");
    expect(config.model_provider).toBe("akashml");
    expect(config.model_providers).toMatchObject({
      akashml: {
        name: "AkashML",
        base_url: `${BASE_URL}/v1`,
        env_key: "AKASHML_API_KEY",
        wire_api: "chat"
      }
    });
  });

  it("rerunning with the same model is unchanged", () => {
    installCodexAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    expect(installCodexAkashml({ baseUrl: BASE_URL, model: "Org/Model" }).status).toBe("unchanged");
  });

  it("changed model returns updated", () => {
    installCodexAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    const result = installCodexAkashml({ baseUrl: BASE_URL, model: "Org/New-Model" });
    expect(result.status).toBe("updated");
    const config = parse(readFileSync(result.path, "utf8")) as Record<string, unknown>;
    expect(config.model).toBe("Org/New-Model");
  });

  it("preserves foreign tables/keys across the TOML round-trip", () => {
    const path = join(codexDir(), "config.toml");
    mkdirSync(codexDir(), { recursive: true });
    writeFileSync(
      path,
      [
        "# a user comment",
        'approval_policy = "never"',
        "",
        "[model_providers.other]",
        'name = "Other"',
        'base_url = "https://example.test/v1"'
      ].join("\n")
    );

    installCodexAkashml({ baseUrl: BASE_URL, model: "Org/Model" });

    const config = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(config.approval_policy).toBe("never");
    expect((config.model_providers as Record<string, unknown>).other).toMatchObject({
      name: "Other",
      base_url: "https://example.test/v1"
    });
  });

  it("removes the akashml provider table and clears model/model_provider, returns removed", () => {
    installCodexAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    const result = removeCodexAkashml();
    expect(result.status).toBe("removed");
    const config = parse(readFileSync(result.path, "utf8")) as Record<string, unknown>;
    expect(config.model).toBeUndefined();
    expect(config.model_provider).toBeUndefined();
    expect(config.model_providers).toBeUndefined();
  });

  it("remove is absent when config.toml does not exist", () => {
    expect(removeCodexAkashml().status).toBe("absent");
  });

  it("remove is absent and leaves a foreign backend untouched when model_provider is not akashml", () => {
    const path = join(codexDir(), "config.toml");
    mkdirSync(codexDir(), { recursive: true });
    const original = ['model = "foreign/model"', 'model_provider = "openai"', "", "[model_providers.openai]", 'name = "OpenAI"'].join(
      "\n"
    );
    writeFileSync(path, original);

    const result = removeCodexAkashml();

    expect(result.status).toBe("absent");
    expect(readFileSync(path, "utf8")).toBe(original);
  });
});

describe("opencode akashml installer", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "axi-akml-oc-"));
    vi.stubEnv("XDG_CONFIG_HOME", join(home, ".config"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("fresh install writes provider.akashml and top-level model, key stays out of the file", () => {
    const result = installOpencodeAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    expect(result.status).toBe("installed");

    const raw = readFileSync(result.path, "utf8");
    expect(raw).not.toContain(API_KEY);
    expect(raw).not.toContain("akml-");

    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config.model).toBe("akashml/Org/Model");
    expect(config.provider).toMatchObject({
      akashml: {
        npm: "@ai-sdk/openai-compatible",
        name: "AkashML",
        options: { baseURL: `${BASE_URL}/v1`, apiKey: "{env:AKASHML_API_KEY}" },
        models: { "Org/Model": {} }
      }
    });
  });

  it("rerunning with the same model is unchanged", () => {
    installOpencodeAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    expect(installOpencodeAkashml({ baseUrl: BASE_URL, model: "Org/Model" }).status).toBe("unchanged");
  });

  it("changed model returns updated", () => {
    installOpencodeAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    const result = installOpencodeAkashml({ baseUrl: BASE_URL, model: "Org/New-Model" });
    expect(result.status).toBe("updated");
    const config = JSON.parse(readFileSync(result.path, "utf8")) as Record<string, unknown>;
    expect(config.model).toBe("akashml/Org/New-Model");
  });

  it("preserves foreign config", () => {
    const path = join(opencodeDir(), "opencode.json");
    mkdirSync(opencodeDir(), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        foreignTopLevel: "keep-me",
        provider: { other: { npm: "@ai-sdk/other", name: "Other" } }
      })
    );

    installOpencodeAkashml({ baseUrl: BASE_URL, model: "Org/Model" });

    const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(config.foreignTopLevel).toBe("keep-me");
    expect((config.provider as Record<string, unknown>).other).toMatchObject({ npm: "@ai-sdk/other", name: "Other" });
  });

  it("removes provider.akashml and resets top-level model, returns removed", () => {
    installOpencodeAkashml({ baseUrl: BASE_URL, model: "Org/Model" });
    const result = removeOpencodeAkashml();
    expect(result.status).toBe("removed");
    const config = JSON.parse(readFileSync(result.path, "utf8")) as Record<string, unknown>;
    expect(config.model).toBeUndefined();
    expect(config.provider).toBeUndefined();
  });

  it("remove is absent when opencode.json does not exist", () => {
    expect(removeOpencodeAkashml().status).toBe("absent");
  });

  it("remove is absent and leaves a foreign provider untouched when there is no provider.akashml", () => {
    const path = join(opencodeDir(), "opencode.json");
    mkdirSync(opencodeDir(), { recursive: true });
    const original = { model: "other/model", provider: { other: { npm: "@ai-sdk/other" } } };
    writeFileSync(path, JSON.stringify(original));

    const result = removeOpencodeAkashml();

    expect(result.status).toBe("absent");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(original);
  });
});
