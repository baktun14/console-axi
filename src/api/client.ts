import createClient, { type Client } from "openapi-fetch";

import type { ResolvedConfig } from "../config/config.js";
import { AxiError, translateApiError } from "../errors.js";
import type { paths } from "./schema.js";

export type ApiClient = Client<paths>;

/** The relevant fields of any openapi-fetch response (union of ok/err variants). */
export interface FetchResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** Build a typed client with the API key + base URL injected centrally. */
export function createApiClient(config: ResolvedConfig): ApiClient {
  const headers: Record<string, string> = {};
  if (config.apiKey) headers["x-api-key"] = config.apiKey;
  return createClient<paths>({
    baseUrl: config.baseUrl,
    headers,
    // Translate transport-level failures (DNS, connection refused, TLS) into a
    // friendly AxiError instead of a raw "fetch failed" TypeError.
    fetch: async (request) => {
      try {
        return await fetch(request);
      } catch {
        throw new AxiError({
          code: "network",
          message: "Could not reach the Console API. Check connectivity and --url."
        });
      }
    }
  });
}

/**
 * Unwrap an openapi-fetch result: return `data` on success, else throw a
 * translated AxiError. Network failures (no response) become a `network` error.
 */
export function unwrap<T>(result: FetchResult<T>, context?: { dseq?: string }): NonNullable<T> {
  const { data, error, response } = result;
  if (response && response.ok && data !== undefined && data !== null) {
    return data as NonNullable<T>;
  }
  if (!response) {
    throw new AxiError({ code: "network", message: "Could not reach the Console API. Check connectivity and --url." });
  }
  throw translateApiError(response.status, error ?? data, context);
}
