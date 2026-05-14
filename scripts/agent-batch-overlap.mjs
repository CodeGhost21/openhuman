#!/usr/bin/env node
// Pre-launch collision check for a Cursor Cloud Agents batch.
//
// Reads a JSON batch file describing the issues that will be launched in
// parallel and reports:
//   - missing/invalid lane assignments
//   - paths declared on an issue that do not fall under that issue's lane
//   - pairwise path overlap between any two issues
//   - choke-point files touched by more than one issue (schema-owner conflicts)
//
// Usage:
//   node scripts/agent-batch-overlap.mjs <batch.json>
//
// Batch file shape:
//   {
//     "batch": "2026-05-14",
//     "issues": [
//       { "number": 1502, "lane": "frontend-ui",        "paths": ["app/src/components/", "app/src/screens/"] },
//       { "number": 1675, "lane": "rust-core/agent",    "paths": ["src/openhuman/agent/"] },
//       { "number": 1714, "lane": "rust-core/<domain>", "paths": ["src/openhuman/integrations/"] }
//     ]
//   }
//
// Exit codes: 0 = no collisions, 1 = collision or invalid input.

import fs from "node:fs";
import path from "node:path";

const LANES = {
  "frontend-ui": ["app/src/components/", "app/src/screens/", "app/src/styles/"],
  "frontend-state": ["app/src/store/", "app/src/services/", "app/src/lib/"],
  "frontend-mcp": ["app/src/lib/mcp/"],
  "tauri-shell": ["app/src-tauri/src/"],
  "rust-core/<domain>": ["src/openhuman/"],
  "rust-core-server": ["src/core/", "src/rpc/"],
  tests: ["tests/", "app/test/", "app/src/test/"],
  docs: ["gitbooks/", "docs/", "README.md", "AGENTS.md", "CLAUDE.md"],
  "ci-config": [".github/workflows/", ".github/actions/", "scripts/"],
};

// Choke-point files. If two issues touch the same choke point, only one may
// own the change in this batch (the "schema owner"); the others must defer or
// wait for the owner's PR to merge first.
const CHOKE_POINTS = [
  "src/core/all.rs",
  "src/rpc/dispatch.rs",
  "app/src-tauri/tauri.conf.json",
  "app/package.json",
  "Cargo.lock",
  "Cargo.toml",
  "pnpm-lock.yaml",
];

function normalizePath(p) {
  // Collapse any "./" or "//" but preserve trailing "/" which marks a directory.
  return path.posix.normalize(p);
}

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

function validateIssue(issue, index) {
  const where = `issue[${index}]`;
  if (typeof issue.number !== "number")
    fail(`${where}: missing numeric "number"`);
  if (typeof issue.lane !== "string" || !issue.lane.trim())
    fail(`#${issue.number}: missing "lane"`);
  // Treat "rust-core/<subdomain>" lanes (e.g. "rust-core/agent") as instances of "rust-core/<domain>".
  const laneKey = issue.lane.startsWith("rust-core/")
    ? "rust-core/<domain>"
    : issue.lane;
  if (!LANES[laneKey]) fail(`#${issue.number}: unknown lane "${issue.lane}"`);
  if (!Array.isArray(issue.paths) || issue.paths.length === 0) {
    fail(
      `#${issue.number}: declare at least one path the agent will touch in "paths"`,
    );
  }
  const paths = issue.paths.map(normalizePath);
  const allowed = LANES[laneKey];
  for (const p of paths) {
    const inLane = allowed.some((root) =>
      root.endsWith("/") ? p.startsWith(root) : p === root,
    );
    if (!inLane)
      fail(
        `#${issue.number}: path "${p}" is outside lane "${issue.lane}" (allowed: ${allowed.join(", ")})`,
      );
  }
  return { ...issue, paths };
}

function pathsOverlap(a, b) {
  // A pair of paths "overlap" if one is a prefix of the other (treating
  // trailing "/" as directory scope), or if they are equal.
  if (a === b) return a;
  const ad = a.endsWith("/");
  const bd = b.endsWith("/");
  if (ad && b.startsWith(a)) return a;
  if (bd && a.startsWith(b)) return b;
  return null;
}

