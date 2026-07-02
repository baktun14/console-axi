import type { Command } from "commander";

import { createApiClient } from "../api/client.js";
import { getCurrentUser } from "../api/user.js";
import { clearStoredConfig, readStoredConfig, resolveConfig, writeStoredConfig } from "../config/config.js";
import { action, authedContext } from "../context.js";
import { AxiError } from "../errors.js";
import { printResult } from "../output/render.js";

export function registerAuth(program: Command): void {
  program
    .command("login")
    .description("Validate an API key and store it for future commands")
    .requiredOption("--with-key <key>", "Console API key (or set CONSOLE_API_KEY)")
    .option("--url <url>", "override the API base URL")
    .action(
      action(async (opts: { withKey: string; url?: string }) => {
        const overrides = { url: opts.url };
        const config = resolveConfig(overrides);
        // Validate the key against the live user endpoint before persisting it.
        const probeClient = createApiClient({ ...config, apiKey: opts.withKey });
        const user = await getCurrentUser(probeClient).catch(() => {
          throw new AxiError({
            code: "unauthorized",
            message: "That API key was rejected by the Console API.",
            help: ["console-axi login --with-key <key>"]
          });
        });

        const stored = readStoredConfig();
        stored.apiKey = opts.withKey;
        if (opts.url) stored.baseUrl = config.baseUrl;
        writeStoredConfig(stored);

        printResult({ ok: true, loggedInAs: user.username, email: user.email }, { help: ["console-axi"] });
      })
    );

  program
    .command("logout")
    .description("Remove the stored API key and config")
    .action(
      action(() => {
        clearStoredConfig();
        printResult({ ok: true, message: "Logged out; stored config removed." });
      })
    );

  program
    .command("whoami")
    .description("Show the authenticated user")
    .action(
      action(async (_opts: unknown, command: Command) => {
        const { client } = authedContext(command);
        const user = await getCurrentUser(client);
        printResult({
          username: user.username,
          email: user.email,
          emailVerified: user.emailVerified,
          userId: user.userId
        });
      })
    );
}
