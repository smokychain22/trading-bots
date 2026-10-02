import { createHash } from 'node:crypto';
import { canonicalizeRatio, type NormalizedOptionContract } from './option-contract.js';
import { optionExecutabilityCauses } from './option-executability-diagnostics.js';
import { paperBootstrapRuntimePolicy } from './paper-bootstrap-runtime-policy.js';
import { wholeContractsAffordable } from './secured-contract-capacity.js';

/**
 * THETA-Q (cash-secured put) per-stage entry FUNNEL receipt (Phase 2).
 *
 * Pure and deterministic: no clock, no I/O, no provider, no randomness. It
 * does not decide, rank, size or authorize anything and it never relaxes a
 * threshold -- it only ATTRIBUTES every candidate to the first stage that
 * stopped it, with the exact reason, so that a zero-trade cycle can never be
 * summarized as a generic "no qualifying candidate" when the blocker is known.
 *
 * Stage counts obey one invariant: INPUT = PASS + FAIL + UNKNOWN +
 * NOT_APPLICABLE. PASS and NOT_APPLICABLE continue to the next stage; FAIL and
 * UNKNOWN stop (UNKNOWN is fail-closed, never coerced to PASS or to zero).
 * `independentGates` additionally evaluates every gate against every
 * candidate that cleared the identity stage, so the dominant blocker is
 * visible even when an earlier gate masks it in the sequential attribution.
 *
 * The numeric gate semantics mirror bots/theta/quant/models/theta_q_lattice.py
 * and theta_q_baseline.py exactly (and are parity-tested against them):
 * DTE inclusive on both ends; |delta| in a HALF-OPEN band [low, high);
 * spread <= max (fraction of mid, not percent); OI/volume >= floor;
 * quote age <= budget; earnings distance <= exclusion blocks.
 */
export const qEntryFunnelVersion = 'theta-q-entry-funnel-v1' as const;

export type QFunnelStageId =
  | 'PUT_CONTRACT_IDENTITY' | 'INSTRUMENT_APPROVAL' | 'EXECUTABLE_ALPACA_QUOTE' | 'DELTA_KNOWN'
  | 'QUOTE_FRESHNESS' | 'DTE_WINDOW' | 'DELTA_BAND' | 'SPREAD' | 'OPEN_INTEREST' | 'VOLUME'
  | 'PREMIUM_ECONOMICS' | 'QUOTE_AGE_BUDGET' | 'EVENT_WINDOW' | 'FINALIST_SHORTLIST' | 'ENTRY_ELIGIBILITY'
  | 'AEGIS' | 'CAPITAL_FIT' | 'FINAL_QUANTITY';
export type QFunnelVerdict = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type QFunnelCategory =
  | 'IDENTITY' | 'INSTRUMENT_APPROVAL' | 'LIQUIDITY' | 'Q_STRICTNESS' | 'EVENTS' | 'DATA_UNKNOWN'
  | 'SHORTLIST_BOUND' | 'ENTRY_ELIGIBILITY' | 'AEGIS' | 'CAPITAL' | 'SIZING';

export const qFunnelStageOrder: readonly QFunnelStageId[] = [
  'PUT_CONTRACT_IDENTITY', 'INSTRUMENT_APPROVAL', 'EXECUTABLE_ALPACA_QUOTE', 'DELTA_KNOWN', 'QUOTE_FRESHNESS',
  'DTE_WINDOW', 'DELTA_BAND', 'SPREAD', 'OPEN_INTEREST', 'VOLUME', 'PREMIUM_ECONOMICS', 'QUOTE_AGE_BUDGET', 'EVENT_WINDOW',
  'FINALIST_SHORTLIST', 'ENTRY_ELIGIBILITY', 'CAPITAL_FIT', 'AEGIS', 'FINAL_QUANTITY',
];

const stageCategory: Readonly<Record<QFunnelStageId, QFunnelCategory>> = {
  PUT_CONTRACT_IDENTITY: 'IDENTITY', INSTRUMENT_APPROVAL: 'INSTRUMENT_APPROVAL', EXECUTABLE_ALPACA_QUOTE: 'LIQUIDITY',
  DELTA_KNOWN: 'DATA_UNKNOWN', QUOTE_FRESHNESS: 'LIQUIDITY', DTE_WINDOW: 'Q_STRICTNESS', DELTA_BAND: 'Q_STRICTNESS',
  SPREAD: 'LIQUIDITY', OPEN_INTEREST: 'LIQUIDITY', VOLUME: 'LIQUIDITY', PREMIUM_ECONOMICS: 'Q_STRICTNESS', QUOTE_AGE_BUDGET: 'LIQUIDITY',
  EVENT_WINDOW: 'EVENTS', FINALIST_SHORTLIST: 'SHORTLIST_BOUND', ENTRY_ELIGIBILITY: 'ENTRY_ELIGIBILITY',
  CAPITAL_FIT: 'CAPITAL', AEGIS: 'AEGIS', FINAL_QUANTITY: 'SIZING',
};

