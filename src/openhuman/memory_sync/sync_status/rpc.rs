//! JSON-RPC handler for `openhuman.memory_sync_status_list` (#1136).
//!
//! Single SQL query against `mem_tree_chunks`. Two layers of metrics:
//!
//!   * **Lifetime** — `chunks_synced` (total ingested), `chunks_pending`
//!     (not yet *resolved* = still in the extract+embed queue, not yet
//!     appended to the source-tree buffer).
//!
//!     A chunk is "resolved" (i.e. NOT pending) when ANY of:
//!       - it has a row in the per-(chunk,model) sidecar
//!         `mem_tree_chunk_embeddings` (#1574) — embedded under some model;
//!       - `lifecycle_status = 'dropped'` — the admission gate rejected it,
//!         so it is intentionally never embedded (terminal, not waiting);
//!       - it has a `mem_tree_chunk_reembed_skipped` tombstone (#1574 §6) —
//!         embedding failed terminally (missing body / wrong dim / embed
//!         error) and will not be retried (terminal, not waiting).
//!
//!     NOTE: "embedded" is keyed off the sidecar table, NOT the legacy
//!     inline `mem_tree_chunks.embedding` column. The #1574 §7 migration
//!     copied every vector into the sidecar and stopped writing the inline
//!     column, so it now reads back NULL for every chunk. Keying pending /
//!     processed off the inline column made this RPC report 100% of chunks
//!     as pending and `0` processed forever, regardless of real progress.
//!     Dropped / terminally-skipped chunks have no sidecar row either, so
//!     without the extra terminal predicates they would read as pending
//!     forever and could pin a provider's progress bar below 100%.
//!
//!   * **Active sync wave** — `batch_total` / `batch_processed`. The
//!     wave is identified by a *time-cluster anchor*: the earliest
//!     chunk within `WAVE_WINDOW_MS` of the most recent chunk (per
//!     provider). A typical sync ingests its whole batch in seconds,
//!     so a 10-minute window cleanly captures one wave; if no new
//!     chunks arrive, the anchor stays put. Two syncs <10min apart
//!     merge into one wave (acceptable — they're contiguous activity).
//!
//! Stateless: no per-process Mutex, no persisted side table. Pure SQL
//! + the chunks table. Survives restart, safe across multiple core
//! processes.
//!
//! Trade-off: pending chunks older than `WAVE_WINDOW_MS` (e.g.,
//! leftovers from a stuck earlier wave when the worker was offline)
//! show up in lifetime `chunks_pending` but not in `batch_total` —
//! deliberately, since they shouldn't pollute the active wave's
//! progress signal.

use std::collections::HashSet;

use crate::openhuman::config::Config;
use crate::openhuman::memory_store::chunks::store::with_connection;
use crate::openhuman::memory_sync::composio::periodic::{
    auto_fetch_interval_secs, error_snapshot_by_toolkit, SyncErrorRecord,
};
use crate::rpc::RpcOutcome;
use rusqlite::Connection;

use super::types::{FreshnessLabel, IntegrationHealth, MemorySyncStatus, StatusListResponse};

/// Sliding window used to identify a "current sync wave". Chunks
/// within this many ms of `MAX(created_at_ms)` for a provider count
/// as part of the wave; older chunks fall out.
const WAVE_WINDOW_MS: i64 = 10 * 60 * 1000;

/// `openhuman.memory_sync_status_list` — one row per provider that
/// has chunks, with lifetime + active-wave counters and a freshness
/// label.
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
    // No `single_log` wrapper: the controller serializes
    // `RpcOutcome::into_cli_compatible_json`, and a non-empty `logs` list
    // wraps the value in `{ result, logs }`. The frontend reads
    // `resp.statuses` directly, so any envelope here breaks parsing.
    Ok(RpcOutcome::new(StatusListResponse { statuses }, vec![]))
}

