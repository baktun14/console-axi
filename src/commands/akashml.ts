import type { Command } from "commander";

import { installClaudeAkashmlEnv, removeClaudeAkashmlEnv } from "../agents/akashml-claude.js";
import { installCodexAkashml, removeCodexAkashml } from "../agents/akashml-codex.js";
import { installOpencodeAkashml, removeOpencodeAkashml } from "../agents/akashml-opencode.js";
import {
  type AkashmlChatRequest,
  type AkashmlMessage,
  type AkashmlModel,
  type AkashmlReasoningConfig,
  chat,
  chatStream,
  listModels
} from "../akashml/client.js";
import {
  readStoredConfig,
  requireAkashmlAuth,
  resolveConfig,
  type ResolvedConfig,
  writeStoredConfig
} from "../config/config.js";
import { action } from "../context.js";
import { debugLog } from "../debug.js";
import { AxiError } from "../errors.js";
import { readFileOrStdin } from "../input.js";
import { formatUsd } from "../output/price.js";
import { isJsonOutput, printResult } from "../output/render.js";
import { mask } from "./config.js";

/** AkashML API keys are prefixed this way; enforced live by the probe, not client-side. */
const AKML_PREFIX = "akml-";

const NEXT_STEPS = ["console-axi akashml chat --model <id>", "console-axi akashml setup"];

interface LoginOptions {
  withKey: string;
  url?: string;
}

interface ModelsOptions {
  model?: string;
  tools?: boolean;
  reasoning?: boolean;
}

interface ChatOptions {
  model?: string;
  system?: string;
  maxTokens?: string;
  temperature?: string;
  /** Commander's --no-stream flag: defaults true, false when the flag is passed. */
  stream: boolean;
  effort?: string;
  reasoningMaxTokens?: string;
  showReasoning?: boolean;
}

type SetupAgent = "claude" | "codex" | "opencode";

interface SetupOptions {
  agent: string;
  model?: string;
  sonnet?: string;
  opus?: string;
  haiku?: string;
  project?: boolean;
  remove?: boolean;
  /** Commander's --no-verify flag: defaults true, false when the flag is passed. */
  verify: boolean;
}

/**
 * Top-level `akashml` command group (managed inference on Akash compute):
 * login/logout/models/chat/setup.
 */
