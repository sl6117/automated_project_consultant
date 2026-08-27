import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelClient } from "./client";

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

export function createRecordedModelClient(
  options: {
    extractionPath?: string;
    questionPath?: string;
    coachPath?: string;
  } = {},
): ModelClient {
  const extractionPath =
    options.extractionPath ?? join(fixtureDir, "sonnet-extraction.json");
  const questionPath =
    options.questionPath ?? join(fixtureDir, "fable-next-question.json");
  const coachPath = options.coachPath ?? join(fixtureDir, "fable-coach.json");

  return {
    executionProvenance: "recorded",
    async extractFromIdea() {
      // Fixture reads must not pull the whole project tree into the traced
      // server build output.
      const payload = JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ extractionPath, "utf8"),
      ) as unknown;
      return { payload, usage: null };
    },
    async nextQuestion() {
      const payload = JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ questionPath, "utf8"),
      ) as unknown;
      return { payload, usage: null };
    },
    async coachRecommendation() {
      const payload = JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ coachPath, "utf8"),
      ) as unknown;
      return { payload, usage: null };
    },
  };
}
