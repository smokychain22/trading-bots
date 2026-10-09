import { createHash } from 'node:crypto';
import { classifyDefinedRiskExpiry, type DefinedRiskExpiryState } from './defined-risk-lifecycle.js';
import type { DefinedRiskExposure, DefinedRiskPositionState } from './defined-risk-position.js';
import type { DefinedRiskManagementProposal } from '../theta/management-action-frontier.js';

// Management of ONE native spread. This module only DECIDES; it never touches the broker. It is the D branch of the single management authority: a close is proposed here,
// persisted as a decision, turned into an order intent by the close command builder and submitted ONLY by PaperOrderCoordinator.
//
// Scope is deliberately SAFETY: expiry/pin/assignment risk, event / AEGIS / liquidity deterioration, broker-vs-ledger leg divergence. No profit-target or stop-loss number is
// invented here (those are owner policy and require empirical evidence, TRD section 40); without them a healthy spread is simply HELD to its safety deadline.

export const definedRiskManagementVersion = 'theta-defined-risk-management-v1' as const;

export type DefinedRiskManagementAction =
  | 'HOLD'                        // keep the spread; includes "close required but not executable right now" (see closeRequired)
  | 'CLOSE_FULL'                  // close BOTH legs as one native package, quantity = hedged spreads
  | 'EMERGENCY_UNHEDGED_SHORT'    // a short put has no long behind it; flatten risk is required (escalation-only, see runner)
  | 'EMERGENCY_UNRESOLVABLE'      // e.g. short stock from a one-leg exercise: not auto-fixable by an option order
  | 'WAIT_FOR_BROKER_TRUTH'       // evidence is unknown/stale/in flight; nothing may be inferred
  | 'NO_ACTION_TERMINAL';

export interface DefinedRiskLegQuoteEvidence { readonly symbol: string; readonly bid: number | null; readonly ask: number | null; readonly observedAt: string | null }

export interface DefinedRiskManagementInput {
  readonly orderIntentId: string;
  readonly chainId: string;
  readonly state: DefinedRiskPositionState;
  readonly exposure: DefinedRiskExposure;
  readonly shortSymbol: string;
  readonly longSymbol: string;
  readonly shortStrike: number;
  readonly longStrike: number;
  readonly observedAt: string;
  /** broker-reported OPEN contracts per leg (absolute); null = UNKNOWN (never assumed equal to the ledger) */
  readonly brokerOpenContracts: { readonly short: number | null; readonly long: number | null };
  readonly shortQuote: DefinedRiskLegQuoteEvidence | null;
  readonly longQuote: DefinedRiskLegQuoteEvidence | null;
  /** The authenticated source of both leg quotes. Unknown provenance cannot authorize a close. */
  readonly quoteFeed: 'OPRA' | 'INDICATIVE' | null;
  readonly spot: number | null;
  /** calendar days to expiration; null = UNKNOWN */
  readonly dte: number | null;
  readonly marketOpen: boolean | null;
  readonly closeOrderWorking: boolean;
  readonly context: { readonly eventState: 'CLEAR' | 'PRESENT' | 'UNKNOWN'; readonly aegisState: string | null; readonly executionQuality: 'GOOD' | 'DEGRADED' | 'UNKNOWN' };
  readonly pinBandPct: number;
  readonly maximumQuoteAgeSeconds: number;
}

export interface DefinedRiskManagementDecision {
  readonly contractVersion: typeof definedRiskManagementVersion;
  readonly orderIntentId: string;
  readonly chainId: string;
  readonly observedAt: string;
  readonly action: DefinedRiskManagementAction;
  /** a safety trigger demands a close even if it can not be executed this scan (then action is HOLD and quotesExecutable is false) */
  readonly closeRequired: boolean;
  readonly quotesExecutable: boolean;
  readonly expiryState: DefinedRiskExpiryState;
  readonly closeQuantity: number;
  readonly reasons: readonly string[];
  /** the position must be looked at again no later than this; persisted with the decision so a restart can not lose it */
  readonly reviewDeadline: string;
  /** true when a human must be told: emergency, or unknown evidence close to expiry */
  readonly escalate: boolean;
  readonly contentHash: string;
}

