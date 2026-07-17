import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCachedManifest, removeCachedManifest, saveManifest } from "./manifest-store.js";

describe("manifest cache", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "axi-manifest-"));
    vi.stubEnv("XDG_CONFIG_HOME", root);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("stores manifests with owner-only permissions", () => {
    const path = join(root, "console-axi", "manifests", "100.json");
    mkdirSync(join(root, "console-axi", "manifests"), { recursive: true });
    writeFileSync(path, "stale");
    chmodSync(path, 0o644);

    saveManifest("100", "secret");

    expect(readFileSync(path, "utf8")).toBe("secret");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("keeps arbitrary identifiers inside the manifest directory", () => {
    const outside = join(root, "console-axi", "outside.json");
    mkdirSync(join(root, "console-axi"), { recursive: true });
    writeFileSync(outside, "keep");

    saveManifest("../outside", "secret");
    expect(readCachedManifest("../outside")).toBe("secret");
    removeCachedManifest("../outside");

    expect(readFileSync(outside, "utf8")).toBe("keep");
  });
});
