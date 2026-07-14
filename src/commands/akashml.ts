import type { Command } from "commander";

import { type AkashmlModel, listModels } from "../akashml/client.js";
import {
  readStoredConfig,
  requireAkashmlAuth,
  resolveConfig,
  type ResolvedConfig,
  writeStoredConfig
} from "../config/config.js";
import { action } from "../context.js";
import { formatUsd } from "../output/price.js";
import { printResult } from "../output/render.js";

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
