/**
 * OVERNIGHT WAVE item (a): real adapters turning Codex's canonical
 * cycle-evidence export (`decodeCycleEvidenceArchive`, confirmed real and
 * lossless in the COMMAND 3 audit) into COMMAND 4's dataset contracts.
 * Research-only, read-only consumer of Codex's export -- never queries
 * Production Postgres directly, never mutates anything.
 *
 * Every row is schema-drift-checked (`export-schema-drift-detector.ts`)
 * before being adapted; a drifted archive is rejected, never guessed at.
 *
 * `sourceSha`/`workerSha` are not part of the archive payload itself (they
 * live on the row that references the archive, e.g. `fusion_snapshot`'s own
 * columns) -- callers supply them explicitly rather than this module
 * fabricating a plausible-looking value.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from './point-in-time-evidence.js';
import { assertExportSchemaCompatible } from './export-schema-drift-detector.js';
import {
  buildDecisionCandidateObservation, type DecisionCandidateObservation, type DecisionCandidateStatus,
} from './entry-unit-separation.js';
import {
  buildStrategyChoiceOutcomeRows, strategyChoiceOutcomeBuilderVersion,
  type StrategyAlternative, type StrategyChoiceOutcomeRow,
} from './strategy-choice-outcome-builder.js';
import { identifiabilityTaxonomyVersion } from './empirical-identifiability-taxonomy.js';

export const canonicalExportAdaptersVersion = 'theta-canonical-export-adapters-v1' as const;

interface DecodedArchiveLike {
  readonly contractVersion: unknown;
  readonly strategyFrontier: unknown;
}

interface FrontierBranchLike {
  readonly branch: string;
  readonly candidates: readonly { readonly candidateId: string }[];
}

interface FrontierLike {
  readonly selectedCandidateId: string | null;
  readonly branches: readonly FrontierBranchLike[];
}

function candidateStatus(candidateId: string, frontier: FrontierLike): DecisionCandidateStatus {
  if (frontier.selectedCandidateId === candidateId) return 'SELECTED';
  return 'REJECTED';
}

/** Real, deterministic feature-snapshot hash for a single candidate --
 * hashes exactly the candidate object as exported, so two adapter runs
 * over the same archive produce identical hashes (a reproducibility
 * requirement, not incidental). */
function candidateFeatureSnapshotHash(candidate: unknown): string {
  return createHash('sha256').update(canonicalJson(candidate as never)).digest('hex');
}

export interface CanonicalExportAdapterContext {
  readonly decisionId: string;
  readonly decisionAt: string;
  readonly sourceSha: string;
  readonly workerSha: string | null;
}

/**
 * Adapts a real, schema-verified decoded archive's `strategyFrontier` into
 * `DECISION_CANDIDATE_DATASET` rows -- one per candidate, across every
 * branch, `SELECTED`/`REJECTED` per the frontier's own `selectedCandidateId`.
 * A candidate that was never evaluated this cycle (WAITED/SHADOW_ONLY) is
 * not representable from this archive alone -- those states require a
 * separate WAIT-alternative source (`wait-strategy-alternatives-extension.ts`),
 * not fabricated here.
 */
export function adaptDecisionCandidateDataset(
  decodedArchive: DecodedArchiveLike,
  context: CanonicalExportAdapterContext,
): readonly DecisionCandidateObservation[] {
  const frontier = decodedArchive.strategyFrontier as FrontierLike | null;
  if (frontier === null || frontier === undefined) return [];

  const allCandidateIds = frontier.branches.flatMap((branch) => branch.candidates.map((c) => c.candidateId));
  const allStatuses = allCandidateIds.map((id) => candidateStatus(id, frontier));
  assertExportSchemaCompatible(decodedArchive as unknown as Record<string, unknown>, allStatuses);

  const rows: DecisionCandidateObservation[] = [];
  for (const branch of frontier.branches) {
    for (const candidate of branch.candidates) {
      rows.push(buildDecisionCandidateObservation({
        candidateId: candidate.candidateId,
        decisionId: context.decisionId,
        decisionAt: context.decisionAt,
        strategyFamily: branch.branch,
        status: candidateStatus(candidate.candidateId, frontier),
        featureSnapshotHash: candidateFeatureSnapshotHash(candidate),
        sourceSha: context.sourceSha,
        workerSha: context.workerSha,
      }));
    }
  }
  return rows;
}

/**
 * Adapts a real, schema-verified decoded archive's `strategyFrontier` into
 * `STRATEGY_COMPARISON_DATASET` rows -- one alternative per real branch
 * that had at least one candidate this cycle. `wasChosen` is true only for
 * the branch containing the frontier's own `selectedCandidateId`.
 * `chosenStrategyResolvedOutcome` is always `null` here -- this adapter
 * only recovers the pre-decision alternative set from the export; the
 * eventual factual outcome is a separate, later join
 * (`prediction-outcome-join.ts`'s pattern), never fabricated at adapt time.
 */
export function adaptStrategyComparisonDataset(
  decodedArchive: DecodedArchiveLike,
  context: CanonicalExportAdapterContext,
): readonly StrategyChoiceOutcomeRow[] {
  const frontier = decodedArchive.strategyFrontier as FrontierLike | null;
  if (frontier === null || frontier === undefined) return [];

  const branchesWithCandidates = frontier.branches.filter((b) => b.candidates.length > 0);
  if (branchesWithCandidates.length === 0) return [];

  const chosenBranch = branchesWithCandidates.find(
    (b) => b.candidates.some((c) => c.candidateId === frontier.selectedCandidateId),
  );

  const alternatives: StrategyAlternative[] = branchesWithCandidates.map((branch) => ({
    strategyFamily: branch.branch,
    wasChosen: branch === chosenBranch,
    preDecisionStateHash: candidateFeatureSnapshotHash(branch.candidates),
  }));

  // No branch matched the frontier's selectedCandidateId (e.g. a real WAIT
  // cycle). buildStrategyChoiceOutcomeRows structurally requires exactly
  // one chosen alternative (by design -- a comparison point must have a
  // real decision), so a genuine "nothing was chosen this cycle" state is
  // represented directly here rather than forcing an arbitrary branch to
  // look selected just to satisfy that invariant.
  if (chosenBranch === undefined) {
    return alternatives.map((alt): StrategyChoiceOutcomeRow => ({
      contractVersion: strategyChoiceOutcomeBuilderVersion,
      taxonomyVersion: identifiabilityTaxonomyVersion,
      comparisonPointId: context.decisionId,
      strategyFamily: alt.strategyFamily,
      preDecisionStateHash: alt.preDecisionStateHash,
      identifiabilityStatus: 'NOT_IDENTIFIABLE',
      commonHorizonOutcome: null,
    }));
  }

  return buildStrategyChoiceOutcomeRows({
    comparisonPointId: context.decisionId,
    alternatives,
    chosenStrategyResolvedOutcome: null,
  });
}
