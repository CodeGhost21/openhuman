# Cursor Cloud Agents Workflow

This runbook describes how OpenHuman runs **15-20 Cursor Cloud Agents in parallel** against the codebase without branch collisions, duplicated work, or quality regressions. It mirrors [`codex-pr-checklist.md`](codex-pr-checklist.md) for the Codex web channel and is the single source of truth operators use to launch, monitor, and reconcile a batch.

Use this document for any cloud agent that opens OpenHuman PRs from a Cursor remote run. Single-agent local Cursor sessions follow the regular contributor flow in [`CLAUDE.md`](../../CLAUDE.md).

---

## Pilot vs. scaled batch

| Stage            | Concurrency  | Purpose                                                                                               | Exit criteria                                                                                                            |
| ---------------- | ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Pilot**        | 3-5 agents   | Validate the control loop on real issues.                                                             | All pilot PRs reach CI green or are explicitly closed with a recorded reason. No two pilot agents touched the same file. |
| **Scaled batch** | 15-20 agents | Steady-state parallel execution once the pilot has shipped at least one merged PR per ownership lane. | Operator dashboard (see below) shows every agent in a terminal state (merged, closed, blocked) within the batch window.  |

Always run a pilot before scaling. A scaled batch that skips the pilot has no baseline for collision rate, CI flakiness, or secrets posture, and the recovery cost is much higher than the wait.

---

## Required preflight (per agent)

Each Cursor Cloud Agent runs this in its container before editing any file. The script lives in [`scripts/codex-pr-preflight.mjs`](../../scripts/codex-pr-preflight.mjs) and is shared with Codex web:

```bash
node scripts/codex-pr-preflight.mjs --strict-path --lightweight
```

Then verify the environment is wired to this repo and the expected path:

```bash
pwd
git status --porcelain
git branch --show-current
git remote -v
test -f AGENTS.md
test -f gitbooks/developing/architecture.md
test -f Cargo.toml
test -f app/package.json
```

Expected repo path in Cursor Cloud is `/workspace/openhuman` (configurable via `CODEX_EXPECT_REPO_PATH`; the preflight script honors the same variable). If the checkout is missing or the command shows another project, the agent must stop and report the environment binding problem in the PR body. **Do not edit files in the wrong repository.**

---

## Launch trigger rule

One Cursor Cloud Agent trigger per GitHub issue. Do not also delegate the same issue via Linear or Codex web at the same time; combining triggers double-runs the same scope and produces duplicate PRs.

Preferred launch comment posted on the upstream issue:

```md
@CursorAgent use the Cursor Cloud environment for tinyhumansai/openhuman.

Work issue #<ISSUE-NUMBER>.
Expected path: /workspace/openhuman.
Start from latest origin/main.
Create branch cursor/<ISSUE-NUMBER>-<short-title>.
Follow docs/agent-workflows/cursor-cloud-agents.md exactly.
Do not open duplicate PRs. If validation is blocked, report exact command and error in the PR body and on the issue.
```

Record the chosen trigger (`@CursorAgent` comment, Cursor dashboard launch, or scheduled batch) on the issue so the operator dashboard can attribute the run. Do not mix `@Codex` and `@CursorAgent` comments on the same issue.

---

## Branch and PR rules

