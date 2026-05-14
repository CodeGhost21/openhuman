#!/usr/bin/env node
// Generate the parent-issue body + per-issue launch comments for a Cursor
// Cloud Agents batch. Reads the same batch JSON shape as
// scripts/agent-batch-overlap.mjs and prints copy-pasteable markdown to
// stdout. It does not post anything to GitHub.
//
// Usage:
//   node scripts/agent-batch-comments.mjs <batch.json>
//
// Recommended: run the overlap check first and only generate comments if
// that script reports PASS.
//   node scripts/agent-batch-overlap.mjs  <batch.json> && \
//   node scripts/agent-batch-comments.mjs <batch.json>

import fs from "node:fs";

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function loadBatch(file) {
  if (!fs.existsSync(file)) fail(`batch file not found: ${file}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    fail(`batch file is not valid JSON: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.issues) || parsed.issues.length === 0) {
    fail('batch file must contain { "issues": [...] } with at least one entry');
  }
  return parsed;
}

function slug(title, number) {
  const base = (title || `issue-${number}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return base || `issue-${number}`;
}

function parentBody(batch) {
  const children = batch.issues
    .map(
      (i) =>
        `- [ ] #${i.number} — ${i.title ?? "(no title)"} — lane \`${i.lane}\``,
    )
    .join("\n");
  return `Pilot batch for the Cursor Cloud Agents workflow defined in
[\`docs/agent-workflows/cursor-cloud-agents.md\`](../blob/main/docs/agent-workflows/cursor-cloud-agents.md).
${batch.issues.length} agents, one per lane. Validates the control loop before scaling.

Collision check:
\`node scripts/agent-batch-overlap.mjs <this-batch>.json\`
must report PASS — no path overlap, no choke-point conflict — before launch.

Children:
${children}

Dashboard: filter PRs by label \`cursor-cloud-agent\` against
\`tinyhumansai/openhuman\`. Two consecutive CI failures on any child PR
routes that agent to human review.

Pilot acceptance check (see [\`cursor-cloud-agents.md\`](../blob/main/docs/agent-workflows/cursor-cloud-agents.md#pilot-acceptance-check)):
- [ ] No two pilot agents touched the same file (lock-files excepted).
- [ ] Every pilot PR reached merged / closed-with-reason / blocked-with-note.
- [ ] At least one pilot PR merged after passing the diff-coverage gate.
- [ ] Dashboard reflected each PR state within 5 minutes of a status change.
- [ ] No secrets-posture violation logged.
- [ ] Retro filled in below.

Retro (filled at close):
- Collision rate:
- CI failure rate per agent:
- Workflow gaps to fix before scaling:
- Decision: cleared for scaled batch / changes required.`;
}

function launchComment(issue) {
  const slugged = slug(issue.title, issue.number);
  const paths = issue.paths.join(", ");
  return `@CursorAgent use the Cursor Cloud environment for tinyhumansai/openhuman.

Work issue #${issue.number}.
Expected path: /workspace/openhuman.
Start from latest origin/main.
Create branch cursor/${issue.number}-${slugged}.
Lane: ${issue.lane}. Owned paths: ${paths}. Do not edit any file outside those subtrees.
Follow docs/agent-workflows/cursor-cloud-agents.md exactly.
Do not open duplicate PRs. If validation is blocked, report the exact command and error in the PR body and on this issue.`;
}

function main() {
  const file = process.argv[2];
  if (!file) fail("usage: node scripts/agent-batch-comments.mjs <batch.json>");

  const batch = loadBatch(file);
  const dateLabel = batch.batch ?? new Date().toISOString().slice(0, 10);

  console.log(`# Cursor Cloud batch — ${dateLabel}\n`);
  console.log("## 1. Parent issue\n");
  console.log(`**Title:** \`Cursor Cloud pilot batch — ${dateLabel}\`\n`);
  console.log("**Body:**\n");
  console.log("```md");
  console.log(parentBody(batch));
  console.log("```\n");

  console.log("## 2. Launch comments (post one on each child issue)\n");
  for (const issue of batch.issues) {
    console.log(`### #${issue.number} — lane \`${issue.lane}\`\n`);
    console.log("```md");
    console.log(launchComment(issue));
    console.log("```\n");
  }

  console.log("## 3. Dashboard query\n");
  console.log("```bash");
  console.log(`gh pr list --repo tinyhumansai/openhuman --label cursor-cloud-agent --state open \\
  --json number,title,headRefName,statusCheckRollup,reviewDecision \\
  --jq '.[] | "\\(.number)\\t\\(.headRefName)\\t\\(.statusCheckRollup[0].conclusion // \\"pending\\")\\t\\(.reviewDecision // \\"PENDING\\")\\t\\(.title)"'`);
  console.log("```");
}

main();
