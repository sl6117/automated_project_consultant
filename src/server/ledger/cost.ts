export class CostCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostCapError";
  }
}

// Spend accounting lives in model-attempts.ts: attempt rows are the canonical
// record, the session stores only the cap, and there is deliberately no
// accumulator to update here anymore.
