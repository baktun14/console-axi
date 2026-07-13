import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { removeManagedBlock, upsertManagedBlock } from "./managed-block.js";

describe("managed block", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "axi-block-"));
    file = join(dir, "AGENTS.md");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates the file with the block when absent", () => {
    const status = upsertManagedBlock(file, "run console-axi");

    expect(status).toBe("installed");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("<!-- console-axi:begin -->");
    expect(content).toContain("run console-axi");
    expect(content).toContain("<!-- console-axi:end -->");
  });

  it("appends the block to an existing file, preserving user content", () => {
    writeFileSync(file, "# My own instructions\n\nBe nice.\n");

    const status = upsertManagedBlock(file, "run console-axi");

    expect(status).toBe("installed");
    const content = readFileSync(file, "utf8");
    expect(content.startsWith("# My own instructions")).toBe(true);
    expect(content).toContain("Be nice.");
    expect(content).toContain("run console-axi");
  });

  it("is idempotent: same body -> unchanged, no growth", () => {
    upsertManagedBlock(file, "body v1");
    const first = readFileSync(file, "utf8");

    const status = upsertManagedBlock(file, "body v1");

    expect(status).toBe("unchanged");
    expect(readFileSync(file, "utf8")).toBe(first);
  });

  it("replaces only the block when the body changes", () => {
    writeFileSync(file, "before\n");
    upsertManagedBlock(file, "body v1");

    const status = upsertManagedBlock(file, "body v2");

    const content = readFileSync(file, "utf8");
    expect(status).toBe("updated");
    expect(content).toContain("before");
    expect(content).toContain("body v2");
    expect(content).not.toContain("body v1");
    expect(content.match(/console-axi:begin/g)).toHaveLength(1);
  });

  it("remove deletes only the block, keeping user content", () => {
    writeFileSync(file, "# Mine\n");
    upsertManagedBlock(file, "body");

    const status = removeManagedBlock(file);

    expect(status).toBe("removed");
    const content = readFileSync(file, "utf8");
    expect(content).toContain("# Mine");
    expect(content).not.toContain("console-axi:begin");
  });

  it("remove deletes the file when nothing but the block remains", () => {
    upsertManagedBlock(file, "body");

    const status = removeManagedBlock(file);

    expect(status).toBe("removed");
    expect(existsSync(file)).toBe(false);
  });

  it("remove is a no-op when the file or block is absent", () => {
    expect(removeManagedBlock(file)).toBe("absent");
    writeFileSync(file, "unrelated\n");
    expect(removeManagedBlock(file)).toBe("absent");
    expect(readFileSync(file, "utf8")).toBe("unrelated\n");
  });

  it("repairs a corrupted block missing its end marker", () => {
    writeFileSync(file, "keep\n<!-- console-axi:begin -->\ngarbage without end\n");

    const status = upsertManagedBlock(file, "fresh body");

    const content = readFileSync(file, "utf8");
    expect(status).toBe("repaired");
    expect(content).toContain("keep");
    expect(content).toContain("fresh body");
    expect(content).not.toContain("garbage");
    expect(content).toContain("<!-- console-axi:end -->");
  });
});
