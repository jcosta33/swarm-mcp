// zod schemas mirroring the suspec CLI's real `--json` shapes (verified against the binary). These are
// the DRIFT TRIPWIRE: suspec-mcp parses every CLI payload through them, so if suspec-cli renames or drops
// a field suspec-mcp consumes (e.g. ReviewReport.coverage), the parse fails loudly in a test rather than
// silently producing wrong tool output. `.passthrough()` keeps unknown extra fields (additive CLI
// changes don't break us); the named fields are the ones suspec-mcp actually reads.
//
// ENUM POLICY (AC-011, audit F7): a field is modelled as a CLOSED `z.enum` ONLY when the adapter BRANCHES
// on its exact value-set — so a new/renamed value the adapter cannot interpret trips the wire. A field the
// adapter only PASSES THROUGH (surfaces in `data` / a concise slice, never switches on) is modelled as
// `z.string()`: a benign additive CLI enum value must NOT convert into a suspec-mcp break for no consumer
// benefit. The only payload enum the adapter branches on is `ReviewReport.level` (`=== "blocking"` scales
// the derived human-attention severity), so OutcomeLevel stays closed; every diagnostic `code`/`kind`/
// `severity`/`verdict`/verify-`result` is pass-through and is `z.string()`. The always-present top-level
// lists stay required (a dropped list the adapter iterates still trips the wire).

import { z } from "zod";

// The three exit classes an engine success carries (unixOutcome.ts `OutcomeLevel`). NOT a review
// result — it is the CLI's advisory severity (clean = exit 0, warning = 1, blocking = 2). CLOSED because
// the adapter branches on it (`ReviewReport.level === "blocking"` in envelope.ts).
const OutcomeLevel = z.enum(["clean", "warning", "blocking"]);

// --- suspec status --json  → DerivedBoard (deriveBoard.ts) -----------------------------------------
const BoardTask = z
  .object({
    id: z.string(),
    status: z.string(),
    hasReview: z.boolean(),
    reviewStatus: z.string().nullable(),
  })
  .passthrough(); // reviewStatus is `string | null` (deriveBoard.ts) — null for an unreviewed task; status is free-form frontmatter
const BoardSpec = z
  .object({ id: z.string(), status: z.string(), tasks: z.array(BoardTask) })
  .passthrough();
export const DerivedBoardSchema = z
  .object({
    level: OutcomeLevel,
    specs: z.array(BoardSpec),
    // The board's two headline triage lists (deriveBoard.ts) — review-ready tasks with no packet,
    // and tasks whose review status reads needs-human/blocked. Always emitted; modelled so a drop trips.
    tasksWithoutReview: z.array(z.string()),
    needsHuman: z.array(z.string()),
  })
  .passthrough();
export type DerivedBoard = z.infer<typeof DerivedBoardSchema>;

// --- suspec check [file] --json (checkSpec.ts / checkWorkspace.ts) ---------------------------------
const Diagnostic = z
  .object({
    code: z.string(),
    // pass-through (AC-011) → z.string(), not a closed enum.
    severity: z.string(),
    message: z.string(),
    line: z.number().nullable().optional(),
  })
  .passthrough();
export const FileCheckSchema = z
  .object({
    level: OutcomeLevel,
    path: z.string(),
    diagnostics: z.array(Diagnostic),
  })
  .passthrough();
export type FileCheck = z.infer<typeof FileCheckSchema>;

const WorkspaceSpecCheck = z
  .object({
    path: z.string(),
    level: OutcomeLevel,
    diagnostics: z.array(Diagnostic),
  })
  .passthrough();
// A workspace-level finding (checkWorkspace.ts `WorkspaceFinding`) — a C002/C017 collision, a kit-
// validity problem (placeholder / missing-template / agents-oversize), or one of the reconcile-only
// advisories (supersede-* / duplicate-content / unpromoted-finding / incomplete-execution-digest). These
// live OUTSIDE any spec's diagnostics, so an agent reading only `specs[]` would miss them. The `code` is
// pass-through (AC-011) → z.string(); the `message` (which the agent reads) staying required IS the
// tripwire: a dropped message field still trips the wire.
const WorkspaceFinding = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .passthrough();
export const WorkspaceCheckSchema = z
  .object({
    level: OutcomeLevel,
    // The check outcome (NOT a review verdict): the merge-gate result the CLI computes for the repo.
    // pass-through (AC-011) → z.string().
    verdict: z.string(),
    specs: z.array(WorkspaceSpecCheck),
    // The change-plan files' check results, same shape as a spec result (checkWorkspace.ts).
    changePlans: z.array(WorkspaceSpecCheck),
    workspaceFindings: z.array(WorkspaceFinding),
  })
  .passthrough();
