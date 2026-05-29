# Memory Tree — per-integration health on the existing sources list (#2763, Part 3)

**Date:** 2026-05-29
**Issue:** [#2763](https://github.com/tinyhumansai/openhuman/issues/2763) (Part 3 of umbrella [#1856](https://github.com/tinyhumansai/openhuman/issues/1856))
**Branch:** `feat/2763-memory-tree-integration-health` (off `origin/main`)

## Summary

Surface a true per-integration **health status** (Active / Stale / Error) plus a
provider **icon** on the per-integration list that already sits directly under the
Memory Tree status panel. This is Part 3 of #1856; Part 1 (status panel + toggle)
shipped in #2719, Part 2 (team silos) is blocked on FR9 and out of scope here.

## Key finding that shapes this design

#2763's literal ask is "build a new `MemoryTreeIntegrationList.tsx` directly under the
panel." But the panel is already followed by **`MemorySources.tsx`** (mounted in
`MemoryWorkspace.tsx:225`, directly below `MemoryTreeStatusPanel`), which already renders
a per-integration list: integration name (`TOOLKIT_LABEL · identity`), chunk count
(`chunks_synced`), last-chunk timestamp, a per-row Sync button, and a **freshness** badge
(Active / Recent / Idle).

So ~70% of Part 3 already exists. Building a second near-identical list would be a
confusing duplicate. **Decision: enhance `MemorySources.tsx` in place** rather than add a
new component.

The genuine gaps versus #2763 are:

1. **No real `Error` status.** `MemorySyncStatus` (Rust) has no error field. The sync
   model is a *pull* model (#1136): it counts rows in `mem_tree_chunks` and deliberately
   removed push-based per-source phase/error tracking as "racy." Sync failures in the
   periodic loop are logged and swallowed (`memory_sync/composio/periodic.rs:265`); the
   only per-source state is an in-memory **last-success** map (`LAST_SYNC_AT`), rebuilt on
   restart and never exposed over RPC.
2. **No provider icons** — labels only.
3. **Staleness is not interval-aware.** The auto-fetch loop is a hardcoded
   `TICK_SECONDS = 1200` (20 min) const in `periodic.rs:68`. There is **no
   `auto_fetch_interval_minutes` config field** (which #2763's proposed thresholds assume).
   The current freshness thresholds (Active ≤30s, Recent ≤5min, Idle >5min) would mark a
   *healthy* 20-min-loop integration as Idle most of the time.

## Decisions (confirmed with the user)

1. **Direction:** enhance `MemorySources.tsx` in place. No duplicate component.
2. **Error status mechanism:** hybrid **in-memory** error capture — a process-global
   last-error map mirroring `LAST_SYNC_AT` (lost on restart; no SQLite). Keeps the
   #1136 pull-model grain; no durable error log.
3. **Badge:** **replace** the freshness badge (Active/Recent/Idle) with the new health
   badge (Active/Stale/Error). One badge per row. Keep the last-chunk timestamp as text.
4. **Which integrations:** keep the existing filter — connected ∩ `SYNCABLE_TOOLKITS`
   (the 6 toolkits that actually write into the memory tree). Listing non-syncable
   connected toolkits that contribute 0 chunks by design would be misleading.
5. **Error wiring depth:** capture at the always-on periodic loop only. Manual-sync
   failures already surface to the user via toast.

## Architecture

Two thin core changes feed one frontend change. All core work stays inside the
`memory_sync` domain (intra-domain dependency: `sync_status` reads from `composio`).

```
composio/periodic.rs                 sync_status/{types,rpc}.rs            MemorySources.tsx
  LAST_SYNC_AT (success)   ─┐
  LAST_SYNC_ERROR (new)    ─┼─ error_snapshot() ──► classify health ──► RPC field ──► health badge
  record_sync_error()       │     (+ TICK_SECONDS as the staleness interval)            + provider icon
  record_sync_success()─────┘  (clears error)                                           + error detail line
```

### Core change 1 — in-memory error capture (`memory_sync/composio/periodic.rs`)

- Add a process-global `LAST_SYNC_ERROR: OnceLock<Arc<Mutex<HashMap<(String,String), SyncErrorRecord>>>>`,
  sibling to the existing `LAST_SYNC_AT`. Key: `(toolkit, connection_id)`.
  `SyncErrorRecord { message: String, at_ms: i64 }`.
- `record_sync_error(toolkit, connection_id, message)` — called at the failure arm
  (`periodic.rs:265`, the `Err(e)` branch of `provider.sync(...)`).
- `record_sync_success(...)` is extended to **clear** that key's error entry, so a
  recovered source stops reporting Error on the next successful tick.
- Expose `pub fn error_snapshot() -> HashMap<(String,String), SyncErrorRecord>` (cloned
  snapshot) and make `TICK_SECONDS` readable to the status module (e.g. `pub const` or a
  `pub fn auto_fetch_interval_secs() -> u64`).
- Truncate stored error messages (e.g. ≤500 chars) and never store secrets — the periodic
  failure message is already a rendered provider error; redact if needed.

### Core change 2 — health classification + RPC fields (`memory_sync/sync_status/`)

- New enum in `types.rs`: `IntegrationHealth { Active, Stale, Error }` (`#[serde(rename_all = "snake_case")]`).
- Pure classifier `IntegrationHealth::derive(last_chunk_at_ms, last_error_at_ms, now_ms, interval_secs)`
  with precedence **Error > Active > Stale**:
  - `Error` if `last_error_at_ms` is `Some` and newer than `last_chunk_at_ms` (a failure
    that has not been superseded by a later successful ingest).
  - else `Active` if `last_chunk_at_ms` within `2 × interval_secs` (≈40 min) — lenient so a
    healthy source does not flap to Stale just before its next tick.
  - else `Stale` (genuinely quiet *or* quietly behind — deliberately **not** Error, so
    low-traffic sources like an empty inbox do not false-alarm).
- Extend `MemorySyncStatus` with:
  - `health: IntegrationHealth`
  - `last_error: Option<String>`
  - `last_error_at_ms: Option<i64>`
  - (retain `freshness` for now to keep the status SQL/struct diff tight; the UI stops
    using it. Verify remaining consumers at implementation time and remove in a follow-up
    if none.)
- `status_list_rpc` (`sync_status/rpc.rs`) reads `periodic::error_snapshot()`, aggregates
  errors **by toolkit** (any errored connection ⇒ toolkit Error; take the most recent),
  and joins onto each per-provider row by string equality (`provider == normalized_toolkit`
  holds for the syncable set: gmail/slack/notion/github/linear/clickup). Rows with no
  matching error keep `last_error = None`.
- Wire shape (`StatusListResponse`) is unchanged in structure; only `MemorySyncStatus`
  grows fields. The existing `openhuman.memory_sync_status_list` method already returns the
  per-integration array #2763 asks for — no new RPC method needed.

### Frontend change — `app/src/components/intelligence/MemorySources.tsx`

- **Icon:** render `composioToolkitMeta(row.toolkit).icon` (existing Composio logo badge
  with a generic fallback) at the start of each `SourceRowCard`.
- **Health badge:** drive the badge from the new `health` field instead of `freshness`:
  - `error` → coral, `stale` → stone/amber, `active` → sage/primary (reuse existing token
    classes). Remove `freshnessBadge`/`useFreshnessLabel` usage.
- **Error detail:** when `health === 'error'`, render the truncated `last_error` inline
  (same slot as today's connection-status badge).
- **Types:** extend the `MemorySyncStatus` TS type in `services/memorySyncService.ts` to
  add `health`, `last_error`, `last_error_at_ms`, plus an `IntegrationHealth` union.
- **i18n:** add new keys (`sync.healthStale`, `sync.healthError`, `sync.syncError` label,
  etc.) to `app/src/lib/i18n/en.ts` **and** `chunks/en-1.ts` (same chunk as the panel)
  **and** the chunk-1 file for every locale (ar, bn, de, es, fr, hi, id, it, ko, pl, pt,
  ru, zh-CN) using the English value as a placeholder. `pnpm i18n:check` enforces parity.

## Testing (≥80% changed-line coverage gate)

**Rust unit (`cargo test`):**
- `IntegrationHealth::derive` precedence: Error supersedes a stale timestamp; a successful
  ingest after an error returns Active; no error + recent chunk = Active; no error + old
  chunk = Stale; `None` chunk + `None` error = Stale; error older than last chunk = Active
  (recovered).
- `record_sync_error` stores keyed by `(toolkit, connection_id)`; `record_sync_success`
  clears it; distinct connections don't collide.
- `status_list_rpc` returns `health`/`last_error` populated; toolkit-level aggregation
  picks the most recent error across connections.

**Frontend unit (Vitest):**
- Row renders the correct health badge for active/stale/error.
- Error row shows the truncated `last_error` message.
- Provider icon renders (toolkit → `composioToolkitMeta`).
- A status with a cleared error renders Active (recovery path).
- Empty state ("No connected sources") unchanged.

**E2E scenarios covered (per CLAUDE.md planning rule):**
- Happy path: connected syncable integration with a recent chunk → Active badge + icon +
  chunk count + last-chunk time.
- Failure mode: integration whose last periodic sync errored → Error badge + message;
  after a later successful sync the badge returns to Active.
- Idle/quiet: connected integration with no recent chunks but no error → Stale (not Error).
- Auth gate / no connections: empty state.

## Scope

**In scope:** the two core changes above, the `MemorySources.tsx` enhancement, TS types,
i18n across all locales, and the tests above.

**Out of scope / explicitly rejected:**
- Part 2 — team-scoped wiki silos (#1856 Part 2), blocked on FR9.
- A durable/SQLite per-source error log (rejected; in-memory only).
- A new `auto_fetch_interval_minutes` config field (reference the existing const instead).
- A new standalone `MemoryTreeIntegrationList.tsx` component (enhance in place instead).
- Removing the now-unused `freshness` field (deferred to a follow-up to keep this diff tight).

## Acceptance-criteria mapping (#2763)

| #2763 criterion | How this design satisfies it |
| --- | --- |
| Per-integration RPC field (`integrations` array with id/name/icon/last-fetched/chunks/status) | Existing `memory_sync_status_list` already returns the per-provider array (provider id, chunks_synced, last_chunk_at_ms); we add `health`. Name + icon are resolved client-side via `composioToolkitMeta`. |
| Status classification Active/Stale/Error, deterministic given interval | `IntegrationHealth::derive` pure fn keyed off `TICK_SECONDS` (the real interval const). |
| List renders below `MemoryTreeStatusPanel`, visible from `/intelligence` + Settings → Memory data | `MemorySources` is already mounted there (`MemoryWorkspace.tsx:225`); enhanced in place. |
| Empty state matches `MemorySources` convention | Already present and unchanged. |
| Polling shares parent (no double poll) | `MemorySources` keeps its own existing 5 s poll; we do not add a second loop. |
| i18n parity across 14 locales | New keys added to `en.ts` + `chunks/*-1.ts` for all locales; `pnpm i18n:check` gate. |
| Diff coverage ≥ 80% | Rust + Vitest tests above target changed lines. |

> Note: one #2763 criterion (a dedicated per-integration RPC `integrations` field on
> `memory_tree_pipeline_status`) is satisfied structurally by the pre-existing
> `memory_sync_status_list` rather than literally on `memory_tree_pipeline_status`. This is
> an intentional reuse decision (see "Key finding"); to be called out in the PR body.
