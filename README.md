# console-axi

An **[AXI](https://axi.md/)** (Agent eXperience Interface) CLI for the **Akash Console** managed-wallet API. It lets an AI agent deploy and operate Akash Network workloads end to end — create, bid, lease, watch, fund, debug, tear down — with token-efficient [TOON](https://www.npmjs.com/package/@toon-format/toon) output, structured errors, stable exit codes, and next-step hints.

Deployments are **signed server-side** by your managed wallet, so the agent never handles private keys. Everything is priced in **USD**.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/baktun14/console-axi/main/install.sh | sh
```

Installs a self-contained binary to `~/.local/bin` (no Node required; macOS/Linux, arm64/x64) and wires up the Claude Code session hook + skill. Update with `console-axi upgrade`; remove with `console-axi uninstall` (add `--purge` to also drop the stored API key).

## Authenticate

Get an API key from the [Console web UI](https://console.akash.network) (`/user/api-keys`) or with `console-axi apikey create`.

```bash
console-axi login --with-key <key>     # stored in ~/.config/console-axi/config.json
# or, per-invocation:
export CONSOLE_API_KEY=<key>
console-axi whoami
```

## Formulate an SDL

Every deployment needs a valid [SDL](https://akash.network/docs/getting-started/stack-definition-language/) (the YAML that describes your app). The `sdl` commands help you scaffold and validate one **before** you deploy — validation runs entirely client-side (the Console API has no validate endpoint) via [`@akashnetwork/chain-sdk`](https://www.npmjs.com/package/@akashnetwork/chain-sdk) plus a few best-practice lint rules.

```bash
console-axi sdl templates                                   # list scaffolds: web, gpu, multi-service, ip-lease
console-axi sdl init web --image nginx:1.27 --port 80 > app.yml   # generate SDL YAML (stdout)
console-axi sdl validate app.yml                            # offline: schema + best-practice checks (exit 2 if invalid)
console-axi sdl screen app.yml                              # live: which providers could bid (no key)
console-axi deploy --sdl app.yml --deposit 0.5
```

`sdl init` common flags: `--image --port --as --name --cpu --memory --storage --count --price --env K=V` (plus `--gpu --gpu-model` for the `gpu` template). It prints raw YAML to stdout, so redirect to a file or pipe into `sdl validate -`.

This is designed to be **agent-driven**: the packaged [Agent Skill](./skills/console-axi/SKILL.md) teaches an agent to interview the user and run this loop, so no interactive prompts are needed. `deploy`, `deployment create` and `deployment update` also validate the SDL client-side first (bypass with `--skip-validation`).

## Deploy in one command

```bash
console-axi deploy --sdl app.yml --deposit 0.5
```

Screens the network for capable providers (aborts before spending if none match), creates the deployment, waits for bids, accepts the cheapest, creates the lease, waits until the workload is ready, and prints the live service URIs. On failure it leaves the deployment **open** and prints the exact retry/close command, then exits non-zero. Deposits are in USD; the minimum is **$0.5** (values below are rejected client-side).

Options: `--accept cheapest|first|<provider>`, `--bid-timeout <s>`, `--timeout <s>`, `--skip-validation`, `--skip-screening`.

## Command surface

| Area | Commands |
|------|----------|
| Auth/config | `login`, `logout`, `whoami`, `setup` |
| SDL | `sdl templates`, `sdl init <template>`, `sdl validate <file>`, `sdl screen [file]` |
| Deploy | `deploy` (composite) |
| Deployments | `deployment list\|view\|status\|create\|update\|close\|deposit` |
| Market | `bid list --dseq <dseq>`, `lease create ...` |
| Debug | `logs <dseq> [--follow]`, `events <dseq> [--follow]`, `exec <dseq> --service <s> -- <cmd>`, `shell <dseq> --service <s>` |
| Wallet | `wallet list\|balance\|settings\|cost`, `usage` |
| Keys/tokens | `apikey list\|create\|delete`, `jwt create` |
| Lifecycle | `upgrade`, `uninstall` |

Run `console-axi` with no arguments for a live status home view, or `console-axi <command> --help` for details.

## Output & exit codes

All output is TOON. Money is always USD. Errors are structured (`error: { code, exit, message }`) and carry a `help[]` block naming the command that fixes the situation.

| Exit | Meaning |
|------|---------|
| 0 | success or idempotent no-op |
| 1 | operational error (network, API, business failure) |
| 2 | usage error (bad/missing arguments) |

## Session hook & Agent Skill

```bash
console-axi setup                 # installs the session hook + Claude skill
console-axi uninstall             # removes them (and the binary; --no-self to keep it)
```

`setup` installs a SessionStart hook that injects a compact status view (auth, active deployment count, top deployments) at the start of each agent session, and installs the [Agent Skill](./skills/console-axi/SKILL.md) into `~/.claude/skills/`. `install.sh` runs `setup` for you. Both honor `CLAUDE_CONFIG_DIR`. For other agents, `setup --agent codex|opencode` prints the hook command to add to that agent's config instead.

## Configuration

| Setting | Env | Config key | Default |
|---------|-----|-----------|---------|
| API key | `CONSOLE_API_KEY` | `apiKey` | — |
| API base URL | `CONSOLE_API_URL` | `baseUrl` | `https://console-api.akash.network` |
| Provider proxy | `CONSOLE_PROVIDER_PROXY_URL` | `providerProxyUrl` | `https://console.akash.network/provider-proxy-%{NETWORK}` |
| Network | `CONSOLE_NETWORK` | `network` | `mainnet` |
| Console web URL | `CONSOLE_WEB_URL` | `consoleWebUrl` | `https://console.akash.network` |

Precedence: env > stored config > defaults. `--url` overrides the base URL per invocation. `%{NETWORK}` in the provider-proxy URL is replaced with the resolved network (used by `logs`, `events`, `exec`, `shell`).

## Development

```bash
npm install
npm run gen:api      # refresh the vendored OpenAPI snapshot + typed client
npm run build        # bundle to dist/cli.js
npm test             # vitest
npm run lint
npm run gen:skill    # regenerate skills/console-axi/SKILL.md
npm run build:bin    # cross-compile standalone binaries to dist-bin/ (requires bun)
```

## Testing

Three tiers, fastest first.

### 1. Automated (no key)

```bash
npm test             # unit tests (bid selection, price, errors, TOON, ws relay, config)
npm run test:e2e     # spawns the built CLI against a fake Console API + provider proxy
npm run lint
npm run typecheck
npm run build
```

The e2e suite (`test/e2e/`) covers the offline smoke procedure below plus auth,
error mapping, the deploy pipeline, and the logs/exec relay — all against local
fakes, no key or network needed. `E2E_CLI=<path>` re-runs it against a compiled
standalone binary.

### 2. Offline CLI smoke (no key)

Exercises output, help, and error/exit-code paths without touching the network:

```bash
node dist/cli.js                      # home view ("not signed in")
node dist/cli.js --help               # full command tree
node dist/cli.js whoami; echo $?      # -> unauthorized, exit 1
node dist/cli.js frobnicate; echo $?  # -> unknown command, exit 2

node dist/cli.js sdl templates        # list SDL scaffolds
node dist/cli.js sdl init web --image nginx:1.27 --port 80 | node dist/cli.js sdl validate -   # -> valid: true
node dist/cli.js sdl validate examples/hello.yml           # offline validation + summary
```

`sdl screen [file]` also works without a key (it calls the public bid-screening endpoint).

Run the real `console-axi` binary during development with `npm link`.

### 3. Live end-to-end (needs an API key + a funded managed wallet)

This makes real on-chain deployments and spends a small amount of real funds.
Point at a non-prod console-api with `--url` / `CONSOLE_API_URL` if you have one;
otherwise `--deposit 0.5` (the minimum) followed by an immediate `close` keeps the cost minimal.

```bash
export CONSOLE_API_KEY=<your-key>     # from the Console web UI: /user/api-keys

console-axi whoami                    # confirms auth
console-axi wallet balance            # confirms funds (USD)
console-axi deploy --sdl examples/hello.yml --deposit 0.5  # returns a live URI
console-axi deployment status <dseq>  # use the dseq from deploy
console-axi logs <dseq> --tail 50
console-axi exec <dseq> --service web -- echo hi ; echo "exit=$?"
console-axi deployment close <dseq>   # clean up (stops spend)
```

`deploy` is safe-on-failure: if no bids arrive it leaves the deployment open and
prints the exact retry/close commands, so nothing is stranded silently.

#### Manual (step-by-step) deploy

`deploy` is `create -> bid list -> lease create -> wait` in one call. To drive
the steps yourself (e.g. to pick a specific provider), run them individually.
`deployment create` caches the generated manifest by dseq, so `lease create`
needs no `--manifest` argument:

```bash
console-axi deployment create --sdl examples/hello.yml --deposit 0.5  # prints dseq
console-axi bid list --dseq <dseq>                                    # pick gseq/oseq/provider
console-axi lease create --dseq <dseq> --gseq 1 --oseq 1 --provider <addr>
console-axi deployment status <dseq>                                  # wait for ready + URIs
console-axi deployment close <dseq>
```

## License

Apache-2.0
