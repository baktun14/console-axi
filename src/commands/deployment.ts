import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import {
  formatUsd,
  type RawDeploymentEntry,
  type RawLease,
  statusSnapshot,
  summarizeDeployment,
  uactToUsd
} from "../api/deployment-format.js";
import { action, authedContext } from "../context.js";
import { saveManifest } from "../deploy/manifest-store.js";
import { AxiError } from "../errors.js";
import { readFileOrStdin } from "../input.js";
import { consoleDeploymentUrl } from "../output/console-url.js";
import { blockPriceToUsdPerMonth, MIN_DEPOSIT_USD } from "../output/price.js";
import { printResult } from "../output/render.js";
import { assertSdlValid } from "../sdl/validate.js";

function parseUsd(value: string, flag: string, min = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AxiError({ code: "usage", message: `${flag} must be a positive USD amount, got "${value}".` });
  }
  if (n < min) {
    throw new AxiError({ code: "usage", message: `${flag} must be at least ${formatUsd(min)} (minimum deposit), got ${formatUsd(n)}.` });
  }
  return n;
}

interface Coin {
  denom: string;
  amount: string;
}

function sumCoinsUsd(coins: Coin[] | undefined): number {
  if (!coins) return 0;
  return coins.reduce((sum, c) => sum + uactToUsd(c.amount), 0);
}

