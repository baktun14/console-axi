import { describe, expect, it } from "vitest";

import { frameStdin, parseExitCode, ShellCode } from "./shell-codes.js";

describe("frameStdin", () => {
  it("prefixes the stdin channel code to the payload", () => {
    const framed = frameStdin(new Uint8Array([1, 2, 3]));

    expect(framed[0]).toBe(ShellCode.Stdin);
    expect(Array.from(framed.slice(1))).toEqual([1, 2, 3]);
  });
});

describe("parseExitCode", () => {
  it("extracts exit_code from a status frame", () => {
    expect(parseExitCode('{"exit_code":0}')).toBe(0);
    expect(parseExitCode('{"exit_code":137,"message":"killed"}')).toBe(137);
  });

  it("returns undefined for ordinary output", () => {
    expect(parseExitCode("hello world")).toBeUndefined();
    expect(parseExitCode('{"not":"a status"}')).toBeUndefined();
  });

  it("returns undefined for malformed JSON that mentions exit_code", () => {
    expect(parseExitCode('{"exit_code": }')).toBeUndefined();
  });
});
