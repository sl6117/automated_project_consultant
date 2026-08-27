import type { ModelExecutionProvenance } from "../ledger/schemas";
import type { ModelUsage } from "./pricing";
import type { ModelRequestDescription } from "./prompt";

// Every client method resolves to the raw payload plus the usage the provider
// reported. Non-live clients report null usage; the attempt runner settles
// their spend as zero.
export type ModelClientResult = {
  payload: unknown;
  usage: ModelUsage | null;
};

// Each call carries the exact request description the orchestrator estimated
// against; the live client sends that same object, so the estimate covers
// precisely what goes over the wire. Offline clients use the semantic fields
// and ignore the description.
export type ModelClient = {
  // How this client produces payloads; persisted on every model_calls row.
  executionProvenance: ModelExecutionProvenance;
  extractFromIdea(input: {
    idea: string;
    projectName: string;
    request: ModelRequestDescription;
  }): Promise<ModelClientResult>;
  nextQuestion(input: {
    idea: string;
    projectName: string;
    request: ModelRequestDescription;
  }): Promise<ModelClientResult>;
  coachRecommendation(input: {
    idea: string;
    projectName: string;
    questionBody: string;
    // Approved ledger context: canonical statements and concern coverage the
    // advice must be grounded in.
    approvedStatements: string[];
    approvedConcerns: string[];
    request: ModelRequestDescription;
  }): Promise<ModelClientResult>;
};
