import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  clean: true,
  minify: false,
  sourcemap: true,
  // Dependencies are externalized (tsup default) and resolved by npm/npx at
  // install time. Bundling CJS deps like `ws` into ESM breaks on dynamic
  // require(), so we keep them external rather than inlining.
  banner: { js: "#!/usr/bin/env node" }
});
