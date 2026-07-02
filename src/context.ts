import type { Command } from "commander";

import { type ApiClient,createApiClient } from "./api/client.js";
import { type Overrides, requireAuth, resolveConfig, type ResolvedConfig } from "./config/config.js";
import { printError } from "./output/render.js";

/** Extract per-invocation overrides (e.g. global `--url`) from a command. */
export function overridesFrom(command: Command): Overrides {
  const opts = command.optsWithGlobals() as { url?: string };
  return { url: opts.url };
}

export interface AuthedContext {
  config: ResolvedConfig & { apiKey: string };
  client: ApiClient;
}

/** Build an authenticated context, throwing a friendly error if no key is set. */
export function authedContext(command: Command): AuthedContext {
  const config = requireAuth(overridesFrom(command));
  return { config, client: createApiClient(config) };
}

/** Build a context that does not require auth (login, logout, home-when-signed-out). */
export function anonContext(command: Command): { config: ResolvedConfig; client: ApiClient } {
  const config = resolveConfig(overridesFrom(command));
  return { config, client: createApiClient(config) };
}

/**
 * Wrap a command action so any thrown error is rendered as a structured TOON
 * error and mapped to the correct process exit code.
 */
export function action<A extends unknown[]>(fn: (...args: A) => Promise<void> | void): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (error) {
      process.exitCode = printError(error);
    }
  };
}
