export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `fn` until it returns a non-undefined value or the deadline passes.
 * Returns the value, or undefined on timeout.
 */
export async function pollUntil<T>(
  fn: () => Promise<T | undefined>,
  options: { deadlineMs: number; intervalMs: number; now?: () => number }
): Promise<T | undefined> {
  const now = options.now ?? (() => Date.now());
  const start = now();
  while (now() - start < options.deadlineMs) {
    const result = await fn();
    if (result !== undefined) return result;
    await sleep(options.intervalMs);
  }
  return undefined;
}
