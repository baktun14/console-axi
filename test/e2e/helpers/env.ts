import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestHome {
  dir: string;
  /** Isolated config dir the CLI writes to (XDG_CONFIG_HOME/console-axi). */
  configDir: string;
  env(extra?: Record<string, string>): Record<string, string>;
  cleanup(): void;
}

/**
 * Per-test isolated HOME/XDG so the spawned CLI can never read the developer's
 * real config or API key. The env is a full replacement, not an overlay.
 */
export function makeTestHome(): TestHome {
  const dir = mkdtempSync(join(tmpdir(), "axi-e2e-"));
  const xdg = join(dir, "xdg");
  return {
    dir,
    configDir: join(xdg, "console-axi"),
    env(extra = {}) {
      return {
        PATH: process.env.PATH ?? "",
        HOME: dir,
        XDG_CONFIG_HOME: xdg,
        CONSOLE_AXI_NO_UPDATE_CHECK: "1",
        CI: "1",
        ...extra
      };
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