function reportPairOverlap(issues) {
  const collisions = [];
  for (let i = 0; i < issues.length; i++) {
    for (let j = i + 1; j < issues.length; j++) {
      const a = issues[i];
      const b = issues[j];
      for (const pa of a.paths) {
        for (const pb of b.paths) {
          const hit = pathsOverlap(pa, pb);
          if (hit)
            collisions.push({
              a: a.number,
              b: b.number,
              path: hit,
              paA: pa,
              paB: pb,
            });
        }
      }
    }
  }
  return collisions;
}

function reportChokePoints(issues) {
  const hits = new Map();
  for (const issue of issues) {
    for (const p of issue.paths) {
      for (const cp of CHOKE_POINTS) {
        if (p === cp || (p.endsWith("/") && cp.startsWith(p))) {
          if (!hits.has(cp)) hits.set(cp, []);
          hits.get(cp).push(issue.number);
        }
      }
    }
  }
  const conflicts = [];
  for (const [cp, owners] of hits) {
    if (owners.length > 1) conflicts.push({ choke: cp, owners });
  }
  return conflicts;
}

function main() {
  const file = process.argv[2];
  if (!file) fail("usage: node scripts/agent-batch-overlap.mjs <batch.json>");

  const batch = loadBatch(file);
  const issues = batch.issues.map(validateIssue);
  const lanes = new Map();
  for (const issue of issues) {
    if (!lanes.has(issue.lane)) lanes.set(issue.lane, []);
    lanes.get(issue.lane).push(issue.number);
  }

  console.log(
    `Batch: ${batch.batch ?? "(unnamed)"} — ${issues.length} agent(s)\n`,
  );
  console.log("Lane assignments:");
  for (const [lane, nums] of lanes) {
    const marker = nums.length > 1 ? "  COLLISION" : "";
    console.log(
      `  ${lane.padEnd(22)} → ${nums.map((n) => `#${n}`).join(", ")}${marker}`,
    );
  }

  const sameLaneCollisions = [...lanes.values()].filter(
    (nums) => nums.length > 1,
  );
  const pathCollisions = reportPairOverlap(issues);
  const chokeCollisions = reportChokePoints(issues);

  console.log("\nPath overlap between issues:");
  if (pathCollisions.length === 0) {
    console.log("  (none)");
  } else {
    for (const c of pathCollisions) {
      console.log(
        `  #${c.a} ⇄ #${c.b}: "${c.paA}" vs "${c.paB}" (overlap at "${c.path}")`,
      );
    }
  }

  console.log("\nChoke-point file owners:");
  if (chokeCollisions.length === 0) {
    console.log("  (none)");
  } else {
    for (const c of chokeCollisions) {
      console.log(
        `  ${c.choke}: claimed by ${c.owners.map((n) => `#${n}`).join(", ")} — pick one schema owner before launch`,
      );
    }
  }

  // Same-lane collisions are only fatal when the lane is a single-owner lane
  // ("frontend-mcp", "rust-core-server", "ci-config", "docs", "tests",
  // "tauri-shell", "frontend-ui", "frontend-state"). "rust-core/<domain>" is
  // parallel-safe because each domain is its own subtree.
  const PARALLEL_OK = ["rust-core/<domain>"];
  const fatalSameLane = sameLaneCollisions.filter((nums) => {
    const lane = issues.find((i) => i.number === nums[0]).lane;
    if (lane.startsWith("rust-core/")) return false; // sub-domains are distinct
    return !PARALLEL_OK.includes(lane);
  });

  const fatal =
    pathCollisions.length > 0 ||
    fatalSameLane.length > 0 ||
    chokeCollisions.length > 0;
  console.log(
    `\n${fatal ? "FAIL" : "PASS"}: batch ${fatal ? "has collisions to resolve before launch" : "is clear to launch"}`,
  );
  process.exit(fatal ? 1 : 0);
}

main();