- Start from latest `origin/main` (this targets `tinyhumansai/openhuman:main`). Do not branch off a stale fork main.
- One branch and one PR per issue.
- Branch name: `cursor/<ISSUE-NUMBER>-<short-title>` (lower-case kebab, max 60 chars). The `cursor/` prefix is what the operator dashboard filters on.
- Push to the agent's authorized fork (typically `cursor-bot/openhuman` or the operator's fork). Never push branches to `tinyhumansai/openhuman` directly.
- Open the PR with `--head <fork-owner>:cursor/<ISSUE-NUMBER>-<short-title>` against `tinyhumansai/openhuman:main`.
- Add the GitHub label `cursor-cloud-agent` so the dashboard and operator queries can find the PR.
- Do not open duplicate PRs for the same issue. If a retry is needed, push to the same branch or close the stale duplicate and state which PR is canonical (see [Duplicate PR cleanup](codex-pr-checklist.md#duplicate-pr-cleanup)).

---

## Ownership boundaries (collision avoidance)

The most common failure for 15-20 parallel agents is two agents touching the same file with conflicting edits. The workflow enforces ownership at the **scope-decomposition step**, not at merge time, because git merges are not the right place to discover scope overlap.

### Lanes

Issues are partitioned into lanes before launch. An agent is assigned exactly one lane; lanes do not overlap.

| Lane                 | Owned paths                                                                          | Typical work                                                                   |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `frontend-ui`        | `app/src/components/`, `app/src/screens/`, `app/src/styles/`                         | React/Tailwind UI                                                              |
| `frontend-state`     | `app/src/store/`, `app/src/services/`, `app/src/lib/` (excluding `app/src/lib/mcp/`) | Redux slices, API clients, hooks                                               |
| `frontend-mcp`       | `app/src/lib/mcp/`                                                                   | JSON-RPC transport / validation                                                |
| `tauri-shell`        | `app/src-tauri/src/`                                                                 | IPC, window management, core process lifecycle                                 |
| `rust-core/<domain>` | `src/openhuman/<domain>/` for one specific domain                                    | One domain at a time (`memory`, `cron`, `skills`, `channels`, `webhooks`, ...) |
| `rust-core-server`   | `src/core/`, `src/rpc/`                                                              | Transport, dispatch, controller registry plumbing                              |
| `tests`              | `tests/`, `app/test/`, `app/src/test/`                                               | Test-only additions / fixes                                                    |
| `docs`               | `gitbooks/`, `docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md`                          | Documentation only                                                             |
| `ci-config`          | `.github/workflows/`, `.github/actions/`, `scripts/`                                 | CI workflows, repo scripts                                                     |

Rules:

- **One agent per lane per batch.** A 15-20 agent batch must use at least 9 lanes (one of each above) or split a lane along path-disjoint sub-trees. `rust-core/<domain>` is naturally parallel because each domain lives in its own subdirectory; treat `rust-core/memory` and `rust-core/cron` as two distinct lanes.
- **No cross-lane edits.** If an issue actually needs changes in two lanes (e.g. a Rust core change plus a frontend rendering tweak), split it into two issues with explicit dependency order. The dependent issue is launched only after the upstream PR merges.
- **Schema and contract files (`src/core/all.rs`, controller registries, JSON-RPC dispatch, `tauri.conf.json`, `package.json`, `Cargo.lock`):** these are choke points. Only one agent per batch may modify any of these. The operator marks the chosen agent as the **schema owner** for the batch; other agents must request the schema owner to land their entry first or defer to the next batch.

### Pre-launch collision check

Before launching a batch, the operator writes a batch file describing each issue's lane and the paths the agent is allowed to touch (see [`pilot-batch-1480.json`](pilot-batch-1480.json) for the canonical format), then runs:

```bash
node scripts/agent-batch-overlap.mjs docs/agent-workflows/<your-batch>.json
```

The script reports lane assignments, pairwise path overlap, and choke-point conflicts (`src/core/all.rs`, controller registries, `tauri.conf.json`, `package.json`, `Cargo.lock`, `pnpm-lock.yaml`, etc.). It exits non-zero on any collision. Resolve every reported collision by reassigning scope or sequencing the issues before launch — do not rely on git to catch it after the fact.

---

## Quality gates (per agent, before PR)

Every Cursor Cloud Agent runs the smallest checks that prove the changed surface, plus the merge gates the repo enforces. These are the same gates [`codex-pr-checklist.md`](codex-pr-checklist.md#validation-before-pr) requires; the difference here is they run inside the agent's container with no operator hand-holding.

```bash
# Always for app or docs-visible app changes
pnpm --filter openhuman-app format:check
pnpm typecheck

# Focused app tests for changed TS/React behavior
pnpm --dir app exec vitest run <changed-test-files> --config test/vitest.config.ts

# Root Rust changes
cargo fmt --manifest-path Cargo.toml --all --check
pnpm debug rust <test-filter>

# Tauri shell changes
cargo fmt --manifest-path app/src-tauri/Cargo.toml --all --check
```

Merge gates the agent must respect:

- **Diff coverage ≥ 80% on changed lines.** Enforced by [`.github/workflows/coverage.yml`](../../.github/workflows/coverage.yml). The agent runs `pnpm test:coverage` and `pnpm test:rust` locally before opening the PR. If the agent cannot generate coverage in its container (toolchain missing, sandbox restrictions), it must report the exact command and blocker in the PR body. Do not claim a gate passed that did not run.
- **Format / lint / typecheck** must all be green before push.
- **PR submission checklist** in [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md) is validated with `pnpm pr:checklist` (see [Codex checklist preflight](codex-pr-checklist.md#pr-submission-checklist-preflight)).

If a command cannot run because the container lacks vendored files or system packages, do not claim it passed. Copy the exact command and blocker into the PR body so the operator can rerun the gate locally before merge.

---

## Secrets posture

Cursor Cloud Agent containers must not see production secrets. The threat model is that an agent run is treated as an untrusted process for the duration of the batch.

Rules:

- **No production env files.** Agent containers ship with [`.env.example`](../../.env.example) and [`app/.env.example`](../../app/.env.example) only. Production values for `VITE_*`, `OPENAI_*`, `OPENHUMAN_*`, OAuth client secrets, signing keys, and updater Gist tokens are not provisioned.
- **Build-only credentials are scoped.** If a Cursor Cloud Agent needs to run `pnpm build` (rare; usually unnecessary for code-edit work), it uses a scoped staging value that cannot sign installers or finalize OAuth. Production signing and OAuth credentials stay in the GitHub Actions environments configured by [`release-production.yml`](../../.github/workflows/release-production.yml) and [`release-staging.yml`](../../.github/workflows/release-staging.yml), not in agent containers.
- **No GitHub App token escalation.** Agents push with a token scoped to the agent's fork only. Pushes to `tinyhumansai/openhuman` are blocked by branch protection; the agent has no token that bypasses it.
- **No live external integrations in tests.** Mock-only per the [mock policy](../../gitbooks/developing/testing-strategy.md). Agents must not configure real OAuth callback URLs, real Sentry DSNs, or real provider API keys for tests. The shared mock backend at `scripts/mock-api-core.mjs` is the only network the test suite is allowed to hit.
- **Redact in logs.** Per [`CLAUDE.md`](../../CLAUDE.md#debug-logging-must-follow): never log secrets or full PII. Agent-authored diagnostics inherit the same rule.

If an agent finds itself needing a real secret, it must stop and surface the request to the operator. Do not work around the gate.

---

## Progress visibility (operator dashboard)

A single operator-facing view answers: which agents are running, which are blocked, which need review, and which have merged.

The dashboard is built from three GitHub data sources, joined by the `cursor-cloud-agent` label and the `cursor/<ISSUE-NUMBER>-...` branch prefix:

1. **GitHub Projects board** (`Cursor Cloud Batch`) with columns: `Launched`, `PR open`, `CI failing`, `Review requested`, `Merged`, `Blocked`, `Closed`. Each PR auto-moves on label or status changes via [`.github/workflows/pr-quality.yml`](../../.github/workflows/pr-quality.yml).
2. **Per-batch issue** that lists every child issue with a checkbox. The operator opens one parent issue at batch launch, links each child issue, and ticks the checkbox as PRs land.
3. **CLI snapshot** for ad-hoc checks:

```bash
gh pr list --repo tinyhumansai/openhuman --label cursor-cloud-agent --state open \
  --json number,title,headRefName,statusCheckRollup,reviewDecision \
  --jq '.[] | "\(.number)\t\(.headRefName)\t\(.statusCheckRollup[0].conclusion // "pending")\t\(.reviewDecision // "PENDING")\t\(.title)"'
```

Treat any PR that has been in `CI failing` for more than two consecutive check runs as **blocked** and re-route to a human reviewer. Do not let the agent keep retrying.

---

## Operator runbook

The end-to-end sequence the operator follows for a 15-20 agent batch. The pilot uses the same sequence at smaller scale.

1. **Pick issues.** Tag candidate issues with `cursor-cloud-batch` and confirm each has a clear acceptance criteria block. Reject issues that span multiple lanes (split first).
2. **Assign lanes.** For each issue, write the lane and the explicit owned paths into the issue body (a `## Cursor Lane` section). The launch comment references this section.
3. **Run pre-launch collision check.** Confirm no two issues touch the same paths. Resolve overlaps before launching.
4. **Open the batch parent issue.** Title: `Cursor Cloud batch <YYYY-MM-DD>`. List each child issue as a checkbox. Link the GitHub Project board view.
5. **Launch.** Post the launch comment on each child issue. Cursor Cloud picks them up; one agent per issue.
6. **Monitor.** Watch the operator dashboard. When a PR turns `CI failing` twice in a row, mark blocked. When a PR is `Review requested`, route to a human. Do not leave agents looping on the same failure.
7. **Reconcile.** As PRs merge, tick the parent-issue checklist. When the parent is fully checked, close the batch.
8. **Retro.** After every scaled batch, record collision rate, CI failure rate, secret-policy violations (should be zero), and merge-time per agent in the batch parent issue before closing.

---

## Pilot acceptance check

Before declaring the pilot complete:

- [ ] Three to five Cursor Cloud Agents launched against real (non-trivial) issues.
- [ ] No two pilot agents touched the same file outside of `Cargo.lock`-style auto-generated outputs.
- [ ] Every pilot PR reached either `merged`, `closed with explicit reason`, or `blocked with operator note`.
- [ ] At least one pilot PR merged after passing the diff-coverage gate.
- [ ] The operator dashboard reflected each PR's state within five minutes of a status change.
- [ ] No secrets-posture violation logged.
- [ ] Retro recorded on the pilot parent issue with collision rate, CI failure rate, and any workflow gaps to fix before scaling.

Once all boxes are checked, the workflow is cleared for 15-20 agent scaled batches.

---

## Related

- [`codex-pr-checklist.md`](codex-pr-checklist.md) — the parallel runbook for Codex web sessions.
- [`CLAUDE.md`](../../CLAUDE.md) — repo conventions, debug-logging rules, feature workflow.
- [`AGENTS.md`](../../AGENTS.md) — RPC controller patterns and `RpcOutcome<T>` contract.
- [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md) — required PR sections (AI-authored metadata is mandatory for Cursor Cloud PRs).
- [`.github/workflows/coverage.yml`](../../.github/workflows/coverage.yml) — diff-coverage merge gate.
- [`gitbooks/developing/testing-strategy.md`](../../gitbooks/developing/testing-strategy.md) — failure-path testing and mock policy.
