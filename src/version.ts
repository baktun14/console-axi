// Single source of truth for the CLI version. package.json is authoritative;
// tsup/bun inline this at build time, so the compiled binary carries it too.
import { version } from "../package.json";

export const VERSION: string = version;

/** GitHub repo the installer, upgrade, and update-check target. */
export const REPO_SLUG = "baktun14/console-axi";
