import type { Command } from "commander";

import { action, authedContext } from "../context.js";
import { AxiError } from "../errors.js";
import { printResult } from "../output/render.js";
import { DEFAULT_SCOPE, mintJwt } from "../provider-proxy/jwt.js";

export function registerJwt(program: Command): void {
  program
    .command("jwt")
    .description("Mint a provider-scoped JWT (also used internally for logs/shell)")
    .command("create")
    .description("Create a scoped JWT for provider access")
    .option("--ttl <seconds>", "token lifetime in seconds", "300")
    .option("--scope <scopes>", `comma-separated scopes (default: ${DEFAULT_SCOPE.join(",")})`)
    .action(
      action(async (opts: { ttl: string; scope?: string }, command: Command) => {
        const { client } = authedContext(command);
        const ttl = Number(opts.ttl);
        if (!Number.isInteger(ttl) || ttl <= 0) {
          throw new AxiError({ code: "usage", message: `--ttl must be a positive integer, got "${opts.ttl}".` });
        }
        const scope = opts.scope ? opts.scope.split(",").map((s) => s.trim()).filter(Boolean) : [...DEFAULT_SCOPE];
        const token = await mintJwt(client, { ttl, scope });
        printResult({ token, ttl, scope });
      })
    );
}
