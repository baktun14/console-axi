import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { action, anonContext } from "../context.js";
import { AxiError, EXIT } from "../errors.js";
import { readFileOrStdin } from "../input.js";
import { formatUsd } from "../output/price.js";
import { printResult } from "../output/render.js";
import { deriveResources, type ScreeningResource } from "../sdl/resources.js";
import { toYaml } from "../sdl/serialize.js";
import { summarizeSdl } from "../sdl/summary.js";
import { getTemplate, listTemplates } from "../sdl/templates/registry.js";
import type { InitOptions } from "../sdl/templates/types.js";
import type { SdlDoc } from "../sdl/types.js";
import { validateSdl } from "../sdl/validate.js";

export function registerSdl(program: Command): void {
  const sdl = program.command("sdl").description("Formulate, validate and price-check deployment SDLs");

  registerTemplates(sdl);
  registerInit(sdl);
  registerValidate(sdl);
  registerEstimate(sdl);
}

function registerTemplates(sdl: Command): void {
  sdl
    .command("templates")
    .description("List the SDL scaffolds `sdl init` can generate")
    .action(
      action(() => {
        printResult(
          { templates: listTemplates().map((t) => ({ name: t.name, description: t.description, params: t.params.join(" ") })) },
          { help: ["console-axi sdl init <template> [flags]"] }
        );
      })
    );
}

function registerInit(sdl: Command): void {
  sdl
    .command("init <template>")
    .description("Generate an SDL from a template; prints YAML to stdout (redirect to a file)")
    .option("--image <ref>", "container image (must be tagged, e.g. nginx:1.27)")
    .option("--port <n>", "container port to expose")
    .option("--as <n>", "external port (defaults to --port)")
    .option("--cpu <units>", "cpu units, e.g. 0.5 or 500m")
    .option("--memory <size>", "memory size, e.g. 512Mi, 2Gi")
    .option("--storage <size>", "storage size, e.g. 1Gi")
    .option("--count <n>", "replica count")
    .option("--price <uact>", "max price per block in uact")
    .option("--env <k=v>", "environment variable (repeatable)", collectKeyValue, [])
    .option("--gpu <n>", "gpu units (gpu template)")
    .option("--gpu-model <model>", "nvidia gpu model, e.g. a100 (gpu template)")
    .option("--name <name>", "service name")
    .action(
      action((templateName: string, opts: RawInitOptions) => {
        const template = getTemplate(templateName);
        if (!template) {
          throw new AxiError({
            code: "usage",
            message: `Unknown template "${templateName}".`,
            help: ["console-axi sdl templates"]
          });
        }

        const yaml = toYaml(template.build(toInitOptions(opts)));
        // Safety net: a template should never emit invalid SDL.
        const { valid, errors } = validateSdl(yaml);
        if (!valid) {
          throw new AxiError({
            code: "internal",
            message: `Generated SDL failed validation: ${errors.map((e) => e.message).join("; ")}`
          });
        }
        process.stdout.write(yaml.endsWith("\n") ? yaml : `${yaml}\n`);
      })
    );
}

function registerValidate(sdl: Command): void {
  sdl
    .command("validate <file>")
    .description("Validate an SDL offline (use - for stdin)")
    .action(
      action((file: string) => {
        const { valid, errors, parsed } = validateSdl(readFileOrStdin(file));
        if (valid && parsed) {
          printResult(
            { valid: true, summary: summarizeSdl(parsed) },
            { help: [`console-axi sdl estimate ${file}`, `console-axi deploy --sdl ${file} --deposit <usd>`] }
          );
          return;
        }
        printResult({ valid: false, errors }, { help: ["fix the errors above, then re-run `sdl validate`"] });
        process.exitCode = EXIT.USAGE;
      })
    );
}

function registerEstimate(sdl: Command): void {
  sdl
    .command("estimate <file>")
    .description("Estimate monthly cost and provider availability for an SDL (use - for stdin)")
    .action(
      action(async (file: string, _opts: unknown, command: Command) => {
        const { valid, errors, parsed } = validateSdl(readFileOrStdin(file));
        if (!valid || !parsed) {
          throw new AxiError({
            code: "usage",
            message: `SDL is invalid: ${errors.map((e) => e.message).join("; ")}`,
            help: [`console-axi sdl validate ${file}`]
          });
        }

        const { pricing, screening } = deriveResources(parsed);
        const { client } = anonContext(command);

        const priceData = unwrap(await client.POST("/v1/pricing", { body: pricing }));
        const price = firstEstimate(priceData);

        printResult(
          {
            cost: {
              akash: `${formatUsd(price.akash)}/mo`,
              aws: `${formatUsd(price.aws)}/mo`,
              gcp: `${formatUsd(price.gcp)}/mo`,
              azure: `${formatUsd(price.azure)}/mo`
            },
            resources: {
              cpu: `${pricing.cpu / 1000} cores`,
              memory: bytesToHuman(pricing.memory),
              storage: bytesToHuman(pricing.storage)
            },
            providers: await screenProviders(client, parsed, screening)
          },
          { help: [`console-axi deploy --sdl ${file} --deposit <usd>`] }
        );
      })
    );
}

