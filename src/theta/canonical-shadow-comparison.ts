import type { CanonicalStrategyFrontier, CanonicalFrontierCandidate } from './canonical-strategy-frontier.js';
import { parseOccOptionSymbol } from './account-exposure.js';
import { cashSecuredPutMaxLossAtZero, compareCrossStrategy, ENTRY_WHOLE_CHAIN_V1,
  unknownDatum, type CandidateComparisonInput } from '../research/cross-strategy-common-horizon-contract.js';

export const canonicalShadowComparisonVersion = 'theta-canonical-shadow-comparison-v1' as const;
const required = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error('SHADOW_VALIDATION_INVARIANT');
  return value;
};

/** Analytical one-lot normalization is not an executable size recommendation.
 * Existing candidate quantities, risk results and the sovereign Q action are untouched.
 * Exact expiration cohorts avoid silently inventing reinvestment after H expires.
 */
export function buildCanonicalShadowComparison(frontier: Pick<CanonicalStrategyFrontier, 'timestamp' | 'snapshotId' | 'branches'>) {
  const excluded: { candidateId: string; reasons: string[] }[] = [];
  const groups = new Map<string, CandidateComparisonInput[]>();
  const decisionMs = Date.parse(frontier.timestamp);
  const ids = new Map<string, number>();
  const candidates = frontier.branches.flatMap((branch) => branch.candidates)
    .filter((c) => ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'].includes(c.branch));
  for (const c of candidates) ids.set(c.candidateId, (ids.get(c.candidateId) ?? 0) + 1);
  for (const c of [...candidates].sort((a, b) => a.candidateId.localeCompare(b.candidateId))) {
    const reasons = validateCandidate(c, decisionMs);
    if (ids.get(c.candidateId) !== 1) reasons.push('DUPLICATE_CANDIDATE_ID');
    if (reasons.length) { excluded.push({ candidateId: c.candidateId, reasons }); continue; }
    const leg = required(c.legs[0]);
    const expiry = leg.expiration;
    const credit = c.legs.reduce((total, l) => total + (l.positionIntent === 'SELL_TO_OPEN' ? required(l.bid) : -required(l.ask)), 0);
    const width = c.legs.length === 2 ? Math.abs(leg.strike - required(c.legs[1]).strike) : null;
    const maxLoss = width === null ? cashSecuredPutMaxLossAtZero(leg.strike, credit, leg.multiplier, 1)
      : Math.max(0, width - credit) * leg.multiplier;
    const capital = width === null ? leg.strike * leg.multiplier : maxLoss;
    const projected: CandidateComparisonInput = {
      candidateId: c.candidateId, quantity: 1,
      context: { decisionTimestamp: frontier.timestamp, comparisonHorizonStart: frontier.timestamp,
        comparisonHorizonEnd: expiry, horizonDefinitionVersion: 'same-expiration-terminal-payoff-v1',
        basis: 'PER_CONTRACT', currency: 'USD' },
      deterministic: { action: c.action, strategy: c.branch, underlying: c.underlying,
        structureClass: width === null ? 'CASH_SECURED_SINGLE_LEG' : 'STRUCTURALLY_DEFINED_RISK_SPREAD',
        contractIdentities: c.legs.map((l) => l.optionSymbol), dte: c.dte, strikes: c.legs.map((l) => l.strike),
        executableOpenCreditDebit: credit * leg.multiplier, multiplier: leg.multiplier,
        collateral: capital, buyingPowerImpact: null, maxLoss, breakEven: c.economics.breakEven,
        downsideCushion: c.economics.downsideCushion, width,
        bidAskSpread: c.legs.reduce((sum, l) => sum + (required(l.ask) - required(l.bid)) * l.multiplier, 0),
        estimatedEntryExecutionCost: null, capitalRequirement: capital },
      empirical: { expectedAfterCostWholeChainPnl: null, probabilityProfitable: null,
        probabilityAssignment: unknownDatum('EV_MODEL_NOT_EMPIRICALLY_READY'),
        expectedAssignmentBurden: unknownDatum('EV_MODEL_NOT_EMPIRICALLY_READY'),
        expectedRecoveryDuration: unknownDatum('EV_MODEL_NOT_EMPIRICALLY_READY'),
        expectedCapitalDays: null, expectedShortfall: null, cvar: null, maxDrawdown: null,
        concentrationImpact: null, expectedTca: null, calibratedUncertainty: null },
    };
    const key = `${c.underlying}:${expiry}`;
    const group = groups.get(key) ?? [];
    group.push(projected); groups.set(key, group);
  }
  const cohorts = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cohortId, members]) => ({
    cohortId, candidates: members, comparison: compareCrossStrategy(members, ENTRY_WHOLE_CHAIN_V1),
    structuralParetoCandidateIds: members.filter((c) => !members.some((other) => {
      const vector = (item: CandidateComparisonInput) => [required(item.deterministic.executableOpenCreditDebit),
        -required(item.deterministic.capitalRequirement), -required(item.deterministic.maxLoss), -required(item.deterministic.bidAskSpread)];
      const a = vector(other); const b = vector(c);
      return a.every((v, i) => v >= required(b[i])) && a.some((v, i) => v > required(b[i]));
    })).map((c) => c.candidateId),
    structuralParetoMeaning: 'CREDIT_CAPITAL_THEORETICAL_MAX_LOSS_SPREAD_ONLY_NOT_EXPECTED_UTILITY',
    sourceCandidateIds: members.map((c) => c.candidateId),
    waitAlternative: { action: 'WAIT', incrementalOptionCashFlow: 0, incrementalOptionCollateral: 0,
      opportunityCost: null, reason: 'NO_NEW_POSITION_NOT_ZERO_OPPORTUNITY_COST' },
  }));
  const hasPeers = cohorts.some((c) => c.candidates.length > 1);
  return {
    version: canonicalShadowComparisonVersion, snapshotId: frontier.snapshotId, decisionAsOf: frontier.timestamp,
    state: hasPeers ? 'STRUCTURAL_COMPARISON' as const : 'NO_COMPARISON' as const,
    basis: 'ONE_ANALYTICAL_LOT_NOT_ORDER_QUANTITY', cohorts, excluded,
    enumerationComplete: frontier.branches.filter((b) => b.applicable)
      .every((b) => b.evaluated && !b.enumerationTruncated),
    crossHorizonState: 'NO_COMPARISON_FORWARD_COMMON_HORIZON_EVIDENCE_REQUIRED',
    profitabilityWinner: null, empiricalState: 'EV_MODEL_NOT_EMPIRICALLY_READY',
    brokerAuthority: false as const, executionAuthorized: false as const,
  };
}

