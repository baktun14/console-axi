import type { Command } from "commander";

import { createApiClient, unwrap } from "../api/client.js";
import { type RawDeploymentEntry, summarizeDeployment } from "../api/deployment-format.js";
import { getCurrentUser } from "../api/user.js";
import { resolveConfig } from "../config/config.js";
import { action, overridesFrom } from "../context.js";
import { formatUsd } from "../output/price.js";
import { printResult } from "../output/render.js";

const DESCRIPTION = "Deploy and manage Akash workloads via the Console managed wallet";

export function registerHome(program: Command): void {
  program
    .command("home", { hidden: true, isDefault: false })
    .description("Show status and recent deployments (the default no-args view)")
    .option("--trimmed", "compact variant for session hooks (auth + counts + top 3)")
    .action(
      action(async (opts: { trimmed?: boolean }, command: Command) => {
        await renderHome(command, { trimmed: opts.trimmed ?? false });
      })
    );
}

/** Shared by the `home` command and the `setup` session hook. */
export async function renderHome(command: Command, options: { trimmed: boolean }): Promise<void> {
  const config = resolveConfig(overridesFrom(command));

  if (!config.apiKey) {
    printResult(
      { bin: "console-axi", description: DESCRIPTION, auth: "not signed in" },
      { help: ["console-axi login --with-key <key>"] }
    );
    return;
  }

  const client = createApiClient(config);
  const [user, balancesRes, listRes] = await Promise.all([
    getCurrentUser(client),
    client.GET("/v1/balances"),
    client.GET("/v1/deployments", { params: { query: { limit: 50 } } })
  ]);
  const balances = unwrap(balancesRes).data;
  const list = unwrap(listRes).data;

  const entries = (list.deployments ?? []) as RawDeploymentEntry[];
  const active = entries.filter((e) => e.deployment.state === "active");
  const total = list.pagination?.total ?? entries.length;
  const topN = options.trimmed ? 3 : 5;
  const recent = (active.length > 0 ? active : entries).slice(0, topN).map(summarizeDeployment);

  const result: Record<string, unknown> = {
    bin: "console-axi",
    description: DESCRIPTION,
    auth: `${user.username} (api-key)`,
    wallet: `${formatUsd(balances.balance)} available of ${formatUsd(balances.total)}`,
    deployments: `${active.length} active of ${total} total`
  };

  if (recent.length > 0) {
    result.recent = recent;
  } else {
    result.recent = "0 deployments found";
  }

  const help = options.trimmed
    ? ["console-axi", "console-axi deploy --sdl <file> --deposit <usd>"]
    : [
        "console-axi deploy --sdl <file> --deposit <usd>",
        "console-axi deployment list",
        "console-axi deployment status <dseq>",
        "console-axi wallet balance"
      ];

  printResult(result, { help });
}
