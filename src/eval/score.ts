import type { BriefLabels } from "./corpus-schemas";
import type { ReplayTranscript } from "./replay";

// Deterministic scoring: every dimension is computed from the transcript and
// ledger-derived state alone — no model anywhere. Judged dimensions
// (faithfulness, usefulness, sufficiency) are slice 3. Matching against
// labels is case-insensitive substring on statement bodies; expected-tension
// matching is by count only, because semantic matching of summaries is a
// judgement call that belongs to the calibrated judge, not to a scorer that
// must produce identical output forever.

export class UnauthoredLabelsError extends Error {
  constructor(briefId: string) {
    super(
      `Labels for ${briefId} are still the template; the harness refuses to score unlabeled briefs`,
    );
    this.name = "UnauthoredLabelsError";
  }
}

export type DimensionResult = {
  pass: boolean;
  // Not every dimension applies to every brief (e.g. stop correctness on an
  // unlabeled stop turn); inapplicable dimensions never fail a brief.
  applicable: boolean;
  detail: string;
};

export type BriefScore = {
  briefId: string;
  pass: boolean;
  dimensions: {
    extractionCoverage: DimensionResult;
    questionEfficiency: DimensionResult;
    contradictionHandling: DimensionResult;
    stopCorrectness: DimensionResult;
    contractDiscipline: DimensionResult;
  };
};

function includesPhrase(haystack: string, phrase: string): boolean {
  return haystack.toLowerCase().includes(phrase.toLowerCase());
}

function scoreExtractionCoverage(
  transcript: ReplayTranscript,
  labels: BriefLabels,
): DimensionResult {
  const problems: string[] = [];

  for (const required of labels.requiredStatements) {
    const found = transcript.approvedStatements.some(
      (statement) =>
        statement.kind === required.kind &&
        includesPhrase(statement.body, required.mustMention),
    );
    if (!found) {
      problems.push(
        `missing required ${required.kind} mentioning "${required.mustMention}"`,
      );
    }
  }
  for (const forbidden of labels.forbiddenContent) {
    const hit = transcript.approvedStatements.find((statement) =>
      includesPhrase(statement.body, forbidden),
    );
    if (hit) {
      problems.push(`forbidden content "${forbidden}" appears in an approved statement`);
    }
  }
  const approvedCodes = new Set(transcript.approvedConcernCodes);
  for (const code of labels.requiredConcerns) {
    if (!approvedCodes.has(code)) {
      problems.push(`required concern ${code} never reached approved coverage`);
    }
  }

  return {
    pass: problems.length === 0,
    applicable: true,
    detail: problems.length === 0 ? "all label demands met" : problems.join("; "),
  };
}

// Turns until the four core codes all hold approved coverage, plus agreement
// with the owner's per-turn question rankings where the owner labeled a turn.
function scoreQuestionEfficiency(
  transcript: ReplayTranscript,
  labels: BriefLabels,
): DimensionResult {
  const rankingResults: string[] = [];
  let misses = 0;
  for (const ranking of labels.questionRankings) {
    const turn = transcript.turns.find((entry) => entry.turn === ranking.turn);
    if (!turn) {
      continue;
    }
    const hit = turn.concernCodes.some((code) =>
      ranking.preferredCodes.includes(
        code as (typeof ranking.preferredCodes)[number],
      ),
    );
    if (!hit) {
      misses += 1;
    }
    rankingResults.push(
      `turn ${ranking.turn}: asked [${turn.concernCodes.join(", ")}], owner preferred [${ranking.preferredCodes.join(", ")}] — ${hit ? "hit" : "miss"}`,
    );
  }

  const coverage =
    transcript.coreCoveredAtTurn === null
      ? "core coverage never completed"
      : `core coverage complete after turn ${transcript.coreCoveredAtTurn}`;

  if (rankingResults.length === 0) {
    return {
      pass: true,
      applicable: false,
      detail: `no labeled turns to compare; ${coverage}`,
    };
  }
  return {
    pass: misses === 0,
    applicable: true,
    detail: `${rankingResults.join("; ")}; ${coverage}`,
  };
}

