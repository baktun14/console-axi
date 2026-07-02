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

### License

By contributing, you agree that your contributions are licensed under the
project's [Apache License 2.0](./LICENSE).
