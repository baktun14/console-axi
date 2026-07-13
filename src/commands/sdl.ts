import type { Command } from "commander";

import { action, anonContext } from "../context.js";
import { AxiError, EXIT } from "../errors.js";
import { readFileOrStdin } from "../input.js";
import { printResult } from "../output/render.js";
import { buildRequirements, type ScreenRequirements, screenSupply, summarizeIncidents } from "../sdl/screen.js";
import { toYaml } from "../sdl/serialize.js";
import { summarizeSdl } from "../sdl/summary.js";
import { synthesizeSdl } from "../sdl/synthesize.js";
import { cpuUnits } from "../sdl/templates/common.js";
import { getTemplate, listTemplates } from "../sdl/templates/registry.js";
import type { InitOptions } from "../sdl/templates/types.js";
import type { SdlDoc } from "../sdl/types.js";
import { validateSdl } from "../sdl/validate.js";

export function registerSdl(program: Command): void {
  const sdl = program.command("sdl").description("Formulate, validate and probe deployment SDLs");

  registerTemplates(sdl);
  registerInit(sdl);
  registerValidate(sdl);
  registerScreen(sdl);
}

function registerTemplates(sdl: Command): void {
  sdl
    .command("scaffolds")
    // Back-compat: this was `sdl templates` before the Console catalog took the
    // `template` word (see the top-level `template` command group).
    .alias("templates")
    .description("List the local SDL scaffolds `sdl init` can generate")
    .action(
      action(() => {
        printResult(
          { scaffolds: listTemplates().map((t) => ({ name: t.name, description: t.description, params: t.params.join(" ") })) },
          { help: ["console-axi sdl init <scaffold> [flags]"] }
        );
      })
    );
}

function registerInit(sdl: Command): void {
  sdl
    .command("init <scaffold>")
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
            help: ["console-axi sdl scaffolds"]
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
            { help: [`console-axi sdl screen ${file}`, `console-axi deploy --sdl ${file} --deposit <usd>`] }
          );
          return;
        }
        printResult({ valid: false, errors }, { help: ["fix the errors above, then re-run `sdl validate`"] });
        process.exitCode = EXIT.USAGE;
      })
    );
}

function registerScreen(sdl: Command): void {
  sdl
    .command("screen [file]")
    .description("Probe the network for providers that could bid, from an SDL and/or resource flags (use - for stdin)")
    .option("--cpu <units>", "cpu units, e.g. 0.5 or 500m")
    .option("--memory <size>", "memory size, e.g. 512Mi, 2Gi")
    .option("--storage <size>", "storage size, e.g. 1Gi")
    .option("--gpu <n>", "gpu units")
    .option("--gpu-model <model>", "nvidia gpu model, e.g. a100")
    .option("--count <n>", "replica count")
    .option("--attribute <k=v>", "required placement attribute (repeatable)", collectKeyValue, [])
    .option("--signed-by <auditor>", "required auditor address (repeatable)", collectValue, [])
    .option("--reclamation-window <seconds>", "only consider providers with a reclamation window >= this many seconds")
    .action(
      action(async (file: string | undefined, opts: RawScreenOptions, command: Command) => {
        const initOpts = toInitOptions({ ...opts, env: [] });
        const hasResourceFlags =
          opts.cpu !== undefined ||
          opts.memory !== undefined ||
          opts.storage !== undefined ||
          opts.gpu !== undefined ||
          opts.gpuModel !== undefined ||
          opts.count !== undefined;

        if (!file && !hasResourceFlags) {
          throw new AxiError({
            code: "usage",
            message: "Provide an SDL file or resource flags (e.g. --cpu 2 --memory 4Gi) to screen.",
            help: ["console-axi sdl screen app.yml", "console-axi sdl screen --cpu 2 --memory 4Gi --gpu 1 --gpu-model a100"]
          });
        }

        // Resources: from the SDL, from flags alone (no file), or the SDL overridden by flags.
        const parsed = file ? loadValidSdl(file) : synthesizeSdl(initOpts);
        if (file && hasResourceFlags) applyResourceOverrides(parsed, initOpts);

        const requirements = mergeRequirements(buildRequirements(parsed), opts.attribute, opts.signedBy);
        const reclamationWindow =
          opts.reclamationWindow !== undefined ? parseIntFlag(opts.reclamationWindow, "--reclamation-window") : undefined;

        const { client } = anonContext(command);
        const matched = await screenSupply(client, parsed, { reclamationWindow, requirements });

        const providers = matched.map((p) => ({
          owner: p.owner,
          hostUri: p.hostUri,
          location: p.location ?? "unknown",
          organization: p.organization ?? "unknown",
          audited: p.isAudited,
          ...summarizeIncidents(p.incidents)
        }));

        const deployHelp = file
          ? `console-axi deploy --sdl ${file} --deposit <usd>`
          : "console-axi sdl init <scaffold> [flags] > app.yml";
        printResult(
          {
            count: `${matched.length} matching`,
            providers,
            note:
              matched.length > 0
                ? "Advisory only — providers may run custom bid scripts, so a match does not guarantee a bid."
                : "No providers currently match. Try lowering resources or relaxing --attribute / --signed-by."
          },
          { help: [deployHelp] }
        );
      })
    );
}

