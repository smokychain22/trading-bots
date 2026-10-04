import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontierInput } from '../src/theta/canonical-strategy-frontier.js';
import { decodeCycleEvidenceArchive } from '../src/theta/postgres-cycle-evidence-storage.js';
import { replayCycleArchive } from '../src/theta/cycle-archive-replay.js';
import { buildCycleQEntryFunnelSummary, qEntryFunnelPolicyFromRuntimePolicy } from '../src/theta/q-entry-funnel.js';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';

const argument = (name: string): string | undefined => process.argv
  .find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const replayRoot = resolve(argument('replay-root')
  ?? 'C:\\ProjectBackups\\trading-bots\\storage-archives\\theta-20261003\\replay-samples');
const outputPath = resolve(argument('output')
  ?? 'docs/operations/THETA_PHASE7_OFFMARKET_PREPARATION_20261004.json');
const promotionPath = resolve('docs/operations/THETA_MASTER_PAPER_UNIVERSE_PROMOTION_20261004.json');
const liveBoardPath = resolve('docs/operations/THETA_LIVE_BOARD_20261002.json');
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 30_000 }).trim();

interface ReplayReceipt {
  readonly replaySourceSha: string;
  readonly results: readonly { readonly id: string; readonly archiveSha256: string; readonly decisionTime: string }[];
}
interface PromotionReceipt {
  readonly account: {
    readonly equityUsd: number; readonly optionsBuyingPowerUsd: number;
    readonly softTickerCapPct: number; readonly hardTickerCapPct: number;
  };
  readonly candidates: readonly { readonly symbol: string; readonly lowestQualifiedCollateralUsd: number | null }[];
  readonly approvedSymbols: readonly string[];
}

const replayReceipt = JSON.parse(readFileSync(resolve(replayRoot, 'replay-receipt.json'), 'utf8')) as ReplayReceipt;
const promotion = JSON.parse(readFileSync(promotionPath, 'utf8')) as PromotionReceipt;
const liveBoard = JSON.parse(readFileSync(liveBoardPath, 'utf8')) as {
  readonly rejectionDistribution?: {
    readonly account?: { readonly minimumQValidSpyCollateral?: number };
  };
};
const qPolicy = qEntryFunnelPolicyFromRuntimePolicy();
const approved = new Set(promotion.approvedSymbols);
const reasonCounts = new Map<string, number>();
const approvedReasonCounts = new Map<string, number>();
const incrementMap = (target: Map<string, number>, reason: string, count = 1): void =>
  target.set(reason, (target.get(reason) ?? 0) + count);

