import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

import type { Command } from "commander";

import { action } from "../context.js";
import { AxiError } from "../errors.js";
import { printResult } from "../output/render.js";
import { isNewer, isPackagedBinary } from "../update/check.js";
import { REPO_SLUG, VERSION } from "../version.js";

const INSTALL_URL = `https://raw.githubusercontent.com/${REPO_SLUG}/main/install.sh`;

/** Abort a download if no bytes arrive for this long (fixes silent indefinite hangs). */
const STALL_TIMEOUT_MS = 30_000;

/** Release asset base name for this platform (must match scripts/build-bin.sh + install.sh). */
function assetName(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!os || !arch) {
    throw new AxiError({
      code: "usage",
      message: `Unsupported platform ${process.platform}/${process.arch}.`,
      help: [`curl -fsSL ${INSTALL_URL} | sh`]
    });
  }
  return `console-axi-${os}-${arch}`;
}

interface Release {
  tag: string;
  assets: Map<string, string>;
}

async function fetchLatest(): Promise<Release> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, {
      headers: { "user-agent": "console-axi", accept: "application/vnd.github+json" }
    });
  } catch {
    throw new AxiError({ code: "network", message: "Could not reach GitHub to check for updates." });
  }
  if (!res.ok) {
    throw new AxiError({ code: "network", message: `GitHub releases request failed (HTTP ${res.status}).` });
  }
  const body = (await res.json()) as {
    tag_name?: string;
    assets?: Array<{ name: string; browser_download_url: string }>;
  };
  const assets = new Map<string, string>();
  for (const a of body.assets ?? []) assets.set(a.name, a.browser_download_url);
  return { tag: (body.tag_name ?? "").replace(/^v/, ""), assets };
}

/** Write a status line to stderr only for humans at a TTY — keeps stdout TOON-clean. */
function note(msg: string): void {
  if (process.stderr.isTTY) process.stderr.write(`${msg}\n`);
}

interface Progress {
  update(received: number): void;
  done(): void;
}

/** Live one-line download progress on stderr; a no-op when stderr is not a TTY. */
function makeProgress(total: number): Progress {
  if (!process.stderr.isTTY) return { update() {}, done() {} };
  const mb = (n: number): string => (n / 1e6).toFixed(1);
  const totalLabel = total > 0 ? `${mb(total)} MB` : "?";
  return {
    update(received: number): void {
      const pct = total > 0 ? Math.floor((received / total) * 100) : 0;
      process.stderr.write(`\r  downloading ${pct}% (${mb(received)}/${totalLabel})`);
    },
    done(): void {
      process.stderr.write("\r\x1b[K");
    }
  };
}

/**
 * Fetch a URL, streaming the body so we can report progress and abort on a
 * stall (no bytes for STALL_TIMEOUT_MS). Returns the raw bytes; the caller
 * hashes/decompresses. Progress is drawn only when `opts.progress` is set.
 */
async function download(url: string, opts: { progress?: boolean } = {}): Promise<Buffer> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
  };
  const stalled = (): AxiError =>
    new AxiError({ code: "network", message: `Download stalled; aborted after ${STALL_TIMEOUT_MS / 1000}s.` });

  arm();
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "console-axi" }, signal: controller.signal });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (controller.signal.aborted) throw stalled();
    throw new AxiError({ code: "network", message: `Download failed: ${(e as Error).message}` });
  }
  if (!res.ok || !res.body) {
    if (timer) clearTimeout(timer);
    throw new AxiError({ code: "network", message: `Download failed (HTTP ${res.status}).` });
  }

  const total = Number(res.headers.get("content-length")) || 0;
  const progress = opts.progress ? makeProgress(total) : null;
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      arm();
      const buf = Buffer.from(chunk);
      chunks.push(buf);
      received += buf.length;
      progress?.update(received);
    }
  } catch (e) {
    if (controller.signal.aborted) throw stalled();
    throw new AxiError({ code: "network", message: `Download interrupted: ${(e as Error).message}` });
  } finally {
    if (timer) clearTimeout(timer);
    progress?.done();
  }
  return Buffer.concat(chunks);
}

/** Parse a `<sha256>  <filename>` SHA256SUMS body into a name→hash lookup. */
function parseSums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m?.[1] && m[2]) map.set(m[2], m[1].toLowerCase());
  }
  return map;
}

export function registerUpgrade(program: Command): void {
  program
    .command("upgrade")
    .description("Update console-axi to the latest release (self-replaces the binary)")
    .option("--check", "only report current vs latest; don't install", false)
    .action(
      action(async (opts: { check: boolean }) => {
        const { tag: latest, assets } = await fetchLatest();

        if (opts.check) {
          printResult({
            current: VERSION,
            latest: latest || "unknown",
            upToDate: latest ? !isNewer(latest, VERSION) : true
          });
          return;
        }

        if (!latest || !isNewer(latest, VERSION)) {
          printResult({ ok: true, status: "up-to-date", version: VERSION });
          return;
        }

        if (!isPackagedBinary()) {
          throw new AxiError({
            code: "usage",
            message: "`upgrade` self-replaces the standalone binary, but this is a dev/node run.",
            help: [`curl -fsSL ${INSTALL_URL} | sh`]
          });
        }

        const target = process.execPath;
        const dir = dirname(target);
        try {
          accessSync(dir, constants.W_OK);
        } catch {
          throw new AxiError({
            code: "usage",
            message: `Cannot write to ${dir}. Re-run the installer to a writable location.`,
            help: [`curl -fsSL ${INSTALL_URL} | sh`]
          });
        }

        // Prefer the gzip-compressed asset; fall back to the raw binary for
        // older/mixed releases that predate compression.
        const base = assetName();
        const gzAsset = `${base}.gz`;
        const asset = assets.has(gzAsset) ? gzAsset : base;
        const compressed = asset.endsWith(".gz");
        const url = assets.get(asset);
        if (!url) throw new AxiError({ code: "not_found", message: `Release v${latest} has no asset ${base}.` });

        note(`Downloading console-axi v${latest} (${asset})…`);
        const payload = await download(url, { progress: true });

        // Verify the downloaded asset against SHA256SUMS when the release ships one.
        const sumsUrl = assets.get("SHA256SUMS");
        if (sumsUrl) {
          note("Verifying checksum…");
          const expected = parseSums((await download(sumsUrl)).toString("utf8")).get(asset);
          const actual = createHash("sha256").update(payload).digest("hex");
          if (expected && expected !== actual) {
            throw new AxiError({ code: "internal", message: `Checksum mismatch for ${asset}; aborting upgrade.` });
          }
        }

        note("Installing…");
        // gzip's CRC guards the decompression; a corrupt payload throws here.
        const bin = compressed ? gunzipSync(payload) : payload;

        // Write beside the target so the replace is an atomic same-filesystem rename.
        const tmp = join(dir, `.${basename(target)}.new-${process.pid}`);
        writeFileSync(tmp, bin);
        chmodSync(tmp, 0o755);
        try {
          renameSync(tmp, target);
        } catch (e) {
          try {
            unlinkSync(tmp);
          } catch {
            /* best-effort cleanup */
          }
          throw new AxiError({ code: "internal", message: `Could not replace ${target}: ${(e as Error).message}` });
        }

        // Re-run setup with the NEW binary to resync the skill + hook.
        const resync = spawnSync(target, ["setup"], { stdio: "ignore" });

        printResult(
          {
            ok: true,
            status: "upgraded",
            from: VERSION,
            to: latest,
            binary: target,
            resync: resync.status === 0 ? "ok" : "skipped"
          },
          { help: ["console-axi"] }
        );
      })
    );
}
