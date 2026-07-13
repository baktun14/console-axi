import type { Command } from "commander";

import { action,authedContext } from "../context.js";
import { AxiError } from "../errors.js";
import { printResult } from "../output/render.js";
import { formatEvent, formatLog, type K8sEventMessage, type LogEntryMessage } from "../provider-proxy/format.js";
import { providerLeaseUrl, resolveLeaseTarget } from "../provider-proxy/lease-target.js";
import { parseExitCode, ShellCode } from "../provider-proxy/shell-codes.js";
import { createTokenManager } from "../provider-proxy/token.js";
import { ProviderProxyRelay } from "../provider-proxy/ws.js";

/** Parse the string message payload the proxy relays (double-encoded JSON). */
function parsePayload<T>(message: unknown): T | undefined {
  if (message === undefined || message === null) return undefined;
  if (typeof message === "string") {
    try {
      return JSON.parse(message) as T;
    } catch {
      return undefined;
    }
  }
  return message as T;
}

/** Install a one-shot SIGINT handler that closes the relay for `--follow`. */
function onInterrupt(relay: ProviderProxyRelay): () => void {
  const handler = () => relay.close();
  process.once("SIGINT", handler);
  return () => process.removeListener("SIGINT", handler);
}

export function registerDebug(program: Command): void {
  program
    .command("logs <dseq>")
    .description("Fetch service logs (bulk by default, or --follow to stream)")
    .option("--service <service>", "filter to a single service")
    .option("--tail <n>", "number of trailing lines", "100")
    .option("--follow", "stream new log lines until interrupted")
    .action(
      action(async (dseq: string, opts: { service?: string; tail: string; follow?: boolean }, command: Command) => {
        const { config, client } = authedContext(command);
        const target = await resolveLeaseTarget(client, dseq);
        const follow = opts.follow ?? false;
        const params = new URLSearchParams({ follow: String(follow), tail: opts.tail });
        if (opts.service) params.set("service", opts.service);
        const providerUrl = `${providerLeaseUrl(target, "logs")}?${params.toString()}`;

        const relay = new ProviderProxyRelay({
          proxyUrl: config.providerProxyUrl,
          providerUrl,
          providerAddress: target.provider,
          ensureToken: createTokenManager(client, { ttl: follow ? 3600 : 300 }),
          maxRotations: follow ? 10 : 1
        });
        await relay.start();
        const detach = follow ? onInterrupt(relay) : () => {};

        let lines = 0;
        try {
          for await (const msg of relay.receive()) {
            if (msg.closed) break;
            const entry = parsePayload<LogEntryMessage>(msg.message);
            if (!entry?.message) continue;
            process.stdout.write(`${formatLog(entry)}\n`);
            lines++;
          }
        } finally {
          detach();
          relay.close();
        }
        if (lines === 0) printResult({ logs: "0 lines returned" });
      })
    );

  program
    .command("events <dseq>")
    .description("Fetch Kubernetes lease events (bulk by default, or --follow)")
    .option("--follow", "stream new events until interrupted")
    .action(
      action(async (dseq: string, opts: { follow?: boolean }, command: Command) => {
        const { config, client } = authedContext(command);
        const target = await resolveLeaseTarget(client, dseq);
        const follow = opts.follow ?? false;
        const providerUrl = `${providerLeaseUrl(target, "events")}?follow=${follow}`;

        const relay = new ProviderProxyRelay({
          proxyUrl: config.providerProxyUrl,
          providerUrl,
          providerAddress: target.provider,
          ensureToken: createTokenManager(client, { ttl: follow ? 3600 : 300 }),
          maxRotations: follow ? 10 : 1
        });
        await relay.start();
        const detach = follow ? onInterrupt(relay) : () => {};

        let count = 0;
        try {
          for await (const msg of relay.receive()) {
            if (msg.closed) break;
            const event = parsePayload<K8sEventMessage>(msg.message);
            if (!event) continue;
            process.stdout.write(`${formatEvent(event)}\n`);
            count++;
          }
        } finally {
          detach();
          relay.close();
        }
        if (count === 0) printResult({ events: "0 events returned" });
      })
    );

  program
    .command("exec <dseq> [cmd...]")
    .description("Run a command in a service and capture stdout/stderr + exit code")
    .requiredOption("--service <service>", "target service")
    .option("--replica <n>", "pod/replica index", "0")
    .action(
      action(async (dseq: string, cmd: string[], opts: { service: string; replica: string }, command: Command) => {
        if (cmd.length === 0) {
          throw new AxiError({ code: "usage", message: "Provide a command after `--`, e.g. exec <dseq> --service web -- ls -la" });
        }
        const { config, client } = authedContext(command);
        const target = await resolveLeaseTarget(client, dseq);

        const params = new URLSearchParams({ stdin: "0", tty: "0", podIndex: opts.replica, service: opts.service });
        cmd.forEach((c, i) => params.append(`cmd${i}`, c));
        const providerUrl = `${providerLeaseUrl(target, "shell")}?${params.toString()}`;

        const relay = new ProviderProxyRelay({
          proxyUrl: config.providerProxyUrl,
          providerUrl,
          providerAddress: target.provider,
          ensureToken: createTokenManager(client, { ttl: 300, scope: ["shell"] }),
          isBase64: true,
          maxRotations: 1
        });
        await relay.start();
        relay.sendData(new Uint8Array()); // kick off the remote command

        const decoder = new TextDecoder("utf-8");
        let stdout = "";
        let stderr = "";
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
            if (channel === ShellCode.Stderr) stderr += text;
            else stdout += text;
          }
        } finally {
          relay.close();
        }

        if (stdout) process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
        if (stderr) process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
        process.exitCode = exitCode;
      })
    );
}
