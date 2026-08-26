import type { ModelClient } from "./client";
import type { ExtractionOutput, NextQuestionOutput } from "../ledger/schemas";

export function stubExtractionFromIdea(input: {
  idea: string;
  projectName: string;
}): ExtractionOutput {
  return {
    statements: [
      {
        kind: "fact",
        body: `Working title: ${input.projectName}`,
      },
      {
        kind: "hypothesis",
        body: `Stated idea: ${input.idea}`,
      },
    ],
    concerns: [
      {
        code: "problem",
        coverage: input.idea,
      },
    ],
  };
}

export function stubNextQuestionFromIdea(input: {
  idea: string;
  projectName: string;
}): NextQuestionOutput {
  return {
    body: `What must the first working version of "${input.projectName}" do that you cannot do today?`,
    whySelected: `The idea is still a restatement of "${input.idea}". A first-slice behavior bounds the rest of discovery.`,
  };
}

export function createStubModelClient(): ModelClient {
  return {
    executionProvenance: "synthetic",
    extractFromIdea(input) {
      return stubExtractionFromIdea(input);
    },
    nextQuestion(input) {
      return stubNextQuestionFromIdea(input);
    },
  };
}
