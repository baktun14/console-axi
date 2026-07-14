import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { filterGpuModels, type GpuModel, gpuRow, sortGpuModels } from "../api/gpu-format.js";
import { action, anonContext } from "../context.js";
import { printResult } from "../output/render.js";
import { screenGpuModel } from "../sdl/gpu-screen.js";

const VERIFY_CONCURRENCY = 6;
const FRESHNESS_NOTE =
  "Availability and prices refresh ~every 15 min. Use --verify for the real-time biddable-provider count (`live`), or `sdl screen` to probe supply for a full spec.";

interface GpuListOptions {
  vendor?: string;
  model?: string;
  available?: boolean;
  verify?: boolean;
}

export function registerGpu(program: Command): void {
  const gpu = program.command("gpu").description("GPU marketplace availability and pricing (no key needed)");

  const listAction = action(async (opts: GpuListOptions, command: Command) => {
    const { client } = anonContext(command);
    const data = unwrap(await client.GET("/v1/gpu-prices"));

    let models = sortGpuModels(filterGpuModels(data.models, opts));

    // Live verification: bid-screen each shown model (deduped by name), then —
    // when combined with --available — drop models with no live supply.
    let liveByModel: Map<string, number | null> | undefined;
    if (opts.verify) {
      liveByModel = await verifyModels(client, models);
      if (opts.available) models = models.filter((m) => (liveByModel!.get(m.model) ?? 0) > 0);
    }

    if (models.length === 0) {
      printResult({
        gpus: opts.verify ? "0 models with live supply" : "0 models matched",
        network: `${data.availability.available}/${data.availability.total} GPUs available`,
        note: FRESHNESS_NOTE
      });
      return;
    }
    printResult(
      {
        network: `${data.availability.available}/${data.availability.total} GPUs available`,
        count: `${models.length} of ${data.models.length} models`,
        gpus: models.map((m) => gpuRow(m, liveByModel ? (liveByModel.get(m.model) ?? null) : undefined)),
        note: FRESHNESS_NOTE
      },
      {
        help: [
          "console-axi sdl init gpu --image <image> --gpu-model <model>",
          "console-axi sdl screen --cpu 1 --memory 2Gi --storage 10Gi --gpu 1 --gpu-model <model>"
        ]
      }
    );
  });

  // `list` is the default subcommand, so bare `gpu` behaves like `gpu list`.
  // Options live on `list` only — duplicating them on the parent makes commander
  // drop the subcommand's parsed options (returns {}).
  gpu
    .command("list", { isDefault: true })
    .description("List GPU models with availability and hourly market prices")
    .option("--vendor <vendor>", "filter by vendor, e.g. nvidia")
    .option("--model <model>", "filter by model substring, e.g. h100")
    .option("--available", "only models available right now (live-verified when combined with --verify)")
    .option("--verify", "cross-check each shown model against real-time bid-screening (adds a `live` column)")
    .action(listAction);
}

/** Bid-screen each distinct model once (concurrency-capped); null marks a screening error. */
async function verifyModels(
  client: Parameters<typeof screenGpuModel>[0],
  models: GpuModel[]
): Promise<Map<string, number | null>> {
  const distinct = [...new Set(models.map((m) => m.model))];
  const counts = await mapLimit(distinct, VERIFY_CONCURRENCY, async (model) => {
    try {
      return await screenGpuModel(client, model);
    } catch {
      return null;
    }
  });
  return new Map(distinct.map((model, i) => [model, counts[i] ?? null]));
}

/** Run `fn` over `items` with at most `limit` in flight, preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
