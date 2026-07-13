import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * A marker-delimited section console-axi owns inside a shared file (e.g. a
 * global AGENTS.md). Everything outside the markers belongs to the user and is
 * never touched.
 */
const BEGIN = "<!-- console-axi:begin -->";
const END = "<!-- console-axi:end -->";

export type WriteStatus = "installed" | "repaired" | "updated" | "unchanged";
export type RemoveStatus = "removed" | "absent";

function renderBlock(body: string): string {
  return `${BEGIN}\n${body.trim()}\n${END}`;
}

export function upsertManagedBlock(path: string, body: string): WriteStatus {
  const block = renderBlock(body);

  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${block}\n`);
    return "installed";
  }

  const content = readFileSync(path, "utf8");
  const begin = content.indexOf(BEGIN);

  if (begin === -1) {
    const separator = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(path, `${content}${separator}${block}\n`);
    return "installed";
  }

  const end = content.indexOf(END, begin);
  if (end === -1) {
    // Corrupted block (no end marker): reclaim from BEGIN to EOF.
    writeFileSync(path, `${content.slice(0, begin)}${block}\n`);
    return "repaired";
  }

  const existing = content.slice(begin, end + END.length);
  if (existing === block) return "unchanged";
  writeFileSync(path, `${content.slice(0, begin)}${block}${content.slice(end + END.length)}`);
  return "updated";
}

export function removeManagedBlock(path: string): RemoveStatus {
  if (!existsSync(path)) return "absent";
  const content = readFileSync(path, "utf8");
  const begin = content.indexOf(BEGIN);
  if (begin === -1) return "absent";

  const end = content.indexOf(END, begin);
  const tail = end === -1 ? "" : content.slice(end + END.length);
  const remainder = `${content.slice(0, begin)}${tail}`.replace(/\n{3,}/g, "\n\n");

  if (remainder.trim().length === 0) {
    rmSync(path);
  } else {
    writeFileSync(path, remainder);
  }
  return "removed";
}
