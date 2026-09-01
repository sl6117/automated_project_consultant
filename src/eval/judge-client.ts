import { createHash } from "node:crypto";
import type { ModelUsage } from "../server/model/pricing";
import type { ResponseDiagnostics } from "../server/model/response-diagnostics";
import type { JudgeRequestDescription } from "./judge";
import type { LoadedRun, RecordingEntry } from "./recordings";

// Judge calls follow the same hash-keyed capture/replay contract as
// consultant calls. Judge prompts carry no ledger ids (judge.ts builds them
// from plain text and indexes), so canonicalization is the identity: the
// rendered request hashes as-is and a fresh replay renders byte-identical
// bytes. A miss rejects the run exactly like a consultant miss.

export type JudgeTask =
  | "judge-faithfulness"
  | "judge-usefulness"
  | "judge-sufficiency"
  | "judge-pairwise";

export type JudgeClientResult = {
  payload: unknown;
  usage: ModelUsage | null;
  // Live clients attach stop_reason and parse status so validation failures
  // can state their own cause (see response-diagnostics.ts).
  diagnostics?: ResponseDiagnostics;
};

export type JudgeClient = {
  executionProvenance: "synthetic" | "recorded" | "live";
  judge(input: {
    task: JudgeTask;
    request: JudgeRequestDescription;
  }): Promise<JudgeClientResult>;
};

export function hashJudgeRequest(request: JudgeRequestDescription): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

export class JudgeRecordingMissError extends Error {
  constructor(task: JudgeTask, hash: string) {
    super(
      `No recording for ${task} request ${hash}: recording stale or missing — owner capture pass required`,
    );
    this.name = "JudgeRecordingMissError";
  }
}

export type JudgeCaptureSink = {
  record(entry: RecordingEntry): void;
};

export function createCapturingJudgeClient(
  inner: JudgeClient,
  sink: JudgeCaptureSink,
): JudgeClient {
  return {
    executionProvenance: inner.executionProvenance,
    async judge(input) {
      const startedAt = Date.now();
      const result = await inner.judge(input);
      sink.record({
        requestHash: hashJudgeRequest(input.request),
        task: input.task,
        modelAlias: "sonnet",
        payload: result.payload,
        usage: result.usage,
        latencyMs: Date.now() - startedAt,
      });
      return result;
    },
  };
}

export type ReplayJudgeClient = JudgeClient & {
  misses: JudgeRecordingMissError[];
};

export function createReplayJudgeClient(run: LoadedRun): ReplayJudgeClient {
  const misses: JudgeRecordingMissError[] = [];
  return {
    misses,
    executionProvenance: "recorded",
    async judge(input) {
      const hash = hashJudgeRequest(input.request);
      const entry = run.entriesByHash.get(hash);
      if (!entry) {
        const miss = new JudgeRecordingMissError(input.task, hash);
        misses.push(miss);
        throw miss;
      }
      return { payload: entry.payload, usage: null };
    },
  };
}
