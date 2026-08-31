import type { JudgeBriefScores } from "./calibration";
import type { Brief, BriefLabels } from "./corpus-schemas";
import {
  describeFaithfulnessRequest,
  describeSufficiencyRequest,
  describeUsefulnessRequest,
  parseFaithfulness,
  parseSufficiency,
  parseUsefulness,
} from "./judge";
import type { JudgeClient } from "./judge-client";
import type { ReplayTranscript } from "./replay";

// Runs the three judged dimensions over one brief's transcript. Usefulness is
// judged only at the turns the owner labeled in questionRankings — the same
// turns the deterministic efficiency dimension reads — so judge spend scales
// with the owner's labeling effort, not with transcript length. Every payload
// passes its validation gate before it is used; a validation failure
// propagates and the brief's judged scores are discarded whole, never
// partially applied.

export async function judgeTranscript(input: {
  brief: Brief;
  transcript: ReplayTranscript;
  labels: BriefLabels;
  client: JudgeClient;
}): Promise<JudgeBriefScores> {
  const { brief, transcript, labels, client } = input;

  const statementCount = transcript.approvedStatements.length;
  let inventedStatementIndexes: number[] = [];
  if (statementCount > 0) {
    const request = describeFaithfulnessRequest({ brief, transcript });
    const result = await client.judge({ task: "judge-faithfulness", request });
    const parsed = parseFaithfulness(result.payload, { statementCount });
    inventedStatementIndexes = parsed.verdicts
      .filter((verdict) => verdict.verdict === "invented")
      .map((verdict) => verdict.index)
      .sort((a, b) => a - b);
  }

  const usefulnessByTurn: JudgeBriefScores["usefulnessByTurn"] = [];
  for (const ranking of labels.questionRankings) {
    const turnExists = transcript.turns.some(
      (turn) => turn.turn === ranking.turn,
    );
    if (!turnExists) {
      continue;
    }
    const request = describeUsefulnessRequest({
      brief,
      transcript,
      turn: ranking.turn,
    });
    const result = await client.judge({ task: "judge-usefulness", request });
    const parsed = parseUsefulness(result.payload);
    usefulnessByTurn.push({
      turn: ranking.turn,
      score: parsed.score,
      why: parsed.why,
    });
  }

  const sufficiencyRequest = describeSufficiencyRequest({ brief, transcript });
  const sufficiencyResult = await client.judge({
    task: "judge-sufficiency",
    request: sufficiencyRequest,
  });
  const sufficiency = parseSufficiency(sufficiencyResult.payload);

  return {
    briefId: brief.id,
    inventedStatementIndexes,
    statementCount,
    usefulnessByTurn,
    minimumSufficiency: { score: sufficiency.score, why: sufficiency.why },
  };
}
