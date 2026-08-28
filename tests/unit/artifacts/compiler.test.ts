import { describe, expect, test } from "vitest";
import { compileArtifacts } from "../../../src/server/artifacts/compiler";
import { openMemoryLedger } from "../../../src/server/db/open";
import {
  promoteCoachNote,
  proposeCoachNote,
} from "../../../src/server/ledger/coach-notes";
import {
  approveConcern,
  listConcerns,
  proposeConcern,
} from "../../../src/server/ledger/concerns";
import { askAdaptiveQuestion } from "../../../src/server/model/next-question";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import { getPendingQuestion, resolveQuestion } from "../../../src/server/ledger/questions";
import {
  LedgerValidationError,
  approveStatement,
  listStatements,
  proposeStatement,
  rejectStatement,
} from "../../../src/server/ledger/statements";
import { extractAndStartSession } from "../../../src/server/model/extract";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";

function seedSession() {
  const db = openMemoryLedger();
  const project = createProject(db, "Marker project");
  const session = createSession(db, project.id);
  return { db, sessionId: session.id };
}

function approveNewStatement(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
  kind: "fact" | "decision" | "hypothesis" | "unknown" | "deferred",
  body: string,
) {
  const proposed = proposeStatement(db, {
    sessionId,
    kind,
    body,
    provenanceSource: "user",
  });
  return approveStatement(db, proposed.id);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("compileArtifacts", () => {
  test("projects approved rows and never proposals, rejections, or coaching", () => {
    const { db, sessionId } = seedSession();

    approveNewStatement(db, sessionId, "fact", "APPROVED-FACT-MARKER");
    proposeStatement(db, {
      sessionId,
      kind: "fact",
      body: "PROPOSED-MARKER",
      provenanceSource: "model-inference",
    });
    const rejected = proposeStatement(db, {
      sessionId,
      kind: "decision",
      body: "REJECTED-MARKER",
      provenanceSource: "model-inference",
    });
    rejectStatement(db, rejected.id);
    const concern = proposeConcern(db, {
      sessionId,
      code: "problem",
      coverage: "CONCERN-MARKER",
      provenanceSource: "model-inference",
    });
    approveConcern(db, concern.id);
    proposeCoachNote(db, {
      sessionId,
      recommendation: "COACH-MARKER",
      whyNow: "why now",
      technique: "technique",
      tradeoffs: "tradeoffs",
      gotcha: "gotcha",
      confidence: "low",
      evidenceWouldChange: "evidence",
      provenanceSource: "model-inference",
    });

    const files = compileArtifacts(db, sessionId);
    const spec = files.find((file) => file.filename === "SPEC.md");
    const everything = files.map((file) => file.body).join("\n===\n");

    // Positive controls: the compiler really ran over this session's rows.
    expect(spec?.body).toContain("APPROVED-FACT-MARKER");
    expect(spec?.body).toContain("problem: CONCERN-MARKER");

    // Excluded rows are absent from every generated file.
    expect(everything).not.toContain("PROPOSED-MARKER");
    expect(everything).not.toContain("REJECTED-MARKER");
    expect(everything).not.toContain("COACH-MARKER");
  });

  test("the raw project idea never enters any artifact", () => {
    const db = openMemoryLedger();
    const project = createProject(
      db,
      "Idea boundary",
      "RAW-IDEA-MARKER should stay out of exports",
    );
    const session = createSession(db, project.id);
    approveNewStatement(
      db,
      session.id,
      "fact",
      "APPROVED-IDEA-SUMMARY-MARKER",
    );

    const files = compileArtifacts(db, session.id);
    const everything = files.map((file) => file.body).join("\n===\n");

    expect(files).toHaveLength(6);
    expect(everything).toContain("APPROVED-IDEA-SUMMARY-MARKER");
    expect(everything).not.toContain("RAW-IDEA-MARKER");
  });

  test("promotion flips coach content into the decision projections", () => {
    const { db, sessionId } = seedSession();
    approveNewStatement(db, sessionId, "fact", "one approved fact");
    const note = proposeCoachNote(db, {
      sessionId,
      recommendation: "COACH-PROMOTED-MARKER",
      whyNow: "why now",
      technique: "technique",
      tradeoffs: "tradeoffs",
      gotcha: "gotcha",
      confidence: "high",
      evidenceWouldChange: "evidence",
      provenanceSource: "model-inference",
    });

    const before = compileArtifacts(db, sessionId)
      .map((file) => file.body)
      .join("\n");
    expect(before).not.toContain("COACH-PROMOTED-MARKER");

    promoteCoachNote(db, note.id);

    const after = compileArtifacts(db, sessionId);
    const decisions = after.find((file) => file.filename === "DECISIONS.md");
    expect(decisions?.body).toContain("COACH-PROMOTED-MARKER");
  });

  test("an answered question appears exactly once per file", async () => {
    const db = openMemoryLedger();
    const { sessionId } = await extractAndStartSession(db, {
      projectName: "Answered once",
      idea: "one household inbox",
      client: createRecordedModelClient(),
    });
    // Phase 2 start is extraction-only: clear review, then ask.
    for (const row of listStatements(db, sessionId, "proposed")) {
      approveStatement(db, row.id);
    }
    for (const row of listConcerns(db, sessionId, "proposed")) {
      approveConcern(db, row.id);
    }
    await askAdaptiveQuestion(db, {
      sessionId,
      client: createRecordedModelClient(),
    });
    const pending = getPendingQuestion(db, sessionId);
    if (!pending) {
      throw new Error("Expected a pending question");
    }
    resolveQuestion(db, {
      questionId: pending.id,
      disposition: "answered",
      body: "ANSWER-ONCE-MARKER",
    });

    // Phase 2 promotion rule: the raw answer never reaches exports on its
    // own — resolving no longer auto-approves a statement.
    const beforeApproval = compileArtifacts(db, sessionId)
      .map((file) => file.body)
      .join("\n");
    expect(beforeApproval).not.toContain("ANSWER-ONCE-MARKER");

    // Only an approved (incremental) proposal carries it in — exactly once.
    const proposal = proposeStatement(db, {
      sessionId,
      kind: "decision",
      body: "ANSWER-ONCE-MARKER distilled into a decision.",
      provenanceSource: "model-inference",
    });
    approveStatement(db, proposal.id);

    const files = compileArtifacts(db, sessionId);
    const containing = files.filter((file) =>
      file.body.includes("ANSWER-ONCE-MARKER"),
    );
    expect(containing.length).toBeGreaterThan(0);
    for (const file of containing) {
      expect(occurrences(file.body, "ANSWER-ONCE-MARKER")).toBe(1);
    }
  });

  test("unknowns, deferreds, and the pending question land in OPEN_QUESTIONS", () => {
    const { db, sessionId } = seedSession();
    approveNewStatement(db, sessionId, "unknown", "UNKNOWN-MARKER");
    approveNewStatement(db, sessionId, "deferred", "DEFERRED-MARKER");
    approveNewStatement(db, sessionId, "hypothesis", "HYPOTHESIS-MARKER");

    const files = compileArtifacts(db, sessionId);
    const open = files.find((file) => file.filename === "OPEN_QUESTIONS.md");
    const assumptions = files.find(
      (file) => file.filename === "ASSUMPTIONS.md",
    );

    expect(open?.body).toContain("UNKNOWN-MARKER");
    expect(open?.body).toContain("DEFERRED-MARKER");
    expect(open?.body).toContain("No pending question.");
    expect(assumptions?.body).toContain("HYPOTHESIS-MARKER");
    expect(open?.body).not.toContain("HYPOTHESIS-MARKER");
  });

  test("is deterministic for unchanged ledger state", () => {
    const { db, sessionId } = seedSession();
    approveNewStatement(db, sessionId, "decision", "a stable decision");

    const first = compileArtifacts(db, sessionId);
    const second = compileArtifacts(db, sessionId);
    expect(second).toStrictEqual(first);
  });

  test("rejects an unknown session", () => {
    const { db } = seedSession();
    expect(() => compileArtifacts(db, "missing")).toThrow(
      LedgerValidationError,
    );
  });
});