export function registerAkashml(program: Command): void {
  const akashml = program.command("akashml").description("AkashML managed inference (models, chat, setup)");

  akashml
    .command("login")
    .description("Validate an AkashML API key and store it for future commands")
    .requiredOption("--with-key <key>", "AkashML API key (or set AKASHML_API_KEY)")
    .option("--url <url>", "override the AkashML base URL")
    .action(
      action(async (opts: LoginOptions) => {
        if (!opts.withKey.startsWith(AKML_PREFIX)) {
          process.stderr.write(
            `Warning: AkashML API keys usually start with "${AKML_PREFIX}"; continuing since the live check is authoritative.\n`
          );
        }

        const config = resolveConfig();
        const akashmlBaseUrl = opts.url ? opts.url.replace(/\/+$/, "") : config.akashmlBaseUrl;
        const probeConfig: ResolvedConfig = { ...config, akashmlApiKey: opts.withKey, akashmlBaseUrl };

        // Validate before persisting. listModels already translates non-2xx and
        // network failures into a well-formed AxiError (unauthorized, rate_limited,
        // etc.) — let it propagate as-is rather than collapsing every failure mode
        // into a generic "rejected" message.
        const models = await listModels(probeConfig);

        const stored = readStoredConfig();
        stored.akashmlApiKey = opts.withKey;
        if (opts.url) stored.akashmlBaseUrl = akashmlBaseUrl;
        writeStoredConfig(stored);

        printResult(
          { ok: true, akashmlBaseUrl, modelsAvailable: models.length },
          { help: ["console-axi akashml models"] }
        );
      })
    );

  akashml
    .command("logout")
    .description("Remove the stored AkashML API key (Console credentials are untouched)")
    .action(
      action(() => {
        const stored = readStoredConfig();
        if (stored.akashmlApiKey !== undefined) {
          delete stored.akashmlApiKey;
          writeStoredConfig(stored);
        }
        printResult({ ok: true, message: "Logged out of AkashML; stored key removed." });
      })
    );

  akashml
    .command("models")
    .description("List AkashML models available for chat")
    .option("--model <substring>", "filter by model id substring (case-insensitive)")
    .option("--tools", "only models that support tool calling")
    .option("--reasoning", "only models that support reasoning")
    .action(
      action(async (opts: ModelsOptions) => {
        const config = requireAkashmlAuth();
        const models = filterModels(await listModels(config), opts);

        if (models.length === 0) {
          printResult({ models: "0 matched" }, { help: NEXT_STEPS });
          return;
        }
        printResult({ models: models.map(modelRow) }, { help: NEXT_STEPS });
      })
    );

  akashml
    .command("chat [prompt...]")
    .description("One-shot chat completion against an AkashML model (streams by default)")
    .option("--model <id>", "AkashML model id (Org/Model or Org--Model form) — required")
    .option("--system <text>", "optional system message")
    .option("--max-tokens <n>", "maximum output tokens")
    .option("--temperature <n>", "sampling temperature")
    .option("--no-stream", "force a single non-streaming request with structured output")
    .option("--effort <level>", "reasoning effort: minimal|low|medium|high|xhigh")
    .option("--reasoning-max-tokens <n>", "reasoning token budget")
    .option("--show-reasoning", "stream reasoning deltas to stderr")
    .action(
      action(async (prompt: string[], opts: ChatOptions) => {
        if (!opts.model) {
          throw new AxiError({
            code: "usage",
            message: "Missing required option '--model <id>'.",
            help: ["console-axi akashml models"]
          });
        }

        const config = requireAkashmlAuth();
        const joined = prompt.join(" ");
        const content = joined === "" || joined === "-" ? readFileOrStdin("-") : joined;

        const messages: AkashmlMessage[] = [];
        if (opts.system) messages.push({ role: "system", content: opts.system });
        messages.push({ role: "user", content });

        const req: AkashmlChatRequest = { model: normalizeModelId(opts.model), messages };
        if (opts.maxTokens !== undefined) req.max_tokens = parseIntFlag(opts.maxTokens, "--max-tokens");
        if (opts.temperature !== undefined) req.temperature = parseFloatFlag(opts.temperature, "--temperature");

        const wantsReasoning =
          opts.effort !== undefined || opts.reasoningMaxTokens !== undefined || opts.showReasoning === true;
        if (wantsReasoning) {
          const reasoning: AkashmlReasoningConfig = {};
          if (opts.effort !== undefined) reasoning.effort = assertEffort(opts.effort);
          if (opts.reasoningMaxTokens !== undefined) {
            reasoning.max_tokens = parseIntFlag(opts.reasoningMaxTokens, "--reasoning-max-tokens");
          }
          if (!opts.showReasoning) reasoning.exclude = true;
          req.reasoning = reasoning;
        }

        if (!opts.stream || isJsonOutput()) {
          const completion = await chat(config, req);
          const message = completion.choices[0]?.message;
          const reasoningText = message?.reasoning_content ?? message?.reasoning;
          const result: Record<string, unknown> = {
            model: completion.model,
            content: message?.content ?? ""
          };
          if (reasoningText) result.reasoning = reasoningText;
          result.finishReason = completion.choices[0]?.finish_reason;
          result.usage = completion.usage;
          printResult(result);
          return;
        }

        const { usage, finishReason } = await chatStream(config, req, (delta) => {
          if (delta.content) process.stdout.write(delta.content);
          if (opts.showReasoning) {
            const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
            if (reasoningDelta) process.stderr.write(reasoningDelta);
          }
        });
        process.stdout.write("\n");
        debugLog(
          "akashml",
          `usage=${JSON.stringify(usage ?? {})} finishReason=${finishReason ?? "n/a"}`
        );
      })
    );

  akashml
    .command("setup")
    .description("Configure claude, codex, or opencode to use AkashML as the inference backend")
    .option("--agent <agent>", "claude | codex | opencode")
    .option("--model <id>", "AkashML model id (Org/Model or Org--Model form)")
    .option("--sonnet <id>", "override the Sonnet-tier model (claude only, defaults to --model)")
    .option("--opus <id>", "override the Opus-tier model (claude only, defaults to --model)")
    .option("--haiku <id>", "override the Haiku-tier model (claude only, defaults to --model)")
    .option("--project", "write ./.claude/settings.local.json instead of the global settings (claude only)", false)
    .option("--remove", "remove the AkashML configuration for this agent instead of installing it", false)
    .option("--no-verify", "skip validating --model id(s) against live AkashML models")
    .action(
      action(async (opts: SetupOptions) => {
        const agent = assertAgent(opts.agent);
        assertClaudeOnlyFlags(agent, opts);

        if (opts.remove) {
          const removed = dispatchRemove(agent, { project: opts.project });
          printResult(
            { ok: true, agent, ...removed },
            { help: ["console-axi akashml setup --agent " + agent + " --model <id>", "console-axi uninstall"] }
          );
          return;
        }

        if (!opts.model) {
          throw new AxiError({
            code: "usage",
            message: "Missing required option '--model <id>'.",
            help: ["console-axi akashml models"]
          });
        }

        const config = requireAkashmlAuth();
        const model = normalizeModelId(opts.model);
        const sonnet = normalizeModelId(opts.sonnet ?? opts.model);
        const opus = normalizeModelId(opts.opus ?? opts.model);
        const haiku = normalizeModelId(opts.haiku ?? opts.model);

        const idsToValidate = agent === "claude" ? [...new Set([model, sonnet, opus, haiku])] : [model];
        await assertModelsKnown(config, idsToValidate, opts.verify);

        if (agent === "claude") {
          const installed = installClaudeAkashmlEnv({
            baseUrl: config.akashmlBaseUrl,
            apiKey: config.akashmlApiKey,
            sonnet,
            opus,
            haiku,
            project: opts.project
          });
          printResult(
            {
              ok: true,
              agent,
              settings: installed.path,
              status: installed.status,
              note: "AkashML credentials were written into that settings file (ANTHROPIC_AUTH_TOKEN)."
            },
            { help: [`console-axi akashml setup --agent claude --remove${opts.project ? " --project" : ""}`] }
          );
          return;
        }

        const install = agent === "codex" ? installCodexAkashml : installOpencodeAkashml;
        const installed = install({ baseUrl: config.akashmlBaseUrl, model });
        printResult(
          {
            ok: true,
            agent,
            path: installed.path,
            status: installed.status,
            note: `export AKASHML_API_KEY=${mask(config.akashmlApiKey)}  # set the real key in your shell profile; it is never written to the ${agent} config file`
          },
          { help: [`console-axi akashml setup --agent ${agent} --remove`] }
        );
      })
    );
}

