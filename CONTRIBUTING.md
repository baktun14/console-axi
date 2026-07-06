## Contributing to console-axi

Thanks for considering a contribution! `console-axi` is an AXI CLI for the Akash
Network Console managed-wallet API. These guidelines keep contributions focused
and consistent.

### Before contributing

1. **Open an issue** to discuss a feature or bug before making changes.
2. **Describe clearly** what the change does and why.

### Pull requests

1. **Single purpose** — each PR addresses one feature or bug.
2. **Keep it small** — several small PRs beat one large one.
3. **Link the issue** in the PR description.

### Commit messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
standard, e.g. `feat: add deployment status command` or `fix: map network errors`.

### Before you push

Run the checks locally and make sure they pass:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

If you changed the API surface, regenerate the client from the live spec:

```bash
npm run gen:api
```

### Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please)
— **you never tag by hand.** Just merge PRs using [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:` → minor, `fix:` → patch, `feat!`/`BREAKING CHANGE:` → major). release-please
opens and keeps a **release PR** that bumps `package.json` + `CHANGELOG.md` from those
commits; when you're ready to ship, **merge the release PR**.

Merging it creates the `v<version>` tag + GitHub Release, and the *same*
[`release-please.yml`](./.github/workflows/release-please.yml) run cross-compiles the
four binaries with Bun and attaches them + `SHA256SUMS` + `install.sh` + `SKILL.md`.
Users pick it up via the daily update nudge → `console-axi upgrade`. `package.json` is
the single version source (`src/version.ts` imports it; the binary bakes it in).

> One-time repo setting: **Settings → Actions → General → Workflow permissions →**
> enable **"Allow GitHub Actions to create and approve pull requests"** so release-please
> can open its PR.

### Maintainer notes

- **Moving to the `akash-network` org:** follow [docs/org-transfer.md](./docs/org-transfer.md)
  — it lists every repo-slug reference to update and the release/install continuity steps.
- **Upstream skill contribution:** [docs/akash-skill/](./docs/akash-skill/) holds a
  ready-to-open PR spec for adding console-axi to `akash-network/akash-skill`, deferred
  until this repo graduates to the org.

### License

By contributing, you agree that your contributions are licensed under the
project's [Apache License 2.0](./LICENSE).
