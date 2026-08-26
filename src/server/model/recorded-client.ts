import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelClient } from "./client";

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

export function createRecordedModelClient(
  options: { extractionPath?: string; questionPath?: string } = {},
): ModelClient {
  const extractionPath =
    options.extractionPath ?? join(fixtureDir, "sonnet-extraction.json");
  const questionPath =
    options.questionPath ?? join(fixtureDir, "fable-next-question.json");

  return {
    executionProvenance: "recorded",
    extractFromIdea() {
      // Fixture reads must not pull the whole project tree into the traced
      // server build output.
      return JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ extractionPath, "utf8"),
      ) as unknown;
    },
    nextQuestion() {
      return JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ questionPath, "utf8"),
      ) as unknown;
    },
  };
}
