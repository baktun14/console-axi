import { Command, CommanderError } from "commander";

import { registerApiKey } from "./commands/apikey.js";
import { registerAuth } from "./commands/auth.js";
import { registerDeploy } from "./commands/deploy.js";
import { registerDeployment } from "./commands/deployment.js";
import { registerHome } from "./commands/home.js";
import { registerJwt } from "./commands/jwt.js";
import { registerBid, registerLease } from "./commands/market.js";
import { registerProvider } from "./commands/provider.js";
import { registerSdl } from "./commands/sdl.js";
import { registerSetup } from "./commands/setup.js";
import { registerShell } from "./commands/shell.js";
import { registerUninstall } from "./commands/uninstall.js";
import { registerUpgrade } from "./commands/upgrade.js";
import { registerUsage, registerWallet } from "./commands/wallet.js";
import { printError } from "./output/render.js";
import { maybeNotifyUpdate, registerUpdateCheck, scheduleRefresh } from "./update/check.js";
import { VERSION } from "./version.js";

/** Commander codes that are informational, not failures. */
const INFO_CODES = new Set(["commander.helpDisplayed", "commander.version", "commander.help"]);

function buildProgram(): Command {
  const program = new Command();
  program
    .name("console-axi")
    .description("AXI CLI for the Akash Console managed-wallet API (token-efficient TOON output for agents)")
    .version(VERSION, "-v, --version")
    .option("--url <url>", "override the Console API base URL")
    .option("--no-update-check", "skip the daily check for a newer console-axi")
    .showHelpAfterError(false)
    .exitOverride()
    .configureOutput({
      // Route commander's own errors (e.g. unknown command) through our exit codes.
      outputError: (str) => process.stderr.write(str)
    });

  registerHome(program);
  registerAuth(program);
  registerSetup(program);
  registerSdl(program);
  registerDeploy(program);
  registerDeployment(program);
  registerBid(program);
  registerLease(program);
  registerWallet(program);
  registerUsage(program);
  registerProvider(program);
  registerShell(program);
  registerApiKey(program);
  registerJwt(program);
  registerUpgrade(program);
  registerUninstall(program);
  registerUpdateCheck(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();

  // Surface a cached "update available" nudge (stderr only) and refresh the
  // marker in the background — unless we ARE the background refresh child.
  if (!process.argv.includes("__update-check")) {
    maybeNotifyUpdate(VERSION);
    scheduleRefresh();
  }

  try {
    // No args -> content-first home view (AXI principle 8).
    if (process.argv.length <= 2) {
      await program.parseAsync(["home"], { from: "user" });
    } else {
      await program.parseAsync(process.argv);
    }
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help/version already printed their content; treat as success.
      process.exitCode = INFO_CODES.has(error.code) ? 0 : 2;
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  // Errors thrown by our own action wrappers already set exitCode; this is the
  // last-resort net for anything unexpected escaping the command layer.
  process.exitCode = printError(error);
});