const cycles = replayReceipt.results.map((entry) => {
  const blobPath = resolve(replayRoot, `${entry.id}.bin`);
  const blob = readFileSync(blobPath);
  if (sha256(blob) !== entry.archiveSha256) throw new Error(`PHASE7_REPLAY_ARCHIVE_HASH_MISMATCH:${entry.id}`);
  const decoded = decodeCycleEvidenceArchive(blob);
  const input = decoded.canonicalFrontierInput as unknown as CanonicalStrategyFrontierInput;
  const contentHash = sha256(Buffer.from(canonicalJson(decoded)));
  const replay = replayCycleArchive(blob, {
    cycleId: entry.id, sourceSha: replayReceipt.replaySourceSha,
    archiveSha256: entry.archiveSha256, archiveContentHash: contentHash,
  }, currentSha);
  const frontier = buildCanonicalStrategyFrontier(input);
  const symbol = input.contracts[0]?.underlying ?? 'UNKNOWN';
  const q = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  const h = frontier.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE');
  const d = frontier.branches.find((branch) => branch.branch === 'THETA_DEFINED_RISK');
  for (const candidate of q?.candidates ?? []) for (const reason of candidate.hardBlockers) {
    incrementMap(reasonCounts, `HARD:${reason}`);
    if (approved.has(symbol)) incrementMap(approvedReasonCounts, `HARD:${reason}`);
  }
  const exposure = input.capitalBudgetAccountEvidence as unknown as { exposure?: { equity?: number } } | null | undefined;
  const evaluations = input.thetaQCandidateEvaluationByOptionSymbol;
  const funnel = buildCycleQEntryFunnelSummary({
    contracts: input.contracts,
    account: {
      equity: exposure?.exposure?.equity ?? null,
      buyingPower: input.buyingPower ?? null,
      instrumentApproval: approved.has(symbol)
        ? { state: 'APPROVED', reason: null }
        : { state: 'NOT_APPROVED', reason: 'INSTRUMENT_NOT_IN_CURRENT_PAPER_MANIFEST' },
    },
    // The compact canonical T0 records that event evidence was observed, but
    // does not retain the complete company/macro clearance needed to replay
    // that gate. UNKNOWN is the only truthful counterfactual value.
    eventState: input.eventState === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'UNKNOWN',
    earningsDistanceSessions: null,
    conventionalCandidates: (q?.candidates ?? []).flatMap((candidate) => {
      const optionSymbol = candidate.legs[0]?.optionSymbol;
      if (optionSymbol === undefined) return [];
      const evaluation = evaluations?.[optionSymbol];
      return [{
        optionSymbol, aegisState: candidate.aegisState,
        aegisBindingReasons: input.aegisBindingReasonsByCandidateId?.[candidate.candidateId] ?? [],
        quantity: candidate.sizing.quantity, bindingConstraint: candidate.sizing.bindingConstraint,
        shortlistState: evaluation === undefined ? 'UNKNOWN' as const
          : evaluation.state === 'NOT_EVALUATED_SHORTLIST_BOUND' ? 'NOT_SELECTED' as const : 'FINALIST' as const,
        entryBasis: candidate.entryEligibility?.basis,
      }];
    }),
  });
  for (const [stage, counts] of Object.entries(funnel?.independentGates ?? {})) {
    if (counts.FAIL_COUNT > 0) {
      incrementMap(reasonCounts, `GATE:${stage}:FAIL`, counts.FAIL_COUNT);
      if (approved.has(symbol)) incrementMap(approvedReasonCounts, `GATE:${stage}:FAIL`, counts.FAIL_COUNT);
    }
    if (counts.UNKNOWN_COUNT > 0) {
      incrementMap(reasonCounts, `GATE:${stage}:UNKNOWN`, counts.UNKNOWN_COUNT);
      if (approved.has(symbol)) incrementMap(approvedReasonCounts, `GATE:${stage}:UNKNOWN`, counts.UNKNOWN_COUNT);
    }
  }
  return {
    cycleId: entry.id, decisionTime: entry.decisionTime, symbol,
    approvedSymbol: approved.has(symbol), replayMode: replay.mode, replayState: replay.state,
    chain: input.contracts.length,
    valid: input.contracts.filter((contract) => contract.dataQuality === 'GOOD').length,
    funnel: funnel === null ? null : { totals: funnel.totals, stages: funnel.stages,
      dominantBlocker: funnel.dominantBlocker, extinctionStage: funnel.extinctionStage },
    qCandidates: q?.candidateCount ?? 0,
    aegisReached: (q?.candidates ?? []).filter((candidate) => candidate.aegisState !== null).length,
    aegisPass: (q?.candidates ?? []).filter((candidate) =>
      candidate.aegisState === 'ALLOW_FULL' || candidate.aegisState === 'ALLOW_REDUCED').length,
    structuralQtyPositive: (q?.candidates ?? []).filter((candidate) => candidate.sizing.quantity > 0).length,
    finalists: (q?.candidates ?? []).filter((candidate) =>
      evaluations?.[candidate.legs[0]?.optionSymbol ?? '']?.state !== 'NOT_EVALUATED_SHORTLIST_BOUND').length,
    currentAction: frontier.primaryAction, currentQuantity: frontier.selectedQuantity,
    wait: frontier.primaryAction === 'GLOBAL_WAIT' || frontier.primaryAction === 'SYSTEM_HOLD',
    hCandidates: h?.candidateCount ?? 0, dCandidates: d?.candidateCount ?? 0,
    hStructuralQtyPositive: (h?.candidates ?? []).filter((candidate) => candidate.sizing.quantity > 0).length,
    dStructuralQtyPositive: (d?.candidates ?? []).filter((candidate) => candidate.sizing.quantity > 0).length,
    brokerAuthority: false as const, providerRequests: 0 as const, brokerMutations: 0 as const,
  };
});

