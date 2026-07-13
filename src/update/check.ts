/**
 * Auto-update plumbing for the standalone-binary channel.
 *
 * - maybeNotifyUpdate: sync, network-free — prints a one-line stderr nudge from a
 *   cached marker. Never touches stdout (agents parse TOON there).
 * - scheduleRefresh: fires a detached, unref'd child (the hidden __update-check
 *   command) at most once/day to refresh the cache. Never blocks or fails a run.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { Command } from "commander";

import { configDir } from "../config/config.js";
import { debugLog } from "../debug.js";
import { REPO_SLUG } from "../version.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RELEASES_LATEST = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;

interface Cache {
  lastCheck: number;
  latest: string;
}

function cachePath(): string {
  return join(configDir(), "update-check.json");
}

function readCache(): Cache | null {
  try {
    const c = JSON.parse(readFileSync(cachePath(), "utf8")) as Cache;
    if (typeof c.lastCheck === "number" && typeof c.latest === "string") return c;
  } catch {
    /* no cache yet or unreadable — treat as absent */
  }
  return null;
}

function writeCache(c: Cache): void {
  try {
    const path = cachePath();
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(c));
  } catch {
    /* cache is best-effort */
  }
}

/** Compare dotted numeric versions; true if `a` is strictly newer than `b`. Pre-release tags are ignored. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string): number[] =>
    (v.replace(/^v/, "").split("-")[0] ?? "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** True when running as the compiled standalone binary (vs `node dist/cli.js`). */
export function isPackagedBinary(): boolean {
  return basename(process.execPath).startsWith("console-axi");
}

function notifyDisabled(): boolean {
  return (
    Boolean(process.env.CONSOLE_AXI_NO_UPDATE_CHECK) ||
    Boolean(process.env.CI) ||
    process.argv.includes("--no-update-check")
  );
}

/** Print a one-line update nudge to stderr if the cache shows a newer version. */
export function maybeNotifyUpdate(current: string): void {
  // Only nudge humans at an interactive terminal; agents update via `upgrade`/CI.
  if (notifyDisabled() || !process.stderr.isTTY) return;
  const cache = readCache();
  if (cache && cache.latest && isNewer(cache.latest, current)) {
    process.stderr.write(
      `\nconsole-axi ${cache.latest} is available (you have ${current}) — run: console-axi upgrade\n\n`
    );
  }
}

/** If it has been >24h since the last check, refresh the cache in the background. */
export function scheduleRefresh(): void {
  if (notifyDisabled()) return;
  const cache = readCache();
  if (cache && Date.now() - cache.lastCheck < DAY_MS) return;
  try {
    const args = isPackagedBinary()
      ? ["__update-check"]
      : [process.argv[1] ?? "", "__update-check"];
    const child = spawn(process.execPath, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    /* a failed refresh must never affect the foreground command */
  }
}

/** Fetch the latest release tag and rewrite the cache. Swallows every error. */
export async function runUpdateCheck(): Promise<void> {
  const prev = readCache();
  let latest = prev?.latest ?? "";
  try {
    const res = await fetch(RELEASES_LATEST, {
      headers: { "user-agent": "console-axi", accept: "application/vnd.github+json" }
    });
    debugLog("http", `GET ${RELEASES_LATEST} -> ${res.status}`);
    if (res.ok) {
      const body = (await res.json()) as { tag_name?: string };
      const tag = (body.tag_name ?? "").replace(/^v/, "");
      if (tag) latest = tag;
    }
  } catch {
    /* network errors are expected and ignored */
  }
  // Always stamp lastCheck so a persistent outage doesn't respawn every run.
  writeCache({ lastCheck: Date.now(), latest });
}

/** Hidden command the detached refresh child runs. */
export function registerUpdateCheck(program: Command): void {
  program
    .command("__update-check", { hidden: true })
    .description("internal: refresh the cached latest-version marker")
    .action(async () => {
      await runUpdateCheck();
    });
}
