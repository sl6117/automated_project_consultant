import type { AdaptiveLedgerContext } from "../../../src/server/model/prompt";

// The adaptive request's ledger context is a required field. Request-shape
// tests (byte estimates, serialization, transport plumbing) use this helper
// to state the empty context explicitly; a fresh object per call keeps tests
// from sharing mutable arrays.
export function emptyAdaptiveContext(): AdaptiveLedgerContext {
  return {
    missingCoreCodes: [],
    openContradictions: [],
    resolvedQuestions: [],
  };
}
