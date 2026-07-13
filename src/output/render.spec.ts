import { decode } from "@toon-format/toon";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AxiError, EXIT } from "../errors.js";
import { printError, printResult, resetOutputFormat, setOutputFormat } from "./render.js";

describe("render", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetOutputFormat();
  });

  describe("printResult", () => {
    it("emits the result as TOON on stdout", () => {
      const { output } = setup();

      printResult({ dseq: "123", state: "active" });

      expect(decode(output())).toMatchObject({ dseq: "123", state: "active" });
    });

    it("appends a help[] block when help is provided", () => {
      const { output } = setup();

      printResult({ ok: true }, { help: ["console-axi deployment list"] });

      expect(decode(output())).toMatchObject({ ok: true, help: ["console-axi deployment list"] });
    });

    it("omits help when the array is empty", () => {
      const { output } = setup();

      printResult({ ok: true }, { help: [] });

      expect(decode(output())).not.toHaveProperty("help");
    });
  });

  describe("printError", () => {
    it("renders a structured error and returns its exit code", () => {
      const { output } = setup();

      const exit = printError(new AxiError({ code: "not_found", message: "missing", details: { dseq: "9" } }));

      expect(exit).toBe(EXIT.ERROR);
      expect(decode(output())).toMatchObject({
        error: { code: "not_found", exit: 1, message: "missing", details: { dseq: "9" } }
      });
    });

    it("maps usage errors to exit code 2", () => {
      setup();

      const exit = printError(new AxiError({ code: "usage", message: "bad" }));

      expect(exit).toBe(EXIT.USAGE);
    });

    it("wraps unknown throwables as an internal error", () => {
      const { output } = setup();

      const exit = printError(new Error("kaboom"));

      expect(exit).toBe(EXIT.ERROR);
      expect(decode(output())).toMatchObject({ error: { code: "internal", message: "kaboom" } });
    });
  });

  describe("output format", () => {
    it("emits JSON when setOutputFormat('json') is active", () => {
      const { output } = setup();
      setOutputFormat("json");

      printResult({ dseq: "123", state: "active" }, { help: ["console-axi deployment list"] });

      expect(JSON.parse(output())).toEqual({
        dseq: "123",
        state: "active",
        help: ["console-axi deployment list"]
      });
    });

    it("keeps the error payload shape and exit code under JSON", () => {
      const { output } = setup();
      setOutputFormat("json");

      const exit = printError(new AxiError({ code: "not_found", message: "missing", details: { dseq: "9" } }));

      expect(exit).toBe(EXIT.ERROR);
      expect(JSON.parse(output())).toEqual({
        error: { code: "not_found", exit: 1, message: "missing", details: { dseq: "9" } }
      });
    });

    it("honors CONSOLE_AXI_OUTPUT=json from the environment", () => {
      const { output } = setup();
      vi.stubEnv("CONSOLE_AXI_OUTPUT", "json");

      printResult({ ok: true });

      expect(JSON.parse(output())).toEqual({ ok: true });
    });

    it("lets the flag override the environment", () => {
      const { output } = setup();
      vi.stubEnv("CONSOLE_AXI_OUTPUT", "toon");
      setOutputFormat("json");

      printResult({ ok: true });

      expect(JSON.parse(output())).toEqual({ ok: true });
    });

    it("falls back to TOON for unrecognized env values", () => {
      const { output } = setup();
      vi.stubEnv("CONSOLE_AXI_OUTPUT", "yaml");

      printResult({ ok: true });

      expect(() => JSON.parse(output())).toThrow();
      expect(decode(output())).toMatchObject({ ok: true });
    });
  });

  function setup() {
    let written = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written += chunk.toString();
      return true;
    });
    return { output: () => written };
  }
});