export type WorkspaceCheck = z.infer<typeof WorkspaceCheckSchema>;

// --- suspec review <stem> --json  → ReviewReport (reconcileReview.ts) ------------------------------
// `kind` is the C012 coverage class; the adapter derives human-attention from `.message`/`.id`, never
// branches on `kind` → pass-through (AC-011), z.string(). The `message` staying required is the tripwire.
const CoverageFinding = z
  .object({
    id: z.string(),
    kind: z.string(),
    message: z.string(),
  })
  .passthrough();
// The C013 verify-evidence-binding consistency classes (checksContract.ts `VerifyBindingFinding`).
// Same as coverage: `kind` is pass-through (AC-011) → z.string().
const VerifyBindingReport = z
  .object({
    id: z.string(),
    kind: z.string(),
    message: z.string(),
  })
  .passthrough();
const SelfReport = z
  .object({
    claimedNotInDiff: z.array(z.string()),
    inDiffNotClaimed: z.array(z.string()),
    outsideScope: z.array(z.string()),
    // A prose Run summary with no machine-checkable file paths (suspec-cli #44): the inDiffNotClaimed
    // flood is suppressed and this is surfaced once. Optional for back-compat with an older CLI.
    runSummaryUnparsed: z.boolean().optional(),
  })
  .passthrough();
const PacketStructural = z
  .object({
    badResultCells: z.array(z.string()),
    badStatus: z.string().nullable(),
    statusPassContradicted: z.boolean(),
    missingSections: z.array(z.string()),
  })
  .passthrough();
export const ReviewReportSchema = z
  .object({
    level: OutcomeLevel,
    task: z.string(),
    diffChangedFiles: z.array(z.string()),
    // The adapter derives human-attention from `.message` on each of these — a rename/drop trips the wire.
    coverage: z.array(CoverageFinding),
    verifyBinding: z.array(VerifyBindingReport),
    scopeDivergence: z.array(z.string()),
    selfReport: SelfReport,
    // Changed files matching a task's `## Do not change` entry (C014, ADR-0086) — distinct from
    // selfReport.outsideScope; the adapter derives a human-attention item from it.
    doNotChangeTouched: z.array(z.string()),
    emptyEvidencePassRows: z.array(z.string()),
    packetStructural: PacketStructural,
    hasReviewPacket: z.boolean(),
  })
  .passthrough();
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

// --- suspec show <kind> [ref] --json  → ShowResult (showArtifact.ts) -------------------------------
// The loader projections suspec-mcp's get_* tools surface. Same drift-tripwire intent as the schemas
// above: a renamed/dropped field the adapter relies on trips a parse in the contract tests. Each is the
// uniform `{ level: 'clean', kind, value }` envelope (show never warns; a lookup failure is exit 2).
const showEnvelope = <T extends z.ZodTypeAny>(kind: string, value: T) =>
  z
    .object({ level: z.literal("clean"), kind: z.literal(kind), value })
    .passthrough();

// suspec show checks → the contract version + the core checks (id/name/severity).
export const ShowChecksSchema = showEnvelope(
  "checks",
  z
    .object({
      version: z.string(),
      checks: z.array(
        // `severity` is pass-through (AC-011) → z.string().
        z
          .object({ id: z.string(), name: z.string(), severity: z.string() })
          .passthrough(),
      ),
    })
    .passthrough(),
);
export type ShowChecks = z.infer<typeof ShowChecksSchema>;

// suspec show task → the task packet's frontmatter + scope/areas + the ADR-0100 cross-root embedded slice.
export const ShowTaskSchema = showEnvelope(
  "task",
  z
    .object({
      id: z.string().nullable(),
      source: z.string().nullable(),
      status: z.string().nullable(),
      scope: z.array(z.string()),
      affectedAreas: z.array(z.string()),
      doNotChange: z.array(z.string()),
      claimedChangedFiles: z.array(z.string()),
      // The embedded `## Spec snapshot` slice — null id + [] for the co-located case (ADR-0100).
      embeddedSpecId: z.string().nullable(),
      embeddedRequirements: z.array(
        z
          .object({ id: z.string(), verifyCommand: z.string().nullable() })
          .passthrough(),
      ),
    })
    .passthrough(),
);
export type ShowTask = z.infer<typeof ShowTaskSchema>;

