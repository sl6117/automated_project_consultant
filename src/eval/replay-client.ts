import type { ModelClient, ModelClientResult } from "../server/model/client";
import { payloadFromCanonical } from "./payload-translate";
import {
  canonicalRequestHash,
  type ConsultantRequestInputs,
} from "./request-hash";
import type { LoadedRun } from "./recordings";

// Offline replay resolves every model call by exact canonical-hash lookup
// against the loaded run. A miss rejects the run — it never falls back to a
// live call or a fuzzy match — so changing a prompt, an output contract, or a
// brief always demands a fresh owner-initiated capture pass rather than
// silently scoring stale recordings.
export class RecordingMissError extends Error {
  constructor(task: string, hash: string) {
    super(
      `No recording for ${task} request ${hash}: recording stale or missing — owner capture pass required`,
    );
    this.name = "RecordingMissError";
  }
}

// The pipeline's attempt runner classifies any invoke error as a transport
// failure, so a thrown miss alone cannot reach the harness intact; the client
// also records every miss on this side channel, and the run-level replay
// wrapper turns a non-empty list into the run rejection.
export type ReplayModelClient = ModelClient & { misses: RecordingMissError[] };

export function createReplayModelClient(run: LoadedRun): ReplayModelClient {
  const misses: RecordingMissError[] = [];

  async function replay(
    inputs: ConsultantRequestInputs,
  ): Promise<ModelClientResult> {
    const { hash, ids } = canonicalRequestHash(inputs);
    const entry = run.entriesByHash.get(hash);
    if (!entry) {
      const miss = new RecordingMissError(inputs.task, hash);
      misses.push(miss);
      throw miss;
    }
    // Usage stays null like every non-live client: the attempt ledger settles
    // replayed calls at zero, and reports take the run's real cost and
    // latency from the recording entries instead.
    return {
      payload: payloadFromCanonical(entry.payload, ids),
      usage: null,
    };
  }

  return {
    misses,
    executionProvenance: "recorded",
    extractFromIdea(input) {
      return replay({
        task: "extraction",
        projectName: input.projectName,
        idea: input.idea,
      });
    },
    incrementalExtraction(input) {
      return replay({
        task: "incremental",
        projectName: input.projectName,
        idea: input.idea,
        approved: input.approved,
        resolved: input.resolved,
      });
    },
    nextQuestion(input) {
      return replay({
        task: "next-question",
        projectName: input.projectName,
        idea: input.idea,
        approved: input.approved,
        context: input.context,
      });
    },
    coachRecommendation(input) {
      return replay({
        task: "coach",
        projectName: input.projectName,
        idea: input.idea,
        questionBody: input.questionBody,
        approvedStatements: input.approvedStatements,
        approvedConcerns: input.approvedConcerns,
      });
    },
  };
}