export type QFunnelAegisState = 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'DEFINED_RISK_ONLY'
  | 'EMERGENCY_EXIT_ONLY' | null;

export interface QEntryFunnelPolicy {
  readonly minDte: number;
  readonly maxDte: number;
  /** Half-open delta-magnitude bands [low, high). */
  readonly deltaBands: readonly (readonly [number, number])[];
  readonly minOpenInterest: number;
  readonly minVolume: number;
  /** Fraction of the quote midpoint (0.15 = 15%), never a percent number. */
  readonly maxSpreadPct: number;
  readonly candidateQuoteMaxAgeSeconds: number;
  readonly staleQuoteMinimumSeconds: number;
  readonly earningsExclusionDays: number;
  /**
   * RESEARCH-ONLY. Production Q has NO minimum-premium gate (see
   * docs/operations/THETA_PHASE2_Q_FUNNEL_SENSITIVITY_20261002.json). When
   * undefined the stage is NOT_APPLICABLE; the runtime policy never sets it.
   */
  readonly minimumPremiumPerShare?: number;
  readonly aegisTickerSoftCapPct: number;
  readonly aegisHardCapMultiplier: number;
  readonly reducedStateMultiplier: number;
  /** Named quantity caps, in contracts. */
  readonly quantityCaps: Readonly<Record<string, number>>;
}

export function qEntryFunnelPolicyFromRuntimePolicy(): QEntryFunnelPolicy {
  const p = paperBootstrapRuntimePolicy;
  return {
    minDte: p.conventional.minimumDte, maxDte: p.conventional.maximumDte,
    deltaBands: p.conventional.deltaBands.map(([low, high]) => [low, high] as const),
    minOpenInterest: p.conventional.minimumOpenInterest, minVolume: p.conventional.minimumVolume,
    maxSpreadPct: p.conventional.maximumSpreadPct, candidateQuoteMaxAgeSeconds: p.quoteAge.candidateMaximumSeconds,
    staleQuoteMinimumSeconds: p.quoteAge.staleMinimumSeconds, earningsExclusionDays: p.conventional.earningsExclusionDays,
    aegisTickerSoftCapPct: p.aegis.maximumTickerConcentrationPct, aegisHardCapMultiplier: p.aegis.hardCapMultiplier,
    reducedStateMultiplier: p.sizing.reducedStateMultiplier,
    quantityCaps: {
      RISK_BUDGET: p.sizing.riskBudgetQuantityCap, COLLATERAL_CAP: p.sizing.collateralQuantityCap,
      CONCENTRATION_CAP: p.sizing.concentrationQuantityCap, ASSIGNMENT_CAPACITY_CAP: p.sizing.assignmentCapacityQuantityCap,
      TAIL_RISK_CAP: p.sizing.tailRiskQuantityCap, CORRELATION_CAP: p.sizing.correlationQuantityCap,
      LIQUIDITY_CAP: p.sizing.liquidityQuantityCap,
    },
  };
}

export interface QFunnelAccount {
  readonly equity: number | null;
  readonly buyingPower: number | null;
  readonly instrumentApproval: { readonly state: 'APPROVED' | 'NOT_APPROVED' | 'UNKNOWN'; readonly reason: string | null };
}

export interface QFunnelCandidateFacts {
  readonly candidateId: string;
  readonly optionSymbol: string;
  readonly optionType: 'PUT' | 'CALL';
  readonly occSymbol: string | null;
  readonly multiplier: number | null;
  readonly strike: number;
  readonly dte: number;
  /** Signed provider delta (puts are negative); null = UNKNOWN. */
  readonly delta: number | null;
  readonly spreadPct: number | null;
  readonly openInterest: number | null;
  readonly volume: number | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteAgeSeconds: number | null;
  readonly quoteSource: 'ALPACA' | 'OPTIONOMICS';
  readonly quoteTimestamp: string | null;
  readonly executable: boolean;
  readonly nonExecutableCauses: readonly string[];
  readonly eventState: 'CLEAR' | 'BLOCK' | 'UNKNOWN' | 'NOT_APPLICABLE';
  /** Trading sessions to the next earnings; null = UNKNOWN or not applicable. */
  readonly earningsDistanceSessions: number | null;
  /** undefined = shortlist not modeled (stage NOT_APPLICABLE). */
  readonly finalist?: boolean;
  /** undefined = eligibility not observed (stage NOT_APPLICABLE). */
  readonly entryBasis?: 'EMPIRICAL_OWNERSHIP' | 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED' | 'INELIGIBLE';
  /** undefined = AEGIS not modeled/observed (stage NOT_APPLICABLE); 'NOT_REACHED' = never asked. */
  readonly aegisState?: QFunnelAegisState | 'NOT_REACHED';
  readonly aegisReasons?: readonly string[];
  /** Observed or modeled final quantity; undefined = not observed. */
  readonly finalQuantity?: number | null;
  readonly finalQuantityBinding?: string | null;
}

