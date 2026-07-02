import type { Command } from "commander";

import { unwrap } from "../api/client.js";
import { action, authedContext } from "../context.js";
import { printResult } from "../output/render.js";

interface RawApiKey {
  id: string;
  name: string;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function registerApiKey(program: Command): void {
  const apikey = program.command("apikey").description("Manage Console API keys");

  apikey
    .command("list")
    .description("List API keys (secrets are never shown)")
    .action(
      action(async (_opts: unknown, command: Command) => {
        const { client } = authedContext(command);
        const keys = unwrap(await client.GET("/v1/api-keys")).data as RawApiKey[];
        if (keys.length === 0) {
          printResult({ apiKeys: "0 found" }, { help: ["console-axi apikey create --name <name>"] });
          return;
        }
        printResult({
          apiKeys: keys.map((k) => ({
            id: k.id,
            name: k.name,
            expiresAt: k.expiresAt ?? "never",
            lastUsedAt: k.lastUsedAt ?? "never"
          }))
        });
      })
    );

  apikey
    .command("create")
    .description("Create an API key (the secret is shown ONCE)")
    .requiredOption("--name <name>", "human-readable key name")
    .option("--expires-at <iso>", "expiry as an ISO-8601 timestamp")
    .action(
      action(async (opts: { name: string; expiresAt?: string }, command: Command) => {
        const { client } = authedContext(command);
        const data: { name: string; expiresAt?: string } = { name: opts.name };
        if (opts.expiresAt) data.expiresAt = opts.expiresAt;
        const created = unwrap(await client.POST("/v1/api-keys", { body: { data } })).data as RawApiKey & {
          apiKey: string;
        };
        printResult({
          id: created.id,
          name: created.name,
          apiKey: created.apiKey,
          warning: "Store this key now. It will not be shown again."
        });
      })
    );

  apikey
    .command("delete <id>")
    .description("Delete an API key by id")
    .action(
      action(async (id: string, _opts: unknown, command: Command) => {
        const { client } = authedContext(command);
        const res = await client.DELETE("/v1/api-keys/{id}", { params: { path: { id } } });
        if (res.response.status === 404) {
          printResult({ ok: true, id, deleted: true, note: "already absent (no-op)" });
          return;
        }
        unwrap(res);
        printResult({ ok: true, id, deleted: true });
      })
    );
}
