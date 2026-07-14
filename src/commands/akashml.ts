import type { Command } from "commander";

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

/**
 * Top-level `akashml` command group (managed inference on Akash compute).
 * `login`/`logout`/`models` land here now; `chat` and `setup` are registered
 * as sibling subcommands by later tasks.
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
        if (opts.maxTokens !== undefined) req.max_tokens = Number(opts.maxTokens);
        if (opts.temperature !== undefined) req.temperature = Number(opts.temperature);

        const wantsReasoning =
          opts.effort !== undefined || opts.reasoningMaxTokens !== undefined || opts.showReasoning === true;
        if (wantsReasoning) {
          const reasoning: AkashmlReasoningConfig = {};
          if (opts.effort !== undefined) reasoning.effort = opts.effort;
          if (opts.reasoningMaxTokens !== undefined) reasoning.max_tokens = Number(opts.reasoningMaxTokens);
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
}

/** Accept both `Org/Model` and `Org--Model` id forms; normalize to slashed. */
function normalizeModelId(id: string): string {
  return id.includes("/") ? id : id.replace("--", "/");
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