/** Load and validate an SDL file, throwing a usage error if it is invalid. */
function loadValidSdl(file: string): SdlDoc {
  const { valid, errors, parsed } = validateSdl(readFileOrStdin(file));
  if (!valid || !parsed) {
    throw new AxiError({
      code: "usage",
      message: `SDL is invalid: ${errors.map((e) => e.message).join("; ")}`,
      help: [`console-axi sdl validate ${file}`]
    });
  }
  return parsed;
}

/** Apply resource-flag overrides onto every compute profile of a parsed SDL (mainly for single-service SDLs). */
function applyResourceOverrides(sdl: SdlDoc, o: InitOptions): void {
  for (const profile of Object.values(sdl.profiles?.compute ?? {})) {
    const r = profile.resources;
    if (!r) continue;
    if (o.cpu !== undefined) r.cpu = { units: cpuUnits(o.cpu) };
    if (o.memory !== undefined) r.memory = { size: o.memory };
    if (o.storage !== undefined) r.storage = { size: o.storage };
    if (o.gpu !== undefined || o.gpuModel !== undefined) {
      r.gpu = { units: o.gpu ?? 1, attributes: { vendor: { nvidia: [{ model: o.gpuModel ?? "a100" }] } } };
    }
  }
  if (o.count !== undefined) {
    for (const svc of Object.values(sdl.deployment ?? {})) {
      for (const target of Object.values(svc)) target.count = o.count;
    }
  }
}

/** Merge `--attribute k=v` (upsert by key) and `--signed-by` (union into anyOf) onto SDL-derived requirements. */
function mergeRequirements(base: ScreenRequirements, attributes: string[], signedBy: string[]): ScreenRequirements {
  const attrs = [...(base.attributes ?? [])];
  for (const kv of attributes) {
    const idx = kv.indexOf("=");
    const key = kv.slice(0, idx);
    const value = kv.slice(idx + 1);
    const existing = attrs.findIndex((a) => a.key === key);
    if (existing >= 0) attrs[existing] = { key, value };
    else attrs.push({ key, value });
  }

  let sb = base.signedBy;
  if (signedBy.length > 0) {
    sb = { anyOf: [...new Set([...(sb?.anyOf ?? []), ...signedBy])], allOf: sb?.allOf ?? [] };
  }

  const req: ScreenRequirements = {};
  if (sb) req.signedBy = sb;
  if (attrs.length > 0) req.attributes = attrs;
  return req;
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

interface RawScreenOptions {
  cpu?: string;
  memory?: string;
  storage?: string;
  gpu?: string;
  gpuModel?: string;
  count?: string;
  attribute: string[];
  signedBy: string[];
  reclamationWindow?: string;
}

function collectKeyValue(value: string, previous: string[]): string[] {
  if (!value.includes("=")) {
    throw new AxiError({ code: "usage", message: `expected KEY=value, got "${value}".` });
  }
  return [...previous, value];
}

function collectValue(value: string, previous: string[]): string[] {
  return [...previous, value];
}
