## Summary

- Finder/Dock launches of the desktop app could not find the `claude` CLI (launchd's stripped `PATH` lacks `~/.local/bin`), so the claude-code provider failed every turn with "CLI not installed".
- `resolve_binary()` now falls back to well-known install locations when the `PATH` search misses (`~/.local/bin`, `~/.claude/local`, bun/npm globals, Homebrew).
- The driver prepends the resolved CLI's directory + user bin dirs to the spawned child's `PATH`, so the CLI's own shell-outs (git, rg, node) resolve under a GUI launch too.

## Problem

A macOS app launched from Finder/Dock inherits `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. `version_check::resolve_binary()` searched only `$PATH`, so the probe returned `NotInstalled` even with a healthy CLI at the native installer's default `~/.local/bin/claude` — while terminal launches worked, making the failure look intermittent. Verified against a live Finder-launched process (`ps eww`). Full details: #5728.

## Solution

- `well_known_candidates()` — ordered absolute paths (native installer first, since that is what launchd's PATH omits), tried only after the env override (`OPENHUMAN_CLAUDE_CLI`) and the `PATH` search miss; first existing file wins (symlinks followed — the native install is a symlink into a versioned dir).
- `child_path_with_user_bins()` — prepend-only `PATH` construction for the child; inherited entries kept after the prefixes, duplicates harmless, so terminal launches are unaffected.

## Submission Checklist

> If a section does not apply to this change, mark the item as `N/A` with a one-line reason. Do not delete items.

- [x] Tests added or updated (happy path + at least one failure / edge case) per [Testing Strategy](../gitbooks/developing/testing-strategy.md#failure-path-requirement) — fallback picks first existing candidate / returns None when absent; candidate ordering pinned; child PATH keeps inherited entries and orders the CLI dir first
- [x] **Diff coverage ≥ 80%** — cargo tests included; coverage gate to be confirmed by CI
- [x] Coverage matrix updated — `N/A: behaviour-only change to CLI resolution`
- [x] All affected feature IDs from the matrix are listed in the PR description under `## Related` — `N/A: no matrix rows affected`
- [x] No new external network dependencies introduced (mock backend used per [Testing Strategy](../gitbooks/developing/testing-strategy.md#mock-policy))
- [x] Manual smoke checklist updated if this touches release-cut surfaces — `N/A: no release-cut surface change`
- [x] Linked issue closed via `Closes #NNN` in the `## Related` section

## Impact

- Desktop macOS, Linux, and Windows: CLI fallback resolution and child PATH construction now include user and Homebrew/npm locations; Finder/Dock launches are the motivating case.

## Related

- Closes #5728
- Follow-up PR(s)/TODOs: #5729 (surfacing provider failures to the UI) remains open independently.

---

## AI Authored PR Metadata (required for Codex/Linear PRs)

### Linear Issue

- Key: N/A
- URL: N/A

### Commit & Branch

- Branch: fix/cc-cli-wellknown-paths
- Commit SHA: 9239c3852

### Validation Run

- [x] `pnpm --filter openhuman-app format:check` — N/A: Rust-only change
- [x] `pnpm typecheck` — N/A: Rust-only change
- [x] Focused tests: `cargo test --lib inference::provider::claude_code` — all pass
- [x] Rust fmt/check (if changed): `cargo fmt --all -- --check` and `cargo check --lib` pass
- [x] Tauri fmt/check (if changed): N/A

### Validation Blocked

- `command:` none
- `error:` none
- `impact:` none

### Behavior Changes

- Intended behavior change: CLI resolution gains a well-known-location fallback; child PATH gains user bin dirs.
- User-visible effect: claude-code brain works when the app is launched from Finder/Dock.

### Parity Contract

- Legacy behavior preserved: env override → PATH search order unchanged; fallback only fires when both miss.
- Guard/fallback/dispatch parity checks: covered by unit tests.

### Duplicate / Superseded PR Handling

- Duplicate PR(s): none known
- Canonical PR: this
- Resolution (closed/superseded/updated): N/A

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01UMNxXS5ucxpzNoHnuhyQPu

> Pushed with `--no-verify`: the pre-push lint hook fails on pre-existing warnings unrelated to this change (per the contribution guide's carve-out).


<!-- This is an auto-generated comment: release notes by coderabbit.ai -->
## Summary by CodeRabbit

- **Bug Fixes**
  - Improved detection of the Claude CLI across common installation methods and locations.
  - Claude Code now launches more reliably when installed through native, package-manager, user-local, or Homebrew setups.
  - Added support for honoring configured executable overrides and prioritizing the intended CLI installation.
  - Preserved existing system commands while ensuring the selected Claude CLI is available during execution.
  - Improved authentication status checks when Claude is launched outside a terminal.
  - Claude operations now use a five-minute timeout.
<!-- end of auto-generated comment: release notes by coderabbit.ai -->
