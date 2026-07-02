import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { getUserId } from "../api/user.js";
import { action, authedContext } from "../context.js";
import { AxiError } from "../errors.js";
import { formatUsd } from "../output/price.js";
import { printResult } from "../output/render.js";

interface RawWallet {
  address?: string | null;
  creditAmount: number;
  isTrialing: boolean;
}

function parseBool(value: string, flag: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AxiError({ code: "usage", message: `${flag} must be true or false, got "${value}".` });
}

/** Resolve the primary managed-wallet address (needed by usage history). */
async function resolveWalletAddress(client: ReturnType<typeof authedContext>["client"]): Promise<string> {
  const userId = await getUserId(client);
  const wallets = unwrap(await client.GET("/v1/wallets", { params: { query: { userId } } })).data as RawWallet[];
  const address = wallets.find((w) => w.address)?.address;
  if (!address) {
    throw new AxiError({ code: "not_found", message: "No managed wallet with an on-chain address was found." });
  }
  return address;
}

export function registerWallet(program: Command): void {
  const wallet = program.command("wallet").description("Managed wallet balance, settings and cost");

  const listAction = action(async (_opts: unknown, command: Command) => {
    const { client } = authedContext(command);
    const userId = await getUserId(client);
    const wallets = unwrap(await client.GET("/v1/wallets", { params: { query: { userId } } })).data as RawWallet[];
    if (wallets.length === 0) {
      printResult({ wallets: "0 found" });
      return;
    }
    printResult({
      wallets: wallets.map((w) => ({
        address: w.address ?? "-",
        balance: formatUsd(w.creditAmount),
        trialing: w.isTrialing
      }))
    });
  });

  // `wallet` with no subcommand behaves like `wallet list`.
  wallet.action(listAction);
  wallet.command("list").description("List managed wallets").action(listAction);

  wallet
    .command("balance")
    .description("Available / in-deployment / total balance in USD")
    .action(
      action(async (_opts: unknown, command: Command) => {
        const { client } = authedContext(command);
        const b = unwrap(await client.GET("/v1/balances")).data;
        printResult({
          available: formatUsd(b.balance),
          inDeployments: formatUsd(b.deployments),
          total: formatUsd(b.total)
        });
      })
    );

  wallet
    .command("settings")
    .description("View or change wallet settings (auto-reload is the only headless way to add funds)")
    .option("--auto-reload <bool>", "enable/disable automatic top-up (true|false)")
    .action(
      action(async (opts: { autoReload?: string }, command: Command) => {
        const { client } = authedContext(command);
        if (opts.autoReload !== undefined) {
          const autoReloadEnabled = parseBool(opts.autoReload, "--auto-reload");
          unwrap(await client.PUT("/v1/wallet-settings", { body: { data: { autoReloadEnabled } } }));
          printResult({ ok: true, autoReloadEnabled });
          return;
        }
        const data = unwrap(await client.GET("/v1/wallet-settings")).data;
        printResult(
          { autoReloadEnabled: data.autoReloadEnabled },
          { help: ["console-axi wallet settings --auto-reload true"] }
        );
      })
    );

  wallet
    .command("cost")
    .description("Estimated weekly cost (USD) across auto-top-up deployments")
    .action(
      action(async (_opts: unknown, command: Command) => {
        const { client } = authedContext(command);
        const data = unwrap(await client.GET("/v1/weekly-cost")).data;
        printResult({ weeklyCost: formatUsd(data.weeklyCost) });
      })
    );
}

export function registerUsage(program: Command): void {
  program
    .command("usage")
    .description("Historical spend and active-deployment counts")
    .option("--from <date>", "start date (YYYY-MM-DD)")
    .option("--to <date>", "end date (YYYY-MM-DD)")
    .action(
      action(async (opts: { from?: string; to?: string }, command: Command) => {
        const { client } = authedContext(command);
        const address = await resolveWalletAddress(client);
        const query: { address: string; startDate?: string; endDate?: string } = { address };
        if (opts.from) query.startDate = opts.from;
        if (opts.to) query.endDate = opts.to;
        const rows = unwrap(await client.GET("/v1/usage/history", { params: { query } })) as Array<{
          date: string;
          activeDeployments: number;
          dailyUsdcSpent?: number;
          totalUsdcSpent?: number;
        }>;

        if (rows.length === 0) {
          printResult({ usage: "0 records found" });
          return;
        }
        const last = rows[rows.length - 1];
        printResult({
          totalSpent: formatUsd(last?.totalUsdcSpent ?? 0),
          days: rows.length,
          history: rows.map((r) => ({
            date: r.date,
            deployments: r.activeDeployments,
            spent: formatUsd(r.dailyUsdcSpent ?? 0)
          }))
        });
      })
    );
}