export function registerDeployment(program: Command): void {
  const deployment = program.command("deployment").description("Manage deployments");

  deployment
    .command("list")
    .description("List deployments (status omitted; use `deployment status <dseq>`)")
    .option("--skip <n>", "offset for pagination", "0")
    .option("--limit <n>", "page size", "20")
    .action(
      action(async (opts: { skip: string; limit: string }, command: Command) => {
        const { client } = authedContext(command);
        const query = { skip: Number(opts.skip), limit: Number(opts.limit) };
        const data = unwrap(await client.GET("/v1/deployments", { params: { query } })).data;
        const entries = (data.deployments ?? []) as RawDeploymentEntry[];
        const total = data.pagination?.total ?? entries.length;

        if (entries.length === 0) {
          printResult({ deployments: "0 found", count: `0 of ${total} total` });
          return;
        }
        printResult(
          {
            count: `${entries.length} of ${total} total`,
            deployments: entries.map(summarizeDeployment)
          },
          { help: ["console-axi deployment status <dseq>", "console-axi deployment view <dseq>"] }
        );
      })
    );

  deployment
    .command("view <dseq>")
    .description("Show a deployment's state, escrow (USD) and leases")
    .action(
      action(async (dseq: string, _opts: unknown, command: Command) => {
        const { client, config } = authedContext(command);
        const data = unwrap(await client.GET("/v1/deployments/{dseq}", { params: { path: { dseq } } }), {
          dseq
        }).data;
        const leases = (data.leases ?? []) as RawLease[];
        const deposited = sumCoinsUsd(data.escrow_account?.state?.funds as Coin[] | undefined);
        const spent = sumCoinsUsd(data.escrow_account?.state?.transferred as Coin[] | undefined);

        printResult(
          {
            dseq: data.deployment.id.dseq,
            console: consoleDeploymentUrl(config.consoleWebUrl, data.deployment.id.dseq),
            state: data.deployment.state,
            createdAt: data.deployment.created_at,
            escrow: {
              deposited: formatUsd(deposited),
              spent: formatUsd(spent),
              remaining: formatUsd(Math.max(0, deposited - spent))
            },
            leases: leases.map((l) => ({
              provider: l.id.provider,
              gseq: l.id.gseq,
              oseq: l.id.oseq,
              state: l.state,
              cost: blockPriceToUsdPerMonth(l.price.amount)
            }))
          },
          {
            help: [
              `console-axi deployment status ${dseq}`,
              `console-axi logs ${dseq} --tail 100`,
              `console-axi deployment close ${dseq}`
            ]
          }
        );
      })
    );

  deployment
    .command("status <dseq>")
    .description("Live readiness, service URIs and forwarded ports")
    .action(
      action(async (dseq: string, _opts: unknown, command: Command) => {
        const { client, config } = authedContext(command);
        const data = unwrap(await client.GET("/v1/deployments/{dseq}", { params: { path: { dseq } } }), {
          dseq
        }).data;
        const { result, ready } = statusSnapshot(dseq, consoleDeploymentUrl(config.consoleWebUrl, dseq), data);

        printResult(result, {
          help: ready
            ? [`console-axi logs ${dseq} --tail 100`]
            : [`console-axi deployment status ${dseq}`, `console-axi events ${dseq}`]
        });
      })
    );

  deployment
    .command("create")
    .description("Create a deployment on-chain (managed wallet signs server-side)")
    .requiredOption("--sdl <file|->", "SDL YAML file path, or - for stdin")
    .requiredOption("--deposit <usd>", "deposit amount in USD (minimum 0.5)")
    .option("--skip-validation", "skip client-side SDL validation before creating the deployment")
    .action(
      action(async (opts: { sdl: string; deposit: string; skipValidation?: boolean }, command: Command) => {
        const { client, config } = authedContext(command);
        const sdl = readFileOrStdin(opts.sdl);
        if (!opts.skipValidation) assertSdlValid(sdl);
        const deposit = parseUsd(opts.deposit, "--deposit", MIN_DEPOSIT_USD);
        const data = unwrap(await client.POST("/v1/deployments", { body: { data: { sdl, deposit } } })).data;
        // Cache the manifest so `lease create` can send it without a manual arg.
        saveManifest(data.dseq, data.manifest);
        printResult(
          {
            dseq: data.dseq,
            console: consoleDeploymentUrl(config.consoleWebUrl, data.dseq),
            txHash: data.signTx.transactionHash,
            state: "open"
          },
          {
            help: [
              `console-axi bid list --dseq ${data.dseq}`,
              `console-axi deploy --sdl ${opts.sdl} --deposit ${opts.deposit}`
            ]
          }
        );
      })
    );

  deployment
    .command("update <dseq>")
    .description("Update a deployment's SDL")
    .requiredOption("--sdl <file|->", "new SDL YAML file path, or - for stdin")
    .option("--skip-validation", "skip client-side SDL validation before updating the deployment")
    .action(
      action(async (dseq: string, opts: { sdl: string; skipValidation?: boolean }, command: Command) => {
        const { client, config } = authedContext(command);
        const sdl = readFileOrStdin(opts.sdl);
        if (!opts.skipValidation) assertSdlValid(sdl);
        unwrap(await client.PUT("/v1/deployments/{dseq}", { params: { path: { dseq } }, body: { data: { sdl } } }), {
          dseq
        });
        printResult(
          { ok: true, dseq, console: consoleDeploymentUrl(config.consoleWebUrl, dseq), updated: true },
          { help: [`console-axi deployment status ${dseq}`] }
        );
      })
    );

  deployment
    .command("close <dseq>")
    .description("Close a deployment (idempotent: already-closed is a no-op)")
    .action(
      action(async (dseq: string, _opts: unknown, command: Command) => {
        const { client, config } = authedContext(command);
        const consoleUrl = consoleDeploymentUrl(config.consoleWebUrl, dseq);
        const res = await client.DELETE("/v1/deployments/{dseq}", { params: { path: { dseq } } });
        // Already-closed deployments should not be an error (AXI principle: idempotent).
        if (res.response.status === 404 || res.response.status === 400) {
          printResult({ ok: true, dseq, console: consoleUrl, state: "closed", note: "already closed (no-op)" });
          return;
        }
        unwrap(res, { dseq });
        printResult({ ok: true, dseq, console: consoleUrl, state: "closed" });
      })
    );

  deployment
    .command("deposit <dseq>")
    .description("Add funds to a deployment's escrow")
    .requiredOption("--amount <usd>", "amount to add in USD")
    .action(
      action(async (dseq: string, opts: { amount: string }, command: Command) => {
        const { client, config } = authedContext(command);
        const deposit = parseUsd(opts.amount, "--amount");
        unwrap(await client.POST("/v1/deposit-deployment", { body: { data: { dseq, deposit } } }), { dseq });
        printResult(
          { ok: true, dseq, console: consoleDeploymentUrl(config.consoleWebUrl, dseq), deposited: formatUsd(deposit) },
          { help: [`console-axi deployment view ${dseq}`] }
        );
      })
    );
}
