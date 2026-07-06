#!/bin/sh
# Cross-compile standalone console-axi binaries with Bun, then checksum them.
# The version is baked automatically: src/version.ts imports package.json, which
# Bun inlines into the compiled binary. Requires: bun (https://bun.sh).
set -eu

OUT="${OUT:-dist-bin}"
ENTRY="src/cli.ts"
TARGETS="bun-darwin-arm64 bun-darwin-x64 bun-linux-x64 bun-linux-arm64"

command -v bun >/dev/null 2>&1 || { echo "error: bun is required (https://bun.sh)"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

for target in $TARGETS; do
  suffix=${target#bun-}                     # e.g. darwin-arm64
  echo "building console-axi-$suffix ..."
  bun build "$ENTRY" --compile --minify --target="$target" --outfile "$OUT/console-axi-$suffix"
done

# Regenerate the packaged skill so the release also ships the current SKILL.md.
npm run --silent gen:skill || true

echo "checksums ..."
(
  cd "$OUT"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum console-axi-* > SHA256SUMS
  else
    shasum -a 256 console-axi-* > SHA256SUMS
  fi
)

echo "done -> $OUT"
ls -la "$OUT"
