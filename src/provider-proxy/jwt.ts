import type { ApiClient } from "../api/client.js";
import { unwrap } from "../api/client.js";

/** Scopes an agent typically needs against a provider. */
export const DEFAULT_SCOPE = ["status", "logs", "events", "shell", "send-manifest", "get-manifest"] as const;

export interface MintJwtOptions {
  /** Time-to-live in seconds. */
  ttl: number;
  /** Access scopes applied to all leases. */
  scope: string[];
}

/**
 * Mint a provider-scoped JWT via POST /v1/create-jwt-token. The token authorizes
 * the managed wallet against provider endpoints (logs/events/shell/status).
 */
export async function mintJwt(client: ApiClient, options: MintJwtOptions): Promise<string> {
  const body = {
    data: {
      ttl: options.ttl,
      // `access: "scoped"` applies `scope` to every lease owned by the principal.
      leases: { access: "scoped", scope: options.scope } as Record<string, unknown>
    }
  };
  const data = unwrap(await client.POST("/v1/create-jwt-token", { body })).data;
  return data.token;
}
