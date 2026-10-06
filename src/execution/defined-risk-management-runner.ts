import type { PaperOrderCoordinator, PaperOrderStore } from './paper-order-coordinator.js';
import { assessDefinedRiskManagement, type DefinedRiskLegQuoteEvidence, type DefinedRiskManagementDecision, type DefinedRiskManagementInput } from './defined-risk-management.js';
import { buildDefinedRiskCloseCommand } from './defined-risk-close-command.js';
import { definedRiskManagementProposal } from './defined-risk-management.js';
import { buildDefinedRiskManagementActionFrontier, type ManagementActionFrontier } from '../theta/management-action-frontier.js';
import type { DefinedRiskPositionSnapshot, PostgresDefinedRiskPositionStore } from './postgres-defined-risk-position-store.js';

/** Everything the decision needs from the outside world for ONE spread. Every field that can be unknown IS nullable: nothing is defaulted. */
export interface DefinedRiskScanInputs {
  readonly brokerOpenContracts: { readonly short: number | null; readonly long: number | null };
  readonly shortQuote: DefinedRiskLegQuoteEvidence | null;
  readonly longQuote: DefinedRiskLegQuoteEvidence | null;
  readonly spot: number | null;
  readonly dte: number | null;
  readonly marketOpen: boolean | null;
  readonly context: DefinedRiskManagementInput['context'];
  readonly aegisState: 'ALLOW_FULL' | 'ALLOW_REDUCED' | 'HOLD_ONLY' | 'HARD_VETO' | 'EMERGENCY_EXIT_ONLY' | null;
  readonly executionAccountId: string;
}

export interface DefinedRiskManagementRunnerDeps {
  readonly positions: PostgresDefinedRiskPositionStore;
  readonly orders: PaperOrderStore;
  readonly coordinator: PaperOrderCoordinator;
  /** reads broker legs, both exact leg quotes, spot, clock and context. A throw is recorded as UNKNOWN evidence, never skipped silently. */
  readonly loadInputs: (position: DefinedRiskPositionSnapshot, observedAt: string) => Promise<DefinedRiskScanInputs>;
  /** persists the decision (immutable, hash-addressed) and returns the trade.decision id the order intent will reference */
  readonly recordDecision: (decision: DefinedRiskManagementDecision, position: DefinedRiskPositionSnapshot, frontier: ManagementActionFrontier) => Promise<string>;
  /** attempt number for the NEXT close order of this spread: 1 + number of earlier close intents that ended without any fill */
  readonly nextCloseAttempt: (openIntentId: string) => Promise<number>;
  readonly pinBandPct: number;
  readonly maximumQuoteAgeSeconds: number;
  readonly decisionWindowSeconds: number;
  /** false = the decision is still computed and persisted, but NO order intent is prepared or submitted (submission not authorized, market closed, reconciliation not GOOD) */
  readonly mayClose: boolean;
  readonly now: () => string;
}

export interface DefinedRiskScanResult {
  readonly orderIntentId: string;
  readonly state: string;
  /** what the D producer proposed */
  readonly action: DefinedRiskManagementDecision['action'];
  /** what the sovereign management frontier (v3) selected; the ONLY action that may reach the coordinator */
  readonly selectedAction: ManagementActionFrontier['selectedAction'];
  readonly reasons: readonly string[];
  readonly escalate: boolean;
  readonly closeIntentId: string | null;
  /** an emergency spread must stop new entries: the autonomous runtime reads this through blocksNewRisk() */
  readonly blocksNewRisk: boolean;
}

const unknownInputs = (executionAccountId: string): DefinedRiskScanInputs => ({ brokerOpenContracts: { short: null, long: null }, shortQuote: null, longQuote: null, spot: null, dte: null,
  marketOpen: null, context: { eventState: 'UNKNOWN', aegisState: null, executionQuality: 'UNKNOWN' }, aegisState: null, executionAccountId });

/**
 * One management pass over every active spread. Inert when there are none. It refreshes each position from durable broker truth, asks the pure decision module, persists
 * the decision, and for CLOSE_FULL builds ONE close package that PaperOrderCoordinator prepares and submits. Emergencies are escalated and persisted, never auto-flattened
 * with an improvised single-leg order. Restart-safe: every id is deterministic, so a crash between persisting the intent and submitting it resumes at the READY intent.
 */
