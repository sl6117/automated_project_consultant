import { describe, expect, test } from "vitest";
import { briefSchema } from "../../../src/eval/corpus-schemas";
import { createPersona } from "../../../src/eval/persona";

const baseBrief = {
  id: "test-brief",
  projectName: "T",
  idea: "an idea",
  domain: "test",
  traits: [],
  maxTurns: 12,
  fallback: { disposition: "unknown" as const },
  answers: {
    problem: ["problem answer 1", "problem answer 2"],
    user: ["user answer 1"],
    workflow: ["workflow answer 1"],
    success: ["success answer 1"],
  },
};

describe("persona answer selection", () => {
  test("codes are consulted in ontology order, not the model's order", () => {
    const persona = createPersona(briefSchema.parse(baseBrief));
    // Model presents success before problem; ontology order says problem
    // comes first.
    const answer = persona.answerFor(["success", "problem"]);
    expect(answer).toEqual({
      disposition: "answered",
      body: "problem answer 1",
    });
  });

  test("entries are consumed in order, at most once each", () => {
    const persona = createPersona(briefSchema.parse(baseBrief));
    expect(persona.answerFor(["problem"]).body).toBe("problem answer 1");
    expect(persona.answerFor(["problem"]).body).toBe("problem answer 2");
    // problem exhausted; the next code on the question is used instead.
    expect(persona.answerFor(["problem", "user"]).body).toBe("user answer 1");
  });

  test("the unknown fallback applies when every code is exhausted", () => {
    const persona = createPersona(briefSchema.parse(baseBrief));
    persona.answerFor(["user"]);
    expect(persona.answerFor(["user"])).toEqual({
      disposition: "unknown",
      body: "",
    });
  });

  test("an answered fallback supplies its fixed text", () => {
    const persona = createPersona(
      briefSchema.parse({
        ...baseBrief,
        fallback: { disposition: "answered", body: "I have nothing to add." },
      }),
    );
    expect(persona.answerFor(["quality"])).toEqual({
      disposition: "answered",
      body: "I have nothing to add.",
    });
  });

  test("a code with no script entries is skipped, not an error", () => {
    const persona = createPersona(briefSchema.parse(baseBrief));
    expect(persona.answerFor(["data", "workflow"]).body).toBe(
      "workflow answer 1",
    );
  });
});