export function qFunnelFactsFromContract(contract: NormalizedOptionContract, context: {
  readonly eventState: QFunnelCandidateFacts['eventState'];
  readonly earningsDistanceSessions: number | null;
}): QFunnelCandidateFacts {
  return {
    candidateId: `THETA_CONVENTIONAL:${contract.optionSymbol}`, optionSymbol: contract.optionSymbol,
    optionType: contract.optionType, occSymbol: contract.occSymbol, multiplier: contract.multiplier,
    strike: contract.strike, dte: contract.dte, delta: contract.delta, spreadPct: contract.spreadPct,
    openInterest: contract.openInterest, volume: contract.volume, bid: contract.bid, ask: contract.ask,
    quoteAgeSeconds: contract.dataAgeSeconds, quoteSource: contract.source, quoteTimestamp: contract.quoteTimestamp,
    executable: contract.executable, nonExecutableCauses: optionExecutabilityCauses(contract),
    eventState: context.eventState, earningsDistanceSessions: context.earningsDistanceSessions,
  };
}

// ---------------------------------------------------------------------------
// Gate semantics (single source for boundary behaviour).
// ---------------------------------------------------------------------------

export interface QGateResult { readonly verdict: QFunnelVerdict; readonly reasons: readonly string[] }
const pass = (): QGateResult => ({ verdict: 'PASS', reasons: [] });
const notApplicable = (reason: string): QGateResult => ({ verdict: 'NOT_APPLICABLE', reasons: [reason] });
const fail = (...reasons: string[]): QGateResult => ({ verdict: 'FAIL', reasons });
const unknown = (...reasons: string[]): QGateResult => ({ verdict: 'UNKNOWN', reasons });
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

export const qGates = {
  dte: (dte: number, policy: QEntryFunnelPolicy): QGateResult =>
    dte >= policy.minDte && dte <= policy.maxDte ? pass() : fail('DTE_OUTSIDE_LATTICE'),
  /** Put delta is in [-1, 0]; the band is over |delta|, upper edge exclusive. A positive put delta is invalid evidence (UNKNOWN). */
  deltaBand: (delta: number | null, policy: QEntryFunnelPolicy): QGateResult => {
    if (!finite(delta)) return unknown('DELTA_UNKNOWN');
    // Q-DELTA-SIGN-001: a positive put delta is invalid evidence, never a magnitude (mirrors normalizeOptionContract).
    if (delta > 0 || delta < -1) return unknown('DELTA_SIGN_INVALID');
    const magnitude = Math.abs(delta);
    return policy.deltaBands.some(([low, high]) => magnitude >= low && magnitude < high)
      ? pass() : fail('DELTA_OUTSIDE_ALL_BANDS');
  },
  spread: (spreadPct: number | null, policy: QEntryFunnelPolicy): QGateResult => {
    if (!finite(spreadPct)) return unknown('SPREAD_UNKNOWN');
    return canonicalizeRatio(spreadPct) <= policy.maxSpreadPct ? pass() : fail('SPREAD_TOO_WIDE');
  },
  openInterest: (openInterest: number | null, policy: QEntryFunnelPolicy): QGateResult => {
    if (!finite(openInterest)) return unknown('OPEN_INTEREST_UNKNOWN');
    return openInterest >= policy.minOpenInterest ? pass() : fail('OPEN_INTEREST_BELOW_FLOOR');
  },
  volume: (volume: number | null, policy: QEntryFunnelPolicy): QGateResult => {
    if (!finite(volume)) return unknown('VOLUME_UNKNOWN');
    return volume >= policy.minVolume ? pass() : fail('VOLUME_BELOW_FLOOR');
  },
  quoteAge: (ageSeconds: number | null, policy: QEntryFunnelPolicy): QGateResult => {
    if (!finite(ageSeconds)) return unknown('QUOTE_AGE_UNKNOWN');
    if (ageSeconds < 0) return fail('QUOTE_TIMESTAMP_IN_FUTURE');
    return ageSeconds <= policy.candidateQuoteMaxAgeSeconds ? pass() : fail('QUOTE_STALE');
  },
  /** Orchestrator freshness classification: STALE at age >= staleMinimumSeconds; DEGRADED still proceeds. */
  quoteFreshness: (ageSeconds: number | null, policy: QEntryFunnelPolicy): QGateResult => {
    if (!finite(ageSeconds)) return unknown('OPTION_QUOTE_UNKNOWN');
    if (ageSeconds < 0) return fail('OPTION_QUOTE_INVALID');
    return ageSeconds >= policy.staleQuoteMinimumSeconds ? fail('OPTION_QUOTE_STALE') : pass();
  },
  earnings: (distanceSessions: number | null, policy: QEntryFunnelPolicy): QGateResult =>
    distanceSessions !== null && finite(distanceSessions) && distanceSessions <= policy.earningsExclusionDays
      ? fail('EARNINGS_TOO_NEAR') : pass(),
};

/**
 * Whole contracts the buying power can secure at strike * multiplier. UNKNOWN
 * inputs stay UNKNOWN; zero is a valid result and is never floored to one.
 */