/** Bid-screening is a best-effort extra: on any failure, note it rather than failing the estimate. */
async function screenProviders(
  client: ReturnType<typeof anonContext>["client"],
  sdl: SdlDoc,
  screening: ScreeningResource[]
): Promise<number | string> {
  try {
    const data = unwrap(
      await client.POST("/v1/bid-screening", {
        body: { requirements: buildRequirements(sdl), resources: screening, timezone: systemTimezone() }
      })
    ) as { providers?: unknown[] };
    return data.providers?.length ?? 0;
  } catch (e) {
    return e instanceof AxiError ? `screening unavailable: ${e.message}` : "screening unavailable";
  }
}

interface Estimate {
  akash: number;
  aws: number;
  gcp: number;
  azure: number;
}

/** The pricing endpoint returns a single estimate for a single spec, or an array for an array of specs. */
function firstEstimate(data: unknown): Estimate {
  const entry = Array.isArray(data) ? data[0] : data;
  const e = (entry ?? {}) as Partial<Estimate>;
  return { akash: e.akash ?? 0, aws: e.aws ?? 0, gcp: e.gcp ?? 0, azure: e.azure ?? 0 };
}

function buildRequirements(sdl: SdlDoc): { signedBy?: { anyOf: string[]; allOf: string[] }; attributes?: Array<{ key: string; value: string }> } {
  const attributes: Array<{ key: string; value: string }> = [];
  let signedBy: { anyOf: string[]; allOf: string[] } | undefined;

  for (const placement of Object.values(sdl.profiles?.placement ?? {})) {
    for (const [key, value] of Object.entries(placement.attributes ?? {})) {
      attributes.push({ key, value: String(value) });
    }
    if (!signedBy && placement.signedBy) {
      signedBy = { anyOf: placement.signedBy.anyOf ?? [], allOf: placement.signedBy.allOf ?? [] };
    }
  }

  const req: { signedBy?: { anyOf: string[]; allOf: string[] }; attributes?: Array<{ key: string; value: string }> } = {};
  if (signedBy) req.signedBy = signedBy;
  if (attributes.length > 0) req.attributes = attributes;
  return req;
}

function systemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ---- option parsing -------------------------------------------------------

interface RawInitOptions {
  image?: string;
  port?: string;
  as?: string;
  cpu?: string;
  memory?: string;
  storage?: string;
  count?: string;
  price?: string;
  env: string[];
  gpu?: string;
  gpuModel?: string;
  name?: string;
}

function toInitOptions(o: RawInitOptions): InitOptions {
  return {
    ...(o.name ? { name: o.name } : {}),
    ...(o.image ? { image: o.image } : {}),
    ...(o.port !== undefined ? { port: parseIntFlag(o.port, "--port") } : {}),
    ...(o.as !== undefined ? { as: parseIntFlag(o.as, "--as") } : {}),
    ...(o.cpu ? { cpu: o.cpu } : {}),
    ...(o.memory ? { memory: o.memory } : {}),
    ...(o.storage ? { storage: o.storage } : {}),
    ...(o.count !== undefined ? { count: parseIntFlag(o.count, "--count") } : {}),
    ...(o.price !== undefined ? { price: parseIntFlag(o.price, "--price") } : {}),
    ...(o.env.length > 0 ? { env: o.env } : {}),
    ...(o.gpu !== undefined ? { gpu: parseIntFlag(o.gpu, "--gpu") } : {}),
    ...(o.gpuModel ? { gpuModel: o.gpuModel } : {})
  };
}

function parseIntFlag(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new AxiError({ code: "usage", message: `${flag} must be a non-negative integer, got "${value}".` });
  }
  return n;
}

function collectKeyValue(value: string, previous: string[]): string[] {
  if (!value.includes("=")) {
    throw new AxiError({ code: "usage", message: `--env must be KEY=value, got "${value}".` });
  }
  return [...previous, value];
}

function bytesToHuman(bytes: number): string {
  const GiB = 1024 ** 3;
  const MiB = 1024 ** 2;
  if (bytes >= GiB) return `${round(bytes / GiB)}Gi`;
  if (bytes >= MiB) return `${round(bytes / MiB)}Mi`;
  return `${bytes}B`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
