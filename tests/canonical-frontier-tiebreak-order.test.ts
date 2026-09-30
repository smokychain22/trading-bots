import assert from 'node:assert/strict';
import test from 'node:test';
import { candidateRankOrder } from '../src/theta/canonical-strategy-frontier.js';

/**
 * Phase 1 (1H): proves candidateId is only a final, deterministic tiebreak
 * among candidates already tied on paretoRank and unknownEvidence.length --
 * never a driver of which economically-different candidate wins. Exercises
 * the actual Production comparator, not a duplicate implementation.
 */
interface Fixture {
  readonly candidateId: string;
  readonly paretoRank: number;
  readonly unknownEvidenceLength: number;
}

function sortLikeRankCandidates(candidates: readonly Fixture[]): readonly Fixture[] {
  const normalized = (candidate: Fixture) => ({ ...candidate,
    unknownEvidence: Array.from({ length: candidate.unknownEvidenceLength }, (_, index) => `UNKNOWN_${index}`) });
  return candidates.toSorted((a, b) => candidateRankOrder(normalized(a), normalized(b)));
}

test('CORE CLAIM: a strictly better paretoRank always wins, even against a lexically-earlier ID', () => {
  const worse: Fixture = { candidateId: 'A_LEXICALLY_FIRST', paretoRank: 2, unknownEvidenceLength: 0 };
  const better: Fixture = { candidateId: 'Z_LEXICALLY_LAST', paretoRank: 1, unknownEvidenceLength: 0 };
  const [winner] = sortLikeRankCandidates([worse, better]);
  assert.equal(winner.candidateId, 'Z_LEXICALLY_LAST');
});

test('fewer unknown-evidence entries wins when paretoRank ties, regardless of candidateId', () => {
  const moreUnknown: Fixture = { candidateId: 'A_FIRST', paretoRank: 1, unknownEvidenceLength: 3 };
  const fewerUnknown: Fixture = { candidateId: 'Z_LAST', paretoRank: 1, unknownEvidenceLength: 0 };
  const [winner] = sortLikeRankCandidates([moreUnknown, fewerUnknown]);
  assert.equal(winner.candidateId, 'Z_LAST');
});

test('candidateId is used only as the final tiebreak among truly-tied candidates', () => {
  const first: Fixture = { candidateId: 'AAA', paretoRank: 1, unknownEvidenceLength: 0 };
  const second: Fixture = { candidateId: 'ZZZ', paretoRank: 1, unknownEvidenceLength: 0 };
  const [winner] = sortLikeRankCandidates([second, first]);
  assert.equal(winner.candidateId, 'AAA');
  assert.deepEqual(sortLikeRankCandidates([first, second]), sortLikeRankCandidates([second, first]));
});