const minimumCollateral = new Map(promotion.candidates.map((row) => [row.symbol, row.lowestQualifiedCollateralUsd]));
minimumCollateral.set('SPY', liveBoard.rejectionDistribution?.account?.minimumQValidSpyCollateral ?? null);
const strategyCap = Math.min(...Object.values(qPolicy.quantityCaps));
const reachability = promotion.approvedSymbols.map((symbol) => {
  const collateral = minimumCollateral.get(symbol) ?? null;
  if (collateral === null || collateral <= 0) return { symbol, minimumObservedValidCollateralOneContract: null,
    optionsBuyingPower: promotion.account.optionsBuyingPowerUsd, qty1Reachable: null, reason: 'QUALIFIED_COLLATERAL_UNKNOWN' };
  const optionsBuyingPowerCap = Math.floor(promotion.account.optionsBuyingPowerUsd / collateral);
  const tickerCap = Math.floor((promotion.account.equityUsd * promotion.account.softTickerCapPct) / collateral);
  const portfolioCap = Math.floor((promotion.account.equityUsd * 0.5) / collateral);
  const assignmentCap = optionsBuyingPowerCap;
  const aegisCap = collateral / promotion.account.equityUsd >= promotion.account.hardTickerCapPct ? 0 : tickerCap;
  const maximumTheoreticalQty = Math.max(0, Math.min(optionsBuyingPowerCap, tickerCap, portfolioCap,
    assignmentCap, aegisCap, strategyCap));
  return { symbol, minimumObservedValidCollateralOneContract: collateral,
    optionsBuyingPower: promotion.account.optionsBuyingPowerUsd,
    tickerCap, portfolioCap, assignmentCap, aegisCap, strategyCap,
    maximumTheoreticalQty, qty1Reachable: maximumTheoreticalQty >= 1,
    reason: maximumTheoreticalQty >= 1 ? 'STRUCTURALLY_REACHABLE' : 'ACCOUNT_POLICY_INCOMPATIBILITY' };
});

