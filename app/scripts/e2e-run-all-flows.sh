#!/usr/bin/env bash
#
# Run all E2E WDIO specs sequentially (Appium restarted per spec).
# Auto-builds the E2E app bundle when the existing build is missing or stale.
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

resolve_app_artifact() {
  local os
  os="$(uname)"
  case "$os" in
    Darwin)
      echo "$APP_DIR/src-tauri/target/debug/bundle/macos/OpenHuman.app"
      ;;
    Linux)
      echo "$APP_DIR/src-tauri/target/debug/OpenHuman"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "$APP_DIR/src-tauri/target/debug/OpenHuman.exe"
      ;;
    *)
      echo "$APP_DIR/src-tauri/target/debug/OpenHuman"
      ;;
  esac
}

needs_e2e_build() {
  local artifact="$1"

  if [ ! -e "$artifact" ]; then
    echo "E2E artifact missing: $artifact"
    return 0
  fi

  if [ "$APP_DIR/package.json" -nt "$artifact" ]; then
    echo "E2E artifact older than package.json"
    return 0
  fi

  if [ "$APP_DIR/test/wdio.conf.ts" -nt "$artifact" ]; then
    echo "E2E artifact older than test/wdio.conf.ts"
    return 0
  fi

  local stale_file
  stale_file="$(find "$APP_DIR/src" "$APP_DIR/src-tauri" \
    -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.rs' -o -name '*.json' \) \
    -newer "$artifact" \
    -print -quit 2>/dev/null || true)"
  if [ -n "$stale_file" ]; then
    echo "E2E artifact older than source file: $stale_file"
    return 0
  fi

  return 1
}

ensure_fresh_e2e_build() {
  if [ "${E2E_SKIP_BUILD:-0}" = "1" ]; then
    echo "Skipping E2E build freshness check (E2E_SKIP_BUILD=1)."
    return
  fi

  local artifact
  artifact="$(resolve_app_artifact)"
  if needs_e2e_build "$artifact"; then
    echo "Building fresh E2E app bundle before running flows..."
    "$APP_DIR/scripts/e2e-build.sh"
  else
    echo "Using existing fresh E2E app bundle: $artifact"
  fi
}

run() {
  "$APP_DIR/scripts/e2e-run-spec.sh" "$1" "$2"
}

ensure_fresh_e2e_build

# run "test/e2e/specs/app-lifecycle.spec.ts" "app-lifecycle"
# run "test/e2e/specs/login-flow.spec.ts" "login"
# run "test/e2e/specs/auth-access-control.spec.ts" "auth"
# run "test/e2e/specs/settings-capabilities.spec.ts" "settings-capabilities"
run "test/e2e/specs/conversations-web-channel-flow.spec.ts" "conversations"
# run "test/e2e/specs/voice-mode.spec.ts" "voice"
# run "test/e2e/specs/screen-intelligence.spec.ts" "screen-intelligence"
# run "test/e2e/specs/skills-registry.spec.ts" "skills-registry"
# run "test/e2e/specs/skill-execution-flow.spec.ts" "skill-execution"
# run "test/e2e/specs/telegram-flow.spec.ts" "telegram"
# run "test/e2e/specs/gmail-flow.spec.ts" "gmail"
# run "test/e2e/specs/notion-flow.spec.ts" "notion"

echo "All E2E flows completed."
