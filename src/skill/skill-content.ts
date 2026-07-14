/**
 * The console-axi Agent Skill, embedded as a string so the compiled standalone
 * binary can install it (there is no packaged `skills/` dir on disk at runtime).
 * `scripts/gen-skill.ts` also writes this to skills/console-axi/SKILL.md for the
 * repo copy shipped in the npm tarball and seeding the upstream
 * akash-network/akash-skill contribution.
 *
 * This is the single source of truth for the skill content. It must describe only
 * commands that exist in this branch's CLI.
 */
export const SKILL_MD = `---
name: console-axi
description: Deploy and manage Akash Network workloads through the Console managed wallet. Use for "deploy to Akash", "write/validate an Akash SDL", "check my Akash deployment", "stream Akash logs", "run a command in my Akash service", or managing bids, leases, wallet balance, and API keys via console-axi.
---

# console-axi

\`console-axi\` is an AXI CLI for the Akash Console managed-wallet API. It emits
token-efficient TOON output, is content-first, and every command suggests the
next step in a \`help[]\` block. Deployments are signed server-side by the managed
wallet — you never handle private keys.

## Install

\`\`\`
curl -fsSL https://raw.githubusercontent.com/baktun14/console-axi/main/install.sh | sh
\`\`\`

Then keep it current with \`console-axi upgrade\`; remove it with \`console-axi uninstall\`.

## Auth

Set a key once. Get it from the Console web UI (/user/api-keys) or \`apikey create\`.

\`\`\`
console-axi login --with-key <key>     # or export CONSOLE_API_KEY=<key>
console-axi whoami
\`\`\`

## Building a valid SDL

Every deployment needs a valid SDL (the YAML describing your app). You act as the
wizard: interview the user, scaffold an SDL with \`sdl init\`, then validate it
before deploying — never hand-write a half-formed SDL.

Ask only what you don't already know, roughly in this order:

1. What are you deploying? (web service, GPU/ML workload, app + database, or something needing a dedicated public IP)
2. Container image **and tag**? An explicit tag is required — never \`:latest\`.
3. Which port does it listen on, and should it be reachable from the internet?
4. Resources: CPU cores, memory, disk. GPU? which model (e.g. a100, h100)?
5. Persistent storage (database, uploads)? how much?
6. Replica count? Region/provider constraints? Rough monthly budget?

Then run the loop:

\`\`\`
console-axi sdl templates                                   # list scaffolds
console-axi sdl init web --image nginx:1.27 --port 80 > app.yml
console-axi sdl validate app.yml                            # offline: schema + best-practice checks
console-axi sdl screen app.yml                              # live: which providers could bid (probe supply)
console-axi deploy --sdl app.yml --deposit 0.5
\`\`\`

\`sdl init <template>\` prints raw SDL YAML to stdout — redirect it to a file or pipe
into \`sdl validate -\`. Templates: \`web\`, \`gpu\`, \`multi-service\`, \`ip-lease\`. Common
flags: \`--image --port --as --cpu --memory --storage --count --price --env K=V\`
(plus \`--gpu --gpu-model\` for the \`gpu\` template).

**Pricing denom:** SDL pricing is always denominated in \`uact\` (micro-ACT, pegged
1:1 to USD). Never use \`uakt\` — it no longer exists, and the CLI rejects any SDL
whose pricing denom isn't \`uact\` before spending a deposit. \`sdl init\` templates
already emit \`uact\`, so scaffolding avoids the problem entirely.

**Deposit:** deposits are in USD dollars; the **minimum is $0.5**. Use
\`--deposit 0.5\` unless the user wants more escrow headroom. Anything below $0.5 is
rejected client-side.

\`sdl validate\` exits 2 on an invalid SDL and lists each problem with a fix hint;
edit the SDL and re-run until it passes. \`sdl screen\` needs no API key.

\`sdl screen\` probes the network's real-time supply and lists the providers whose
inventory could match (with region, org, audit status, 7-day downtime). It is advisory
only — providers may run custom bid scripts, so a match is not a guaranteed bid. It takes
an SDL, resource flags, or both:

\`\`\`
console-axi sdl screen app.yml                              # from an SDL
console-axi sdl screen --cpu 4 --memory 8Gi --gpu 1 --gpu-model a100   # no SDL: probe raw resources
console-axi sdl screen app.yml --memory 32Gi                # override the SDL's resources
console-axi sdl screen --cpu 1 --memory 1Gi --attribute region=us-west --signed-by <auditor>
\`\`\`

Flags: \`--cpu --memory --storage --gpu --gpu-model --count\` (resources), \`--attribute K=V\`
and \`--signed-by <addr>\` (repeatable placement filters), \`--reclamation-window <seconds>\`.
When flags and a file are combined, the flags override the SDL's resources/requirements.

\`deploy\`, \`deployment create\` and \`deployment update\` validate the SDL client-side
first and refuse to broadcast an invalid one; pass \`--skip-validation\` to override.
\`deploy\` also runs \`sdl screen\` up front and aborts before spending the deposit when
zero providers match; pass \`--skip-screening\` to override (a screening outage never blocks).

## The fast path: deploy

\`\`\`
console-axi deploy --sdl app.yml --deposit 0.5
\`\`\`

This creates the deployment, waits for bids, accepts the cheapest, creates the
lease, waits until the workload is ready, and prints the live service URIs plus a
\`console:\` deep-link to the deployment in the Console web UI — in one call. On
failure it leaves the deployment OPEN and prints the exact retry or close command.

Flags: \`--accept cheapest|first|<provider>\`, \`--bid-timeout <s>\`, \`--timeout <s>\`.

## Managing deployments

\`\`\`
console-axi deployment list
console-axi deployment status <dseq>     # live readiness, URIs, forwarded ports
console-axi deployment view <dseq>       # state, escrow (USD), leases
console-axi deployment deposit <dseq> --amount 0.5
console-axi deployment close <dseq>      # idempotent
\`\`\`

Every single-deployment command prints a \`console:\` link
(https://console.akash.network/deployments/<dseq>) so a human can open the web UI.

Atomic steps if you need them: \`deployment create\`, \`bid list --dseq <dseq>\`,
\`lease create --dseq --gseq --oseq --provider --manifest\`.

## Debugging a running workload

\`\`\`
console-axi logs <dseq> --tail 100 [--follow] [--service <svc>]
console-axi events <dseq> [--follow]
console-axi exec <dseq> --service web -- <cmd...>   # captures stdout/stderr + exit code
console-axi shell <dseq> --service web              # interactive TTY
\`\`\`

## Wallet & billing (all USD)

\`\`\`
console-axi wallet balance                          # available / in-deployments / total
console-axi wallet settings --auto-reload true      # the only headless way to add funds
console-axi wallet cost
console-axi usage [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
\`\`\`

## Keys & tokens

\`\`\`
console-axi apikey list | create --name <n> | delete <id>
console-axi jwt create --ttl 300 --scope logs,shell
\`\`\`

## Output & exit codes

All output is TOON. Exit codes: 0 = success or idempotent no-op, 1 = error,
2 = usage error. Errors are structured (\`error: { code, exit, message }\`) with a
\`help[]\` block naming the command that fixes the situation. Money is always USD.

## Session hook

\`console-axi setup\` installs a session-start hook that injects a compact status
view (auth, active deployment count, top deployments) at the start of each agent
session, and installs this skill. \`console-axi uninstall\` reverses both.

## AkashML inference

AkashML (https://akashml.com) is Akash's managed LLM inference API — an
OpenAI/Anthropic-compatible surface for open-source models running on Akash
compute. It has its own key and login state, separate from the Console auth above.

\`\`\`
console-axi akashml login --with-key <akml-...>   # or export AKASHML_API_KEY=<key>
console-axi akashml models                         # id, ctx, maxOut, price/1M tokens, features, quant
console-axi akashml chat --model <id> "hello"      # streams raw text to stdout
\`\`\`

\`--model\` is always required — there is no stored default; \`akashml models\`
is the discovery path. Filter the list with \`--model <substring>\`, \`--tools\`,
\`--reasoning\`.

\`chat\` flags: \`--system <text>\`, \`--max-tokens <n>\`, \`--temperature <n>\`,
\`--no-stream\` (one structured response instead of a stream), \`--effort
minimal|low|medium|high|xhigh\`, \`--reasoning-max-tokens <n>\`,
\`--show-reasoning\` (reasoning deltas go to stderr, never stdout). \`--json\`
gives structured output instead of a stream. The prompt is the trailing args,
or stdin when omitted or passed as \`-\`.

Point a coding agent at AkashML with \`setup\`:

\`\`\`
console-axi akashml setup --agent claude --model <id>              # ~/.claude/settings.json
console-axi akashml setup --agent claude --model <id> --project    # ./.claude/settings.local.json
export AKASHML_API_KEY=<key>   # codex/opencode read the key from env only
console-axi akashml setup --agent codex --model <id>
console-axi akashml setup --agent opencode --model <id>
console-axi akashml setup --agent claude --remove                  # undo
\`\`\`

\`--agent claude\` also accepts \`--sonnet --opus --haiku <id>\` tier overrides
(each defaults to \`--model\`). \`setup\` validates every \`--model\` id against
the live AkashML catalog before writing config; pass \`--no-verify\` to skip
that check. codex and opencode reference the key by env var
reference only — it is never written into their config files, so export
\`AKASHML_API_KEY\` in your shell profile first. \`akashml logout\` removes only
the AkashML key (Console \`logout\` is untouched); \`uninstall\` sweeps AkashML
agent configs too.
`;
