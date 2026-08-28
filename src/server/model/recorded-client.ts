import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelClient } from "./client";
import {
  APPROVED_CONCERNS_HEADING,
  APPROVED_STATEMENTS_HEADING,
  type ModelRequestDescription,
} from "./prompt";

const STATEMENT_PLACEHOLDER_PREFIX = "__APPROVED_STATEMENT_";

// Contradiction citations must name approved statement ids that exist only at
// runtime, so a static fixture cannot carry them literally. The fixture uses
// __APPROVED_STATEMENT_<n>__ placeholders and the recorded client substitutes
// the ids it finds in the request's own approved-statements section — the
// same ids a live model would cite — keeping validation exactly as strict as
// the live path. The section is located by the headings shared with the
// prompt builder, and a placeholder with no matching statement fails loudly
// here instead of surfacing later as a misleading unknown-id rejection.
function substituteApprovedStatementIds(
  fixtureText: string,
  request: ModelRequestDescription,
): string {
  const content = request.messages[0]?.content ?? "";
  const start = content.indexOf(APPROVED_STATEMENTS_HEADING);
  const end = content.indexOf(APPROVED_CONCERNS_HEADING);
  const statementSection =
    start >= 0 && end > start ? content.slice(start, end) : "";
  const ids = [...statementSection.matchAll(/^- \[([^\]]+)\]/gm)].map(
    (match) => match[1]!,
  );
  const substituted = ids.reduce(
    (text, id, index) =>
      text.replaceAll(`${STATEMENT_PLACEHOLDER_PREFIX}${index}__`, id),
    fixtureText,
  );
  if (substituted.includes(STATEMENT_PLACEHOLDER_PREFIX)) {
    throw new Error(
      "Recorded fixture cites an approved-statement placeholder with no " +
        "matching approved statement in the request",
    );
  }
  return substituted;
}

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

const phase2FixtureDir = join(process.cwd(), "tests/fixtures/phase-2");

export function createRecordedModelClient(
  options: {
    extractionPath?: string;
    questionPath?: string;
    coachPath?: string;
    incrementalPath?: string;
  } = {},
): ModelClient {
  const extractionPath =
    options.extractionPath ?? join(fixtureDir, "sonnet-extraction.json");
  const questionPath =
    options.questionPath ?? join(fixtureDir, "fable-next-question.json");
  const coachPath = options.coachPath ?? join(fixtureDir, "fable-coach.json");
  const incrementalPath =
    options.incrementalPath ??
    join(phase2FixtureDir, "sonnet-incremental.json");

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
    async incrementalExtraction() {
      const payload = JSON.parse(
        readFileSync(/*turbopackIgnore: true*/ incrementalPath, "utf8"),
      ) as unknown;
      return { payload, usage: null };
    },
    async nextQuestion(input) {
      const payload = JSON.parse(
        substituteApprovedStatementIds(
          readFileSync(/*turbopackIgnore: true*/ questionPath, "utf8"),
          input.request,
        ),
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