/** Accept both `Org/Model` and `Org--Model` id forms; normalize to slashed. */
function normalizeModelId(id: string): string {
  return id.includes("/") ? id : id.replace("--", "/");
}

const REASONING_EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;

/** Validate --effort against the accepted reasoning-effort levels. */
function assertEffort(effort: string): string {
  if (!(REASONING_EFFORT_LEVELS as readonly string[]).includes(effort)) {
    throw new AxiError({
      code: "usage",
      message: `--effort must be one of ${REASONING_EFFORT_LEVELS.join("|")}, got "${effort}".`
    });
  }
  return effort;
}

/** Parse a non-negative integer flag (e.g. token counts); reject non-numeric input. */
function parseIntFlag(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new AxiError({ code: "usage", message: `${flag} must be a non-negative integer, got "${value}".` });
  }
  return n;
}

/** Parse a finite numeric flag (e.g. temperature); reject non-numeric input. */
function parseFloatFlag(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new AxiError({ code: "usage", message: `${flag} must be a number, got "${value}".` });
  }
  return n;
}

function filterModels(models: AkashmlModel[], filters: ModelsOptions): AkashmlModel[] {
  const substring = filters.model?.toLowerCase();
  return models.filter((m) => {
    if (substring && !m.id.toLowerCase().includes(substring)) return false;
    if (filters.tools && !m.supported_features.includes("tools")) return false;
    if (filters.reasoning && !m.supported_features.includes("reasoning")) return false;
    return true;
  });
}

function modelRow(m: AkashmlModel): Record<string, unknown> {
  return {
    id: m.id,
    ctx: m.context_length,
    maxOut: m.max_output_length,
    inUsd: formatUsd(m.pricing.input),
    outUsd: formatUsd(m.pricing.output),
    features: m.supported_features.join(", "),
    quant: m.quantization
  };
}

function assertAgent(agent: string | undefined): SetupAgent {
  if (!agent) {
    throw new AxiError({ code: "usage", message: "Missing required option '--agent <agent>'." });
  }
  const lower = agent.toLowerCase();
  if (lower !== "claude" && lower !== "codex" && lower !== "opencode") {
    throw new AxiError({ code: "usage", message: `Unknown --agent "${agent}". Use claude, codex, or opencode.` });
  }
  return lower;
}

function assertClaudeOnlyFlags(agent: SetupAgent, opts: SetupOptions): void {
  const usesClaudeOnlyFlags = opts.sonnet !== undefined || opts.opus !== undefined || opts.haiku !== undefined || opts.project;
  if (agent !== "claude" && usesClaudeOnlyFlags) {
    throw new AxiError({
      code: "usage",
      message: "--sonnet, --opus, --haiku, and --project are only valid with --agent claude."
    });
  }
}

/** Validate every provided model id against live AkashML models unless --no-verify was passed. */
async function assertModelsKnown(
  config: ResolvedConfig & { akashmlApiKey: string },
  ids: string[],
  verify: boolean
): Promise<void> {
  if (!verify) return;
  const models = await listModels(config);
  const known = new Set(models.map((m) => m.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new AxiError({
      code: "usage",
      message: `Unknown AkashML model id(s): ${unknown.join(", ")}`,
      help: ["console-axi akashml models"]
    });
  }
}

function dispatchRemove(agent: SetupAgent, opts: { project?: boolean }): { path: string; status: string } {
  if (agent === "claude") return removeClaudeAkashmlEnv({ project: opts.project });
  if (agent === "codex") return removeCodexAkashml();
  return removeOpencodeAkashml();
}
