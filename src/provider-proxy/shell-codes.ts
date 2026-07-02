/**
 * Stream channel codes used by the Akash provider shell protocol. The first
 * byte of every shell frame (in and out) is one of these.
 */
export const ShellCode = {
  Stdout: 100,
  Stderr: 101,
  Result: 102,
  Failure: 103,
  Stdin: 104,
  TerminalResize: 105
} as const;

/** Prefix raw bytes with the Stdin channel code for outbound shell data. */
export function frameStdin(data: Uint8Array): Uint8Array {
  const framed = new Uint8Array(data.length + 1);
  framed[0] = ShellCode.Stdin;
  framed.set(data, 1);
  return framed;
}

/** Parse a provider `{...,"exit_code":N}` status frame; undefined if not one. */
export function parseExitCode(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}") && trimmed.includes('"exit_code"')) {
    try {
      const parsed = JSON.parse(trimmed) as { exit_code?: number };
      if (typeof parsed.exit_code === "number") return parsed.exit_code;
    } catch {
      // not a status frame
    }
  }
  return undefined;
}