export function modelAffordableContracts(buyingPower: number | null, collateralPerContract: number): number | null {
  if (!finite(buyingPower) || buyingPower < 0 || !finite(collateralPerContract) || collateralPerContract <= 0) return null;
  return wholeContractsAffordable(buyingPower, collateralPerContract);
}

/** AEGIS single-underlying concentration family (aegis.py _threshold_assessment) for ONE new contract. */
export function modelAegisConcentrationState(input: {
  readonly collateral: number; readonly equity: number | null; readonly policy: QEntryFunnelPolicy;
}): QFunnelAegisState {
  if (!finite(input.equity) || input.equity <= 0 || !finite(input.collateral)) return null;
  const exposure = input.collateral / input.equity;
  if (exposure >= input.policy.aegisTickerSoftCapPct * input.policy.aegisHardCapMultiplier) return 'HARD_VETO';
  if (exposure >= input.policy.aegisTickerSoftCapPct) return 'ALLOW_REDUCED';
  return 'ALLOW_FULL';
}

/** Mirrors canonical-strategy-frontier.ts structuralSizing for OPEN_CSP (parity-tested). */
export function modelQFinalQuantity(input: {
  readonly collateral: number; readonly buyingPower: number | null; readonly brokerAllowedQty: number;
  readonly aegisState: QFunnelAegisState; readonly policy: QEntryFunnelPolicy;
}): { readonly quantity: number; readonly bindingConstraint: string } {
  const affordable = modelAffordableContracts(input.buyingPower, input.collateral);
  if (affordable === null) return { quantity: 0, bindingConstraint: 'COLLATERAL_INPUT_UNKNOWN' };
  const caps: [string, number][] = [...Object.entries(input.policy.quantityCaps), ['BROKER_ALLOWED', input.brokerAllowedQty],
    ['BUYING_POWER_AFFORDABLE', affordable], ['REAL_ASSIGNMENT_CAPACITY', affordable]];
  let [binding, quantity] = caps[0] as [string, number];
  for (const [name, value] of caps.slice(1)) if (value < quantity) [binding, quantity] = [name, value];
  if (input.aegisState === null) return { quantity: 0, bindingConstraint: 'AEGIS_UNKNOWN' };
  if (['HOLD_ONLY', 'HARD_VETO', 'EMERGENCY_EXIT_ONLY', 'DEFINED_RISK_ONLY'].includes(input.aegisState)) {
    return { quantity: 0, bindingConstraint: `AEGIS_${input.aegisState}` };
  }
  if (input.aegisState === 'ALLOW_REDUCED') {
    return { quantity: Math.floor(quantity * input.policy.reducedStateMultiplier), bindingConstraint: 'AEGIS_ALLOW_REDUCED' };
  }
  return { quantity, bindingConstraint: binding };
}

// ---------------------------------------------------------------------------
// Funnel construction.
// ---------------------------------------------------------------------------

export interface QFunnelStageReceipt {
  readonly stageId: QFunnelStageId;
  readonly order: number;
  readonly category: QFunnelCategory;
  readonly INPUT_COUNT: number;
  readonly PASS_COUNT: number;
  readonly FAIL_COUNT: number;
  readonly UNKNOWN_COUNT: number;
  readonly NOT_APPLICABLE_COUNT: number;
  readonly reasonCounts: Readonly<Record<string, number>>;
}

export interface QFunnelCandidateRecord {
  readonly candidateId: string;
  readonly optionSymbol: string;
  readonly terminalStage: QFunnelStageId | 'COMPLETED';
  readonly terminalVerdict: 'FAIL' | 'UNKNOWN' | 'COMPLETED';
  readonly terminalReasons: readonly string[];
  /** Every independently failing/unknown gate, regardless of sequential masking. */
  readonly allFindings: readonly string[];
}

export type QFunnelDominantBlocker =
  | 'Q_STRICTNESS' | 'LIQUIDITY' | 'EVENTS' | 'CAPITAL' | 'AEGIS' | 'INSTRUMENT_APPROVAL' | 'SHORTLIST_BOUND'
  | 'ENTRY_ELIGIBILITY' | 'DATA_UNKNOWN' | 'SIZING' | 'IDENTITY' | 'MULTIPLE' | 'NONE_QTY_POSITIVE' | 'NO_INPUT';

export interface QEntryFunnelReceipt {
  readonly contractVersion: typeof qEntryFunnelVersion;
  readonly stages: readonly QFunnelStageReceipt[];
  readonly independentGates: Readonly<Record<string, { readonly FAIL_COUNT: number; readonly UNKNOWN_COUNT: number }>>;
  readonly candidates: readonly QFunnelCandidateRecord[];
  readonly totals: {
    readonly INPUT_CONTRACTS: number;
    /** Cleared every structural gate (identity .. event window). */
    readonly Q_VALID: number;
    readonly FINALIST_REACHED: number | null;
    /** Candidates that reached the AEGIS stage (cleared structure, shortlist, eligibility and capital). */
    readonly AEGIS_REACHED: number;
    readonly AEGIS_PASS: number | null;
    readonly CAPITAL_FIT: number | null;
    readonly FINAL_QTY_POSITIVE: number | null;
  };
  /** First stage at which no candidate survives, or null if some candidate completes. */
  readonly extinctionStage: QFunnelStageId | null;
  readonly dominantBlocker: QFunnelDominantBlocker;
  readonly dominantBlockerShare: number | null;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly executionAuthorized: false;
  readonly contentHash: string;
}

