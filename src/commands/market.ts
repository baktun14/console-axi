import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { action, authedContext } from "../context.js";
import { readFileOrStdin } from "../input.js";
import { blockPriceToUsdPerMonth } from "../output/price.js";
import { printResult } from "../output/render.js";

interface RawBid {
  bid: {
    id: { dseq: string; gseq: number; oseq: number; provider: string };
    state: string;
    price: { denom: string; amount: string };
  };
}

export function registerBid(program: Command): void {
  const bid = program.command("bid").description("Inspect provider bids");

  bid
    .command("list")
    .description("List bids for a deployment order")
    .requiredOption("--dseq <dseq>", "deployment sequence number")
    .action(
      action(async (opts: { dseq: string }, command: Command) => {
        const { client } = authedContext(command);
        const data = unwrap(
          await client.GET("/v1/bids", { params: { query: { dseq: opts.dseq } } }),
          { dseq: opts.dseq }
        ).data as RawBid[];

        if (data.length === 0) {
          printResult(
            { bids: "0 found (providers may still be bidding)" },
            { help: [`console-axi bid list --dseq ${opts.dseq}`] }
          );
          return;
        }

        const bids = data
          .filter((b) => b.bid.state === "open")
          .map((b) => ({
            provider: b.bid.id.provider,
            cost: blockPriceToUsdPerMonth(b.bid.price.amount),
            gseq: b.bid.id.gseq,
            oseq: b.bid.id.oseq,
            state: b.bid.state
          }));

        printResult(
          { count: `${bids.length} open`, bids },
          {
            help: [
              "console-axi lease create --dseq <dseq> --gseq <g> --oseq <o> --provider <p> --manifest <file>",
              `console-axi deploy --sdl <file> --deposit <usd>`
            ]
          }
        );
      })
    );
}

export function registerLease(program: Command): void {
  const lease = program.command("lease").description("Create leases from accepted bids");

  lease
    .command("create")
    .description("Accept a bid by creating a lease and sending the manifest")
    .requiredOption("--dseq <dseq>", "deployment sequence number")
    .requiredOption("--gseq <gseq>", "group sequence number")
    .requiredOption("--oseq <oseq>", "order sequence number")
    .requiredOption("--provider <provider>", "provider address")
    .requiredOption("--manifest <file|->", "manifest file path, or - for stdin")
    .action(
      action(
        async (
          opts: { dseq: string; gseq: string; oseq: string; provider: string; manifest: string },
          command: Command
        ) => {
          const { client } = authedContext(command);
          const manifest = readFileOrStdin(opts.manifest);
          unwrap(
            await client.POST("/v1/leases", {
              body: {
                manifest,
                leases: [
                  { dseq: opts.dseq, gseq: Number(opts.gseq), oseq: Number(opts.oseq), provider: opts.provider }
                ]
              }
            }),
            { dseq: opts.dseq }
          );
          printResult(
            { ok: true, dseq: opts.dseq, provider: opts.provider, state: "lease created" },
            { help: [`console-axi deployment status ${opts.dseq}`] }
          );
        }
      )
    );
}
