import type { Brief } from "./corpus-schemas";
import { describePairwiseRequest, parsePairwise } from "./judge";
import type { JudgeClient } from "./judge-client";
import type { ReplayTranscript } from "./replay";

// Pairwise comparison is for changes, not absolutes: two transcripts of the
// same brief from two loaded runs (before/after a prompt change). Both
// presentation orders are evaluated; a dimension's verdict counts only when
// the judge picks the same transcript from both orders — otherwise the
// dimension is position-biased and yields no verdict. Judged preference for
// a side the deterministic dimensions failed is flagged, never averaged away.

export type PairwiseDimensionVerdict = {
  dimension: "faithfulness" | "usefulness" | "sufficiency";
  verdict: "a" | "b" | "position-biased";
  whyForward: string;
  whyReversed: string;
  // Set when the judge's consistent pick lost on deterministic scoring while
  // the other side passed — a disagreement to surface, not to resolve here.
  deterministicDisagreement: boolean;
};

export type PairwiseResult = {
  briefId: string;
  verdicts: PairwiseDimensionVerdict[];
  positionBiasedDimensions: number;
};

export async function evaluatePairwise(input: {
  brief: Brief;
  a: ReplayTranscript;
  b: ReplayTranscript;
  // Overall deterministic pass/fail for each side, from scoreBrief.
  aPassesDeterministic: boolean;
  bPassesDeterministic: boolean;
  client: JudgeClient;
}): Promise<PairwiseResult> {
  const { brief, a, b, client } = input;

  const forwardRequest = describePairwiseRequest({
    brief,
    first: a,
    second: b,
  });
  const reversedRequest = describePairwiseRequest({
    brief,
    first: b,
    second: a,
  });
  const forward = parsePairwise(
    (await client.judge({ task: "judge-pairwise", request: forwardRequest }))
      .payload,
  );
  const reversed = parsePairwise(
    (await client.judge({ task: "judge-pairwise", request: reversedRequest }))
      .payload,
  );

  const verdicts: PairwiseDimensionVerdict[] = [];
  for (const dimension of [
    "faithfulness",
    "usefulness",
    "sufficiency",
  ] as const) {
    const forwardPick = forward.picks.find(
      (pick) => pick.dimension === dimension,
    )!;
    const reversedPick = reversed.picks.find(
      (pick) => pick.dimension === dimension,
    )!;

    // Forward order: 1 = a, 2 = b. Reversed order: 1 = b, 2 = a.
    const forwardWinner = forwardPick.winner === "1" ? "a" : "b";
    const reversedWinner = reversedPick.winner === "1" ? "b" : "a";

    const verdict =
      forwardWinner === reversedWinner ? forwardWinner : "position-biased";
    const winnerFailedDeterministic =
      (verdict === "a" &&
        !input.aPassesDeterministic &&
        input.bPassesDeterministic) ||
      (verdict === "b" &&
        !input.bPassesDeterministic &&
        input.aPassesDeterministic);

    verdicts.push({
      dimension,
      verdict,
      whyForward: forwardPick.why,
      whyReversed: reversedPick.why,
      deterministicDisagreement: winnerFailedDeterministic,
    });
  }

  return {
    briefId: brief.id,
    verdicts,
    positionBiasedDimensions: verdicts.filter(
      (entry) => entry.verdict === "position-biased",
    ).length,
  };
}
