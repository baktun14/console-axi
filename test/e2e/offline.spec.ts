import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeTestHome, type TestHome } from "./helpers/env.js";
import { runCli } from "./helpers/run-cli.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const HELLO_SDL = resolve(root, "examples/hello.yml");

describe("offline commands", () => {
  let home: TestHome;

  beforeEach(() => (home = makeTestHome()));
  afterEach(() => home.cleanup());

  it("no args shows the signed-out home view on exit 0", async () => {
    const result = await runCli([], { env: home.env() });

    expect(result.code).toBe(0);
    expect(result.toon()).toMatchObject({ bin: "console-axi", auth: "not signed in" });
    expect(result.toon().help).toEqual(["console-axi login --with-key <key>"]);
  });

  it("--help exits 0 and -v prints the package version", async () => {
    const help = await runCli(["--help"], { env: home.env() });
    const version = await runCli(["-v"], { env: home.env() });

    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Usage:");
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(pkg.version);
  });

  it("unknown commands exit 2 with the error on stderr, stdout clean", async () => {
    const result = await runCli(["frobnicate"], { env: home.env() });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain("frobnicate");
    expect(result.stdout).toBe("");
  });

  it("whoami without any key is a structured unauthorized error", async () => {
    const result = await runCli(["whoami"], { env: home.env() });

    expect(result.code).toBe(1);
    expect(result.toon()).toMatchObject({
      error: { code: "unauthorized", exit: 1 },
      help: ["console-axi login --with-key <key>"]
    });
  });

  it("sdl init output pipes into sdl validate via stdin", async () => {
    const init = await runCli(["sdl", "init", "web", "--image", "nginx:1.27", "--port", "80"], { env: home.env() });
    const validate = await runCli(["sdl", "validate", "-"], { env: home.env(), stdin: init.stdout });

    expect(init.code).toBe(0);
    expect(init.stdout).toContain("nginx:1.27");
    expect(validate.code).toBe(0);
    expect(validate.toon()).toMatchObject({ valid: true });
  });

  it("sdl validate accepts the bundled example and rejects garbage with exit 2", async () => {
    const good = await runCli(["sdl", "validate", HELLO_SDL], { env: home.env() });
    const bad = await runCli(["sdl", "validate", "-"], { env: home.env(), stdin: "services: {}\n" });

    expect(good.code).toBe(0);
    expect(good.toon()).toMatchObject({ valid: true });
    expect(bad.code).toBe(2);
    expect(bad.toon()).toMatchObject({ valid: false });
  });

  it("deploy rejects a deposit below the minimum before any network call", async () => {
    // Key set + API pointed at a closed port: a usage error (exit 2) proves the
    // deposit check fired before any HTTP (network errors exit 1).
    const result = await runCli(["deploy", "--sdl", HELLO_SDL, "--deposit", "0.1"], {
      env: home.env({ CONSOLE_API_KEY: "sk-test", CONSOLE_API_URL: "http://127.0.0.1:1" })
    });

    expect(result.code).toBe(2);
    expect(result.toon()).toMatchObject({ error: { code: "usage", exit: 2 } });
  });
});
