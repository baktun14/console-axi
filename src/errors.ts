/**
 * AXI error model: structured errors on stdout with stable exit codes.
 *
 * Exit codes (AXI principle 6):
 *   0  success or idempotent no-op
 *   1  operational error (network, API 4xx/5xx, business failure)
 *   2  usage error (bad/missing args)
 */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2
} as const;

export type ErrorCode =
  | "unauthorized"
  | "insufficient_funds"
  | "not_found"
  | "usage"
  | "timeout"
  | "no_bids"
  | "network"
  | "api_error"
  | "config"
  | "internal";

export interface AxiErrorShape {
  code: ErrorCode;
  message: string;
  /** Next commands that would resolve the situation (AXI principle 9). */
  help?: string[];
  /** Non-sensitive extra context (e.g. dseq, provider). */
  details?: Record<string, string | number>;
}

export class AxiError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly help?: string[];
  readonly details?: Record<string, string | number>;

  constructor(shape: AxiErrorShape & { exitCode?: number }) {
    super(shape.message);
    this.name = "AxiError";
    this.code = shape.code;
    this.help = shape.help;
    this.details = shape.details;
    this.exitCode = shape.exitCode ?? (shape.code === "usage" ? EXIT.USAGE : EXIT.ERROR);
  }
}

/**
 * Translate an openapi-fetch error (HTTP status + body) into an AxiError with
 * actionable guidance. Never leaks raw server internals or stack traces.
 */
export function translateApiError(status: number, body: unknown, context?: { dseq?: string }): AxiError {
  const serverMessage = extractMessage(body);
  const details: Record<string, string | number> = {};
  if (context?.dseq) details.dseq = context.dseq;

  switch (status) {
    case 401:
    case 403:
      return new AxiError({
        code: "unauthorized",
        message: "Not authenticated. The API key is missing, invalid, or expired.",
        help: ["console-axi login --with-key <key>", "console-axi whoami"],
        details
      });
    case 402:
      return new AxiError({
        code: "insufficient_funds",
        message: serverMessage ?? "Not enough funds to cover the deployment cost.",
        help: [
          "console-axi wallet balance",
          "console-axi wallet settings --auto-reload true",
          "console-axi deployment close <dseq>"
        ],
        details
      });
    case 404:
      return new AxiError({
        code: "not_found",
        message: serverMessage ?? "Resource not found.",
        details
      });
    default:
      return new AxiError({
        code: "api_error",
        message: serverMessage ?? `API request failed (HTTP ${status}).`,
        details: { ...details, status }
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
