import { z } from "zod";

// Calibration: the judge scores briefs the owner also scored by hand, and
// agreement decides whether a judged dimension's scores count as evidence.
// Below its threshold — or below the minimum sample count — a dimension is
// marked untrusted in every report until the judge prompt is revised and
// re-calibrated: fail-closed grading. Owner calibration labels are authored
// AGAINST A SPECIFIC RUN's transcripts (usefulness of an asked question only
// exists once a question was asked), so they live per run and name it.
//
// Calibration input is strict, never forgiving: an owner-scored turn the
// judge did not score, a duplicate turn, or an out-of-range statement index
// is a broken calibration set and fails loudly. Silently skipping mismatched
// pairs would inflate agreement — the one direction this machinery must
// never err in.

function refuseDuplicateTurns(
  entries: { turn: number }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.turn)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate usefulness entry for turn ${entry.turn}`,
        path: ["usefulnessByTurn"],
      });
    }
    seen.add(entry.turn);
  }
}

export const calibrationLabelsSchema = z
  .strictObject({
    briefId: z.string().min(1),
    runId: z.string().min(1),
    // Owner-authored exclusively, like corpus labels: template until edited.
    status: z.enum(["template", "authored"]),
    instructions: z.string().optional(),
    // Indexes (into the transcript's approved statements) the OWNER judged
    // invented; every other statement is implicitly grounded.
    inventedStatementIndexes: z.array(z.number().int().min(0)),
    usefulnessByTurn: z.array(
      z.strictObject({
        turn: z.number().int().min(1),
        score: z.number().int().min(1).max(5),
      }),
    ),
    minimumSufficiency: z.number().int().min(1).max(5),
  })
  .superRefine((labels, ctx) => {
    refuseDuplicateTurns(labels.usefulnessByTurn, ctx);
    const seen = new Set<number>();
    for (const index of labels.inventedStatementIndexes) {
      if (seen.has(index)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate invented statement index ${index}`,
          path: ["inventedStatementIndexes"],
        });
      }
      seen.add(index);
    }
  });

export type CalibrationLabels = z.infer<typeof calibrationLabelsSchema>;

// The judge's validated scores for one brief, assembled by the judge runner.
export type JudgeBriefScores = {
  briefId: string;
  inventedStatementIndexes: number[];
  statementCount: number;
  usefulnessByTurn: { turn: number; score: number; why: string }[];
  minimumSufficiency: { score: number; why: string };
};

export type DimensionAgreement = {
  dimension: "faithfulness" | "usefulness" | "sufficiency";
  // Exact: identical verdict/score. WithinOne: |judge - owner| <= 1 (only
  // meaningful for the 1-5 scales; faithfulness is binary, so it equals
  // exact there).
  exact: number;
  withinOne: number;
  samples: number;
  // Faithfulness only: the share of owner-labeled invented statements the
  // judge also flagged. Overall agreement cannot stand in for this — on a
  // mostly-grounded set, missing every invention still yields high exact
  // agreement (19/20 = 95%), which is precisely the false trust the recall
  // gate exists to refuse. Null for the 1-5 dimensions.
  inventedRecall: number | null;
  trusted: boolean;
  // Why the dimension is untrusted, for reports; null when trusted.
  untrustedReason: string | null;
};

// Trust policy lives here as configuration, not in call sites; slice 4's
// report reads the same values. Agreement alone is not enough: a dimension
// is trusted only with enough samples to make the percentage mean something,
// and faithfulness additionally demands at least one owner-labeled INVENTED
// statement — on an all-grounded calibration set, 100% agreement proves only
// that the judge can nod along, never that it can catch an invention.
export type JudgeTrustThresholds = {
  faithfulnessExact: number;
  usefulnessWithinOne: number;
  sufficiencyWithinOne: number;
  minFaithfulnessSamples: number;
  minUsefulnessSamples: number;
  minSufficiencySamples: number;
  minInventedPositives: number;
  // Required recall on owner-labeled invented positives. 1.0: a faithfulness
  // judge that misses even one known invention is not trusted, no matter how
  // high its overall agreement.
  minInventedRecall: number;
};

