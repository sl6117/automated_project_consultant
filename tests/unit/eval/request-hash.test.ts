import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  canonicalRequestHash,
  type ConsultantRequestInputs,
} from "../../../src/eval/request-hash";
import {
  payloadFromCanonical,
  payloadToCanonical,
} from "../../../src/eval/payload-translate";

function nextQuestionInputs(ids: {
  statement: string;
  concern: string;
  tension: string;
}): ConsultantRequestInputs {
  return {
    task: "next-question",
    projectName: "P",
    idea: "an idea",
    approved: {
      statements: [{ id: ids.statement, body: "An approved statement." }],
      concerns: [
        { id: ids.concern, code: "problem", coverage: "the coverage" },
      ],
    },
    context: {
      missingCoreCodes: ["user"],
      openContradictions: [{ id: ids.tension, summary: "a tension" }],
      resolvedQuestions: [{ body: "Q?", disposition: "answered" }],
    },
  };
}

describe("canonical request hashing", () => {
  test("fresh UUIDs on every replay produce the same hash", () => {
    const first = canonicalRequestHash(
      nextQuestionInputs({
        statement: randomUUID(),
        concern: randomUUID(),
        tension: randomUUID(),
      }),
    );
    const second = canonicalRequestHash(
      nextQuestionInputs({
        statement: randomUUID(),
        concern: randomUUID(),
        tension: randomUUID(),
      }),
    );
    expect(first.hash).toBe(second.hash);
  });

  test("any non-id byte changes the hash", () => {
    const base = nextQuestionInputs({
      statement: "s-1",
      concern: "c-1",
      tension: "t-1",
    });
    const changed = structuredClone(base);
    if (changed.task === "next-question") {
      changed.approved.statements[0]!.body = "An approved statement!";
    }
    expect(canonicalRequestHash(base).hash).not.toBe(
      canonicalRequestHash(changed).hash,
    );
  });

  test("a UUID-shaped string inside user content is never touched", () => {
    // Schema-aware, not textual: an id-lookalike in the idea text must
    // participate in the hash verbatim, so two ideas differing only in that
    // string hash differently.
    const lookalike = randomUUID();
    const withLookalike: ConsultantRequestInputs = {
      task: "extraction",
      projectName: "P",
      idea: `The user pasted an id ${lookalike} into their idea.`,
    };
    const withOther: ConsultantRequestInputs = {
      task: "extraction",
      projectName: "P",
      idea: `The user pasted an id ${randomUUID()} into their idea.`,
    };
    expect(canonicalRequestHash(withLookalike).hash).not.toBe(
      canonicalRequestHash(withOther).hash,
    );
  });

  test("payload citations round-trip through canonical form onto new UUIDs", () => {
    const captureStatementId = randomUUID();
    const capture = canonicalRequestHash(
      nextQuestionInputs({
        statement: captureStatementId,
        concern: randomUUID(),
        tension: randomUUID(),
      }),
    );
    const payload = {
      task: "next_question",
      payload: {
        candidates: [],
        contradictions: [
          {
            summary: "tension",
            citedStatementIds: [captureStatementId, "model-invented-id"],
          },
        ],
        readyAdvice: { ready: false, why: "w" },
      },
    };

    const canonical = payloadToCanonical(payload, capture.ids) as {
      payload: { contradictions: { citedStatementIds: string[] }[] };
    };
    expect(canonical.payload.contradictions[0]!.citedStatementIds).toEqual([
      "stmt-1",
      "model-invented-id",
    ]);

    const replayStatementId = randomUUID();
    const replay = canonicalRequestHash(
      nextQuestionInputs({
        statement: replayStatementId,
        concern: randomUUID(),
        tension: randomUUID(),
      }),
    );
    const translated = payloadFromCanonical(canonical, replay.ids) as {
      payload: { contradictions: { citedStatementIds: string[] }[] };
    };
    // The recorded citation lands on the REPLAY session's statement id; the
    // invented id stays verbatim so it fails validation on replay exactly as
    // it did at capture.
    expect(translated.payload.contradictions[0]!.citedStatementIds).toEqual([
      replayStatementId,
      "model-invented-id",
    ]);
  });
});
