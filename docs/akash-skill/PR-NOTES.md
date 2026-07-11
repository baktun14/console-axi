# Upstream contribution: add console-axi to `akash-network/akash-skill`

Goal: document the `console-axi` CLI as the ergonomic path for the **Console API**
deploy method in the comprehensive Akash skill, so it rides that repo's plugin
marketplace + release-please distribution. The **tool** (binary) still ships from
`baktun14/console-axi` via `install.sh`; only the **docs** go upstream.

This is a separate PR against `akash-network/akash-skill` (not this repo). Steps:

## 1. Add the CLI guide
Copy [`axi-cli.md`](./axi-cli.md) → `skills/akash/rules/deploy/console-api/axi-cli.md`.
It uses the repo's progressive-disclosure style (`@sibling.md` references).

## 2. Reference it from the method overview
Edit `skills/akash/rules/deploy/console-api/overview.md` — add a short note near the
"CLI vs HTTP" discussion:

> **CLI:** `console-axi` wraps these endpoints with a one-shot `deploy`, TOON output,
> and stable exit codes. See `@axi-cli.md`. Use it instead of raw `curl` when the user
> wants a CLI or token-efficient output.

## 3. Surface it in the method selector
Edit `skills/akash/SKILL.md` — in the "Choosing a Deployment Method" table, the
**Console API** row should mention the CLI, and add a routing cue, e.g.:

> Cue → path: "wants a CLI" / "TOON output" / "one-shot deploy" / "console-axi" → **Console API via `console-axi`** (`@rules/deploy/console-api/axi-cli.md`).

## 4. No packaging changes
- No `.claude-plugin/marketplace.json` / `plugin.json` edits — **release-please** cuts
  the next version and the marketplace serves it.
- License: akash-skill is MIT; contributed markdown is fine.

## Keeping it in sync
`axi-cli.md` is adapted from this repo's `src/skill/skill-content.ts` (the single
source of truth for console-axi's own skill). Re-sync on console-axi releases.
SDL authoring/screening (`sdl init|validate|screen`) has landed and `axi-cli.md`
already covers it in its "Building & screening an SDL" section — it maps to the
pricing + bid-screening endpoints the Console API method already covers.

## Install linkage
`axi-cli.md` points users at the console-axi one-liner:
`curl -fsSL https://raw.githubusercontent.com/baktun14/console-axi/main/install.sh | sh`
— which requires the `console-axi` repo (or its releases) to be **public**.
