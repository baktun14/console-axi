# console-axi

An **[AXI](https://axi.md/)** (Agent eXperience Interface) CLI for the **Akash Console** managed-wallet API. It lets an AI agent deploy and operate Akash Network workloads end to end — create, bid, lease, watch, fund, debug, tear down — with token-efficient [TOON](https://www.npmjs.com/package/@toon-format/toon) output, structured errors, stable exit codes, and next-step hints.

Deployments are **signed server-side** by your managed wallet, so the agent never handles private keys. Everything is priced in **USD**.

## Install

```bash
npm install -g console-axi
# or run without installing:
npx -y console-axi
```

Node.js >= 20 is required.

## Authenticate

Get an API key from the [Console web UI](https://console.akash.network) (`/user/api-keys`) or with `console-axi apikey create`.

```bash
console-axi login --with-key <key>     # stored in ~/.config/console-axi/config.json
# or, per-invocation:
export CONSOLE_API_KEY=<key>
console-axi whoami
```

## Deploy in one command

```bash
console-axi deploy --sdl app.yml --deposit 5
```

Creates the deployment, waits for bids, accepts the cheapest, creates the lease, waits until the workload is ready, and prints the live service URIs. On failure it leaves the deployment **open** and prints the exact retry/close command, then exits non-zero.

Options: `--accept cheapest|first|<provider>`, `--bid-timeout <s>`, `--timeout <s>`.

## Command surface

| Area | Commands |
|------|----------|
| Auth/config | `login`, `logout`, `whoami`, `setup` |
| Deploy | `deploy` (composite) |
| Deployments | `deployment list\|view\|status\|create\|update\|close\|deposit` |
| Market | `bid list --dseq <dseq>`, `lease create ...` |
| Debug | `logs <dseq> [--follow]`, `events <dseq> [--follow]`, `exec <dseq> --service <s> -- <cmd>`, `shell <dseq> --service <s>` |
| Wallet | `wallet`, `wallet balance`, `wallet settings`, `wallet cost`, `usage` |
| Keys/tokens | `apikey list\|create\|delete`, `jwt create` |

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
console-axi setup                 # installs a session-start hook (Claude Code)
```

The hook injects a compact status view (auth, active deployment count, top deployments) at the start of each agent session. A packaged [Agent Skill](./skills/console-axi/SKILL.md) is also included.

## Configuration

| Setting | Env | Config key | Default |
|---------|-----|-----------|---------|
| API key | `CONSOLE_API_KEY` | `apiKey` | — |
| API base URL | `CONSOLE_API_URL` | `baseUrl` | `https://console-api.akash.network` |
| Provider proxy | `CONSOLE_PROVIDER_PROXY_URL` | `providerProxyUrl` | `https://console.akash.network/provider-proxy-%{NETWORK}` |
| Network | `CONSOLE_NETWORK` | `network` | `mainnet` |

Precedence: env > stored config > defaults. `--url` overrides the base URL per invocation. `%{NETWORK}` in the provider-proxy URL is replaced with the resolved network (used by `logs`, `events`, `exec`, `shell`).

## Development

```bash
npm install
npm run gen:api      # refresh the vendored OpenAPI snapshot + typed client
npm run build        # bundle to dist/cli.js
npm test             # vitest
npm run lint
npm run gen:skill    # regenerate skills/console-axi/SKILL.md
```

## Testing

Three tiers, fastest first.

### 1. Automated (no key)

```bash
npm test             # unit tests (bid selection, price, errors, TOON, ws relay, config)
npm run lint
npm run typecheck
npm run build
```

### 2. Offline CLI smoke (no key)

Exercises output, help, and error/exit-code paths without touching the network:

```bash
node dist/cli.js                      # home view ("not signed in")
node dist/cli.js --help               # full command tree
node dist/cli.js whoami; echo $?      # -> unauthorized, exit 1
node dist/cli.js frobnicate; echo $?  # -> unknown command, exit 2
```

Run the real `console-axi` binary during development with `npm link`.

### 3. Live end-to-end (needs an API key + a funded managed wallet)

This makes real on-chain deployments and spends a small amount of real funds.
Point at a non-prod console-api with `--url` / `CONSOLE_API_URL` if you have one;
otherwise `--deposit 5` followed by an immediate `close` keeps the cost minimal.

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
