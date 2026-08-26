import type Database from "better-sqlite3";
import { listConcerns } from "../ledger/concerns";
import { getPendingQuestion } from "../ledger/questions";
import {
  artifactFilenameSchema,
  type ArtifactFilename,
} from "../ledger/schemas";
import {
  LedgerValidationError,
  listStatements,
  type StatementRow,
} from "../ledger/statements";

export type CompiledArtifact = { filename: ArtifactFilename; body: string };

export const ARTIFACT_FILENAMES = artifactFilenameSchema.options;

// The compiler is a pure projection of approved ledger state: approved
// statements, approved concerns, and the pending question, with the project
// name as heading metadata. It never queries coach_notes or answers, and it
// never renders the raw project idea — promoted coaching, resolved answers,
// and idea content all reach exports solely through approved statements, so
// nothing unapproved has a path in and nothing appears twice. Bodies contain
// no timestamps: recompiling unchanged state must be byte-identical, and
// time lives on the version row instead.
export function compileArtifacts(
  db: Database.Database,
  sessionId: string,
): CompiledArtifact[] {
  const context = db
    .prepare(
      `SELECT p.name AS project_name
       FROM discovery_sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as { project_name: string } | undefined;
  if (!context) {
    throw new LedgerValidationError(`Session ${sessionId} not found`);
  }

  const approved = listStatements(db, sessionId, "approved");
  const concerns = listConcerns(db, sessionId, "approved");
  const pending = getPendingQuestion(db, sessionId);

  const byKind = (kind: StatementRow["kind"]) =>
    approved.filter((statement) => statement.kind === kind);
  const facts = byKind("fact");
  const decisions = byKind("decision");
  const hypotheses = byKind("hypothesis");
  const unknowns = byKind("unknown");
  const deferred = byKind("deferred");

  const spec = [
    `# SPEC — ${context.project_name}`,
    "",
    "Compiled from approved ledger state only.",
    "",
    "## Facts",
    "",
    bulleted(facts.map((row) => row.body), "No approved facts yet."),
    "",
    "## Decisions",
    "",
    bulleted(decisions.map((row) => row.body), "No approved decisions yet."),
    "",
    "## Concern coverage",
    "",
    bulleted(
      concerns.map((row) => `${row.code}: ${row.coverage}`),
      "No approved concern coverage yet.",
    ),
    "",
  ].join("\n");

  const roadmap = [
    `# ROADMAP — ${context.project_name}`,
    "",
    "## First vertical slice",
    "",
    "Derived from approved decisions.",
    "",
    bulleted(decisions.map((row) => row.body), "No approved decisions yet."),
    "",
  ].join("\n");

  const agents = [
    `# AGENTS — ${context.project_name}`,
    "",
    "Stable instructions derived from approved decisions only.",
    "",
    bulleted(decisions.map((row) => row.body), "No approved decisions yet."),
    "",
  ].join("\n");

  const decisionsFile = [
    `# DECISIONS — ${context.project_name}`,
    "",
    bulleted(decisions.map((row) => row.body), "No approved decisions yet."),
    "",
  ].join("\n");

  const assumptions = [
    `# ASSUMPTIONS — ${context.project_name}`,
    "",
    bulleted(hypotheses.map((row) => row.body), "No approved assumptions yet."),
    "",
  ].join("\n");

  const openQuestions = [
    `# OPEN_QUESTIONS — ${context.project_name}`,
    "",
    "## Unknowns",
    "",
    bulleted(unknowns.map((row) => row.body), "No approved unknowns yet."),
    "",
    "## Deferred",
    "",
    bulleted(deferred.map((row) => row.body), "Nothing deferred yet."),
    "",
    "## Pending question",
    "",
    pending ? `${pending.body}` : "No pending question.",
    "",
  ].join("\n");

  return [
    { filename: "SPEC.md", body: spec },
    { filename: "ROADMAP.md", body: roadmap },
    { filename: "AGENTS.md", body: agents },
    { filename: "DECISIONS.md", body: decisionsFile },
    { filename: "ASSUMPTIONS.md", body: assumptions },
    { filename: "OPEN_QUESTIONS.md", body: openQuestions },
  ];
}

function bulleted(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return emptyText;
  }
  return items.map((item) => `- ${item}`).join("\n");
}