type StageEvaluator = (c: QFunnelCandidateFacts) => QGateResult;

function stageEvaluators(policy: QEntryFunnelPolicy, account: QFunnelAccount): Readonly<Record<QFunnelStageId, StageEvaluator>> {
  return {
    PUT_CONTRACT_IDENTITY: (c) => {
      if (c.optionType !== 'PUT') return fail('NOT_A_PUT');
      if (c.occSymbol === null) return unknown('OCC_IDENTITY_UNKNOWN');
      if (c.multiplier === null) return unknown('MULTIPLIER_UNKNOWN');
      return c.multiplier === 100 ? pass() : fail('CONTRACT_NON_STANDARD');
    },
    INSTRUMENT_APPROVAL: () => account.instrumentApproval.state === 'APPROVED' ? pass()
      : account.instrumentApproval.state === 'NOT_APPROVED'
        ? fail(account.instrumentApproval.reason ?? 'INSTRUMENT_NOT_APPROVED')
        : unknown(account.instrumentApproval.reason ?? 'INSTRUMENT_APPROVAL_UNKNOWN'),
    EXECUTABLE_ALPACA_QUOTE: (c) => {
      if (c.quoteSource !== 'ALPACA') return fail('QUOTE_AUTHORITY_INVALID');
      if (c.executable) return pass();
      return fail('CONTRACT_NOT_EXECUTABLE', ...c.nonExecutableCauses);
    },
    DELTA_KNOWN: (c) => finite(c.delta) ? pass() : unknown('DELTA_UNKNOWN'),
    QUOTE_FRESHNESS: (c) => qGates.quoteFreshness(c.quoteAgeSeconds, policy),
    DTE_WINDOW: (c) => qGates.dte(c.dte, policy),
    DELTA_BAND: (c) => qGates.deltaBand(c.delta, policy),
    SPREAD: (c) => qGates.spread(c.spreadPct, policy),
    OPEN_INTEREST: (c) => qGates.openInterest(c.openInterest, policy),
    VOLUME: (c) => qGates.volume(c.volume, policy),
    PREMIUM_ECONOMICS: (c) => {
      if (policy.minimumPremiumPerShare === undefined) return notApplicable('NO_PRODUCTION_PREMIUM_GATE');
      if (!finite(c.bid)) return unknown('BID_UNKNOWN');
      return c.bid >= policy.minimumPremiumPerShare ? pass() : fail('PREMIUM_BELOW_RESEARCH_FLOOR');
    },
    QUOTE_AGE_BUDGET: (c) => qGates.quoteAge(c.quoteAgeSeconds, policy),
    EVENT_WINDOW: (c) => {
      if (c.eventState === 'NOT_APPLICABLE') return notApplicable('EVENT_POLICY_NOT_APPLICABLE');
      if (c.eventState === 'BLOCK') return fail('EVENT_WINDOW_BLOCK');
      if (c.eventState === 'UNKNOWN') return unknown('EVENT_COVERAGE_UNKNOWN');
      return qGates.earnings(c.earningsDistanceSessions, policy);
    },
    FINALIST_SHORTLIST: (c) => c.finalist === undefined ? notApplicable('SHORTLIST_NOT_MODELED')
      : c.finalist ? pass() : fail('NOT_SELECTED_FOR_FINALIST_REFRESH'),
    ENTRY_ELIGIBILITY: (c) => c.entryBasis === undefined ? notApplicable('ELIGIBILITY_NOT_OBSERVED')
      : c.entryBasis === 'INELIGIBLE' ? fail('ENTRY_ELIGIBILITY_INELIGIBLE') : pass(),
    CAPITAL_FIT: (c) => {
      const affordable = modelAffordableContracts(account.buyingPower, c.strike * (c.multiplier ?? 100));
      if (affordable === null) return unknown('BUYING_POWER_OR_COLLATERAL_UNKNOWN');
      return affordable >= 1 ? pass() : fail('BUYING_POWER_BELOW_ONE_CONTRACT_COLLATERAL');
    },
    AEGIS: (c) => {
      if (c.aegisState === undefined) return notApplicable('AEGIS_NOT_MODELED');
      if (c.aegisState === 'NOT_REACHED') return unknown('AEGIS_NOT_REACHED_UPSTREAM');
      if (c.aegisState === null) return unknown('AEGIS_UNKNOWN');
      if (c.aegisState === 'ALLOW_FULL' || c.aegisState === 'ALLOW_REDUCED') return pass();
      return fail(...(c.aegisReasons !== undefined && c.aegisReasons.length > 0 ? c.aegisReasons : [`AEGIS_${c.aegisState}`]));
    },
    FINAL_QUANTITY: (c) => {
      if (c.finalQuantity === undefined) return notApplicable('QUANTITY_NOT_OBSERVED');
      if (c.finalQuantity === null) return unknown('QUANTITY_UNKNOWN');
      return c.finalQuantity >= 1 ? pass() : fail(c.finalQuantityBinding ?? 'QUANTITY_ZERO_VALID');
    },
  };
}

