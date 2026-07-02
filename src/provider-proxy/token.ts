import type { ApiClient } from "../api/client.js";
import { DEFAULT_SCOPE, mintJwt } from "./jwt.js";

export type EnsureToken = (force?: boolean) => Promise<string>;

/**
 * Build an `ensureToken` callback that mints a scoped JWT lazily and re-mints on
 * demand (used by the websocket relay when the provider reports token expiry).
 */
export function createTokenManager(
  client: ApiClient,
  options: { ttl?: number; scope?: string[] } = {}
): EnsureToken {
  const ttl = options.ttl ?? 3600;
  const scope = options.scope ?? [...DEFAULT_SCOPE];
  let token: string | undefined;
  return async (force = false) => {
    if (!token || force) token = await mintJwt(client, { ttl, scope });
    return token;
  };
}
