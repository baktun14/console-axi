import { decode } from "@toon-format/toon";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AxiError, EXIT } from "../errors.js";
import { printError, printResult } from "./render.js";

describe("render", () => {
  afterEach(() => vi.restoreAllMocks());

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

  function setup() {
    let written = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      written += chunk.toString();
      return true;
    });
    return { output: () => written };
  }
});
