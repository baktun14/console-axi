import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configDir } from "../config/config.js";

// The manifest is only returned by `deployment create`; `lease create` needs it
// later, so cache it by dseq to keep the manual flow completable across commands.
function manifestPath(dseq: string): string {
  return join(configDir(), "manifests", `${encodeURIComponent(dseq)}.json`);
}

export function saveManifest(dseq: string, manifest: string): string {
  const path = manifestPath(dseq);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) chmodSync(path, 0o600);
  writeFileSync(path, manifest, { mode: 0o600 });
  return path;
}

export function readCachedManifest(dseq: string): string | undefined {
  const path = manifestPath(dseq);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function removeCachedManifest(dseq: string): void {
  rmSync(manifestPath(dseq), { force: true });
}