export const JUDGE_TRUST_THRESHOLDS: JudgeTrustThresholds = {
  faithfulnessExact: 0.9,
  usefulnessWithinOne: 0.8,
  sufficiencyWithinOne: 0.8,
  minFaithfulnessSamples: 20,
  minUsefulnessSamples: 10,
  minSufficiencySamples: 8,
  minInventedPositives: 1,
  minInventedRecall: 1,
};

function ratio(hits: number, samples: number): number {
  return samples === 0 ? 0 : hits / samples;
}

export class CalibrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationError";
  }
}

function trustVerdict(input: {
  agreement: number;
  threshold: number;
  thresholdName: string;
  samples: number;
  minSamples: number;
  extraBlocker?: string | null;
}): { trusted: boolean; untrustedReason: string | null } {
  const reasons: string[] = [];
  if (input.samples < input.minSamples) {
    reasons.push(
      `${input.samples} sample(s), fewer than the ${input.minSamples} required`,
    );
  }
  if (input.agreement < input.threshold) {
    reasons.push(
      `agreement ${input.agreement.toFixed(2)} below the ${input.thresholdName} threshold ${input.threshold}`,
    );
  }
  if (input.extraBlocker) {
    reasons.push(input.extraBlocker);
  }
  return reasons.length === 0
    ? { trusted: true, untrustedReason: null }
    : { trusted: false, untrustedReason: reasons.join("; ") };
}

