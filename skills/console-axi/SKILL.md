---
name: console-axi
description: Deploy and manage Akash Network workloads through the Console managed wallet. Use for "deploy to Akash", "check my Akash deployment", "stream Akash logs", "run a command in my Akash service", or managing bids, leases, wallet balance, and API keys via console-axi.
---

# console-axi

`console-axi` is an AXI CLI for the Akash Console managed-wallet API. It emits
token-efficient TOON output, is content-first, and every command suggests the
next step in a `help[]` block. Deployments are signed server-side by the managed
wallet — you never handle private keys.

## Auth

Set a key once. Get it from the Console web UI (/user/api-keys) or `apikey create`.

```
console-axi login --with-key <key>     # or export CONSOLE_API_KEY=<key>
console-axi whoami
```

## The fast path: deploy

```
console-axi deploy --sdl app.yml --deposit 5
```

This creates the deployment, waits for bids, accepts the cheapest, creates the
lease, waits until the workload is ready, and prints the live service URIs — in
one call. On failure it leaves the deployment OPEN and prints the exact retry or
close command.

Flags: `--accept cheapest|first|<provider>`, `--bid-timeout <s>`, `--timeout <s>`.

## Managing deployments

```
console-axi deployment list
console-axi deployment status <dseq>     # live readiness, URIs, forwarded ports
console-axi deployment view <dseq>       # state, escrow (USD), leases
console-axi deployment deposit <dseq> --amount 5
console-axi deployment close <dseq>      # idempotent
```

Atomic steps if you need them: `deployment create`, `bid list --dseq <dseq>`,
`lease create --dseq --gseq --oseq --provider --manifest`.

## Debugging a running workload

```
console-axi logs <dseq> --tail 100 [--follow] [--service <svc>]
console-axi events <dseq> [--follow]
console-axi exec <dseq> --service web -- <cmd...>   # captures stdout/stderr + exit code
console-axi shell <dseq> --service web              # interactive TTY
```

## Wallet & billing (all USD)

```
console-axi wallet balance                          # available / in-deployments / total
console-axi wallet settings --auto-reload true      # the only headless way to add funds
console-axi wallet cost
console-axi usage [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
```

## Keys & tokens

```
console-axi apikey list | create --name <n> | delete <id>
console-axi jwt create --ttl 300 --scope logs,shell
```

## Output & exit codes

All output is TOON. Exit codes: 0 = success or idempotent no-op, 1 = error,
2 = usage error. Errors are structured (`error: { code, exit, message }`) with a
`help[]` block naming the command that fixes the situation. Money is always USD.

## Session hook

`console-axi setup` installs a session-start hook that injects a compact status
view (auth, active deployment count, top deployments) at the start of each agent
session.