const independentGateIds: readonly QFunnelStageId[] = [
  'EXECUTABLE_ALPACA_QUOTE', 'DELTA_KNOWN', 'QUOTE_FRESHNESS', 'DTE_WINDOW', 'DELTA_BAND', 'SPREAD', 'OPEN_INTEREST',
  'VOLUME', 'PREMIUM_ECONOMICS', 'QUOTE_AGE_BUDGET', 'EVENT_WINDOW', 'CAPITAL_FIT',
];

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const sortedRecord = (counts: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));

export function buildQEntryFunnel(input: {
  readonly policy: QEntryFunnelPolicy;
  readonly account: QFunnelAccount;
  readonly candidates: readonly QFunnelCandidateFacts[];
}): QEntryFunnelReceipt {
  const evaluators = stageEvaluators(input.policy, input.account);
  const ordered = [...input.candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const ids = ordered.map((candidate) => candidate.candidateId);
  if (new Set(ids).size !== ids.length) throw new Error('Q_FUNNEL_DUPLICATE_CANDIDATE_ID');

  let alive = ordered;
  const records = new Map<string, { stage: QFunnelStageId | 'COMPLETED'; verdict: 'FAIL' | 'UNKNOWN' | 'COMPLETED'; reasons: readonly string[] }>();
  const stages: QFunnelStageReceipt[] = [];
  const survivorsAt = new Map<QFunnelStageId, number>();
  qFunnelStageOrder.forEach((stageId, index) => {
    const reasonCounts = new Map<string, number>();
    let passes = 0, fails = 0, unknowns = 0, notApplicables = 0;
    const next: QFunnelCandidateFacts[] = [];
    for (const candidate of alive) {
      const result = (evaluators[stageId] as StageEvaluator)(candidate);
      for (const reason of result.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      if (result.verdict === 'PASS') { passes++; next.push(candidate); }
      else if (result.verdict === 'NOT_APPLICABLE') { notApplicables++; next.push(candidate); }
      else {
        if (result.verdict === 'FAIL') fails++; else unknowns++;
        records.set(candidate.candidateId, { stage: stageId, verdict: result.verdict, reasons: result.reasons });
      }
    }
    stages.push({ stageId, order: index + 1, category: stageCategory[stageId], INPUT_COUNT: alive.length,
      PASS_COUNT: passes, FAIL_COUNT: fails, UNKNOWN_COUNT: unknowns, NOT_APPLICABLE_COUNT: notApplicables,
      reasonCounts: sortedRecord(reasonCounts) });
    alive = next;
    survivorsAt.set(stageId, alive.length);
  });
  for (const candidate of alive) records.set(candidate.candidateId, { stage: 'COMPLETED', verdict: 'COMPLETED', reasons: [] });

  // Independent gate evaluation: every candidate that is a real PUT contract on
  // the stage-1 identity, against every gate -- masking-free diagnostics.
  const independentGates: Record<string, { FAIL_COUNT: number; UNKNOWN_COUNT: number }> = {};
  const allFindingsById = new Map<string, string[]>();
  for (const stageId of independentGateIds) independentGates[stageId] = { FAIL_COUNT: 0, UNKNOWN_COUNT: 0 };
  for (const candidate of ordered) {
    const findings: string[] = [];
    if (evaluators.PUT_CONTRACT_IDENTITY(candidate).verdict !== 'PASS') {
      allFindingsById.set(candidate.candidateId, evaluators.PUT_CONTRACT_IDENTITY(candidate).reasons.map((r) => `PUT_CONTRACT_IDENTITY:${r}`));
      continue;
    }
    for (const stageId of independentGateIds) {
      const result = (evaluators[stageId] as StageEvaluator)(candidate);
      if (result.verdict === 'FAIL') { (independentGates[stageId] as { FAIL_COUNT: number }).FAIL_COUNT++; findings.push(...result.reasons.map((r) => `${stageId}:${r}`)); }
      if (result.verdict === 'UNKNOWN') { (independentGates[stageId] as { UNKNOWN_COUNT: number }).UNKNOWN_COUNT++; findings.push(...result.reasons.map((r) => `${stageId}:${r}`)); }
    }
    allFindingsById.set(candidate.candidateId, findings);
  }

  const candidates: QFunnelCandidateRecord[] = ordered.map((candidate) => {
    const record = records.get(candidate.candidateId) as { stage: QFunnelStageId | 'COMPLETED'; verdict: 'FAIL' | 'UNKNOWN' | 'COMPLETED'; reasons: readonly string[] };
    return { candidateId: candidate.candidateId, optionSymbol: candidate.optionSymbol, terminalStage: record.stage,
      terminalVerdict: record.verdict, terminalReasons: record.reasons,
      allFindings: allFindingsById.get(candidate.candidateId) ?? [] };
  });

  const passedCount = (stageId: QFunnelStageId): number => survivorsAt.get(stageId) ?? 0;
  const stageNotModeled = (stageId: QFunnelStageId): boolean => {
    const stage = stages.find((item) => item.stageId === stageId) as QFunnelStageReceipt;
    return stage.INPUT_COUNT > 0 && stage.NOT_APPLICABLE_COUNT === stage.INPUT_COUNT;
  };
  const totals = {
    INPUT_CONTRACTS: ordered.length,
    Q_VALID: passedCount('EVENT_WINDOW'),
    FINALIST_REACHED: stageNotModeled('FINALIST_SHORTLIST') ? null : passedCount('FINALIST_SHORTLIST'),
    AEGIS_REACHED: (stages.find((stage) => stage.stageId === 'AEGIS') as QFunnelStageReceipt).INPUT_COUNT,
    AEGIS_PASS: stageNotModeled('AEGIS') ? null : passedCount('AEGIS'),
    CAPITAL_FIT: passedCount('CAPITAL_FIT'),
    FINAL_QTY_POSITIVE: stageNotModeled('FINAL_QUANTITY') ? null : passedCount('FINAL_QUANTITY'),
  };

  const completed = candidates.filter((record) => record.terminalStage === 'COMPLETED').length;
  const categoryMap = new Map<string, number>();
  for (const record of candidates) {
    if (record.terminalStage === 'COMPLETED') continue;
    const category = record.terminalVerdict === 'UNKNOWN' && stageCategory[record.terminalStage] !== 'LIQUIDITY'
      && stageCategory[record.terminalStage] !== 'CAPITAL' && stageCategory[record.terminalStage] !== 'AEGIS'
      && stageCategory[record.terminalStage] !== 'EVENTS' && stageCategory[record.terminalStage] !== 'INSTRUMENT_APPROVAL'
      ? 'DATA_UNKNOWN' : stageCategory[record.terminalStage];
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
  }
  const extinction = stages.find((stage) => stage.INPUT_COUNT > 0 && stage.PASS_COUNT + stage.NOT_APPLICABLE_COUNT === 0);
  const extinctionStage = completed === 0 && ordered.length > 0 ? (extinction?.stageId ?? null) : null;

  let dominantBlocker: QFunnelDominantBlocker;
  let dominantBlockerShare: number | null = null;
  if (ordered.length === 0) dominantBlocker = 'NO_INPUT';
  else if (completed > 0) dominantBlocker = 'NONE_QTY_POSITIVE';
  else {
    // Q-valid candidates exist: the operative cause of inactivity is where
    // they died (capital, AEGIS, sizing, shortlist, eligibility, approval).
    // Otherwise the single category holding a strict majority of attributions
    // wins, and a split attribution is reported as MULTIPLE, never hidden.
    const total = [...categoryMap.values()].reduce((a, b) => a + b, 0);
    const [topCategory, topCount] = [...categoryMap.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] as [string, number];
    if (totals.Q_VALID > 0 && extinction !== undefined) {
      dominantBlocker = extinction.category as QFunnelDominantBlocker;
      dominantBlockerShare = totals.Q_VALID / ordered.length;
    } else {
      dominantBlocker = (topCount / total > 0.5 ? topCategory : 'MULTIPLE') as QFunnelDominantBlocker;
      dominantBlockerShare = topCount / total;
    }
  }

  const body = {
    contractVersion: qEntryFunnelVersion, stages, independentGates, candidates, totals, extinctionStage,
    dominantBlocker, dominantBlockerShare, categoryCounts: sortedRecord(categoryMap), executionAuthorized: false as const,
  };
  return { ...body, contentHash: createHash('sha256').update(stable(body)).digest('hex') };
}

/** Funnel stage invariant used by tests and by any consumer persisting the receipt. */
export function qFunnelInvariantViolations(receipt: QEntryFunnelReceipt): readonly string[] {
  const violations: string[] = [];
  let previousSurvivors: number | null = null;
  for (const stage of receipt.stages) {
    if (stage.INPUT_COUNT !== stage.PASS_COUNT + stage.FAIL_COUNT + stage.UNKNOWN_COUNT + stage.NOT_APPLICABLE_COUNT) {
      violations.push(`${stage.stageId}:COUNT_IDENTITY`);
    }
    if (previousSurvivors !== null && stage.INPUT_COUNT !== previousSurvivors) violations.push(`${stage.stageId}:INPUT_NOT_PREVIOUS_SURVIVORS`);
    previousSurvivors = stage.PASS_COUNT + stage.NOT_APPLICABLE_COUNT;
  }
  for (const record of receipt.candidates) {
    if (record.terminalVerdict !== 'COMPLETED' && record.terminalReasons.length === 0) violations.push(`${record.candidateId}:BLOCKED_WITHOUT_REASON`);
    if (record.terminalReasons.includes('NO_QUALIFYING_CANDIDATE')) violations.push(`${record.candidateId}:GENERIC_REASON`);
  }
  return violations;
}

/**
 * Q-FUNNEL-001: bounded, additive projection of the funnel receipt for the cycle result and runtime diagnostic. The per-candidate
 * list (thousands of rows on a full chain) is NOT carried; it is represented by exact terminal-reason counts (at most
 * `maxTerminalReasonKeys` keys, the remainder aggregated under OTHER) and by the full receipt's content hash. Diagnostic only:
 * it never decides, sizes or authorizes anything.
 */
export const qEntryFunnelSummaryVersion = 'theta-q-entry-funnel-summary-v1' as const;
export const maxQFunnelTerminalReasonKeys = 25;

export interface QEntryFunnelSummary {
  readonly contractVersion: typeof qEntryFunnelSummaryVersion;
  readonly funnelContractVersion: typeof qEntryFunnelVersion;
  readonly fullReceiptHash: string;
  readonly stages: readonly QFunnelStageReceipt[];
  readonly independentGates: QEntryFunnelReceipt['independentGates'];
  readonly totals: QEntryFunnelReceipt['totals'];
  readonly extinctionStage: QFunnelStageId | null;
  readonly dominantBlocker: QFunnelDominantBlocker;
  readonly dominantBlockerShare: number | null;
  readonly categoryCounts: Readonly<Record<string, number>>;
  readonly terminalReasonCounts: Readonly<Record<string, number>>;
  readonly executionAuthorized: false;
}

export function summarizeQEntryFunnel(receipt: QEntryFunnelReceipt): QEntryFunnelSummary {
  const counts = new Map<string, number>();
  for (const record of receipt.candidates) {
    const key = `${record.terminalStage}:${record.terminalReasons.join('+') || 'COMPLETED'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = ranked.slice(0, maxQFunnelTerminalReasonKeys);
  const other = ranked.slice(maxQFunnelTerminalReasonKeys).reduce((sum, [, count]) => sum + count, 0);
  const terminalReasonCounts = sortedRecord(new Map(other > 0 ? [...kept, ['OTHER', other] as [string, number]] : kept));
  return {
    contractVersion: qEntryFunnelSummaryVersion, funnelContractVersion: receipt.contractVersion, fullReceiptHash: receipt.contentHash,
    stages: receipt.stages, independentGates: receipt.independentGates, totals: receipt.totals,
    extinctionStage: receipt.extinctionStage, dominantBlocker: receipt.dominantBlocker, dominantBlockerShare: receipt.dominantBlockerShare,
    categoryCounts: receipt.categoryCounts, terminalReasonCounts, executionAuthorized: false,
  };
}

/** Pure construction of the cycle funnel summary from what the cycle already holds. Returns null when there is nothing to attribute. */
export function buildCycleQEntryFunnelSummary(input: {
  readonly contracts: readonly NormalizedOptionContract[];
  readonly account: QFunnelAccount;
  readonly eventState: QFunnelCandidateFacts['eventState'];
  readonly earningsDistanceSessions: number | null;
  readonly conventionalCandidates: readonly {
    readonly optionSymbol: string;
    readonly aegisState: QFunnelAegisState;
    readonly aegisBindingReasons: readonly string[];
    readonly quantity: number;
    readonly bindingConstraint: string;
    readonly shortlistState: 'FINALIST' | 'NOT_SELECTED' | 'UNKNOWN';
    readonly entryBasis: 'EMPIRICAL_OWNERSHIP' | 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED' | 'INELIGIBLE' | undefined;
  }[];
}): QEntryFunnelSummary | null {
  const puts = input.contracts.filter((contract) => contract.optionType === 'PUT');
  if (puts.length === 0) return null;
  const bySymbol = new Map(input.conventionalCandidates.map((candidate) => [candidate.optionSymbol, candidate]));
  const candidates = puts.map((contract): QFunnelCandidateFacts => {
    const facts = qFunnelFactsFromContract(contract, { eventState: input.eventState, earningsDistanceSessions: input.earningsDistanceSessions });
    const modeled = bySymbol.get(contract.optionSymbol);
    if (modeled === undefined) return facts;
    return {
      ...facts,
      ...(modeled.shortlistState === 'UNKNOWN' ? {} : { finalist: modeled.shortlistState === 'FINALIST' }),
      ...(modeled.entryBasis === undefined ? {} : { entryBasis: modeled.entryBasis }),
      aegisState: modeled.bindingConstraint === 'AEGIS_NOT_REACHED_UPSTREAM' ? 'NOT_REACHED' : modeled.aegisState,
      aegisReasons: modeled.aegisBindingReasons, finalQuantity: modeled.quantity, finalQuantityBinding: modeled.bindingConstraint,
    };
  });
  return summarizeQEntryFunnel(buildQEntryFunnel({ policy: qEntryFunnelPolicyFromRuntimePolicy(), account: input.account, candidates }));
}
