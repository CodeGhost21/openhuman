# Memory Tree Per-Integration Health — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a true per-integration health status (Active / Stale / Error) plus provider icons to the existing `MemorySources` list under the Memory Tree status panel (#2763, Part 3 of #1856).

**Architecture:** Two thin core additions feed one frontend enhancement. (1) `composio/periodic.rs` gains an in-memory last-error map (sibling to the existing last-success map) populated at the periodic sync failure site and cleared on success. (2) `sync_status` gains an `IntegrationHealth` classifier and three new fields on `MemorySyncStatus`, finalized in the existing `memory_sync_status_list` RPC. (3) `MemorySources.tsx` swaps its freshness badge for a health badge, adds a provider icon via `composioToolkitMeta`, and shows the error message inline. No new component, no new RPC method, no SQLite.

**Tech Stack:** Rust (lib crate `openhuman`, rusqlite, tokio), React + TypeScript (Vitest, @testing-library/react), i18n chunk files.

**Spec:** `docs/superpowers/specs/2026-05-29-memory-tree-integration-health-design.md`. (Note: the spec said i18n keys live in chunk 1; the correct chunk for the `sync.*` namespace is **chunk 3** — this plan is authoritative.)

**Worktree:** `/Users/ghostscripter/Zerolend/openhuman/.claude/worktrees/feat+2763-memory-tree-integration-health` on branch `feat/2763-memory-tree-integration-health`. Run all commands from there. Commit to `aniketh` (the fork) at push time, PR against `tinyhumansai/openhuman:main`.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/openhuman/memory_sync/sync_status/types.rs` | `IntegrationHealth` enum + `derive` classifier; new `MemorySyncStatus` fields | Modify |
| `src/openhuman/memory_sync/sync_status/mod.rs` | Re-export `IntegrationHealth` | Modify |
| `src/openhuman/memory_sync/sync_status/rpc.rs` | Construct new fields; `finalize_health` enrichment; wire into `status_list_rpc` | Modify |
| `src/openhuman/memory_sync/composio/periodic.rs` | In-memory error map; `record_sync_error`; clear-on-success; `error_snapshot_by_toolkit`; `auto_fetch_interval_secs`; wire at failure site | Modify |
| `app/src/services/memorySyncService.ts` | `IntegrationHealth` TS type + new fields on `MemorySyncStatus` | Modify |
| `app/src/lib/i18n/en.ts` | 3 new `sync.*` keys | Modify |
| `app/src/lib/i18n/chunks/en-3.ts` + 13 locale `*-3.ts` | 3 new `sync.*` keys (English placeholder for locales) | Modify |
| `app/src/components/intelligence/MemorySources.tsx` | Health badge (replaces freshness), provider icon, error detail | Modify |
| `app/src/components/intelligence/MemorySources.health.test.tsx` | Render tests for badge/icon/error | Create |

---

## Task 0: Setup & clean baseline

**Files:** none (environment only).

- [ ] **Step 1: Install JS deps + build the Rust lib**

Fresh worktrees have no `node_modules`. Run from the worktree root:

```bash
cd /Users/ghostscripter/Zerolend/openhuman/.claude/worktrees/feat+2763-memory-tree-integration-health
pnpm install
cargo build --manifest-path Cargo.toml --lib
```

Expected: install completes; `cargo build` finishes (may take several minutes the first time).

- [ ] **Step 2: Baseline the files we will touch**

```bash
cargo test --manifest-path Cargo.toml --lib sync_status::
pnpm debug unit MemorySources
```

Expected: existing `sync_status` and `MemorySources` (buildRows) tests PASS. If anything fails before changes, stop and report — that's pre-existing breakage, not ours.

---

## Task 1: `IntegrationHealth` enum + classifier (Rust, pure)

**Files:**
- Modify: `src/openhuman/memory_sync/sync_status/types.rs`

- [ ] **Step 1: Write the failing tests**

Add to the existing `#[cfg(test)] mod tests` block in `types.rs` (after the existing freshness tests, before the closing `}`):

