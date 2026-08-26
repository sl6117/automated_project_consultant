import { describe, expect, test } from "vitest";
import { compileArtifacts } from "../../../src/server/artifacts/compiler";
import { openMemoryLedger } from "../../../src/server/db/open";
import {
  ExportNotReadyError,
  getArtifactVersion,
  listArtifactVersions,
  recordArtifactSet,
} from "../../../src/server/ledger/artifact-versions";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import { getSessionDetail } from "../../../src/server/ledger/sessions";
import {
  LedgerValidationError,
  approveStatement,
  proposeStatement,
} from "../../../src/server/ledger/statements";

function seedSession() {
  const db = openMemoryLedger();
  const project = createProject(db, "Export check");
  const session = createSession(db, project.id);
  return { db, sessionId: session.id };
}

function approveOne(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
  body: string,
) {
  const proposed = proposeStatement(db, {
    sessionId,
    kind: "fact",
    body,
    provenanceSource: "user",
  });
  approveStatement(db, proposed.id);
}

describe("recordArtifactSet", () => {
  test("refuses to export before any statement is approved", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      recordArtifactSet(db, {
        sessionId,
        files: compileArtifacts(db, sessionId),
      }),
    ).toThrow(ExportNotReadyError);
    expect(listArtifactVersions(db, sessionId)).toHaveLength(0);
  });

  test("persists all six files under one shared artifact_set_id", () => {
    const { db, sessionId } = seedSession();
    approveOne(db, sessionId, "an approved fact");

    const rows = recordArtifactSet(db, {
      sessionId,
      files: compileArtifacts(db, sessionId),
    });

    expect(rows).toHaveLength(6);
    const setIds = new Set(rows.map((row) => row.artifact_set_id));
    expect(setIds.size).toBe(1);
    expect(new Set(rows.map((row) => row.filename))).toStrictEqual(
      new Set([
        "SPEC.md",
        "ROADMAP.md",
        "AGENTS.md",
        "DECISIONS.md",
        "ASSUMPTIONS.md",
        "OPEN_QUESTIONS.md",
      ]),
    );
    expect(rows.every((row) => row.session_id === sessionId)).toBe(true);
  });

  test("a second generation appends a new set and leaves the first untouched", () => {
    const { db, sessionId } = seedSession();
    approveOne(db, sessionId, "the first approved fact");
    const first = recordArtifactSet(db, {
      sessionId,
      files: compileArtifacts(db, sessionId),
    });

    approveOne(db, sessionId, "a second approved fact");
    const second = recordArtifactSet(db, {
      sessionId,
      files: compileArtifacts(db, sessionId),
    });

    expect(second[0]?.artifact_set_id).not.toBe(first[0]?.artifact_set_id);
    for (const row of first) {
      expect(getArtifactVersion(db, row.id).body).toBe(row.body);
    }
    const firstSpec = first.find((row) => row.filename === "SPEC.md");
    const secondSpec = second.find((row) => row.filename === "SPEC.md");
    expect(firstSpec?.body).not.toContain("a second approved fact");
    expect(secondSpec?.body).toContain("a second approved fact");
  });

  test("rejects an incomplete or duplicated file set", () => {
    const { db, sessionId } = seedSession();
    approveOne(db, sessionId, "an approved fact");
    const files = compileArtifacts(db, sessionId);

    expect(() =>
      recordArtifactSet(db, { sessionId, files: files.slice(0, 5) }),
    ).toThrow(LedgerValidationError);
    expect(() =>
      recordArtifactSet(db, {
        sessionId,
        files: [...files.slice(0, 5), files[4]],
      }),
    ).toThrow(LedgerValidationError);
    expect(listArtifactVersions(db, sessionId)).toHaveLength(0);
  });

  test("rejects an unknown session", () => {
    const { db, sessionId } = seedSession();
    approveOne(db, sessionId, "an approved fact");

    expect(() =>
      recordArtifactSet(db, {
        sessionId: "missing",
        files: compileArtifacts(db, sessionId),
      }),
    ).toThrow(LedgerValidationError);
  });
});

describe("artifact version immutability", () => {
  test("database triggers refuse UPDATE and DELETE", () => {
    const { db, sessionId } = seedSession();
    approveOne(db, sessionId, "an approved fact");
    const rows = recordArtifactSet(db, {
      sessionId,
      files: compileArtifacts(db, sessionId),
    });
    const target = rows[0];

    expect(() =>
      db
        .prepare("UPDATE artifact_versions SET body = 'tampered' WHERE id = ?")
        .run(target.id),
    ).toThrow(/immutable/);
    expect(() =>
      db.prepare("DELETE FROM artifact_versions WHERE id = ?").run(target.id),
    ).toThrow(/immutable/);

    expect(getArtifactVersion(db, target.id).body).toBe(target.body);
    expect(listArtifactVersions(db, sessionId)).toHaveLength(6);
  });

  test("the database refuses a duplicate filename within one set", () => {
    const { db, sessionId } = seedSession();
    approveOne(db, sessionId, "an approved fact");
    const rows = recordArtifactSet(db, {
      sessionId,
      files: compileArtifacts(db, sessionId),
    });

    expect(() =>
      db
        .prepare(
          `INSERT INTO artifact_versions (
            id, session_id, artifact_set_id, filename, body, created_at
          ) VALUES ('dup', ?, ?, 'SPEC.md', 'smuggled', 't9')`,
        )
        .run(sessionId, rows[0].artifact_set_id),
    ).toThrow(/UNIQUE/);
    expect(listArtifactVersions(db, sessionId)).toHaveLength(6);
  });
});

describe("artifact set ordering", () => {
  test("sets order newest-first even when created_at timestamps tie", () => {
    const { db, sessionId } = seedSession();
    approveOne(db, sessionId, "an approved fact");
    const insert = db.prepare(
      `INSERT INTO artifact_versions (
        id, session_id, artifact_set_id, filename, body, created_at
      ) VALUES (?, ?, ?, 'SPEC.md', 'body', 't0')`,
    );
    insert.run("v-older", sessionId, "set-older");
    insert.run("v-newer", sessionId, "set-newer");

    const sets = getSessionDetail(db, sessionId).artifactSets;
    expect(sets.map((set) => set.artifactSetId)).toStrictEqual([
      "set-newer",
      "set-older",
    ]);
  });
});