export function computeAgreement(
  pairs: { judge: JudgeBriefScores; owner: CalibrationLabels }[],
  thresholds: JudgeTrustThresholds = JUDGE_TRUST_THRESHOLDS,
): DimensionAgreement[] {
  let faithfulnessSamples = 0;
  let faithfulnessExact = 0;
  let ownerInventedPositives = 0;
  let detectedInventedPositives = 0;
  let usefulnessSamples = 0;
  let usefulnessExact = 0;
  let usefulnessWithinOne = 0;
  let sufficiencySamples = 0;
  let sufficiencyExact = 0;
  let sufficiencyWithinOne = 0;

  for (const { judge, owner } of pairs) {
    if (owner.status !== "authored") {
      throw new CalibrationError(
        `Calibration labels for ${owner.briefId} are still the template`,
      );
    }
    if (owner.briefId !== judge.briefId) {
      throw new CalibrationError(
        `Calibration pair mismatch: judge scored ${judge.briefId}, owner labeled ${owner.briefId}`,
      );
    }
    for (const index of owner.inventedStatementIndexes) {
      if (index >= judge.statementCount) {
        throw new CalibrationError(
          `Owner labels for ${owner.briefId} mark statement ${index} invented, but the transcript has only ${judge.statementCount} statements`,
        );
      }
    }

    // Faithfulness: one binary sample per statement.
    const judgeInvented = new Set(judge.inventedStatementIndexes);
    const ownerInvented = new Set(owner.inventedStatementIndexes);
    ownerInventedPositives += ownerInvented.size;
    for (const index of ownerInvented) {
      if (judgeInvented.has(index)) {
        detectedInventedPositives += 1;
      }
    }
    for (let index = 0; index < judge.statementCount; index += 1) {
      faithfulnessSamples += 1;
      if (judgeInvented.has(index) === ownerInvented.has(index)) {
        faithfulnessExact += 1;
      }
    }

    // Usefulness: every owner-scored turn MUST have a judge score; a missing
    // pair is a broken calibration set, never a skipped sample.
    const judgeByTurn = new Map<number, number>();
    for (const entry of judge.usefulnessByTurn) {
      if (judgeByTurn.has(entry.turn)) {
        throw new CalibrationError(
          `Judge scores for ${judge.briefId} contain duplicate turn ${entry.turn}`,
        );
      }
      judgeByTurn.set(entry.turn, entry.score);
    }
    for (const ownerTurn of owner.usefulnessByTurn) {
      const judgeScore = judgeByTurn.get(ownerTurn.turn);
      if (judgeScore === undefined) {
        throw new CalibrationError(
          `Owner labels for ${owner.briefId} score turn ${ownerTurn.turn}, but the judge produced no score for it`,
        );
      }
      usefulnessSamples += 1;
      const gap = Math.abs(judgeScore - ownerTurn.score);
      if (gap === 0) {
        usefulnessExact += 1;
      }
      if (gap <= 1) {
        usefulnessWithinOne += 1;
      }
    }

    // Sufficiency: one sample per brief.
    sufficiencySamples += 1;
    const gap = Math.abs(
      judge.minimumSufficiency.score - owner.minimumSufficiency,
    );
    if (gap === 0) {
      sufficiencyExact += 1;
    }
    if (gap <= 1) {
      sufficiencyWithinOne += 1;
    }
  }

  const faithfulness = ratio(faithfulnessExact, faithfulnessSamples);
  const usefulness = ratio(usefulnessWithinOne, usefulnessSamples);
  const sufficiency = ratio(sufficiencyWithinOne, sufficiencySamples);

  // Recall on the owner-labeled positives: overall agreement cannot stand in
  // for it, since missing every invention on a mostly-grounded set still
  // clears the exact-agreement bar.
  const inventedRecall =
    ownerInventedPositives === 0
      ? 0
      : detectedInventedPositives / ownerInventedPositives;
  const recallBlockers: string[] = [];
  if (ownerInventedPositives < thresholds.minInventedPositives) {
    recallBlockers.push(
      `${ownerInventedPositives} owner-labeled invented statement(s), fewer than the ${thresholds.minInventedPositives} required — an all-grounded set cannot prove the judge detects invention`,
    );
  } else if (inventedRecall < thresholds.minInventedRecall) {
    recallBlockers.push(
      `judge detected ${detectedInventedPositives} of ${ownerInventedPositives} owner-labeled invented statement(s) — invention recall ${inventedRecall.toFixed(2)} below the required ${thresholds.minInventedRecall.toFixed(2)}`,
    );
  }
  const faithfulnessTrust = trustVerdict({
    agreement: faithfulness,
    threshold: thresholds.faithfulnessExact,
    thresholdName: "exact",
    samples: faithfulnessSamples,
    minSamples: thresholds.minFaithfulnessSamples,
    extraBlocker: recallBlockers.length > 0 ? recallBlockers.join("; ") : null,
  });
  const usefulnessTrust = trustVerdict({
    agreement: usefulness,
    threshold: thresholds.usefulnessWithinOne,
    thresholdName: "within-one",
    samples: usefulnessSamples,
    minSamples: thresholds.minUsefulnessSamples,
  });
  const sufficiencyTrust = trustVerdict({
    agreement: sufficiency,
    threshold: thresholds.sufficiencyWithinOne,
    thresholdName: "within-one",
    samples: sufficiencySamples,
    minSamples: thresholds.minSufficiencySamples,
  });

  return [
    {
      dimension: "faithfulness",
      exact: faithfulness,
      withinOne: faithfulness,
      samples: faithfulnessSamples,
      inventedRecall,
      ...faithfulnessTrust,
    },
    {
      dimension: "usefulness",
      exact: ratio(usefulnessExact, usefulnessSamples),
      withinOne: usefulness,
      samples: usefulnessSamples,
      inventedRecall: null,
      ...usefulnessTrust,
    },
    {
      dimension: "sufficiency",
      exact: ratio(sufficiencyExact, sufficiencySamples),
      withinOne: sufficiency,
      samples: sufficiencySamples,
      inventedRecall: null,
      ...sufficiencyTrust,
    },
  ];
}
