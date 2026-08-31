import type { ModelClient, ModelClientResult } from "../server/model/client";
import { payloadToCanonical } from "./payload-translate";
import {
  canonicalRequestHash,
  type ConsultantRequestInputs,
} from "./request-hash";
import type { RecordingEntry } from "./recordings";

// Wraps any inner client and records every call as a hash-keyed entry: the
// canonical request hash, the payload translated to canonical ids, and the
// usage and latency the inner client reported. Capturing happens before
// validation, so an invalid payload is recorded too and reproduces the same
// validation failure on replay. The sink collects entries per brief; the
// caller writes them through recordings.writeRun, which runs the
// fail-closed sanitization scan.

export type CaptureSink = {
  record(entry: RecordingEntry): void;
};

export function createCapturingModelClient(
  inner: ModelClient,
  sink: CaptureSink,
): ModelClient {
  async function capture(
    inputs: ConsultantRequestInputs,
    modelAlias: string,
    invoke: () => Promise<ModelClientResult>,
  ): Promise<ModelClientResult> {
    const { hash, ids } = canonicalRequestHash(inputs);
    const startedAt = Date.now();
    const result = await invoke();
    sink.record({
      requestHash: hash,
      task: inputs.task,
      modelAlias,
      payload: payloadToCanonical(result.payload, ids),
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  }

  return {
    executionProvenance: inner.executionProvenance,
    extractFromIdea(input) {
      return capture(
        {
          task: "extraction",
          projectName: input.projectName,
          idea: input.idea,
        },
        "sonnet",
        () => inner.extractFromIdea(input),
      );
    },
    incrementalExtraction(input) {
      return capture(
        {
          task: "incremental",
          projectName: input.projectName,
          idea: input.idea,
          approved: input.approved,
          resolved: input.resolved,
        },
        "sonnet",
        () => inner.incrementalExtraction(input),
      );
    },
    nextQuestion(input) {
      return capture(
        {
          task: "next-question",
          projectName: input.projectName,
          idea: input.idea,
          approved: input.approved,
          context: input.context,
        },
        "fable",
        () => inner.nextQuestion(input),
      );
    },
    coachRecommendation(input) {
      return capture(
        {
          task: "coach",
          projectName: input.projectName,
          idea: input.idea,
          questionBody: input.questionBody,
          approvedStatements: input.approvedStatements,
          approvedConcerns: input.approvedConcerns,
        },
        "fable",
        () => inner.coachRecommendation(input),
      );
    },
  };
}
