import type { SdlDoc, SdlIssue, SdlService } from "./types.js";

/**
 * Best-practice rules that chain-sdk's `validateSDL` does not enforce but the
 * Console/awesome-akash conventions expect. Keep each rule small and pure so new
 * ones are easy to add.
 */
export function lintSdl(sdl: SdlDoc): SdlIssue[] {
  const issues: SdlIssue[] = [];
  for (const [name, svc] of Object.entries(sdl.services ?? {})) {
    checkImageTag(name, svc, issues);
  }
  checkPricingDenom(sdl, issues);
  return issues;
}

/** Pricing must be denominated in `uact` (micro-ACT, pegged 1:1 to USD). `uakt` no longer exists. */
function checkPricingDenom(sdl: SdlDoc, issues: SdlIssue[]): void {
  for (const [placement, p] of Object.entries(sdl.profiles?.placement ?? {})) {
    for (const [svc, price] of Object.entries(p?.pricing ?? {})) {
      const denom = price?.denom;
      if (typeof denom !== "string" || denom === "uact") continue;
      issues.push({
        path: `/profiles/placement/${placement}/pricing/${svc}/denom`,
        message: `Pricing denom "${denom}" is not accepted; deployments are priced in "uact" (micro-ACT, 1:1 USD).`,
        hint:
          denom === "uakt"
            ? `"uakt" no longer exists — use "uact", or regenerate with \`console-axi sdl init\`.`
            : `Change the denom to "uact".`
      });
    }
  }
}

/** Deployments must pin an explicit, reproducible image tag (no `:latest`, no bare name). */
function checkImageTag(name: string, svc: SdlService, issues: SdlIssue[]): void {
  const image = svc?.image;
  if (typeof image !== "string" || image.length === 0) return; // missing image is a schema error
  if (image.includes("@sha256:")) return; // digest-pinned is reproducible

  const tag = imageTag(image);
  if (tag === undefined) {
    issues.push({
      path: `/services/${name}/image`,
      message: `Image "${image}" has no tag; pin an explicit version for reproducible deployments.`,
      hint: `Use "${image}:<version>" instead of an untagged image.`
    });
  } else if (tag === "latest") {
    issues.push({
      path: `/services/${name}/image`,
      message: `Image "${image}" uses ":latest", which is not reproducible.`,
      hint: `Pin a specific version, e.g. "${image.replace(/:latest$/, "")}:1.2.3".`
    });
  }
}

/** Extract an image tag, ignoring a `host:port/` registry prefix. Returns undefined if untagged. */
function imageTag(image: string): string | undefined {
  const lastColon = image.lastIndexOf(":");
  const lastSlash = image.lastIndexOf("/");
  // A colon before the last slash belongs to a registry host:port, not a tag.
  if (lastColon === -1 || lastColon < lastSlash) return undefined;
  return image.slice(lastColon + 1);
}
