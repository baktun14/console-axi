import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { filterProviders, formatUptime, gpuSummary, providerRow, sortProviders } from "../api/provider-format.js";
import { action, anonContext } from "../context.js";
import { printResult } from "../output/render.js";
import { cpuCores, humanBytes } from "../output/units.js";

export function registerProvider(program: Command): void {
  const provider = program.command("provider").description("Browse marketplace providers (no key needed)");

  provider
    .command("list")
    .description("List online providers, best uptime first")
    .option("--gpu-model <model>", "only providers offering this GPU model (substring)")
    .option("--region <region>", "filter by region, e.g. eu-west or us")
    .option("--audited", "only audited providers")
    .option("--trial", "only providers accepting trial deployments")
    .option("--limit <n>", "max rows", "20")
    .option("--all", "include offline providers and ignore --limit")
    .action(
      action(
        async (
          opts: { gpuModel?: string; region?: string; audited?: boolean; trial?: boolean; limit: string; all?: boolean },
          command: Command
        ) => {
          const { client } = anonContext(command);
          const data = unwrap(
            await client.GET("/v1/providers", {
              params: { query: opts.trial ? { scope: "trial" as const } : {} }
            })
          );

          const matched = sortProviders(filterProviders(data, opts));
          const limit = opts.all ? matched.length : Number(opts.limit);
          const rows = matched.slice(0, limit);
          if (rows.length === 0) {
            printResult(
              { providers: "0 matched", online: `${data.filter((p) => p.isOnline).length} of ${data.length} online` },
              { help: ["console-axi provider list --all", "console-axi provider regions"] }
            );
            return;
          }
          printResult(
            {
              count: `${rows.length} shown of ${matched.length} matched (${data.filter((p) => p.isOnline).length} online)`,
              providers: rows.map(providerRow)
            },
            {
              help: [
                "console-axi provider view <owner>",
                "console-axi sdl screen --cpu 1 --memory 1Gi --storage 1Gi"
              ]
            }
          );
        }
      )
    );

  provider
    .command("view <address>")
    .description("Provider details: uptime, capacity, GPUs")
    .action(
      action(async (address: string, _opts: unknown, command: Command) => {
        const { client } = anonContext(command);
        const p = unwrap(await client.GET("/v1/providers/{address}", { params: { path: { address } } }));

        const stats = (
          p as unknown as {
            stats?: {
              cpu: { active: number; available: number; pending: number };
              gpu: { active: number; available: number; pending: number };
              memory: { active: number; available: number; pending: number };
              storage: { ephemeral: { active: number; available: number; pending: number } };
            };
          }
        ).stats;

        const result: Record<string, unknown> = {
          owner: p.owner,
          org: p.organization ?? p.name ?? "-",
          hostUri: p.hostUri,
          region: p.locationRegion ?? p.ipRegion ?? "-",
          country: p.ipCountry ?? "-",
          online: p.isOnline,
          audited: p.isAudited,
          tier: p.tier ?? "-",
          uptime: {
            "1d": formatUptime(p.uptime1d),
            "7d": formatUptime(p.uptime7d),
            "30d": formatUptime(p.uptime30d)
          },
          leases: p.leaseCount ?? 0
        };
        if (stats) {
          result.capacity = {
            cpu: `${cpuCores(stats.cpu.available)} cores free of ${cpuCores(stats.cpu.active + stats.cpu.available + stats.cpu.pending)}`,
            gpu: `${stats.gpu.available} free of ${stats.gpu.active + stats.gpu.available + stats.gpu.pending}`,
            memory: `${humanBytes(stats.memory.available)} free`,
            storage: `${humanBytes(stats.storage.ephemeral.available)} free`
          };
        }
        if (p.gpuModels.length > 0) result.gpus = gpuSummary(p.gpuModels);
        if (p.website) result.website = p.website;

        printResult(result, {
          help: [`console-axi sdl screen --cpu 1 --memory 1Gi --storage 1Gi`, "console-axi gpu list"]
        });
      })
    );

  provider
    .command("regions")
    .description("List provider regions for --region / placement attributes")
    .action(
      action(async (_opts: unknown, command: Command) => {
        const { client } = anonContext(command);
        const data = unwrap(await client.GET("/v1/provider-regions"));
        printResult(
          {
            regions: data.map((r) => ({ region: r.key, description: r.description, providers: r.providers.length }))
          },
          { help: ["console-axi provider list --region <region>"] }
        );
      })
    );

  provider
    .command("auditors")
    .description("List auditors for sdl screen --signed-by / SDL signedBy")
    .action(
      action(async (_opts: unknown, command: Command) => {
        const { client } = anonContext(command);
        const data = unwrap(await client.GET("/v1/auditors"));
        printResult(
          { auditors: data.map((a) => ({ name: a.name, address: a.address, website: a.website })) },
          { help: ["console-axi sdl screen <file> --signed-by <address>"] }
        );
      })
    );
}
