import { describe, expect, it } from "vitest";

import { consoleDeploymentUrl } from "./console-url.js";

describe("consoleDeploymentUrl", () => {
  it("builds the Console deployment-detail URL from the web base and dseq", () => {
    expect(consoleDeploymentUrl("https://console.akash.network", "1782746892796")).toBe(
      "https://console.akash.network/deployments/1782746892796"
    );
  });

  it("tolerates a trailing slash on the web base", () => {
    expect(consoleDeploymentUrl("https://console.akash.network/", "123")).toBe(
      "https://console.akash.network/deployments/123"
    );
  });

  it("honors a custom (non-prod) web base", () => {
    expect(consoleDeploymentUrl("https://staging.console.example", "999")).toBe(
      "https://staging.console.example/deployments/999"
    );
  });
});