function validateCandidate(c: CanonicalFrontierCandidate, decisionMs: number): string[] {
  const reasons: string[] = [];
  if (!Number.isFinite(decisionMs)) reasons.push('INVALID_DECISION_TIME');
  if (c.action !== 'OPEN_CSP' && c.action !== 'OPEN_DEFINED_RISK') reasons.push('UNSUPPORTED_ACTION');
  if (c.legs.length !== (c.action === 'OPEN_CSP' ? 1 : 2)) reasons.push('INVALID_LEG_COUNT');
  if (!c.structurallyFeasible) reasons.push('STRUCTURALLY_INFEASIBLE');
  if (c.dte === null || !Number.isFinite(c.dte) || c.dte < 0) reasons.push('DTE_UNKNOWN_OR_INVALID');
  for (const leg of c.legs) {
    const identity = leg.occSymbol ? parseOccOptionSymbol(leg.occSymbol) : null;
    if (!identity || leg.occSymbol !== leg.optionSymbol || identity.underlying !== c.underlying
      || identity.expiration !== leg.expiration || identity.strike !== leg.strike || identity.optionType !== leg.optionType) {
      reasons.push('CONTRACT_IDENTITY_MISMATCH');
    }
    if (!leg.optionSymbol || !leg.occSymbol || leg.contractTradable !== true
      || leg.deliverableClassification !== 'STANDARD_EQUITY') reasons.push('CONTRACT_IDENTITY_OR_DELIVERABLE_UNVERIFIED');
    if (leg.optionType !== 'PUT' || !Number.isFinite(leg.strike) || leg.strike <= 0
      || !Number.isInteger(leg.multiplier) || leg.multiplier <= 0) reasons.push('INVALID_CONTRACT');
    if (leg.bid === null || leg.ask === null || !Number.isFinite(leg.bid) || !Number.isFinite(leg.ask)
      || leg.bid <= 0 || leg.ask < leg.bid) reasons.push('INVALID_BBO');
    const quoteMs = leg.quoteTimestamp === null ? NaN : Date.parse(leg.quoteTimestamp);
    if (!Number.isFinite(quoteMs) || quoteMs > decisionMs) reasons.push('QUOTE_TIME_INVALID_OR_FUTURE');
    // No new freshness policy: the canonical structural gate owns executable freshness.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(leg.expiration) || !Number.isFinite(Date.parse(leg.expiration))
      || Date.parse(`${leg.expiration}T23:59:59Z`) < decisionMs) reasons.push('INVALID_EXPIRATION');
    else if (new Date(leg.expiration).toISOString().slice(0, 10) !== leg.expiration) reasons.push('INVALID_EXPIRATION');
  }
  if (new Set(c.legs.map((l) => l.optionSymbol)).size !== c.legs.length) reasons.push('DUPLICATE_LEG');
  if (new Set(c.legs.map((l) => l.expiration)).size > 1 || new Set(c.legs.map((l) => l.multiplier)).size > 1) {
    reasons.push('LEG_HORIZON_OR_MULTIPLIER_MISMATCH');
  }
  if (c.action === 'OPEN_CSP' && c.legs[0]?.positionIntent !== 'SELL_TO_OPEN') reasons.push('INVALID_CSP_STRUCTURE');
  if (c.action === 'OPEN_CSP' && c.legs[0]?.bid !== null && c.legs[0]?.bid !== undefined
    && c.legs[0].bid >= c.legs[0].strike) reasons.push('INVALID_CSP_PREMIUM');
  if (c.action === 'OPEN_DEFINED_RISK') {
    const short = c.legs.find((l) => l.positionIntent === 'SELL_TO_OPEN');
    const long = c.legs.find((l) => l.positionIntent === 'BUY_TO_OPEN');
    if (!short || !long || short.strike <= long.strike) reasons.push('INVALID_CREDIT_SPREAD_STRUCTURE');
    else if (short.bid !== null && long.ask !== null && (short.bid <= long.ask || short.bid - long.ask >= short.strike - long.strike)) {
      reasons.push('INVALID_CREDIT_SPREAD_PREMIUM');
    }
  }
  return [...new Set(reasons)].sort();
}
