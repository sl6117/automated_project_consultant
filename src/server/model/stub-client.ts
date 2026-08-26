import type { ModelClient } from "./client";
import type {
  CoachOutput,
  ExtractionOutput,
  NextQuestionOutput,
} from "../ledger/schemas";

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

export function stubCoachRecommendation(input: {
  idea: string;
  projectName: string;
  questionBody: string;
}): CoachOutput {
  return {
    recommendation: `Answer the pending question for "${input.projectName}" by hand before building anything.`,
    whyNow: `The open question is "${input.questionBody}". Until it is decided, every other choice about "${input.idea}" is speculative.`,
    technique:
      "Manual-first: walk one real example end to end on paper before automating it.",
    tradeoffs:
      "Deciding by hand is slower per case but exposes the constraint that automation would have hidden.",
    gotcha:
      "A stub recommendation restates your input; it cannot weigh evidence a live model would.",
    confidence: "low",
    evidenceWouldChange:
      "A live consultation with real project evidence would replace this synthetic placeholder.",
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
    coachRecommendation(input) {
      return stubCoachRecommendation(input);
    },
  };
}