```rust
    const TEST_INTERVAL_SECS: u64 = 1200; // 20 min, matches the periodic tick

    #[test]
    fn health_error_when_error_newer_than_last_chunk() {
        let now = 1_777_000_000_000;
        // chunk 10 min ago, error 1 min ago → most recent event is a failure
        let h = IntegrationHealth::derive(
            Some(now - 10 * 60_000),
            Some(now - 60_000),
            now,
            TEST_INTERVAL_SECS,
        );
        assert_eq!(h, IntegrationHealth::Error);
    }

    #[test]
    fn health_active_when_chunk_newer_than_error() {
        let now = 1_777_000_000_000;
        // error 10 min ago, but a chunk landed 1 min ago → recovered
        let h = IntegrationHealth::derive(
            Some(now - 60_000),
            Some(now - 10 * 60_000),
            now,
            TEST_INTERVAL_SECS,
        );
        assert_eq!(h, IntegrationHealth::Active);
    }

    #[test]
    fn health_error_when_error_and_no_chunk() {
        let now = 1_777_000_000_000;
        let h = IntegrationHealth::derive(None, Some(now - 60_000), now, TEST_INTERVAL_SECS);
        assert_eq!(h, IntegrationHealth::Error);
    }

    #[test]
    fn health_active_within_two_intervals() {
        let now = 1_777_000_000_000;
        // 39 min ago, window is 2×20 = 40 min → Active
        let h = IntegrationHealth::derive(Some(now - 39 * 60_000), None, now, TEST_INTERVAL_SECS);
        assert_eq!(h, IntegrationHealth::Active);
    }

    #[test]
    fn health_stale_beyond_two_intervals() {
        let now = 1_777_000_000_000;
        // 41 min ago, beyond the 40 min window, no error → Stale (not Error)
        let h = IntegrationHealth::derive(Some(now - 41 * 60_000), None, now, TEST_INTERVAL_SECS);
        assert_eq!(h, IntegrationHealth::Stale);
    }

    #[test]
    fn health_stale_when_no_chunk_and_no_error() {
        let now = 1_777_000_000_000;
        assert_eq!(
            IntegrationHealth::derive(None, None, now, TEST_INTERVAL_SECS),
            IntegrationHealth::Stale
        );
    }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path Cargo.toml --lib sync_status::types::tests::health_
```

Expected: FAIL to compile — `IntegrationHealth` not found.

- [ ] **Step 3: Implement the enum + classifier**

In `types.rs`, after the `FreshnessLabel` impl block (around line 47) and before the `MemorySyncStatus` struct, add:

```rust
/// Operational health of one integration's memory-tree feed. Distinct from
/// [`FreshnessLabel`] (a pure recency axis): `health` folds in a real sync
/// *error* signal and is aware of the auto-fetch interval.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IntegrationHealth {
    Active,
    Stale,
    Error,
}

impl IntegrationHealth {
    /// Precedence: **Error > Active > Stale**.
    ///
    /// * `Error` when a recorded sync error is newer than the last successful
    ///   chunk (or there is no chunk at all) — the most recent thing that
    ///   happened to this source was a failure.
    /// * `Active` when the last chunk landed within `2 × interval_secs`
    ///   (lenient so a healthy source doesn't flap to Stale right before its
    ///   next scheduled tick).
    /// * `Stale` otherwise — quiet or quietly behind, but not a known failure
    ///   (so a low-traffic source like an empty inbox doesn't false-alarm).
    pub fn derive(
        last_chunk_at_ms: Option<i64>,
        last_error_at_ms: Option<i64>,
        now_ms: i64,
        interval_secs: u64,
    ) -> Self {
        if let Some(err_ms) = last_error_at_ms {
            let chunk_ms = last_chunk_at_ms.unwrap_or(i64::MIN);
            if err_ms > chunk_ms {
                return Self::Error;
            }
        }
        match last_chunk_at_ms {
            Some(ts) => {
                // 2× interval, expressed in ms (interval_secs * 2 * 1000).
                let window_ms = (interval_secs as i64).saturating_mul(2_000);
                if now_ms.saturating_sub(ts) <= window_ms {
                    Self::Active
                } else {
                    Self::Stale
                }
            }
            None => Self::Stale,
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test --manifest-path Cargo.toml --lib sync_status::types::tests::health_
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/openhuman/memory_sync/sync_status/types.rs
git commit -m "feat(memory-sync): add IntegrationHealth classifier (#2763)"
```

---

## Task 2: New fields on `MemorySyncStatus` (Rust)

**Files:**
- Modify: `src/openhuman/memory_sync/sync_status/types.rs`
- Modify: `src/openhuman/memory_sync/sync_status/mod.rs`
- Modify: `src/openhuman/memory_sync/sync_status/rpc.rs`

- [ ] **Step 1: Add the fields to the struct**

In `types.rs`, inside `pub struct MemorySyncStatus`, after the `freshness` field, add:

```rust
    /// Operational health folding in the sync-error signal (see
    /// [`IntegrationHealth`]). Finalized in `status_list_rpc`.
    pub health: IntegrationHealth,
    /// Most recent recorded sync-error message for this provider, if any.
    pub last_error: Option<String>,
    /// Wall-clock ms of the most recent recorded sync error, if any.
    pub last_error_at_ms: Option<i64>,
```

- [ ] **Step 2: Re-export from mod.rs**

In `mod.rs`, change the re-export line:

```rust
pub use types::{FreshnessLabel, IntegrationHealth, MemorySyncStatus};
```

- [ ] **Step 3: Give the SQL constructor provisional defaults**

In `rpc.rs`, update the `use super::types::...` line at the top to:

```rust
use super::types::{FreshnessLabel, IntegrationHealth, MemorySyncStatus, StatusListResponse};
```

Then in `query_sync_statuses`, inside the `Ok(MemorySyncStatus { ... })` constructor (after the `freshness:` line), add:

```rust
            // Provisional; `finalize_health` in `status_list_rpc` sets the
            // real value (it has the error snapshot + interval). Never
            // user-visible because finalize always runs.
            health: IntegrationHealth::Stale,
            last_error: None,
            last_error_at_ms: None,
```

- [ ] **Step 4: Verify the crate compiles and existing tests pass**

```bash
cargo test --manifest-path Cargo.toml --lib sync_status::
```

Expected: PASS (existing query tests still pass — they don't assert health).

- [ ] **Step 5: Commit**

```bash
git add src/openhuman/memory_sync/sync_status/types.rs src/openhuman/memory_sync/sync_status/mod.rs src/openhuman/memory_sync/sync_status/rpc.rs
git commit -m "feat(memory-sync): add health/last_error fields to MemorySyncStatus (#2763)"
```

---

## Task 3: In-memory error capture in the periodic loop (Rust)

**Files:**
- Modify: `src/openhuman/memory_sync/composio/periodic.rs`

- [ ] **Step 1: Write the failing tests**

Add to the existing `#[cfg(test)] mod tests` in `periodic.rs` (before the closing `}`):

```rust
    #[test]
    fn record_sync_error_is_visible_in_snapshot_by_toolkit() {
        let toolkit = "test_err_toolkit_a";
        record_sync_error(toolkit, "conn-a", "boom 401");
        let snap = error_snapshot_by_toolkit();
        let rec = snap.get(toolkit).expect("error recorded for toolkit");
        assert_eq!(rec.message, "boom 401");
        assert!(rec.at_ms > 0);
    }

    #[test]
    fn record_sync_success_clears_the_error() {
        let toolkit = "test_err_toolkit_b";
        record_sync_error(toolkit, "conn-b", "transient");
        record_sync_success(toolkit, "conn-b");
        let snap = error_snapshot_by_toolkit();
        assert!(
            snap.get(toolkit).is_none(),
            "a success must clear the prior error for the same key"
        );
    }

    #[test]
    fn snapshot_collapses_connections_keeping_most_recent() {
        let toolkit = "test_err_toolkit_c";
        record_sync_error(toolkit, "conn-1", "older");
        std::thread::sleep(Duration::from_millis(3));
        record_sync_error(toolkit, "conn-2", "newer");
        let snap = error_snapshot_by_toolkit();
        let rec = snap.get(toolkit).expect("toolkit present");
        assert_eq!(rec.message, "newer", "most recent error wins at toolkit level");
    }

    #[test]
    fn record_sync_error_truncates_long_messages() {
        let toolkit = "test_err_toolkit_d";
        let long = "x".repeat(5000);
        record_sync_error(toolkit, "conn-d", &long);
        let snap = error_snapshot_by_toolkit();
        let rec = snap.get(toolkit).expect("toolkit present");
        assert_eq!(rec.message.chars().count(), MAX_ERROR_LEN);
    }

    #[test]
    fn auto_fetch_interval_secs_matches_tick() {
        assert_eq!(auto_fetch_interval_secs(), TICK_SECONDS);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path Cargo.toml --lib composio::periodic::tests::record_sync_error
```

Expected: FAIL to compile — `record_sync_error` / `error_snapshot_by_toolkit` / `MAX_ERROR_LEN` / `auto_fetch_interval_secs` not found.

- [ ] **Step 3: Add the error map + helpers**

In `periodic.rs`, after the `record_sync_success` fn (ends ~line 106), add:

```rust
/// One recorded sync failure for a `(toolkit, connection_id)`. Uses a
/// wall-clock `at_ms` (NOT a monotonic `Instant`) so it's directly comparable
/// to a chunk's `timestamp_ms` when deriving health. In-memory only — rebuilt
/// on restart, exactly like [`LAST_SYNC_AT`].
#[derive(Clone, Debug)]
pub struct SyncErrorRecord {
    pub message: String,
    pub at_ms: i64,
}

type SyncErrorMap = Arc<Mutex<HashMap<(String, String), SyncErrorRecord>>>;

static LAST_SYNC_ERROR: OnceLock<SyncErrorMap> = OnceLock::new();

/// Longest error message we retain — defends the in-memory map and the RPC
/// payload against a pathologically long provider error string.
const MAX_ERROR_LEN: usize = 500;

fn last_error_map() -> SyncErrorMap {
    LAST_SYNC_ERROR
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

/// Record a failed sync for `(toolkit, connection_id)`, overwriting any prior
/// error for the same key. Called from the periodic loop's failure arm so the
/// Memory Tree integration-health list (#2763) can surface real failures.
pub fn record_sync_error(toolkit: &str, connection_id: &str, message: &str) {
    // char-safe truncation (byte-index `String::truncate` can panic on a
    // multi-byte boundary).
    let msg: String = message.trim().chars().take(MAX_ERROR_LEN).collect();
    if let Ok(mut map) = last_error_map().lock() {
        map.insert(
            (toolkit.to_string(), connection_id.to_string()),
            SyncErrorRecord {
                message: msg,
                at_ms: chrono::Utc::now().timestamp_millis(),
            },
        );
    }
}

/// Most recent recorded sync error per *toolkit*, collapsing connection_ids
/// (any failing connection marks the toolkit). Keyed by toolkit slug to line
/// up with the `provider` field of `memory_sync_status_list` (provider ==
/// toolkit slug for the syncable set). Cloned out so callers don't hold the
/// lock.
pub fn error_snapshot_by_toolkit() -> HashMap<String, SyncErrorRecord> {
    let mut out: HashMap<String, SyncErrorRecord> = HashMap::new();
    if let Ok(map) = last_error_map().lock() {
        for ((toolkit, _conn), rec) in map.iter() {
            out.entry(toolkit.clone())
                .and_modify(|existing| {
                    if rec.at_ms > existing.at_ms {
                        *existing = rec.clone();
                    }
                })
                .or_insert_with(|| rec.clone());
        }
    }
    out
}

/// The periodic auto-fetch tick interval, in seconds. Exposed so the
/// sync-status health classifier can reason about staleness relative to how
/// often the loop actually fires.
pub fn auto_fetch_interval_secs() -> u64 {
    TICK_SECONDS
}
```

- [ ] **Step 4: Clear the error on success**

Replace the body of `record_sync_success` (lines ~99-106) with:

```rust
pub fn record_sync_success(toolkit: &str, connection_id: &str) {
    let key = (toolkit.to_string(), connection_id.to_string());
    if let Ok(mut map) = last_sync_map().lock() {
        map.insert(key.clone(), Instant::now());
    }
    // A success supersedes any prior failure for this connection.
    if let Ok(mut errors) = last_error_map().lock() {
        errors.remove(&key);
    }
}
```

- [ ] **Step 5: Wire `record_sync_error` at the failure site**

In `run_one_tick`, in the `Err(e)` arm of `match provider.sync(...)` (lines ~344-353), add the `record_sync_error` call after the `tracing::warn!`:

```rust
            Err(e) => {
                tracing::warn!(
                    toolkit = %conn.toolkit,
                    connection_id = %conn.id,
                    error = %e,
                    "[composio:periodic] sync failed (will retry next tick)"
                );
                // Surface the failure to the Memory Tree integration-health
                // list (#2763). In-memory; cleared on the next success.
                record_sync_error(&conn.toolkit, &conn.id, &e.to_string());
                // Intentionally do NOT update last_sync_at on failure
                // so the next tick retries immediately.
            }
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cargo test --manifest-path Cargo.toml --lib composio::periodic::tests
```

Expected: PASS (existing periodic tests + 5 new ones).

- [ ] **Step 7: Commit**

```bash
git add src/openhuman/memory_sync/composio/periodic.rs
git commit -m "feat(memory-sync): capture per-source sync errors in-memory (#2763)"
```

---

## Task 4: Finalize health in the RPC (Rust)

**Files:**
- Modify: `src/openhuman/memory_sync/sync_status/rpc.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` in `rpc.rs` (before the closing `}`):

```rust
    use crate::openhuman::memory_sync::composio::periodic::SyncErrorRecord;
    use std::collections::HashMap;

    fn base_status(provider: &str, last_chunk_at_ms: Option<i64>) -> MemorySyncStatus {
        MemorySyncStatus {
            provider: provider.to_string(),
            chunks_synced: 1,
            chunks_pending: 0,
            batch_total: 0,
            batch_processed: 0,
            last_chunk_at_ms,
            freshness: FreshnessLabel::Idle,
            health: IntegrationHealth::Stale,
            last_error: None,
            last_error_at_ms: None,
        }
    }

    #[test]
    fn finalize_marks_error_and_attaches_message() {
        let now = 1_777_000_000_000;
        let mut statuses = vec![base_status("gmail", Some(now - 10 * 60_000))];
        let mut errors = HashMap::new();
        errors.insert(
            "gmail".to_string(),
            SyncErrorRecord { message: "boom 401".into(), at_ms: now - 60_000 },
        );
        finalize_health(&mut statuses, &errors, now, 1200);
        assert_eq!(statuses[0].health, IntegrationHealth::Error);
        assert_eq!(statuses[0].last_error.as_deref(), Some("boom 401"));
        assert_eq!(statuses[0].last_error_at_ms, Some(now - 60_000));
    }

    #[test]
    fn finalize_marks_active_when_recent_and_no_error() {
        let now = 1_777_000_000_000;
        let mut statuses = vec![base_status("slack", Some(now - 60_000))];
        finalize_health(&mut statuses, &HashMap::new(), now, 1200);
        assert_eq!(statuses[0].health, IntegrationHealth::Active);
        assert!(statuses[0].last_error.is_none());
    }

    #[test]
    fn finalize_appends_synthetic_row_for_error_only_provider() {
        let now = 1_777_000_000_000;
        let mut statuses = vec![base_status("gmail", Some(now - 60_000))];
        let mut errors = HashMap::new();
        // notion has an error but produced no chunks → not in `statuses`.
        errors.insert(
            "notion".to_string(),
            SyncErrorRecord { message: "auth expired".into(), at_ms: now - 30_000 },
        );
        finalize_health(&mut statuses, &errors, now, 1200);
        let notion = statuses
            .iter()
            .find(|s| s.provider == "notion")
            .expect("synthetic error-only row appended");
        assert_eq!(notion.health, IntegrationHealth::Error);
        assert_eq!(notion.chunks_synced, 0);
        assert_eq!(notion.last_error.as_deref(), Some("auth expired"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path Cargo.toml --lib sync_status::rpc::tests::finalize
```

Expected: FAIL to compile — `finalize_health` not found.

- [ ] **Step 3: Implement `finalize_health`**

In `rpc.rs`, add these imports at the top (below the existing `use` lines):

```rust
use std::collections::HashSet;

use crate::openhuman::memory_sync::composio::periodic::{
    auto_fetch_interval_secs, error_snapshot_by_toolkit, SyncErrorRecord,
};
```

Then add the function (after `query_sync_statuses`, before the test module):

```rust
/// Attach per-provider error info, finalize each row's `health`, and append
/// synthetic rows for toolkits that have *only* an error (never produced a
/// chunk) so a connected-but-failing integration still shows as Error.
fn finalize_health(
    statuses: &mut Vec<MemorySyncStatus>,
    errors: &std::collections::HashMap<String, SyncErrorRecord>,
    now_ms: i64,
    interval_secs: u64,
) {
    for s in statuses.iter_mut() {
        if let Some(rec) = errors.get(&s.provider) {
            s.last_error = Some(rec.message.clone());
            s.last_error_at_ms = Some(rec.at_ms);
        }
        s.health =
            IntegrationHealth::derive(s.last_chunk_at_ms, s.last_error_at_ms, now_ms, interval_secs);
    }

    let present: HashSet<&str> = statuses.iter().map(|s| s.provider.as_str()).collect();
    let missing: Vec<(String, SyncErrorRecord)> = errors
        .iter()
        .filter(|(provider, _)| !present.contains(provider.as_str()))
        .map(|(p, r)| (p.clone(), r.clone()))
        .collect();
    for (provider, rec) in missing {
        statuses.push(MemorySyncStatus {
            provider,
            chunks_synced: 0,
            chunks_pending: 0,
            batch_total: 0,
            batch_processed: 0,
            last_chunk_at_ms: None,
            freshness: FreshnessLabel::from_age_ms(None, now_ms),
            health: IntegrationHealth::Error,
            last_error: Some(rec.message),
            last_error_at_ms: Some(rec.at_ms),
        });
    }
}
```

- [ ] **Step 4: Wire it into `status_list_rpc`**

Replace the body of `status_list_rpc` (lines ~61-99) with this version (computes `now_ms` and fetches the error snapshot *before* `spawn_blocking`, then enriches after):

```rust
pub async fn status_list_rpc(config: &Config) -> Result<RpcOutcome<StatusListResponse>, String> {
    tracing::debug!("[memory_sync_status][rpc] status_list");

    let now_ms = chrono::Utc::now().timestamp_millis();
    let errors = error_snapshot_by_toolkit();
    let interval_secs = auto_fetch_interval_secs();

    let config = config.clone();
    let mut statuses: Vec<MemorySyncStatus> = match tokio::task::spawn_blocking(move || {
        with_connection(&config, |conn| -> anyhow::Result<Vec<MemorySyncStatus>> {
            Ok(query_sync_statuses(conn, now_ms)?)
        })
    })
    .await
    {
        Ok(Ok(rows)) => rows,
        // DB unavailable (open/migration failure) or query error: keep going
        // with an empty list so error-only providers still surface below.
        Ok(Err(e)) => {
            tracing::warn!(
                "[memory_sync_status][rpc] DB query failed, returning error-only statuses: {e:#}"
            );
            vec![]
        }
        Err(e) => {
            tracing::warn!(
                "[memory_sync_status][rpc] spawn_blocking join error, returning error-only statuses: {e}"
            );
            vec![]
        }
    };

    finalize_health(&mut statuses, &errors, now_ms, interval_secs);

    tracing::debug!(
        "[memory_sync_status][rpc] status_list returning {} row(s)",
        statuses.len()
    );
    Ok(RpcOutcome::new(StatusListResponse { statuses }, vec![]))
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cargo test --manifest-path Cargo.toml --lib sync_status::
```

Expected: PASS (new finalize tests + all existing sync_status tests).

- [ ] **Step 6: Commit**

```bash
git add src/openhuman/memory_sync/sync_status/rpc.rs
git commit -m "feat(memory-sync): finalize integration health in status_list RPC (#2763)"
```

---

## Task 5: TypeScript types

**Files:**
- Modify: `app/src/services/memorySyncService.ts`

- [ ] **Step 1: Add the `IntegrationHealth` type**

In `memorySyncService.ts`, after the `FreshnessLabel` type (line 18), add:

```ts
/** Operational health of an integration's feed (server-derived). */
export type IntegrationHealth = 'active' | 'stale' | 'error';
```

- [ ] **Step 2: Add the new fields to `MemorySyncStatus`**

Inside the `MemorySyncStatus` interface, after the `freshness` field (line 41), add:

```ts
  /** Operational health folding in the sync-error signal. */
  health: IntegrationHealth;
  /** Most recent recorded sync-error message, or `null`. */
  last_error: string | null;
  /** Wall-clock ms of the most recent recorded sync error, or `null`. */
  last_error_at_ms: number | null;
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. (No consumer yet sets the new required fields except test factories, which we update in Task 7; the type compiles standalone.)

- [ ] **Step 4: Commit**

```bash
git add app/src/services/memorySyncService.ts
git commit -m "feat(app): add IntegrationHealth + error fields to MemorySyncStatus type (#2763)"
```

---

## Task 6: i18n keys (all locales)

**Files:**
- Modify: `app/src/lib/i18n/en.ts`
- Modify: `app/src/lib/i18n/chunks/en-3.ts` and `chunks/{ar,bn,de,es,fr,hi,id,it,ko,pl,pt,ru,zh-CN}-3.ts`

- [ ] **Step 1: Add keys to `en.ts`**

In `en.ts`, find the line `'sync.sync': 'Sync',` and add immediately after it:

```ts
  'sync.statusStale': 'Stale',
  'sync.statusError': 'Error',
  'sync.lastError': 'Last error:',
```

- [ ] **Step 2: Add the same keys to `chunks/en-3.ts`**

In `chunks/en-3.ts`, after the `'sync.sync': 'Sync',` line (line ~95), add the same three lines:

```ts
  'sync.statusStale': 'Stale',
  'sync.statusError': 'Error',
  'sync.lastError': 'Last error:',
```

- [ ] **Step 3: Add the same keys (English placeholders) to all 13 locale chunk-3 files**

For each of `ar bn de es fr hi id it ko pl pt ru zh-CN`, open `chunks/<locale>-3.ts`, find that file's `'sync.sync':` line, and add the three keys after it using the **English** values as placeholders (translators fill in later):

```ts
  'sync.statusStale': 'Stale',
  'sync.statusError': 'Error',
  'sync.lastError': 'Last error:',
```

Tip to locate each file's `sync.sync` line:

```bash
grep -n "'sync.sync'" app/src/lib/i18n/chunks/*-3.ts
```

- [ ] **Step 4: Verify i18n parity**

```bash
pnpm i18n:check
```

Expected: PASS (no missing keys in any locale). If it reports a missing locale, add the keys there too.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/i18n/en.ts app/src/lib/i18n/chunks/*-3.ts
git commit -m "feat(i18n): add sync health-status keys across locales (#2763)"
```

---

## Task 7: MemorySources health badge, icon, error detail (frontend)

**Files:**
- Modify: `app/src/components/intelligence/MemorySources.tsx`
- Create: `app/src/components/intelligence/MemorySources.health.test.tsx`

- [ ] **Step 1: Write the failing render tests**

Create `app/src/components/intelligence/MemorySources.health.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemorySyncStatus } from '../../services/memorySyncService';
import { MemorySources } from './MemorySources';

const mockStatusList = vi.fn();
const mockListConnections = vi.fn();

vi.mock('../../services/memorySyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/memorySyncService')>(
    '../../services/memorySyncService'
  );
  return { ...actual, memorySyncStatusList: (...a: unknown[]) => mockStatusList(...a) };
});

vi.mock('../../lib/composio/composioApi', () => ({
  listConnections: (...a: unknown[]) => mockListConnections(...a),
  syncConnection: vi.fn(),
}));

const SYNCABLE = new Set(['gmail']);

function status(overrides: Partial<MemorySyncStatus> = {}): MemorySyncStatus {
  return {
    provider: 'gmail',
    chunks_synced: 5,
    chunks_pending: 0,
    batch_total: 0,
    batch_processed: 0,
    last_chunk_at_ms: Date.now(),
    freshness: 'active',
    health: 'active',
    last_error: null,
    last_error_at_ms: null,
    ...overrides,
  };
}

function gmailConnection() {
  return { connections: [{ id: 'c1', toolkit: 'gmail', status: 'ACTIVE', createdAt: '2026-05-01T00:00:00Z' }] };
}

describe('<MemorySources /> health', () => {
  beforeEach(() => {
    mockStatusList.mockReset();
    mockListConnections.mockReset();
  });

  it('renders the health badge for an active integration', async () => {
    mockListConnections.mockResolvedValue(gmailConnection());
    mockStatusList.mockResolvedValue([status({ health: 'active' })]);
    render(<MemorySources syncableToolkits={SYNCABLE} pollIntervalMs={0} />);
    await waitFor(() => {
      expect(screen.getByTestId('memory-source-health-gmail').textContent).toBe('Active');
    });
  });

  it('renders Stale health', async () => {
    mockListConnections.mockResolvedValue(gmailConnection());
    mockStatusList.mockResolvedValue([status({ health: 'stale' })]);
    render(<MemorySources syncableToolkits={SYNCABLE} pollIntervalMs={0} />);
    await waitFor(() => {
      expect(screen.getByTestId('memory-source-health-gmail').textContent).toBe('Stale');
    });
  });

  it('shows the Error badge + last_error message', async () => {
    mockListConnections.mockResolvedValue(gmailConnection());
    mockStatusList.mockResolvedValue([
      status({ health: 'error', last_error: 'boom 401', last_error_at_ms: Date.now() }),
    ]);
    render(<MemorySources syncableToolkits={SYNCABLE} pollIntervalMs={0} />);
    await waitFor(() => {
      expect(screen.getByTestId('memory-source-health-gmail').textContent).toBe('Error');
      expect(screen.getByTestId('memory-source-error-gmail').textContent).toContain('boom 401');
    });
  });

  it('renders a provider icon', async () => {
    mockListConnections.mockResolvedValue(gmailConnection());
    mockStatusList.mockResolvedValue([status()]);
    const { container } = render(<MemorySources syncableToolkits={SYNCABLE} pollIntervalMs={0} />);
    await waitFor(() => expect(screen.getByTestId('memory-source-row-gmail')).toBeTruthy());
    expect(container.querySelector('img')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm debug unit MemorySources.health
```

Expected: FAIL — `memory-source-health-gmail` testid not found (component still renders the freshness badge).

- [ ] **Step 3: Update imports in `MemorySources.tsx`**

Change the `memorySyncService` import (lines 31-35) to drop `FreshnessLabel` and add `IntegrationHealth`:

```tsx
import {
  type IntegrationHealth,
  type MemorySyncStatus,
  memorySyncStatusList,
} from '../../services/memorySyncService';
```

Add a new import for the toolkit icon (after the `useT` import line 30):

```tsx
import { composioToolkitMeta } from '../composio/toolkitMeta';
```

- [ ] **Step 4: Replace the freshness helpers with health helpers**

Replace `useFreshnessLabel` and `freshnessBadge` (lines 62-76) with:

```tsx
function useHealthLabel() {
  const { t } = useT();
  return { active: t('sync.active'), stale: t('sync.statusStale'), error: t('sync.statusError') };
}

function healthBadgeClass(health: IntegrationHealth): string {
  switch (health) {
    case 'active':
      return 'bg-sage-100 dark:bg-sage-500/20 text-sage-700 dark:text-sage-300';
    case 'stale':
      return 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300';
    case 'error':
      return 'bg-coral-50 dark:bg-coral-500/10 text-coral-800 dark:text-coral-300';
  }
}
```

- [ ] **Step 5: Update `SourceRowCard` — label hook, icon, badge, error line**

In `SourceRowCard`, change line 326 from:

```tsx
  const freshnessLabels = useFreshnessLabel();
```

to:

```tsx
  const healthLabels = useHealthLabel();
```

Add the provider icon as the first child of the title row. Change the title `<div className="flex flex-wrap items-center gap-2">` block (lines 347-363) to:

```tsx
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0" aria-hidden="true">
            {composioToolkitMeta(toolkit).icon}
          </span>
          <span className="truncate text-sm font-medium text-stone-900 dark:text-neutral-100">
            {title}
          </span>
          {status && (
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${healthBadgeClass(status.health)}`}
              data-testid={`memory-source-health-${toolkit}`}>
              {healthLabels[status.health]}
            </span>
          )}
          {!isActive && (
            <span className="rounded-md bg-amber-100 dark:bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              {connection.status}
            </span>
          )}
        </div>
```

Add the error-detail line immediately after the stats `<div>` (after line 378, the `</div>` that closes the chunks/lastSync/pending row, before the `{showProgress && (` block):

```tsx
        {status?.health === 'error' && status.last_error && (
          <p
            className="mt-1 break-words text-xs text-coral-700 dark:text-coral-300"
            data-testid={`memory-source-error-${toolkit}`}>
            {t('sync.lastError')} {status.last_error}
          </p>
        )}
```

- [ ] **Step 6: Run the new tests to verify they pass**

```bash
pnpm debug unit MemorySources.health
```

Expected: PASS (4 tests).

- [ ] **Step 7: Run the existing MemorySources tests + typecheck**

```bash
pnpm debug unit MemorySources
pnpm typecheck
```

Expected: PASS — the existing `buildRows` tests still pass (the cast `fakeStatus` is unaffected); typecheck clean (no unused `FreshnessLabel`/`freshnessBadge`).

- [ ] **Step 8: Commit**

```bash
git add app/src/components/intelligence/MemorySources.tsx app/src/components/intelligence/MemorySources.health.test.tsx
git commit -m "feat(app): per-integration health badge + icon + error on MemorySources (#2763)"
```

---

## Task 8: Full verification & format

**Files:** none (verification only).

- [ ] **Step 1: Run the full changed-area test suites**

```bash
cargo test --manifest-path Cargo.toml --lib memory_sync::
pnpm debug unit MemorySources
pnpm i18n:check
```

Expected: all PASS.

- [ ] **Step 2: Lint, typecheck, format**

```bash
pnpm typecheck
pnpm lint
cargo fmt --manifest-path Cargo.toml
pnpm format
```

Expected: typecheck + lint clean; formatters make no functional changes (commit any formatting diffs they produce).

- [ ] **Step 3: Commit any formatting changes**

```bash
git add -A
git commit -m "chore: format (#2763)" || echo "nothing to format"
```

- [ ] **Step 4: Manual UI smoke (if a dev environment is available)**

Per CLAUDE.md, UI changes should be exercised in the app. If feasible, run `pnpm dev:app`, open Intelligence → Memory data, and confirm: each connected syncable integration shows an icon + an Active/Stale/Error badge; force a sync failure (e.g. revoke a token) and confirm the Error badge + message appear, then resolve and confirm it returns to Active. If a dev environment is not available, state that explicitly rather than claiming the UI works.

---

## Self-Review

**Spec coverage:**
- Per-integration health Active/Stale/Error → Tasks 1, 4, 7. ✓
- Deterministic classification keyed off the real interval → Task 1 (`derive` + `auto_fetch_interval_secs`). ✓
- Real Error from in-memory capture (cleared on success) → Task 3. ✓
- Provider icons via `composioToolkitMeta` → Task 7. ✓
- Replace freshness badge with health → Task 7. ✓
- List stays under the status panel (existing `MemoryWorkspace.tsx:225` mount, unchanged) → no task needed; `MemorySources` is already mounted there. ✓
- i18n across 14 locales + `en.ts` → Task 6. ✓
- Tests ≥80% changed lines → Tasks 1,3,4 (Rust) + 7 (Vitest). ✓
- Error-only (never-synced) provider visibility → Task 4 synthetic row. ✓ (covers a gap the spec implied but didn't call out)
- Keep `freshness` field (MemorySyncConnections still consumes it) → not removed. ✓
- Out of scope (Part 2/FR9, SQLite, new config field, duplicate component) → none added. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**Type consistency:** `IntegrationHealth` (Rust enum `Active/Stale/Error`, serde snake_case) ↔ TS union `'active'|'stale'|'error'`. `MemorySyncStatus` fields `health`/`last_error`/`last_error_at_ms` consistent across Rust struct (Task 2), TS interface (Task 5), and test factories (Tasks 4, 7). `record_sync_error`/`error_snapshot_by_toolkit`/`auto_fetch_interval_secs`/`SyncErrorRecord`/`MAX_ERROR_LEN`/`finalize_health` names used identically across Tasks 3, 4. ✓