export async function runDefinedRiskManagementScan(deps: DefinedRiskManagementRunnerDeps): Promise<readonly DefinedRiskScanResult[]> {
  const results: DefinedRiskScanResult[] = [];
  for (const active of await deps.positions.activePositions()) {
    const observedAt = deps.now();
    const refreshed = await deps.positions.refresh(active.orderIntentId, observedAt);
    const position = await deps.positions.get(active.orderIntentId);
    let inputs: DefinedRiskScanInputs;
    let inputError = false;
    const openIntent = await deps.orders.getIntent(position.orderIntentId);
    if (openIntent === null || openIntent.multiLegEvidence === undefined) throw new Error('DEFINED_RISK_OPEN_PARENT_NOT_FOUND');
    try { inputs = await deps.loadInputs(position, observedAt); } catch { inputs = unknownInputs(openIntent.executionAccountId); inputError = true; }
    const legs = openIntent.multiLegEvidence.legs;
    const shortLeg = legs.find((leg) => leg.positionIntent === 'sell_to_open'), longLeg = legs.find((leg) => leg.positionIntent === 'buy_to_open');
    if (shortLeg === undefined || longLeg === undefined) throw new Error('DEFINED_RISK_OPEN_PARENT_LEGS_INVALID');
    const decision = assessDefinedRiskManagement({ orderIntentId: position.orderIntentId, chainId: position.chainId, state: refreshed.state, exposure: refreshed.exposure,
      shortSymbol: shortLeg.occSymbol, longSymbol: longLeg.occSymbol, shortStrike: position.shortStrike, longStrike: position.longStrike, observedAt,
      brokerOpenContracts: inputs.brokerOpenContracts, shortQuote: inputs.shortQuote, longQuote: inputs.longQuote, spot: inputs.spot, dte: inputs.dte, marketOpen: inputs.marketOpen,
      closeOrderWorking: refreshed.closeOrderWorking, context: inputs.context, pinBandPct: deps.pinBandPct, maximumQuoteAgeSeconds: deps.maximumQuoteAgeSeconds });
    // D proposes; the ONE management frontier selects; only its selection is executed
    const frontier = buildDefinedRiskManagementActionFrontier(definedRiskManagementProposal(decision, refreshed));
    const closeSelected = frontier.selectedAction === 'CLOSE_FULL';
    const closeBlocked = closeSelected && !deps.mayClose;
    const reasons = [...decision.reasons, ...(inputError ? ['MANAGEMENT_INPUTS_UNAVAILABLE'] : []), ...(closeBlocked ? ['CLOSE_SUBMISSION_NOT_AUTHORIZED_NOW'] : [])];
    const decisionId = await deps.recordDecision(decision, position, frontier);
    let closeIntentId: string | null = null;
    if (closeSelected && deps.mayClose && inputs.shortQuote?.bid != null && inputs.longQuote?.bid != null) {
      const attempt = await deps.nextCloseAttempt(position.orderIntentId);
      const expires = new Date(Date.parse(observedAt) + deps.decisionWindowSeconds * 1000).toISOString();
      const command = buildDefinedRiskCloseCommand({ openIntentId: position.orderIntentId, openEvidence: openIntent.multiLegEvidence, chainId: position.chainId, underlyingId: position.underlyingId,
        executionAccountId: inputs.executionAccountId, decisionId, decision, shortQuote: { symbol: shortLeg.occSymbol, bid: inputs.shortQuote.bid, ask: inputs.shortQuote.ask as number, observedAt: inputs.shortQuote.observedAt as string },
        longQuote: { symbol: longLeg.occSymbol, bid: inputs.longQuote.bid, ask: inputs.longQuote.ask as number, observedAt: inputs.longQuote.observedAt as string },
        now: observedAt, decisionExpiresAt: expires, maximumQuoteAgeSeconds: deps.maximumQuoteAgeSeconds, attempt, aegisState: inputs.aegisState });
      const { gate, ...intent } = command;
      const existing = await deps.orders.getIntent(intent.orderIntentId);
      const prepared = existing ?? await deps.coordinator.prepare(intent);
      // only a never-submitted intent is submitted here; anything already SUBMITTING/UNKNOWN is the coordinator's restart reconciliation, never resubmitted
      if (prepared.status === 'READY') await deps.coordinator.submit(prepared.orderIntentId, gate);
      closeIntentId = prepared.orderIntentId;
    }
    const emergency = frontier.selectedAction === 'EMERGENCY_RISK_REDUCTION';
    results.push({ orderIntentId: position.orderIntentId, state: refreshed.state, action: decision.action, selectedAction: frontier.selectedAction, reasons, escalate: decision.escalate || inputError || (closeBlocked && decision.reasons.some((reason) => reason.startsWith('D_EXPIRY_'))), closeIntentId, blocksNewRisk: emergency || refreshed.state === 'DIVERGED_EMERGENCY' });
  }
  return results;
}

export const blocksNewRisk = (results: readonly DefinedRiskScanResult[]): boolean => results.some((result) => result.blocksNewRisk);
