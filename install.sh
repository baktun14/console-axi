#!/bin/sh
# console-axi installer.
#
#   curl -fsSL https://raw.githubusercontent.com/baktun14/console-axi/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/baktun14/console-axi/main/install.sh | sh -s -- --uninstall
#
# Env:
#   CONSOLE_AXI_VERSION   install a specific tag, e.g. v0.2.0 (default: latest)
#   CONSOLE_AXI_BIN_DIR   install location (default: ~/.local/bin)
#
# NOTE: downloads release assets from a PUBLIC GitHub repo. If the repo is private,
# assets are not anonymously downloadable — use: gh release download -R <repo>.
set -eu

REPO="baktun14/console-axi"
BIN_NAME="console-axi"
BIN_DIR="${CONSOLE_AXI_BIN_DIR:-$HOME/.local/bin}"

err() { echo "install.sh: error: $*" >&2; exit 1; }
info() { echo "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

download() { # url dest [quiet]
  # Show a progress bar for interactive installs (stderr is a TTY); stay silent
  # for the tiny SHA256SUMS fetch and in non-interactive/piped contexts.
  if have curl; then
    if [ "${3:-}" != quiet ] && [ -t 2 ]; then
      curl -fSL --progress-bar "$1" -o "$2"
    else
      curl -fsSL "$1" -o "$2"
    fi
  elif have wget; then
    if [ "${3:-}" != quiet ] && [ -t 2 ]; then
      wget -q --show-progress -O "$2" "$1"
    else
      wget -qO "$2" "$1"
    fi
  else
    err "need curl or wget"
  fi
}

detect_asset() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) err "unsupported OS '$os' (macOS/Linux only)" ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) err "unsupported architecture '$arch'" ;;
  esac
  ASSET="console-axi-${os}-${arch}.gz"
}

verify_checksum() { # file sumsfile asset
  tool=""
  if have sha256sum; then
    tool="sha256sum"
  elif have shasum; then
    tool="shasum -a 256"
  fi
  if [ -z "$tool" ]; then
    info "warning: no sha256 tool found; skipping checksum verification"
    return 0
  fi
  expected=$(awk -v f="$3" '($2==f)||($2=="*"f){print $1; exit}' "$2")
  [ -n "$expected" ] || err "no checksum listed for $3"
  actual=$($tool "$1" | awk '{print $1}')
  [ "$expected" = "$actual" ] || err "checksum mismatch for $3 (expected $expected, got $actual)"
}

do_install() {
  detect_asset
  base="https://github.com/$REPO/releases"
  if [ -n "${CONSOLE_AXI_VERSION:-}" ]; then
    url="$base/download/$CONSOLE_AXI_VERSION/$ASSET"
    sums="$base/download/$CONSOLE_AXI_VERSION/SHA256SUMS"
    label="$CONSOLE_AXI_VERSION"
  else
    url="$base/latest/download/$ASSET"
    sums="$base/latest/download/SHA256SUMS"
    label="latest"
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  info "downloading $BIN_NAME ($ASSET, $label) ..."
  download "$url" "$tmp/$ASSET" ||
    err "download failed. If the repo is private, run: gh release download -R $REPO -p '$ASSET'"

  if download "$sums" "$tmp/SHA256SUMS" quiet 2>/dev/null; then
    verify_checksum "$tmp/$ASSET" "$tmp/SHA256SUMS" "$ASSET"
  else
    info "warning: SHA256SUMS not found; skipping checksum verification"
  fi

  mkdir -p "$BIN_DIR"
  # Decompress the gzip asset into the final binary.
  gunzip -c "$tmp/$ASSET" > "$tmp/$BIN_NAME" 2>/dev/null ||
    gzip -dc "$tmp/$ASSET" > "$tmp/$BIN_NAME" ||
    err "failed to decompress $ASSET"
  mv "$tmp/$BIN_NAME" "$BIN_DIR/$BIN_NAME"
  chmod +x "$BIN_DIR/$BIN_NAME"
  info "installed $BIN_DIR/$BIN_NAME"

  # Install the Claude session hook + skill via the freshly installed binary.
  "$BIN_DIR/$BIN_NAME" setup >/dev/null 2>&1 ||
    info "note: run '$BIN_NAME setup' to install the agent hook + skill"

  echo ""
  echo "console-axi installed."
  case ":$PATH:" in
    *":$BIN_DIR:"*) : ;;
    *) echo "  Add to PATH:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
  esac
  echo "  Authenticate: $BIN_NAME login --with-key <KEY>   (get one at https://console.akash.network/user/api-keys)"
  echo "  Update:       $BIN_NAME upgrade"
  echo "  Remove:       $BIN_NAME uninstall   (or: curl -fsSL <this-url> | sh -s -- --uninstall)"
}

do_uninstall() {
  purge=""
  [ "${PURGE:-0}" = "1" ] && purge="--purge"

  bin=""
  if have "$BIN_NAME"; then
    bin=$(command -v "$BIN_NAME")
  elif [ -x "$BIN_DIR/$BIN_NAME" ]; then
    bin="$BIN_DIR/$BIN_NAME"
  fi

  if [ -n "$bin" ]; then
    # Let the binary remove the hook, skill, and (optionally) config; we delete the file.
    "$bin" uninstall --no-self $purge >/dev/null 2>&1 || true
    rm -f "$bin"
    info "removed $bin"
  else
    info "$BIN_NAME not found on PATH or in $BIN_DIR; nothing to remove"
  fi
  echo "console-axi uninstalled."
}

main() {
  action="install"
  for arg in "$@"; do
    case "$arg" in
      --uninstall) action="uninstall" ;;
      --purge) PURGE=1 ;;
      -h | --help)
        echo "Usage: install.sh [--uninstall] [--purge]"
        exit 0
        ;;
      *) err "unknown argument: $arg" ;;
    esac
  done
  if [ "$action" = "uninstall" ]; then
    do_uninstall
  else
    do_install
  fi
}

main "$@"
