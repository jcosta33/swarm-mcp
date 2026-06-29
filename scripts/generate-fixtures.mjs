#!/usr/bin/env node
// Regenerate the contract fixtures from the REAL `suspec` binary (AC-011). The fixtures in
// test/fixtures/*.json are the drift tripwire's ground truth: contract.spec.ts parses each through the
// contract schemas, so a fixture that drifts from reality (or a schema that drifts from the fixture) fails
// a test instead of suspec-mcp silently producing wrong output. They MUST be generated, not hand-edited —
// this script is the generator, and test/generated-fixtures.spec.ts re-runs it into a temp dir and asserts
// the checked-in fixtures still match (so a stale fixture trips CI).
//
// It builds a deterministic, self-contained scratch workspace (git init → `suspec init` → scaffold a spec,
// a task, a worktree with a diff, and a review packet) so it can capture EVERY `--json` shape the adapter
// consumes — including a real ReviewReport (which needs a live worktree + diff + packet).
//
// Usage:  node scripts/generate-fixtures.mjs [--out <dir>] [--suspec-bin <path>]
//   --out        where to write the fixtures (default: test/fixtures next to this script's repo)
//   --suspec-bin the `suspec` binary (default: ../suspec-cli/bin/suspec.js relative to this repo)

import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined
    ? process.argv[i + 1]
    : fallback;
}

const outDir = resolve(arg("--out", join(repoRoot, "test", "fixtures")));
const suspecBin = resolve(
  arg("--suspec-bin", resolve(repoRoot, "..", "suspec-cli", "bin", "suspec.js")),
);

// Run `suspec <args> --json` in `cwd`; return the parsed JSON (or throw a clear error). `--json` is the
// only flag this generator appends; it never passes a mutation flag the adapter would not.
function suspec(cwd, args) {
  const res = spawnSync(process.execPath, [suspecBin, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = (res.stdout ?? "").trim();
  if (stdout.length === 0) {
    throw new Error(
      `suspec ${args.join(" ")} produced no JSON (exit ${res.status}): ${(res.stderr ?? "").trim()}`,
    );
  }
  return JSON.parse(stdout);
}

function git(cwd, args) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

function write(name, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(outDir, `${name}.json`), text);
  process.stderr.write(`  wrote ${name}.json\n`);
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "suspec-mcp-fixtures-"));
  try {
    process.stderr.write(`generating fixtures in ${scratch}\n`);
    git(scratch, ["init", "-q"]);
    git(scratch, ["config", "user.email", "fixtures@suspec.local"]);
    git(scratch, ["config", "user.name", "fixtures"]);

    // 1. init the workspace from the kit.
    suspec(scratch, ["init"]);

    // 2. the SAFE-WRITE tier outputs (AC-009) — captured from the REAL prepare ops (a draft spec, its
    //    task, and a promoted finding under the `prep-demo` slug). These are the verdict-free reports the
    //    adapter relays; capturing them from the binary is the whole point of AC-011.
    write("new-spec", suspec(scratch, ["new", "spec", "prep-demo"]));
    write(
      "new-task",
      suspec(scratch, [
        "new",
        "task",
        "--from",
        "SPEC-prep-demo",
        "--scope",
        "AC-001",
      ]),
    );
    write("promote", suspec(scratch, ["promote", "TASK-prep-demo"]));

    // 3. a complete, READY spec for the read + reconcile fixtures. `suspec new spec` scaffolds a DRAFT
    //    spec with `{{TBD}}` placeholders, and the reconcile engine SUPPRESSES coverage for a draft spec
    //    (the scope guard) — so the captured ReviewReport would carry no coverage finding. A hand-written
    //    ready spec with two ACs lets the real `suspec review` surface a genuine uncovered-coverage fact.
    //    This is still the REAL binary's output over a real spec — only the spec INPUT is authored here.
    mkdirSync(join(scratch, "specs", "demo-feature"), { recursive: true });
    writeFileSync(
      join(scratch, "specs", "demo-feature", "spec.md"),
      [
        "---",
        "type: spec",
        "id: SPEC-demo-feature",
        "title: Demo feature",
        "status: ready",
        "owner: fixtures",
        "sources:",
        "  - self",
        "---",
        "",
        "# Demo feature",
        "",
        "## Intent",
        "",
        "Add a demo feature so the fixtures exercise a real reconcile.",
        "",
        "## Non-goals",
        "",
        "- It changes nothing in production.",
        "",
        "## Requirements",
        "",
        "### AC-001 — first",
        "",
        "When a request arrives, the service must respond.",
        "",
        "Verify with: `first test`",
        "",
        "### AC-002 — second",
        "",
        "When a second request arrives, the service must also respond.",
        "",
        "Verify with: `second test`",
        "",
        "## Open questions",
        "",
        "- none",
        "",
        "## Affected areas",
        "",
        "- `src/demo.ts`",
        "",
        "## Dropped from sources",
        "",
        "- none",
        "",
      ].join("\n"),
    );
    suspec(scratch, [
      "new",
      "task",
      "--from",
      "SPEC-demo-feature",
      "--scope",
      "AC-001,AC-002",
    ]);

    // 4. the READ-tier outputs.
    write("status", suspec(scratch, ["status"]));
    write("check-workspace", suspec(scratch, ["check"]));
    write(
      "check-file",
      suspec(scratch, ["check", "specs/demo-feature/spec.md"]),
    );
    write("show-checks", suspec(scratch, ["show", "checks"]));
    write("show-spec", suspec(scratch, ["show", "spec", "SPEC-demo-feature"]));
    write("show-task", suspec(scratch, ["show", "task", "TASK-demo-feature"]));

    // 5. a real ReviewReport + parsed review — needs a live worktree, a diff, and a review packet. The
    //    packet covers only AC-001 (with an empty Evidence cell), so AC-002 reads uncovered and AC-001
    //    reads empty-evidence — the ReviewReport exercises the coverage + empty-evidence + verify-binding
    //    branches the adapter derives human-attention from.
    git(scratch, ["add", "-A"]);
    git(scratch, ["commit", "-qm", "scaffold"]);
    const wt = suspec(scratch, [
      "worktree",
      "create",
      "demo-feature",
      "--task",
      "demo-feature",
    ]);
    // a diff inside the worktree (so `diffChangedFiles` is non-empty)
    appendFileSync(join(wt.worktreePath, "src-file.txt"), "changed\n");
    // a review packet with an empty-Evidence Pass row (so the ReviewReport exercises that branch)
    writeFileSync(
      join(scratch, "reviews", "demo-feature.md"),
      [
        "---",
        "type: review",
        "id: REVIEW-demo-feature",
        "status: needs-human",
        "spec: SPEC-demo-feature",
        "task: TASK-demo-feature",
        "pr: null",
        "reviewedSha: null",
        "evidenceHash: null",
        "---",
        "",
        "# Review: demo-feature",
        "",
        "## Requirement coverage",
        "",
        "| Requirement | Result | Evidence |",
        "| --- | --- | --- |",
        "| AC-001 | Pass |  |",
        "",
        "## Verify results",
        "",
        "## Human attention",
        "",
      ].join("\n"),
    );
    write("review-report", suspec(scratch, ["review", "demo-feature"]));
    write("show-review", suspec(scratch, ["show", "review", "demo-feature"]));

    process.stderr.write(`done. fixtures in ${outDir}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
