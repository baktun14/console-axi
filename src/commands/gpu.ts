import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { filterGpuModels, gpuRow, sortGpuModels } from "../api/gpu-format.js";
import { action, anonContext } from "../context.js";
import { printResult } from "../output/render.js";

export function registerGpu(program: Command): void {
  const gpu = program.command("gpu").description("GPU marketplace availability and pricing (no key needed)");

  const listAction = action(async (opts: { vendor?: string; model?: string; available?: boolean }, command: Command) => {
    const { client } = anonContext(command);
    const data = unwrap(await client.GET("/v1/gpu-prices"));

    const models = sortGpuModels(filterGpuModels(data.models, opts));
    if (models.length === 0) {
      printResult({ gpus: "0 models matched", network: `${data.availability.available}/${data.availability.total} GPUs available` });
      return;
    }
    printResult(
      {
        network: `${data.availability.available}/${data.availability.total} GPUs available`,
        count: `${models.length} of ${data.models.length} models`,
        gpus: models.map(gpuRow)
      },
      {
        help: [
          "console-axi sdl init gpu --image <image> --gpu-model <model>",
          "console-axi sdl screen --cpu 1 --memory 2Gi --storage 10Gi --gpu 1 --gpu-model <model>"
        ]
      }
    );
  });

  // `gpu` with no subcommand behaves like `gpu list` (same flags on both).
  const withFilters = (cmd: Command): Command =>
    cmd
      .option("--vendor <vendor>", "filter by vendor, e.g. nvidia")
      .option("--model <model>", "filter by model substring, e.g. h100")
      .option("--available", "only models with GPUs available right now");
  withFilters(gpu).action(listAction);
  withFilters(gpu.command("list").description("List GPU models with availability and hourly market prices")).action(
    listAction
  );
}
