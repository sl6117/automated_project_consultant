import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  briefSchema,
  labelsSchema,
  type Brief,
  type BriefLabels,
} from "../../../src/eval/corpus-schemas";

const briefsDir = join(process.cwd(), "eval/briefs");

function loadCorpus(): { dir: string; brief: Brief; labels: BriefLabels }[] {
  return readdirSync(briefsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const dir = entry.name;
      const brief = briefSchema.parse(
        JSON.parse(readFileSync(join(briefsDir, dir, "brief.json"), "utf8")),
      );
      const labels = labelsSchema.parse(
        JSON.parse(readFileSync(join(briefsDir, dir, "labels.json"), "utf8")),
      );
      return { dir, brief, labels };
    });
}

describe("evaluation corpus", () => {
  const corpus = loadCorpus();

  test("holds 10-15 briefs that all parse with matching ids and labels", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(10);
    expect(corpus.length).toBeLessThanOrEqual(15);
    for (const { dir, brief, labels } of corpus) {
      expect(brief.id).toBe(dir);
      expect(labels.briefId).toBe(brief.id);
    }
    const ids = new Set(corpus.map(({ brief }) => brief.id));
    expect(ids.size).toBe(corpus.length);
  });

  test("every brief is winnable and declares a fallback", () => {
    // Winnability (an entry for each core code) is enforced inside
    // briefSchema's superRefine, and fallback is a required field — so a
    // corpus that parsed proves both. This test pins the guarantee against
    // schema regressions with one deliberately unwinnable brief.
    const unwinnable = {
      id: "no-success",
      projectName: "X",
      idea: "An idea.",
      domain: "test",
      traits: [],
      maxTurns: 12,
      fallback: { disposition: "unknown" },
      answers: {
        problem: ["p"],
        user: ["u"],
        workflow: ["w"],
      },
    };
    const parsed = briefSchema.safeParse(unwinnable);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("not winnable");
  });

  test("meets the spec's domain and difficulty quotas", () => {
    const domainCounts = new Map<string, number>();
    for (const { brief } of corpus) {
      domainCounts.set(brief.domain, (domainCounts.get(brief.domain) ?? 0) + 1);
    }
    for (const [domain, count] of domainCounts) {
      expect(count, `domain ${domain} exceeds the monoculture cap`).toBeLessThanOrEqual(3);
    }

    const traitCount = (trait: string) =>
      corpus.filter(({ brief }) => (brief.traits as string[]).includes(trait))
        .length;
    for (const required of [
      "data-heavy",
      "safety-sensitive",
      "constraint-dominated",
      "vague",
      "secrets-content",
    ]) {
      expect(traitCount(required), `missing trait ${required}`).toBeGreaterThanOrEqual(1);
    }
    expect(traitCount("early-stop")).toBeGreaterThanOrEqual(3);
    expect(traitCount("hard-coverage")).toBeGreaterThanOrEqual(3);
    expect(traitCount("contradiction")).toBeGreaterThanOrEqual(2);
  });

  test("label templates are structurally valid and unauthored until the owner edits them", () => {
    for (const { labels } of corpus) {
      // Slice 1 ships templates; the owner flips each to "authored". Scoring
      // (slice 2+) will refuse templates — this only checks structure.
      expect(["template", "authored"]).toContain(labels.status);
      if (labels.status === "template") {
        expect(labels.requiredStatements).toHaveLength(0);
        expect(labels.stopTurn).toBeNull();
      }
    }
  });

  test("an authored label that demands no coverage is refused", () => {
    // Flipping the status string alone must not pass for authoring: the
    // schema requires at least one required concern once status is
    // "authored", so an untouched template body cannot masquerade as labels.
    const flippedTemplate = {
      briefId: "x",
      status: "authored",
      requiredStatements: [],
      forbiddenContent: [],
      requiredConcerns: [],
      expectedTensions: [],
      stopTurn: null,
      questionRankings: [],
    };
    const parsed = labelsSchema.safeParse(flippedTemplate);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain(
      "require no concern coverage",
    );
  });
});