const approvedCycles = cycles.filter((cycle) => cycle.approvedSymbol);
const report = {
  contractVersion: 'theta-phase7-offmarket-preparation-v1', generatedAt: new Date().toISOString(),
  sourceSha: currentSha, replayClass: 'CURRENT_POLICY_COUNTERFACTUAL_REPLAY',
  sourceCorpus: { replayRoot, cycles: cycles.length, approvedSymbolCycles: approvedCycles.length,
    symbols: Object.fromEntries([...new Set(cycles.map((cycle) => cycle.symbol))].sort().map((symbol) =>
      [symbol, cycles.filter((cycle) => cycle.symbol === symbol).length])),
    limitations: ['XLE_HAS_QUALIFICATION_EVIDENCE_BUT_NO_FULL_CYCLE_ARCHIVE_IN_RETAINED_SAMPLE',
      'COMPACT_T0_EVENT_CLEARANCE_NOT_RECONSTRUCTIBLE', 'NO_RESOLVED_AFTER_COST_OPTION_OUTCOME_LABELS'] },
  cycles, reachability,
  structuralUniverseReachable: reachability.some((row) => row.qty1Reachable === true),
  strictness: {
    gateRoles: {
      PUT_CONTRACT_IDENTITY: 'HARD_SAFETY', INSTRUMENT_APPROVAL: 'HARD_SAFETY',
      EXECUTABLE_ALPACA_QUOTE: 'HARD_DATA_QUALITY', DELTA_KNOWN: 'HARD_DATA_QUALITY',
      QUOTE_FRESHNESS: 'HARD_SAFETY', DTE_WINDOW: 'HARD_STRUCTURAL', DELTA_BAND: 'HARD_STRUCTURAL',
      SPREAD: 'HARD_DATA_QUALITY', OPEN_INTEREST: 'HARD_DATA_QUALITY', VOLUME: 'HARD_DATA_QUALITY',
      PREMIUM_ECONOMICS: 'HARD_STRUCTURAL', QUOTE_AGE_BUDGET: 'HARD_DATA_QUALITY',
      EVENT_WINDOW: 'HARD_SAFETY', FINALIST_SHORTLIST: 'SOFT_RANKING', ENTRY_ELIGIBILITY: 'HARD_SAFETY',
      CAPITAL_FIT: 'HARD_ACCOUNT', AEGIS: 'HARD_PORTFOLIO', FINAL_QUANTITY: 'HARD_ACCOUNT',
    },
    allCorpusTopReasonCounts: Object.fromEntries([...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)),
    approvedCorpusTopReasonCounts: Object.fromEntries([...approvedReasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)),
    policyChanged: false, productionThresholdChanged: false,
  },
  gateRegret: { state: 'UNKNOWN_NO_RESOLVED_AFTER_COST_OPTION_OUTCOMES', futureObservableCount: 0,
    positiveAfterCostCounterfactualCount: null, negativeAfterCostCounterfactualCount: null },
  falseAccept: { state: 'UNKNOWN_NO_RESOLVED_AFTER_COST_OPTION_OUTCOMES', evaluatedOpenCount: 0 },
  shadow: { hCandidateCount: cycles.reduce((sum, cycle) => sum + cycle.hCandidates, 0),
    dCandidateCount: cycles.reduce((sum, cycle) => sum + cycle.dCandidates, 0),
    approvedHCandidateCount: approvedCycles.reduce((sum, cycle) => sum + cycle.hCandidates, 0),
    approvedDCandidateCount: approvedCycles.reduce((sum, cycle) => sum + cycle.dCandidates, 0),
    approvedHStructuralQtyPositive: approvedCycles.reduce((sum, cycle) => sum + cycle.hStructuralQtyPositive, 0),
    approvedDStructuralQtyPositive: approvedCycles.reduce((sum, cycle) => sum + cycle.dStructuralQtyPositive, 0),
    brokerAuthority: false },
  managementApplicability: { recovery: 'NOT_APPLICABLE_FLAT_ACCOUNT', coveredCall: 'NOT_APPLICABLE_FLAT_ACCOUNT' },
  offlineVerificationContracts: {
    canaryAuthorityChain: 'tests/phase3-first-paper-path.test.ts',
    boundaryMutationMatrix: 'tests/master-paper-action-handoff.test.ts',
    exactQuoteValidation: 'tests/execution-option-quote.test.ts',
    idempotencyAndConflictHandling: 'tests/paper-order-coordinator.test.ts',
    managementActionComparison: ['tests/management-counterfactual-analysis.test.ts',
      'tests/profit-taking-replay.test.ts', 'tests/defined-risk-management-replay.test.ts'],
    wholeChainAccounting: 'tests/phase2-chain-random-episodes.test.ts',
    authorityIsolation: 'tests/architecture-authority-guards.test.ts',
  },
  executionAuthorized: false, providerRequests: 0, brokerMutations: 0,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ state: 'PASS', outputPath, sourceSha: currentSha,
  cycles: cycles.length, approvedSymbolCycles: approvedCycles.length, reachability,
  structuralUniverseReachable: report.structuralUniverseReachable,
  gateRegret: report.gateRegret.state, brokerMutations: 0 })}\n`);
