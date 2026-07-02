/**
 * Truncate long text (manifests, SDLs, log blobs) unless the caller asked for
 * the full value. Appends a machine-readable marker so an agent knows to pass
 * `--full` when it needs the rest (AXI principle 3).
 */
const DEFAULT_MAX = 400;

export function truncate(text: string, full: boolean, max = DEFAULT_MAX): string {
  if (full || text.length <= max) return text;
  return `${text.slice(0, max)}... (truncated, ${text.length} chars total; pass --full for all)`;
}