// Citation VALIDITY is enforced upstream by the validation gate: a payload
// citing an unknown statement id is rejected wholesale before persistence,
// which surfaces here as a contract-discipline failure. This dimension adds
// the structural floor a persisted tension must still meet (two or more
// citations) and the count comparison against the labels; whether a summary
// semantically matches a labeled tension is the calibrated judge's job in
// slice 3, not a deterministic scorer's.
function scoreContradictionHandling(
  transcript: ReplayTranscript,
  labels: BriefLabels,
): DimensionResult {
  const problems: string[] = [];
  for (const turn of transcript.turns) {
    for (const tension of turn.tensionsRaised) {
      if (tension.citedStatementIds.length < 2) {
        problems.push(
          `turn ${turn.turn} tension cites ${tension.citedStatementIds.length} statement(s), fewer than two`,
        );
      }
    }
  }

  const expected = labels.expectedTensions.length;
  const raised = transcript.tensionsRaisedTotal;
  if (expected === 0 && problems.length === 0) {
    return {
      pass: true,
      applicable: false,
      detail: `no labeled tensions; ${raised} raised`,
    };
  }
  if (expected > 0 && raised < expected) {
    problems.push(`${raised} tension(s) raised vs ${expected} labeled`);
  }
  return {
    pass: problems.length === 0,
    applicable: true,
    detail:
      problems.length === 0
        ? `${raised} tension(s) raised vs ${expected} labeled (summary matching is judged, not deterministic)`
        : problems.join("; "),
  };
}

function scoreStopCorrectness(
  transcript: ReplayTranscript,
  labels: BriefLabels,
): DimensionResult {
  if (labels.stopTurn === null) {
    return {
      pass: true,
      applicable: false,
      detail: "stop turn not labeled",
    };
  }
  if (transcript.stopOfferedAtTurn === null) {
    return {
      pass: false,
      applicable: true,
      detail: `no stop offer within ${transcript.turns.length} turns (labeled stop turn ${labels.stopTurn}) — missed stop`,
    };
  }
  if (transcript.stopOfferedAtTurn < labels.stopTurn) {
    return {
      pass: false,
      applicable: true,
      detail: `stop offered at turn ${transcript.stopOfferedAtTurn}, before labeled turn ${labels.stopTurn} — premature`,
    };
  }
  return {
    pass: true,
    applicable: true,
    detail: `stop offered at turn ${transcript.stopOfferedAtTurn} (labeled ${labels.stopTurn})`,
  };
}

function scoreContractDiscipline(
  transcript: ReplayTranscript,
): DimensionResult {
  const violations: string[] = [];
  for (const attempt of transcript.attemptOutcomes) {
    if (attempt.status === "validation_failed") {
      violations.push(`${attempt.alias} attempt failed validation`);
    }
  }
  if (transcript.outcome === "aborted-validation") {
    violations.push(transcript.failureDetail ?? "replay aborted on validation");
  }
  if (transcript.outcome === "start-failed") {
    violations.push(transcript.failureDetail ?? "session start failed");
  }
  return {
    pass: violations.length === 0,
    applicable: true,
    detail:
      violations.length === 0
        ? "no invalid payload persisted, no partial applies"
        : violations.join("; "),
  };
}

export function scoreBrief(
  transcript: ReplayTranscript,
  labels: BriefLabels,
): BriefScore {
  if (labels.status !== "authored") {
    throw new UnauthoredLabelsError(transcript.briefId);
  }

  const dimensions = {
    extractionCoverage: scoreExtractionCoverage(transcript, labels),
    questionEfficiency: scoreQuestionEfficiency(transcript, labels),
    contradictionHandling: scoreContradictionHandling(transcript, labels),
    stopCorrectness: scoreStopCorrectness(transcript, labels),
    contractDiscipline: scoreContractDiscipline(transcript),
  };

  // A contract violation is an automatic failure for the brief regardless of
  // every other dimension.
  const pass = dimensions.contractDiscipline.pass
    ? Object.values(dimensions).every(
        (dimension) => !dimension.applicable || dimension.pass,
      )
    : false;

  return { briefId: transcript.briefId, pass, dimensions };
}