const HARD_AEGIS = new Set(['HARD_VETO', 'EMERGENCY_EXIT_ONLY']);

/** The D producer's output as a proposal to the ONE sovereign management frontier (v3). It never selects anything itself. */
export function definedRiskManagementProposal(decision: DefinedRiskManagementDecision, position: { readonly state: DefinedRiskPositionState;
  readonly exposure: DefinedRiskExposure }): DefinedRiskManagementProposal {
  const proposedAction = decision.action === 'EMERGENCY_UNHEDGED_SHORT' || decision.action === 'EMERGENCY_UNRESOLVABLE' ? 'EMERGENCY_RISK_REDUCTION' : decision.action;
  return { producerVersion: definedRiskManagementVersion, chainId: decision.chainId, orderIntentId: decision.orderIntentId, positionState: position.state,
    proposedAction, closeRequired: decision.closeRequired, quotesExecutable: decision.quotesExecutable, closeQuantity: decision.closeQuantity,
    nakedShortContracts: position.exposure.nakedShortContracts, reasons: decision.reasons, proposalHash: decision.contentHash };
}

const quoteExecutable = (quote: DefinedRiskLegQuoteEvidence | null, symbol: string, nowMs: number, maxAgeSeconds: number): boolean => {
  if (quote === null || quote.symbol !== symbol || quote.bid === null || quote.ask === null || quote.observedAt === null) return false;
  const age = (nowMs - Date.parse(quote.observedAt)) / 1000;
  return Number.isFinite(age) && age >= 0 && age <= maxAgeSeconds && quote.bid >= 0 && quote.ask > 0 && quote.ask >= quote.bid;
};

