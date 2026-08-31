import { concernCodeSchema } from "../server/ledger/schemas";
import type { Brief } from "./corpus-schemas";

// Deterministic persona answer selection (spec, Definitions): the script maps
// each concern code to an ORDERED list of answer entries. For each pending
// question: take the question's concern codes, order them by ontology order
// (not the model's order, so replay is stable across payload orderings), and
// pick the first code that still has an unconsumed entry; that entry is
// consumed — used at most once per consultation. When every code on the
// question is exhausted, the brief's required fallback applies.

export type PersonaAnswer = {
  disposition: "answered" | "unknown";
  body: string;
};

const ONTOLOGY_ORDER = new Map(
  concernCodeSchema.options.map((code, index) => [code as string, index]),
);

export type Persona = {
  answerFor(concernCodes: string[]): PersonaAnswer;
};

export function createPersona(brief: Brief): Persona {
  const consumed = new Map<string, number>();

  return {
    answerFor(concernCodes) {
      const ordered = [...new Set(concernCodes)].sort(
        (a, b) =>
          (ONTOLOGY_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (ONTOLOGY_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
      );
      for (const code of ordered) {
        const entries = brief.answers[code as keyof typeof brief.answers];
        if (!entries) {
          continue;
        }
        const used = consumed.get(code) ?? 0;
        if (used < entries.length) {
          consumed.set(code, used + 1);
          return { disposition: "answered", body: entries[used]! };
        }
      }
      if (brief.fallback.disposition === "answered") {
        return { disposition: "answered", body: brief.fallback.body };
      }
      return { disposition: "unknown", body: "" };
    },
  };
}
