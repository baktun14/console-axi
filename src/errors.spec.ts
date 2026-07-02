import { describe, expect, it } from "vitest";

import { AxiError, EXIT, translateApiError } from "./errors.js";

describe("translateApiError", () => {
  it("maps 401 to an unauthorized error with a login hint (exit 1)", () => {
    const error = translateApiError(401, {});

    expect(error.code).toBe("unauthorized");
    expect(error.exitCode).toBe(EXIT.ERROR);
    expect(error.help).toContain("console-axi login --with-key <key>");
  });

  it("maps 402 to insufficient_funds and surfaces the server message", () => {
    const error = translateApiError(402, { message: "Not enough funds to cover the fee" });

    expect(error.code).toBe("insufficient_funds");
    expect(error.message).toBe("Not enough funds to cover the fee");
    expect(error.help).toContain("console-axi wallet settings --auto-reload true");
  });

  it("maps 404 to not_found and includes dseq context when provided", () => {
    const error = translateApiError(404, {}, { dseq: "123" });

    expect(error.code).toBe("not_found");
    expect(error.details).toMatchObject({ dseq: "123" });
  });

  it("maps unknown statuses to api_error with the status in details", () => {
    const error = translateApiError(500, { error: "boom" });

    expect(error.code).toBe("api_error");
    expect(error.message).toBe("boom");
    expect(error.details).toMatchObject({ status: 500 });
  });
});

describe(AxiError.name, () => {
  it("defaults usage errors to exit code 2", () => {
    const error = new AxiError({ code: "usage", message: "bad flag" });

    expect(error.exitCode).toBe(EXIT.USAGE);
  });

  it("defaults non-usage errors to exit code 1", () => {
    const error = new AxiError({ code: "network", message: "offline" });

    expect(error.exitCode).toBe(EXIT.ERROR);
  });
});