// suspec show spec → frontmatter (incl. the additive living-spec fields), requirements, and the
// append-only `## Execution` run-record (ADR-0103/0104 — the durable record once tasks are ephemeral).
export const ShowSpecSchema = showEnvelope(
  "spec",
  z
    .object({
      frontmatter: z
        .object({
          type: z.string(),
          id: z.string(),
          status: z.string(),
          // ADR-0108 living-spec additions; nullable/optional so an older spec without them still parses.
          supersededBy: z.string().nullable().optional(),
          snapshot: z.string().nullable().optional(),
        })
        .passthrough(),
      requirements: z.array(
        z
          .object({
            id: z.string(),
            line: z.number(),
            verifyCommand: z.string().nullable(),
          })
          .passthrough(),
      ),
      sectionTitles: z.array(z.string()),
      openQuestionsPresent: z.boolean(),
      execution: z.string().nullable(),
    })
    .passthrough(),
);
export type ShowSpec = z.infer<typeof ShowSpecSchema>;

// suspec show review → the parsed packet PLUS the identity/staleness frontmatter projection: which
// spec/task it reviews (review-to-spec `spec:`, ADR-0103) and the fast-track pins (ADR-0107).
export const ShowReviewSchema = showEnvelope(
  "review",
  z
    .object({
      status: z.string().nullable(),
      sectionTitles: z.array(z.string()),
      coverageRows: z.array(
        z
          .object({
            id: z.string(),
            result: z.string(),
            evidence: z.string(),
          })
          .passthrough(),
      ),
      verifyBlocks: z.array(
        // `result` is pass-through (AC-011) → a nullable string, not a closed enum.
        z
          .object({
            id: z.string().nullable(),
            cmd: z.string().nullable(),
            result: z.string().nullable(),
            malformed: z.boolean(),
          })
          .passthrough(),
      ),
      frontmatter: z
        .object({
          status: z.string().nullable(),
          spec: z.string().nullable(),
          task: z.string().nullable(),
          pr: z.string().nullable(),
          reviewedSha: z.string().nullable(),
          evidenceHash: z.string().nullable(),
        })
        .passthrough(),
    })
    .passthrough(),
);
export type ShowReview = z.infer<typeof ShowReviewSchema>;

// --- the SAFE-WRITE tier (AC-009) — verdict-free prepare-op reports ---------------------------------
// Each new/promote scaffold returns a small report the adapter passes through (it surfaces the created
// artifact's path/id; it branches on none of these). `level` stays the closed OutcomeLevel (the engine's
// advisory severity — `new spec` emits `warning` on a duplicate ordinal). These reports carry NO verdict;
// the contract pins the fields the adapter relays so a rename/drop trips the wire.

// suspec new spec <slug> --json → ScaffoldSpecReport (scaffoldSpec.ts).
export const ScaffoldSpecSchema = z
  .object({
    level: OutcomeLevel,
    path: z.string(),
    specId: z.string(),
    // Advisory (non-blocking): a duplicate leading `NNN-` ordinal. Optional — absent on the clean case.
    ordinalClash: z
      .object({
        ordinal: z.string(),
        existingSlug: z.string(),
        nextFree: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ScaffoldSpec = z.infer<typeof ScaffoldSpecSchema>;

// suspec new task --from <SPEC> [--scope …] --json → CutPacketReport (cutPacket.ts).
export const CutPacketSchema = z
  .object({
    level: OutcomeLevel,
    path: z.string(),
    taskId: z.string(),
    scope: z.array(z.string()),
  })
  .passthrough();
export type CutPacket = z.infer<typeof CutPacketSchema>;

// suspec promote <task> --json → ScaffoldFindingReport (scaffoldFinding.ts).
export const ScaffoldFindingSchema = z
  .object({
    level: OutcomeLevel,
    path: z.string(),
    slug: z.string(),
    from: z.string(),
  })
  .passthrough();
export type ScaffoldFinding = z.infer<typeof ScaffoldFindingSchema>;

// The CLI's structured-error stdout body (unixOutcome.ts `emit_error`): `{error, message}` + exit 2.
export const SuspecErrorSchema = z
  .object({ error: z.string(), message: z.string() })
  .passthrough();
export type SuspecError = z.infer<typeof SuspecErrorSchema>;
