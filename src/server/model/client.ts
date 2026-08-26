import type { ModelExecutionProvenance } from "../ledger/schemas";

export type ModelClient = {
  // How this client produces payloads; persisted on every model_calls row.
  executionProvenance: ModelExecutionProvenance;
  extractFromIdea(input: { idea: string; projectName: string }): unknown;
  nextQuestion(input: { idea: string; projectName: string }): unknown;
  coachRecommendation(input: {
    idea: string;
    projectName: string;
    questionBody: string;
  }): unknown;
};