export function assessDefinedRiskManagement(input: DefinedRiskManagementInput): DefinedRiskManagementDecision {
  const nowMs = Date.parse(input.observedAt);
  if (!Number.isFinite(nowMs)) throw new Error('DEFINED_RISK_MANAGEMENT_TIME_INVALID');
  const feedQualified = input.quoteFeed === 'OPRA' || input.quoteFeed === 'INDICATIVE';
  const quotesExecutable = feedQualified && quoteExecutable(input.shortQuote, input.shortSymbol, nowMs, input.maximumQuoteAgeSeconds)
    && quoteExecutable(input.longQuote, input.longSymbol, nowMs, input.maximumQuoteAgeSeconds);
  const reviewMinutes = input.dte === null ? 1 : Math.min(15, Math.max(1, input.dte));
  const reviewDeadline = new Date(nowMs + reviewMinutes * 60_000).toISOString();
  const expiryState = classifyDefinedRiskExpiry({ spot: input.spot, shortStrike: input.shortStrike, longStrike: input.longStrike, dte: input.dte,
    marketOpen: input.marketOpen === true, pinBandPct: input.pinBandPct, shortAssignmentConfirmed: false, longExerciseConfirmed: false });
  const make = (action: DefinedRiskManagementAction, reasons: readonly string[], extra: { closeRequired?: boolean; escalate?: boolean; closeQuantity?: number } = {}): DefinedRiskManagementDecision => {
    const unsigned = { contractVersion: definedRiskManagementVersion, orderIntentId: input.orderIntentId, chainId: input.chainId, observedAt: input.observedAt, action,
      closeRequired: extra.closeRequired ?? false, quotesExecutable, expiryState, closeQuantity: extra.closeQuantity ?? 0, reasons, reviewDeadline, escalate: extra.escalate ?? false };
    return { ...unsigned, contentHash: createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') };
  };

  if (input.state === 'CLOSED' || input.state === 'EXPIRED_WORTHLESS' || input.state === 'STOCK_FROM_ASSIGNMENT') return make('NO_ACTION_TERMINAL', ['TERMINAL_STATE']);
  if (input.state === 'PENDING_OPEN') return make('WAIT_FOR_BROKER_TRUTH', ['OPEN_ORDER_NOT_YET_FILLED']);

  // 1. ledger-vs-broker: broker truth wins, and an unknown broker leg count is UNKNOWN, never "matches the ledger"
  const { short: brokerShort, long: brokerLong } = input.brokerOpenContracts;
  if (brokerShort === null || brokerLong === null) {
    const nearExpiry = input.dte !== null && input.dte <= 1;
    return make('WAIT_FOR_BROKER_TRUTH', ['BROKER_LEG_QUANTITY_UNKNOWN'], { escalate: nearExpiry || input.dte === null });
  }
  if (brokerShort !== input.exposure.shortOpen || brokerLong !== input.exposure.longOpen) {
    if (brokerShort > brokerLong) return make('EMERGENCY_UNHEDGED_SHORT', ['BROKER_SHOWS_UNHEDGED_SHORT_PUT', 'LEDGER_BROKER_LEG_MISMATCH'], { escalate: true });
    return make('WAIT_FOR_BROKER_TRUTH', ['LEDGER_BROKER_LEG_MISMATCH_NOT_UNHEDGED'], { escalate: true });
  }

  // 2. the position itself is in an emergency state
  if (input.state === 'DIVERGED_EMERGENCY') {
    return input.exposure.nakedShortContracts > 0
      ? make('EMERGENCY_UNHEDGED_SHORT', ['NAKED_SHORT_PUT_EXPOSURE'], { escalate: true })
      : make('EMERGENCY_UNRESOLVABLE', ['DIVERGED_STATE_NOT_AUTO_RESOLVABLE'], { escalate: true });
  }
  // 3. never create a second parent while a close is in flight
  if (input.closeOrderWorking) return make('HOLD', ['CLOSE_ORDER_IN_FLIGHT']);
  // 4. a leg without its partner is not the approved structure; it is held, loudly, and never closed as if it were a spread
  if (input.state === 'ASYMMETRIC_OPEN') return make('HOLD', ['ASYMMETRIC_LEG_STATE_REQUIRES_REVIEW'], { escalate: true });

  // 5. safety triggers on a hedged spread
  const triggers: string[] = [];
  if (expiryState === 'CLOSE_REQUIRED' || expiryState === 'PIN_RISK' || expiryState === 'ASSIGNMENT_RISK' || expiryState === 'EXERCISE_RELEVANT') triggers.push(`D_EXPIRY_${expiryState}`);
  if (input.context.eventState === 'PRESENT') triggers.push('EVENT_DETERIORATION');
  if (input.context.aegisState !== null && HARD_AEGIS.has(input.context.aegisState)) triggers.push('AEGIS_DETERIORATION');
  if (input.context.executionQuality === 'DEGRADED') triggers.push('LIQUIDITY_DETERIORATION');
  if (triggers.length === 0) {
    const unknownNearExpiry = (expiryState === 'UNKNOWN') && (input.dte === null || input.dte <= 1);
    return make('HOLD', unknownNearExpiry ? ['EXPIRY_STATE_UNKNOWN_NEAR_EXPIRY'] : ['NO_D_SAFETY_TRIGGER'], { escalate: unknownNearExpiry });
  }
  // both exact legs must be freshly and executably quoted before any close is proposed (never close only one leg, never price from one leg)
  if (!quotesExecutable) return make('HOLD', [...triggers, ...(!feedQualified ? ['CLOSE_QUOTE_PROVENANCE_UNKNOWN'] : []), 'CLOSE_REQUIRED_QUOTES_NOT_EXECUTABLE'],
    { closeRequired: true, escalate: input.dte !== null && input.dte <= 1 });
  return make('CLOSE_FULL', triggers, { closeRequired: true, closeQuantity: input.exposure.hedgedSpreads });
}
