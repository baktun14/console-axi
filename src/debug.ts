/**
 * Opt-in diagnostics on stderr (--verbose, CONSOLE_AXI_DEBUG, DEBUG=console-axi).
 * All output funnels through debugLog so redaction cannot be bypassed.
 */

let flagDebug: boolean | undefined;

/** Set by the global --verbose flag (preAction hook); overrides the env. */
export function setDebug(on: boolean): void {
  flagDebug = on;
}

export function resetDebug(): void {
  flagDebug = undefined;
}

const FALSY = new Set(["", "0", "false"]);

export function isDebugEnabled(): boolean {
  if (flagDebug !== undefined) return flagDebug;
  const own = process.env.CONSOLE_AXI_DEBUG;
  if (own !== undefined && !FALSY.has(own.toLowerCase())) return true;
  const shared = process.env.DEBUG ?? "";
  return shared.split(",").some((part) => {
    const name = part.trim();
    return name === "console-axi" || name === "*";
  });
}

/** Request/response bodies are only logged at this level (they can carry secrets). */
export function isDebugFull(): boolean {
  return isDebugEnabled() && (process.env.CONSOLE_AXI_DEBUG ?? "").toLowerCase() === "full";
}

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const KV_RE = /(x-api-key|api[-_]?key|authorization|token|password|secret)(["']?\s*[:=]\s*["']?)(?:bearer\s+)?\S+/gi;

export function redactSecrets(text: string): string {
  return text.replace(JWT_RE, "[REDACTED:jwt]").replace(KV_RE, "$1$2[REDACTED]");
}

/** Write one redacted diagnostic line to stderr when debug is enabled. */
export function debugLog(scope: string, message: string): void {
  if (!isDebugEnabled()) return;
  process.stderr.write(`[debug] ${scope} ${redactSecrets(message)}\n`);
}