/// Run the per-provider lifetime + active-wave aggregation against `conn`.
///
/// Split out from [`status_list_rpc`] so it can be unit-tested against a
/// tempdir-backed connection without the async / spawn_blocking wrapper.
///
/// A chunk is "resolved" (not pending) when it has a sidecar embedding (any
/// model signature), OR is `dropped`, OR carries a reembed-skip tombstone —
/// see the module header. Resolution is keyed off the `mem_tree_chunk_embeddings`
/// sidecar, NOT the legacy inline `mem_tree_chunks.embedding` column.
fn query_sync_statuses(conn: &Connection, now_ms: i64) -> rusqlite::Result<Vec<MemorySyncStatus>> {
    // Provider parsed from `source_id` prefix (substring before first ':');
    // falls back to `source_kind` when no prefix.
    //
    // `provider_chunks` projects per-row provider + a `resolved` flag (embedded
    // OR dropped OR terminally skipped). `provider_pending` flags providers with
    // at least one unresolved chunk *inside the wave window* (within
    // WAVE_WINDOW_MS of the provider's most recent chunk) — `wave_anchors` is
    // gated on this, so a stale unresolved chunk from an older wave can't
    // resurrect an "active" wave when the recent chunks are all resolved, and a
    // fully-drained provider gets `batch_total = batch_processed = 0` (the UI
    // then hides the progress bar instead of rendering a completed one for an
    // idle connection). `wave_anchors` finds the earliest chunk within
    // WAVE_WINDOW_MS of the most recent — the wave's start. The outer SELECT
    // joins back to count both lifetime and in-wave totals.
    let mut stmt = conn.prepare(
        "WITH provider_chunks AS ( \
            SELECT \
                CASE \
                    WHEN INSTR(source_id, ':') > 0 \
                        THEN SUBSTR(source_id, 1, INSTR(source_id, ':') - 1) \
                    ELSE source_kind \
                END AS provider, \
                created_at_ms, \
                CASE WHEN EXISTS ( \
                    SELECT 1 FROM mem_tree_chunk_embeddings e \
                    WHERE e.chunk_id = c.id \
                ) \
                  OR c.lifecycle_status = 'dropped' \
                  OR EXISTS ( \
                    SELECT 1 FROM mem_tree_chunk_reembed_skipped s \
                    WHERE s.chunk_id = c.id \
                ) THEN 1 ELSE 0 END AS resolved, \
                timestamp_ms \
            FROM mem_tree_chunks c \
         ), \
         provider_max AS ( \
            SELECT provider, MAX(created_at_ms) AS max_created \
            FROM provider_chunks \
            GROUP BY provider \
         ), \
         provider_pending AS ( \
            SELECT p.provider, \
                   SUM(CASE WHEN p.resolved = 0 \
                             AND p.created_at_ms >= m.max_created - ?1 \
                            THEN 1 ELSE 0 END) AS pending \
            FROM provider_chunks p \
            JOIN provider_max m ON p.provider = m.provider \
            GROUP BY p.provider \
         ), \
         wave_anchors AS ( \
            SELECT p.provider, MIN(p.created_at_ms) AS anchor \
            FROM provider_chunks p \
            JOIN provider_max m ON p.provider = m.provider \
            JOIN provider_pending pp ON p.provider = pp.provider \
            WHERE pp.pending > 0 \
              AND p.created_at_ms >= m.max_created - ?1 \
            GROUP BY p.provider \
         ) \
         SELECT \
            p.provider, \
            COUNT(*) AS chunks_synced, \
            SUM(CASE WHEN p.resolved = 0 THEN 1 ELSE 0 END) AS chunks_pending, \
            SUM(CASE WHEN w.anchor IS NOT NULL \
                     AND p.created_at_ms >= w.anchor \
                     THEN 1 ELSE 0 END) AS batch_total, \
            SUM(CASE WHEN w.anchor IS NOT NULL \
                     AND p.created_at_ms >= w.anchor \
                     AND p.resolved = 1 \
                     THEN 1 ELSE 0 END) AS batch_processed, \
            MAX(p.timestamp_ms) AS last_chunk_at_ms \
         FROM provider_chunks p \
         LEFT JOIN wave_anchors w ON p.provider = w.provider \
         GROUP BY p.provider \
         ORDER BY last_chunk_at_ms DESC",
    )?;
    let iter = stmt.query_map([WAVE_WINDOW_MS], |row| {
        let provider: String = row.get(0)?;
        let chunks_synced: i64 = row.get(1)?;
        let chunks_pending: i64 = row.get(2)?;
        let batch_total: i64 = row.get(3)?;
        let batch_processed: i64 = row.get(4)?;
        let last_chunk_at_ms: Option<i64> = row.get(5)?;
        Ok(MemorySyncStatus {
            provider,
            chunks_synced: chunks_synced.max(0) as u64,
            chunks_pending: chunks_pending.max(0) as u64,
            batch_total: batch_total.max(0) as u64,
            batch_processed: batch_processed.max(0) as u64,
            last_chunk_at_ms,
            freshness: FreshnessLabel::from_age_ms(last_chunk_at_ms, now_ms),
            // Provisional default; `status_list_rpc` recomputes `health`
            // (and fills `last_error*`) via `finalize_health` before
            // returning, so callers receive the finalized value, not this one.
            health: IntegrationHealth::Stale,
            last_error: None,
            last_error_at_ms: None,
        })
    })?;
    iter.collect()
}

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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn status_list_response_serializes_statuses_array() {
        let resp = StatusListResponse { statuses: vec![] };
        let v = serde_json::to_value(&resp).expect("serialize");
        assert!(
            v.get("statuses").and_then(|s| s.as_array()).is_some(),
            "statuses must always be present as an array"
        );
    }

    #[test]
    fn status_list_response_empty_statuses_is_empty_array() {
        let resp = StatusListResponse { statuses: vec![] };
        let v = serde_json::to_value(&resp).expect("serialize");
        let arr = v["statuses"].as_array().unwrap();
        assert!(arr.is_empty());
    }

    #[test]
    fn rpc_outcome_no_logs_serializes_bare_value() {
        // Validates the wire contract: with empty logs, into_cli_compatible_json
        // returns the value directly (not wrapped in { result, logs }).
        let resp = StatusListResponse { statuses: vec![] };
        let outcome = RpcOutcome::new(resp, vec![]);
        let json = outcome.into_cli_compatible_json().expect("serialize");
        assert!(
            json.get("statuses").is_some(),
            "bare value must have statuses at the top level"
        );
        assert!(json.get("result").is_none(), "must not be double-wrapped");
        assert!(json.get("logs").is_none(), "must not be double-wrapped");
    }

    /// Regression for the legacy-column bug: pending / processed must be
    /// derived from the `mem_tree_chunk_embeddings` sidecar, not the inline
    /// `mem_tree_chunks.embedding` column (which is always NULL post-#1574).
    /// A chunk with a sidecar row counts as processed even though its inline
    /// column is NULL.
    #[test]
    fn pending_and_processed_key_off_sidecar_not_inline_column() {
        use crate::openhuman::memory_store::chunks::store::with_connection;
        use rusqlite::params;
        use tempfile::TempDir;

        let tmp = TempDir::new().expect("tempdir");
        let mut cfg = Config::default();
        cfg.workspace_dir = tmp.path().to_path_buf();

        let now = chrono::Utc::now().timestamp_millis();

        with_connection(&cfg, |conn| {
            let insert_chunk = |id: &str, source_id: &str, created: i64| {
                conn.execute(
                    "INSERT INTO mem_tree_chunks \
                       (id, source_kind, source_id, owner, timestamp_ms, \
                        time_range_start_ms, time_range_end_ms, content, \
                        token_count, seq_in_source, created_at_ms) \
                     VALUES (?1, 'email', ?2, 'me@x.com', ?3, ?3, ?3, 'body', 10, 0, ?3)",
                    params![id, source_id, created],
                )
                .unwrap();
            };
            let embed = |id: &str| {
                conn.execute(
                    "INSERT INTO mem_tree_chunk_embeddings \
                       (chunk_id, model_signature, vector, dim, created_at) \
                     VALUES (?1, 'sig', X'00000000', 1, 0.0)",
                    params![id],
                )
                .unwrap();
            };

            // gmail: 3 chunks inside the active wave; 2 embedded (sidecar), 1 not.
            insert_chunk("g1", "gmail:acct", now - 1_000);
            insert_chunk("g2", "gmail:acct", now - 2_000);
            insert_chunk("g3", "gmail:acct", now - 3_000);
            embed("g1");
            embed("g2");

            let statuses = query_sync_statuses(conn, now).unwrap();
            let gmail = statuses
                .iter()
                .find(|s| s.provider == "gmail")
                .expect("gmail provider row");

            assert_eq!(gmail.chunks_synced, 3, "all three ingested");
            assert_eq!(
                gmail.chunks_pending, 1,
                "only g3 lacks a sidecar embedding (inline column is NULL for all)"
            );
            assert_eq!(gmail.batch_total, 3, "all three are within the wave window");
            assert_eq!(
                gmail.batch_processed, 2,
                "g1 and g2 have sidecar rows, so they count as processed"
            );
            Ok(())
        })
        .unwrap();
    }

    /// A provider with every chunk embedded must report zero wave (the UI
    /// hides the progress bar): `batch_total = batch_processed = 0`.
    #[test]
    fn fully_embedded_provider_reports_no_active_wave() {
        use crate::openhuman::memory_store::chunks::store::with_connection;
        use rusqlite::params;
        use tempfile::TempDir;

        let tmp = TempDir::new().expect("tempdir");
        let mut cfg = Config::default();
        cfg.workspace_dir = tmp.path().to_path_buf();
        let now = chrono::Utc::now().timestamp_millis();

        with_connection(&cfg, |conn| {
            conn.execute(
                "INSERT INTO mem_tree_chunks \
                   (id, source_kind, source_id, owner, timestamp_ms, \
                    time_range_start_ms, time_range_end_ms, content, \
                    token_count, seq_in_source, created_at_ms) \
                 VALUES ('s1', 'slack', 'slack:eng', 'me@x.com', ?1, ?1, ?1, 'b', 10, 0, ?1)",
                params![now - 5_000],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO mem_tree_chunk_embeddings \
                   (chunk_id, model_signature, vector, dim, created_at) \
                 VALUES ('s1', 'sig', X'00000000', 1, 0.0)",
                [],
            )
            .unwrap();

            let statuses = query_sync_statuses(conn, now).unwrap();
            let slack = statuses
                .iter()
                .find(|s| s.provider == "slack")
                .expect("slack provider row");
            assert_eq!(slack.chunks_pending, 0);
            assert_eq!(slack.batch_total, 0, "no pending chunks ⇒ no active wave");
            assert_eq!(slack.batch_processed, 0);
            Ok(())
        })
        .unwrap();
    }

    /// Terminal-but-unembedded chunks must not read as perpetually pending:
    /// a `dropped` chunk (admission-rejected) and a `reembed_skipped`
    /// tombstoned chunk both count as resolved even with no sidecar row, so a
    /// provider whose only leftovers are terminal drains to 0 pending / no wave.
    #[test]
    fn dropped_and_skipped_chunks_count_as_resolved_not_pending() {
        use crate::openhuman::memory_store::chunks::store::with_connection;
        use rusqlite::params;
        use tempfile::TempDir;

        let tmp = TempDir::new().expect("tempdir");
        let mut cfg = Config::default();
        cfg.workspace_dir = tmp.path().to_path_buf();
        let now = chrono::Utc::now().timestamp_millis();

        with_connection(&cfg, |conn| {
            let insert = |id: &str, lifecycle: &str, created: i64| {
                conn.execute(
                    "INSERT INTO mem_tree_chunks \
                       (id, source_kind, source_id, owner, timestamp_ms, \
                        time_range_start_ms, time_range_end_ms, content, \
                        token_count, seq_in_source, created_at_ms, lifecycle_status) \
                     VALUES (?1, 'slack', 'slack:eng', 'me@x.com', ?2, ?2, ?2, 'b', 10, 0, ?2, ?3)",
                    params![id, created, lifecycle],
                )
                .unwrap();
            };

            // d1: gate-dropped (no embedding, never will be).
            insert("d1", "dropped", now - 4_000);
            // sk1: pending_extraction but terminally tombstoned (e.g. body missing).
            insert("sk1", "pending_extraction", now - 3_000);
            conn.execute(
                "INSERT INTO mem_tree_chunk_reembed_skipped \
                   (chunk_id, model_signature, reason, skipped_at_ms) \
                 VALUES ('sk1', 'sig', 'body read failed', ?1)",
                params![now - 2_000],
            )
            .unwrap();
            // p1: genuinely still in the queue (no embedding, no terminal marker).
            insert("p1", "pending_extraction", now - 1_000);

            let statuses = query_sync_statuses(conn, now).unwrap();
            let slack = statuses
                .iter()
                .find(|s| s.provider == "slack")
                .expect("slack provider row");

            assert_eq!(slack.chunks_synced, 3, "all three ingested");
            assert_eq!(
                slack.chunks_pending, 1,
                "only p1 is genuinely pending; d1 (dropped) and sk1 (skipped) are terminal"
            );
            // p1 keeps the wave alive; d1+sk1 are in-window but resolved.
            assert_eq!(slack.batch_total, 3, "all within the wave window");
            assert_eq!(
                slack.batch_processed, 2,
                "d1 and sk1 count as resolved; p1 does not"
            );
            Ok(())
        })
        .unwrap();
    }

    /// The active wave must be gated on an unresolved chunk *inside the window*.
    /// A stale unresolved chunk from an older wave plus a fully-resolved recent
    /// chunk must NOT resurrect an active wave (no bogus 100%-complete bar):
    /// `batch_total = batch_processed = 0`, while lifetime `chunks_pending`
    /// still reflects the old straggler.
    #[test]
    fn stale_out_of_window_pending_does_not_open_a_wave() {
        use crate::openhuman::memory_store::chunks::store::with_connection;
        use rusqlite::params;
        use tempfile::TempDir;

        let tmp = TempDir::new().expect("tempdir");
        let mut cfg = Config::default();
        cfg.workspace_dir = tmp.path().to_path_buf();
        let now = chrono::Utc::now().timestamp_millis();
        // WAVE_WINDOW_MS is 10 min; place the straggler well outside it.
        let old = now - 30 * 60 * 1000;

        with_connection(&cfg, |conn| {
            let insert = |id: &str, created: i64| {
                conn.execute(
                    "INSERT INTO mem_tree_chunks \
                       (id, source_kind, source_id, owner, timestamp_ms, \
                        time_range_start_ms, time_range_end_ms, content, \
                        token_count, seq_in_source, created_at_ms) \
                     VALUES (?1, 'gmail', 'gmail:acct', 'me@x.com', ?2, ?2, ?2, 'b', 10, 0, ?2)",
                    params![id, created],
                )
                .unwrap();
            };

            // old straggler: unresolved, 30 min ago (outside the wave window).
            insert("old1", old);
            // recent: resolved (embedded), inside the window.
            insert("new1", now - 1_000);
            conn.execute(
                "INSERT INTO mem_tree_chunk_embeddings \
                   (chunk_id, model_signature, vector, dim, created_at) \
                 VALUES ('new1', 'sig', X'00000000', 1, 0.0)",
                [],
            )
            .unwrap();

            let statuses = query_sync_statuses(conn, now).unwrap();
            let gmail = statuses
                .iter()
                .find(|s| s.provider == "gmail")
                .expect("gmail provider row");

            assert_eq!(
                gmail.chunks_pending, 1,
                "the old straggler is still pending lifetime-wise"
            );
            assert_eq!(
                gmail.batch_total, 0,
                "no unresolved chunk inside the window ⇒ no active wave"
            );
            assert_eq!(gmail.batch_processed, 0);
            Ok(())
        })
        .unwrap();
    }
}
