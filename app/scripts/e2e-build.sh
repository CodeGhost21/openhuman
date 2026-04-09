#!/usr/bin/env bash
#
# Build the app for E2E tests with the mock server URL baked in.
#
# - macOS: builds a .app bundle (Appium Mac2)
# - Linux: builds a debug binary (tauri-driver)
#
# Cargo incremental builds are used by default for faster iteration.
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
cd "$APP_DIR"

# Source Cargo environment
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

export VITE_BACKEND_URL="http://127.0.0.1:${E2E_MOCK_PORT:-18473}"

# Disable ggml/whisper.cpp native CPU detection (-mcpu=native) which is
# unsupported by Apple Clang 16 on arm64 and unnecessary for E2E test builds.
# whisper-rs-sys build.rs forwards any GGML_* env var as a CMake define.
export GGML_NATIVE=OFF

echo "Building E2E app with VITE_BACKEND_URL=$VITE_BACKEND_URL"

if [ -n "${E2E_FORCE_CARGO_CLEAN:-}" ]; then
  echo "Forcing cargo clean (E2E_FORCE_CARGO_CLEAN is set)."
  cargo clean --manifest-path src-tauri/Cargo.toml
else
  echo "Skipping cargo clean (default incremental E2E build)."
fi

if [ -f .env ]; then
  # shellcheck source=/dev/null
  source "$REPO_ROOT/scripts/load-dotenv.sh"
else
  echo "No .env file — skipping load-dotenv (optional for CI)."
fi

export VITE_BACKEND_URL="http://127.0.0.1:${E2E_MOCK_PORT:-18473}"

# Stage rust-core sidecar for bundle.externalBin (see app/src-tauri/tauri.conf.json).
node "$REPO_ROOT/scripts/stage-core-sidecar.mjs"

# Disable updater artifacts for E2E bundles to avoid signing-key requirements.
TAURI_CONFIG_OVERRIDE='{"bundle":{"createUpdaterArtifacts":false}}'
# Tauri CLI maps env CI to --ci and only accepts true|false; some runners set CI=1.
case "${CI:-}" in 1) export CI=true ;; 0) export CI=false ;; esac

# Resolve Tauri CLI via Node.js module resolution — handles both workspace-local
# and Yarn-hoisted package locations, and returns a native Windows path on Windows
# (avoiding Git Bash Unix-path → Windows-path conversion issues with node_modules).
TAURI_NODE_BIN="$(command -v node)"
if [ -z "${TAURI_NODE_BIN:-}" ]; then
  echo "ERROR: node not found in PATH." >&2
  exit 1
fi
TAURI_CLI_JS="$("$TAURI_NODE_BIN" -e "process.stdout.write(require.resolve('@tauri-apps/cli/tauri.js'))" 2>/dev/null || true)"
if [ -z "${TAURI_CLI_JS:-}" ]; then
  echo "ERROR: Cannot resolve @tauri-apps/cli/tauri.js — run 'yarn install --frozen-lockfile' first." >&2
  exit 1
fi
echo "Tauri CLI resolved: $TAURI_CLI_JS"

OS="$(uname)"
# Normalize Windows (Git Bash / MSYS2 / Cygwin) to a single token
case "$OS" in MINGW*|MSYS*|CYGWIN*) OS="Windows" ;; esac

if [ "$OS" = "Linux" ]; then
  # Linux: debug binary only — tauri-driver drives the raw binary, no bundle needed
  echo "Building for Linux (debug binary, no bundle)..."
  "$TAURI_NODE_BIN" "$TAURI_CLI_JS" build -c "$TAURI_CONFIG_OVERRIDE" --debug --no-bundle
elif [ "$OS" = "Windows" ]; then
  # Windows: debug binary only — tauri-driver drives OpenHuman.exe directly
  echo "Building for Windows (debug binary, no bundle)..."
  "$TAURI_NODE_BIN" "$TAURI_CLI_JS" build -c "$TAURI_CONFIG_OVERRIDE" --debug --no-bundle
else
  # macOS: .app bundle required for Appium Mac2 / XCUITest
  echo "Building for macOS (.app bundle)..."
  "$TAURI_NODE_BIN" "$TAURI_CLI_JS" build -c "$TAURI_CONFIG_OVERRIDE" --bundles app --debug
fi

echo "E2E build complete."
