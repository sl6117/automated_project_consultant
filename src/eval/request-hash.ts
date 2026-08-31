import { createHash } from "node:crypto";
import {
  describeCoachRequest,
  describeExtractionRequest,
  describeIncrementalExtractionRequest,
  describeNextQuestionRequest,
  type AdaptiveLedgerContext,
  type ApprovedLedgerSlice,
  type ModelRequestDescription,
  type ResolvedAnswerContext,
} from "../server/model/prompt";

// Hash-keyed capture and replay: every recorded model call is keyed by the
// SHA-256 of its canonicalized request. Canonicalization is schema-aware,
// never textual — only the id fields the request-builder inputs define as
// ledger-generated (statement, concern, and contradiction ids) are renumbered
// deterministically by first appearance, and the hash input is produced by
// re-rendering the request through the same prompt builders from those
// canonicalized structured inputs. A UUID-shaped string inside user content
// is therefore never touched. Every other byte — prompt text, system prefix,
// output config, model id, max tokens — participates in the hash unchanged,
// which is what makes the hash a staleness detector: any prompt or contract
// change invalidates every affected recording by construction.

// The structured builder inputs for each task, exactly as the pipeline hands
// them to the prompt builders. This union is the schema the canonicalization
// is aware of.
export type ConsultantRequestInputs =
  | { task: "extraction"; projectName: string; idea: string }
  | {
      task: "incremental";
      projectName: string;
      idea: string;
      approved: ApprovedLedgerSlice;
      resolved: ResolvedAnswerContext;
    }
  | {
      task: "next-question";
      projectName: string;
      idea: string;
      approved: ApprovedLedgerSlice;
      context: AdaptiveLedgerContext;
    }
  | {
      task: "coach";
      projectName: string;
      idea: string;
      questionBody: string;
      approvedStatements: string[];
      approvedConcerns: string[];
    };

export type ConsultantTask = ConsultantRequestInputs["task"];

// Maps each session-local UUID to its canonical token in first-appearance
// order. Statements, concerns, and contradictions number independently.
// These are the only ledger-generated id categories that reach a prompt
// today: session and question ids never enter the builder inputs
// (ApprovedLedgerSlice / AdaptiveLedgerContext carry no such fields). Any
// future builder-input field that carries a ledger id MUST get a rule here,
// or that id hashes raw and session-specific bytes silently re-enter the
// hash — the exact hole canonicalization exists to close.
export type CanonicalIdMap = {
  statements: Map<string, string>;
  concerns: Map<string, string>;
  contradictions: Map<string, string>;
};

function assign(map: Map<string, string>, id: string, prefix: string): string {
  const existing = map.get(id);
  if (existing) {
    return existing;
  }
  const canonical = `${prefix}-${map.size + 1}`;
  map.set(id, canonical);
  return canonical;
}

function canonicalizeApproved(
  approved: ApprovedLedgerSlice,
  ids: CanonicalIdMap,
): ApprovedLedgerSlice {
  return {
    statements: approved.statements.map((row) => ({
      id: assign(ids.statements, row.id, "stmt"),
      body: row.body,
    })),
    concerns: approved.concerns.map((row) => ({
      id: assign(ids.concerns, row.id, "concern"),
      code: row.code,
      coverage: row.coverage,
    })),
  };
}

function canonicalizeContext(
  context: AdaptiveLedgerContext,
  ids: CanonicalIdMap,
): AdaptiveLedgerContext {
  return {
    missingCoreCodes: context.missingCoreCodes,
    openContradictions: context.openContradictions.map((row) => ({
      id: assign(ids.contradictions, row.id, "tension"),
      summary: row.summary,
    })),
    resolvedQuestions: context.resolvedQuestions,
  };
}

// Canonicalizes the builder inputs and re-renders the request through the
// real prompt builders. Returns the id map so response payloads can be
// translated with the same numbering (see payload-translate.ts).
export function canonicalizeRequestInputs(inputs: ConsultantRequestInputs): {
  request: ModelRequestDescription;
  ids: CanonicalIdMap;
} {
  const ids: CanonicalIdMap = {
    statements: new Map(),
    concerns: new Map(),
    contradictions: new Map(),
  };

  switch (inputs.task) {
    case "extraction":
      return {
        request: describeExtractionRequest({
          projectName: inputs.projectName,
          idea: inputs.idea,
        }),
        ids,
      };
    case "incremental":
      return {
        request: describeIncrementalExtractionRequest({
          projectName: inputs.projectName,
          idea: inputs.idea,
          approved: canonicalizeApproved(inputs.approved, ids),
          resolved: inputs.resolved,
        }),
        ids,
      };
    case "next-question":
      return {
        request: describeNextQuestionRequest({
          projectName: inputs.projectName,
          idea: inputs.idea,
          approved: canonicalizeApproved(inputs.approved, ids),
          context: canonicalizeContext(inputs.context, ids),
        }),
        ids,
      };
    case "coach":
      // Coach prompts carry approved bodies without ids, so there is nothing
      // to renumber; the request is hashed as built.
      return {
        request: describeCoachRequest({
          projectName: inputs.projectName,
          idea: inputs.idea,
          questionBody: inputs.questionBody,
          approvedStatements: inputs.approvedStatements,
          approvedConcerns: inputs.approvedConcerns,
        }),
        ids,
      };
  }
}

// The request description is plain data built with deterministic key order by
// the describe* functions, so JSON.stringify is a stable serialization.
export function hashRequestDescription(
  request: ModelRequestDescription,
): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export function canonicalRequestHash(inputs: ConsultantRequestInputs): {
  hash: string;
  ids: CanonicalIdMap;
} {
  const { request, ids } = canonicalizeRequestInputs(inputs);
  return { hash: hashRequestDescription(request), ids };
}
