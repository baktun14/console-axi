import { AxiError } from "../errors.js";

/**
 * Translate an AkashML HTTP error (status + body) into the repo's AxiError.
 * Never retries client-side — this only produces a structured error for the
 * caller to act on (per the no-auto-retry constraint).
 */
export function translateAkashmlError(status: number, body: unknown, retryAfter?: string): AxiError {
  const serverMessage = extractMessage(body);

  switch (status) {
    case 401:
    case 403:
      return new AxiError({
        code: "unauthorized",
        message: serverMessage ?? "Not authenticated. The AkashML API key is missing, invalid, or expired.",
        help: ["console-axi akashml login --with-key <key>"]
      });
    case 402:
      return new AxiError({
        code: "insufficient_funds",
        message: serverMessage ?? "Insufficient AkashML balance. Top up at https://akashml.com."
      });
    case 429: {
      const details: Record<string, string | number> = {};
      if (retryAfter !== undefined) details.retryAfter = retryAfter;
      return new AxiError({
        code: "rate_limited",
        message: serverMessage ?? "Rate limited by AkashML.",
        details
      });
    }
    case 500:
    case 504:
    case 529:
      return new AxiError({
        code: "api_error",
        message: serverMessage ?? `AkashML API request failed (HTTP ${status}).`,
        details: { status, retryable: "true" }
      });
    default:
      return new AxiError({
        code: "api_error",
        message: serverMessage ?? `AkashML API request failed (HTTP ${status}).`,
        details: { status }
      });
  }
}

/** Best-effort extraction of a human message from a JSON error body. */
function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    const v = b[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}
