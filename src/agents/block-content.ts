/**
 * The instructions block installed into a harness's global AGENTS.md for
 * agents without an exec-hook mechanism (codex, opencode). Keep it short:
 * the skill file carries the full reference.
 */
export function buildBlockBody(command: string): string {
  return [
    "## console-axi — Akash Network deployments",
    "",
    "console-axi deploys and manages Akash workloads via the Console managed wallet",
    "(token-efficient TOON output, structured errors, stable exit codes, USD pricing).",
    "",
    `- When starting any Akash-related work, first run: \`${command}\``,
    "  (shows auth, wallet balance, and active deployments).",
    "- Full command reference: the `console-axi` skill installed alongside this block,",
    "  or `console-axi --help`."
  ].join("\n");
}
