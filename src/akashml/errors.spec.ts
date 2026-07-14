import { describe, expect, it } from "vitest";

import { EXIT } from "../errors.js";
import { translateAkashmlError } from "./errors.js";

describe("translateAkashmlError", () => {
  it("maps 401 to unauthorized with a console-axi akashml login hint", () => {
    const error = translateAkashmlError(401, {});

    expect(error.code).toBe("unauthorized");
    expect(error.exitCode).toBe(EXIT.ERROR);
    expect(error.help).toContain("console-axi akashml login --with-key <key>");
  });

  it("maps 403 to unauthorized as well", () => {
    const error = translateAkashmlError(403, {});

    expect(error.code).toBe("unauthorized");
  });

  it("maps 402 to insufficient_funds, points at akashml.com, and is not retryable", () => {
    const error = translateAkashmlError(402, {});

    expect(error.code).toBe("insufficient_funds");
    expect(error.message).toMatch(/akashml\.com/);
    expect(error.details?.retryable).toBeUndefined();
  });

  it("maps 429 with a Retry-After header to rate_limited with details.retryAfter", () => {
    const error = translateAkashmlError(429, {}, "30");

    expect(error.code).toBe("rate_limited");
    expect(error.details).toMatchObject({ retryAfter: "30" });
  });

  it("maps 429 without a Retry-After header to rate_limited without details.retryAfter", () => {
    const error = translateAkashmlError(429, {});

    expect(error.code).toBe("rate_limited");
    expect(error.details?.retryAfter).toBeUndefined();
  });

  it.each([500, 504, 529])("maps %i to api_error, retryable", (status) => {
    const error = translateAkashmlError(status, {});

    expect(error.code).toBe("api_error");
    expect(error.details).toMatchObject({ status, retryable: "true" });
  });

  it("surfaces a server-provided message when present", () => {
    const error = translateAkashmlError(500, { message: "upstream is on fire" });

    expect(error.message).toBe("upstream is on fire");
  });
});
