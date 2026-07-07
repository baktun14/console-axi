import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { collectUris, isDeploymentReady, type RawLease } from "../api/deployment-format.js";
import { action, authedContext } from "../context.js";
import { saveManifest } from "../deploy/manifest-store.js";
import { type BidLike, parseAcceptStrategy, selectBids } from "../deploy/select-bids.js";
import { AxiError } from "../errors.js";
import { readFileOrStdin } from "../input.js";
import { consoleDeploymentUrl } from "../output/console-url.js";
import { blockPriceToUsdPerMonth, formatUsd, MIN_DEPOSIT_USD } from "../output/price.js";
import { printResult } from "../output/render.js";
import { screenSupply } from "../sdl/screen.js";
import { assertSdlValid, parseSdlYaml } from "../sdl/validate.js";
import { pollUntil } from "../util/poll.js";

const BID_POLL_INTERVAL_MS = 3000;
const READY_POLL_INTERVAL_MS = 5000;

export function registerDeploy(program: Command): void {
  program
    .command("deploy")
    .description("One-shot: create -> accept a bid -> lease -> wait for URIs")
    .requiredOption("--sdl <file|->", "SDL YAML file path, or - for stdin")
    .requiredOption("--deposit <usd>", "deposit amount in USD (minimum 0.5)")
    .option("--accept <strategy>", "cheapest | first | <provider-address>", "cheapest")
    .option("--bid-timeout <seconds>", "max seconds to wait for bids", "90")
    .option("--timeout <seconds>", "max seconds to wait for the workload to become ready", "240")
    .option("--skip-validation", "skip client-side SDL validation before creating the deployment")
    .option("--skip-screening", "skip the pre-flight supply probe that aborts when no providers match")
    .action(
      action(async (opts: DeployOpts, command: Command) => {
        const { client, config } = authedContext(command);
        const sdl = readFileOrStdin(opts.sdl);
        const validatedSdl = opts.skipValidation ? undefined : assertSdlValid(sdl);
        const deposit = Number(opts.deposit);
        if (!Number.isFinite(deposit) || deposit <= 0) {
          throw new AxiError({ code: "usage", message: `--deposit must be a positive USD amount, got "${opts.deposit}".` });
        }
        if (deposit < MIN_DEPOSIT_USD) {
          throw new AxiError({ code: "usage", message: `--deposit must be at least ${formatUsd(MIN_DEPOSIT_USD)} (minimum deposit), got ${formatUsd(deposit)}.` });
        }
        const bidTimeoutMs = Number(opts.bidTimeout) * 1000;
        const readyTimeoutMs = Number(opts.timeout) * 1000;
        const strategy = parseAcceptStrategy(opts.accept);

        // 0. Pre-flight supply probe: don't spend a deposit if no provider can match.
        // Advisory only, so a screening outage never blocks — only a confirmed empty match does.
        let screenedProviders: number | undefined;
        if (!opts.skipScreening) {
          const parsed = validatedSdl ?? parseSdlYaml(sdl).parsed;
          if (parsed) {
            try {
              screenedProviders = (await screenSupply(client, parsed)).length;
            } catch {
              screenedProviders = undefined; // endpoint unavailable — proceed without gating
            }
            if (screenedProviders === 0) {
              throw new AxiError({
                code: "no_supply",
                message:
                  "No providers currently match this SDL's requirements, so a deployment would likely receive no bids. No deployment was created.",
                help: [
                  `console-axi sdl screen ${opts.sdl}`,
                  "relax placement attributes / signedBy in the SDL",
                  `console-axi deploy --sdl ${opts.sdl} --deposit ${opts.deposit} --skip-screening`
                ]
              });
            }
          }
        }

        // 1. Create the deployment (managed wallet signs server-side).
        const created = unwrap(await client.POST("/v1/deployments", { body: { data: { sdl, deposit } } })).data;
        const dseq = created.dseq;
        const manifest = created.manifest;
        // Cache so a manual `lease create` can recover if this composite fails mid-way.
        saveManifest(dseq, manifest);

        // 2. Wait for bids.
        const bids = await pollUntil<BidLike[]>(
          async () => {
            const data = unwrap(await client.GET("/v1/bids", { params: { query: { dseq } } }), { dseq }).data as BidLike[];
            const open = data.filter((b) => b.bid.state === "open");
            return open.length > 0 ? data : undefined;
          },
          { deadlineMs: bidTimeoutMs, intervalMs: BID_POLL_INTERVAL_MS }
        );

        if (!bids) {
          throw openDeploymentError(dseq, "no_bids", "No bids were received before the timeout.", opts);
        }

        // 3. Select one bid per order group.
        const { selected, unmatchedGroups } = selectBids(bids, strategy);
        if (selected.length === 0 || unmatchedGroups.length > 0) {
          throw openDeploymentError(
            dseq,
            "no_bids",
            unmatchedGroups.length > 0
              ? `No bid matched the --accept strategy for order group(s): ${unmatchedGroups.join(", ")}.`
              : "No usable bids were found.",
            opts
          );
        }

        // 4. Create leases + send the manifest.
        try {
          unwrap(
            await client.POST("/v1/leases", {
              body: {
                manifest,
                leases: selected.map((s) => ({ dseq: s.dseq, gseq: s.gseq, oseq: s.oseq, provider: s.provider }))
              }
            }),
            { dseq }
          );
        } catch (error) {
          if (error instanceof AxiError) {
            throw new AxiError({
              code: error.code,
              message: `Lease creation failed: ${error.message}`,
              details: { dseq },
              help: retryHelp(dseq, opts)
            });
          }
          throw error;
        }

        // 5. Wait for readiness, then return URIs.
        const readyLeases = await pollUntil<RawLease[]>(
          async () => {
            const data = unwrap(await client.GET("/v1/deployments/{dseq}", { params: { path: { dseq } } }), { dseq }).data;
            const leases = (data.leases ?? []) as RawLease[];
            return isDeploymentReady(leases) ? leases : undefined;
          },
          { deadlineMs: readyTimeoutMs, intervalMs: READY_POLL_INTERVAL_MS }
        );

        const totalPerBlock = selected.reduce((sum, s) => sum + s.amount, 0);
        const providers = [...new Set(selected.map((s) => s.provider))];

        if (!readyLeases) {
          // Leases exist but the workload is not ready yet. Leave it open.
          printResult(
            {
              dseq,
              console: consoleDeploymentUrl(config.consoleWebUrl, dseq),
              state: "lease created, not ready yet",
              providers,
              ...(screenedProviders !== undefined ? { screenedProviders } : {}),
              cost: blockPriceToUsdPerMonth(totalPerBlock),
              note: "Workload did not report ready within the timeout; it may still be starting."
            },
            { help: [`console-axi deployment status ${dseq}`, `console-axi logs ${dseq} --tail 100`] }
          );
          process.exitCode = 1;
          return;
        }

        const uris = collectUris(readyLeases);
        printResult(
          {
            ok: true,
            dseq,
            console: consoleDeploymentUrl(config.consoleWebUrl, dseq),
            providers,
            ...(screenedProviders !== undefined ? { screenedProviders } : {}),
            cost: blockPriceToUsdPerMonth(totalPerBlock),
            uris: uris.length > 0 ? uris : "no external URIs (internal-only services)"
          },
          { help: [`console-axi logs ${dseq} --tail 100`, `console-axi deployment close ${dseq}`] }
        );
      })
    );
}

interface DeployOpts {
  sdl: string;
  deposit: string;
  accept: string;
  bidTimeout: string;
  timeout: string;
  skipValidation?: boolean;
  skipScreening?: boolean;
}

/** Build an error that keeps the deployment open and tells the agent how to recover. */
function openDeploymentError(
  dseq: string,
  code: "no_bids",
  message: string,
  opts: DeployOpts
): AxiError {
  return new AxiError({
    code,
    message: `${message} The deployment ${dseq} is left OPEN.`,
    details: { dseq },
    help: retryHelp(dseq, opts)
  });
}

function retryHelp(dseq: string, opts: DeployOpts): string[] {
  return [
    `console-axi bid list --dseq ${dseq}`,
    `console-axi deploy --sdl ${opts.sdl} --deposit ${opts.deposit}`,
    `console-axi deployment close ${dseq}`
  ];
}
