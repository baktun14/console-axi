import type { Command } from "commander";

import { action, authedContext } from "../context.js";
import { providerLeaseUrl, resolveLeaseTarget } from "../provider-proxy/lease-target.js";
import { frameStdin, parseExitCode, ShellCode } from "../provider-proxy/shell-codes.js";
import { createTokenManager } from "../provider-proxy/token.js";
import { ProviderProxyRelay } from "../provider-proxy/ws.js";

// Default shell command: prefer bash, fall back to sh (mirrors deploy-web).
const DEFAULT_ARGV = ["sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"];

export function registerShell(program: Command): void {
  program
    .command("shell <dseq>")
    .description("Open an interactive shell into a running service (human-oriented)")
    .requiredOption("--service <service>", "target service")
    .option("--replica <n>", "pod/replica index", "0")
    .action(
      action(async (dseq: string, opts: { service: string; replica: string }, command: Command) => {
        const { config, client } = authedContext(command);
        const target = await resolveLeaseTarget(client, dseq);

        const params = new URLSearchParams({ stdin: "1", tty: "1", podIndex: opts.replica, service: opts.service });
        DEFAULT_ARGV.forEach((c, i) => params.append(`cmd${i}`, c));
        const providerUrl = `${providerLeaseUrl(target, "shell")}?${params.toString()}`;

        const relay = new ProviderProxyRelay({
          proxyUrl: config.providerProxyUrl,
          providerUrl,
          providerAddress: target.provider,
          ensureToken: createTokenManager(client, { ttl: 3600, scope: ["shell"] }),
          isBase64: true,
          maxRotations: 5
        });
        await relay.start();
        relay.sendData(new Uint8Array()); // establish the session

        const stdin = process.stdin;
        const wasRaw = stdin.isTTY ? stdin.isRaw : false;
        if (stdin.isTTY) stdin.setRawMode(true);
        stdin.resume();
        const onData = (chunk: Buffer): void => relay.sendData(frameStdin(new Uint8Array(chunk)));
        stdin.on("data", onData);

        const decoder = new TextDecoder("utf-8");
        let exitCode = 0;
        try {
          for await (const msg of relay.receive()) {
            if (msg.closed) break;
            const data = (msg.message as { data?: number[] } | undefined)?.data;
            if (!data || data.length === 0) continue;
            const channel = data[0];
            const text = decoder.decode(Uint8Array.from(data.slice(1)));
            if (channel === ShellCode.Result || channel === ShellCode.Failure) {
              exitCode = parseExitCode(text) ?? (channel === ShellCode.Failure ? 1 : 0);
              break;
            }
            if (channel === ShellCode.Stderr) process.stderr.write(text);
            else process.stdout.write(text);
          }
        } finally {
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(wasRaw);
          stdin.pause();
          relay.close();
        }
        process.exitCode = exitCode;
      })
    );
}
