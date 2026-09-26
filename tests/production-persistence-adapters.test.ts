import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptAssignmentLabelFromLifecycleEvents, adaptManagementDatasetFromFrontierActions,
  adaptRecoverySurvivalFromLifecycleEvents, adaptSlippageRowFromTca, adaptWholeChainOutcomeFromEvidence,
} from '../src/research/production-persistence-adapters.js';
import type { WholeChainComponentEvidence, WholeChainEvidenceField } from '../src/theta/whole-chain-component-evidence.js';
import type { ActionEconomics } from '../src/theta/action-inaction-frontier.js';
import type { LifecycleApplication } from '../src/theta/postgres-lifecycle-application-store.js';
import type { TransactionCostAnalysis } from '../src/execution/transaction-cost-analysis.js';

function knownField<T>(value: T, asOf = '2026-09-26T00:00:00Z'): WholeChainEvidenceField<T> {
  return { value, status: 'KNOWN', sources: [], reasons: [], asOf };
}

function wholeChainEvidence(overrides: Partial<WholeChainComponentEvidence> = {}): WholeChainComponentEvidence {
  return {
    contractVersion: 'theta-whole-chain-component-evidence-v2', chainId: 'chain-1', asOf: '2026-09-26T00:00:00Z',
    contentHash: 'h1',
    initialPutPremium: knownField(300), putCloseCosts: knownField(50), rollCredits: knownField(0), rollCloseCosts: knownField(0),
    assignmentStrike: knownField(null), stockSharesAssigned: knownField(0), assignmentObservedAt: knownField(null),
    dividends: knownField(0), coveredCallPremium: knownField(0), coveredCallCloseCosts: knownField(0),
    stockSaleOrCallAwayProceeds: knownField(null), fees: knownField(2), tcaExecutionShortfall: knownField(null),
    currentStockMarkPerShare: knownField(null), openStockShares: knownField(0),
    stockLotBasisReferences: [], componentBlockers: [],
    components: {
      // A real, resolved chain with no covered-call leg at all uses a
      // known ZERO (not null/UNKNOWN) for coveredCallPremium/CloseCosts --
      // computeWholeChainPnl treats null as a genuine unresolved UNKNOWN,
      // which would (correctly) make wholeChainPnl null for THIS test's
      // purpose of proving a real, complete adaptation.
      cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 300, putCloseCosts: 50, rollCredits: 0, rollCloseCosts: 0,
      assignmentStrike: null, stockSharesAssigned: 0, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
      stockSaleOrCallAwayProceeds: null, fees: 2, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: null,
      currentStockMarkPerShare: null, openStockShares: 0,
    },
    ...overrides,
  };
}

test('CORE CLAIM: a real, complete WholeChainComponentEvidence adapts into a real WholeChainOutcomeRow with computed P&L', () => {
  const row = adaptWholeChainOutcomeFromEvidence({
    evidence: wholeChainEvidence(), strategyFamily: 'THETA_CONVENTIONAL', rollCount: 0,
    dailyCapital: [], observationCutoffAt: '2026-09-26T01:00:00Z', isResolved: true,
  });
  assert.ok(row !== null);
  assert.equal(row?.chainId, 'chain-1');
  assert.equal(row?.state, 'CHAIN_RESOLVED');
  assert.equal(row?.pnl.wholeChainPnl, 300 - 50 + 0 - 0 + 0 + 0 - 0 - 2 - 0); // initialPutPremium - putCloseCosts + dividends + CC(0) - fees, no stock leg
});

test('ADVERSARIAL: a blocked (components: null) evidence object adapts to null, never a fabricated row', () => {
  const row = adaptWholeChainOutcomeFromEvidence({
    evidence: wholeChainEvidence({ components: null, componentBlockers: ['initialPutPremium:UNKNOWN'] }),
    strategyFamily: 'THETA_CONVENTIONAL', rollCount: 0, dailyCapital: [], observationCutoffAt: '2026-09-26T01:00:00Z', isResolved: false,
  });
  assert.equal(row, null);
});

function actionEconomics(overrides: Partial<ActionEconomics> = {}): ActionEconomics {
  return {
    action: 'HOLD', feasible: true, infeasibleReason: null, afterCostEv: null, tailBurden: null,
    capitalDays: null, executionCost: null, assignmentBurden: null, opportunityCost: null, empiricalState: 'UNKNOWN',
    ...overrides,
  };
}

test('CORE CLAIM: a real 14-action ActionEconomics[] adapts into ManagementActionValueRow[] with the taken action factual, others counterfactual', () => {
  const actions: ActionEconomics[] = [
    actionEconomics({ action: 'HOLD', afterCostEv: 12.5, tailBurden: 3, capitalDays: 5, opportunityCost: 1 }),
    actionEconomics({ action: 'CLOSE_FULL', feasible: false, infeasibleReason: 'NOT_YET_PROFITABLE' }),
    actionEconomics({ action: 'ROLL', feasible: false, infeasibleReason: 'AEGIS_BLOCK' }),
  ];
  const rows = adaptManagementDatasetFromFrontierActions({
    managementDecisionPointId: 'm1', actions, actuallyTakenAction: 'HOLD', resolvedAt: '2026-09-26T02:00:00Z',
  });
  const hold = rows.find((r) => r.action === 'HOLD');
  const close = rows.find((r) => r.action === 'CLOSE_FULL');
  assert.equal(hold?.identifiabilityStatus, 'FACTUAL_OBSERVED');
  assert.equal(hold?.riskToGo, 3);
  assert.equal(close?.identifiabilityStatus, 'NOT_IDENTIFIABLE');
  assert.equal(close?.riskToGo, null);
});

test('ADVERSARIAL: adapting a frontier with a taken-action string not present in the real action set throws, never silently no-ops', () => {
  assert.throws(() => adaptManagementDatasetFromFrontierActions({
    managementDecisionPointId: 'm1', actions: [actionEconomics()], actuallyTakenAction: 'MADE_UP_ACTION', resolvedAt: null,
  }), /PRODUCTION_ADAPTER_TAKEN_ACTION_NOT_IN_FRONTIER/);
});

function baseEvent(overrides: Partial<LifecycleApplication>): LifecycleApplication {
  return {
    evidenceKey: 'ek1', chainId: 'chain-1', occurredAt: '2026-10-17T15:00:00Z', decisionId: null, providerActivityRefHash: null,
    ...overrides,
  } as LifecycleApplication;
}

test('CORE CLAIM: an assignment event on the same calendar date as expiration adapts to EXPIRATION_ASSIGNMENT', () => {
  const events: LifecycleApplication[] = [baseEvent({
    eventKind: 'SHORT_PUT_ASSIGNMENT', optionLegId: 'leg1', stockLotId: 'lot1', shares: 100, strikePrice: 590,
    brokerBasisPerShare: null, economicBasisPerShare: 590, realizedOptionPnl: 250,
  })];
  const result = adaptAssignmentLabelFromLifecycleEvents({
    positionEpisodeId: 'pe1', legRole: 'Q_SHORT_PUT', events, expirationDate: '2026-10-17',
    reachedTerminalLifecycleState: true, observationCutoffAt: '2026-10-18T00:00:00Z', longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'EXPIRATION_ASSIGNMENT');
});

test('an assignment event BEFORE the expiration date adapts to EARLY_ASSIGNMENT', () => {
  const events: LifecycleApplication[] = [baseEvent({
    eventKind: 'SHORT_PUT_ASSIGNMENT', optionLegId: 'leg1', stockLotId: 'lot1', shares: 100, strikePrice: 590,
    brokerBasisPerShare: null, economicBasisPerShare: 590, realizedOptionPnl: 250, occurredAt: '2026-10-10T15:00:00Z',
  })];
  const result = adaptAssignmentLabelFromLifecycleEvents({
    positionEpisodeId: 'pe1', legRole: 'Q_SHORT_PUT', events, expirationDate: '2026-10-17',
    reachedTerminalLifecycleState: true, observationCutoffAt: '2026-10-18T00:00:00Z', longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'EARLY_ASSIGNMENT');
});

test('CORE CLAIM: no assignment event + reached terminal state adapts to NO_ASSIGNMENT (factual negative), never censored', () => {
  const result = adaptAssignmentLabelFromLifecycleEvents({
    positionEpisodeId: 'pe1', legRole: 'Q_SHORT_PUT', events: [], expirationDate: '2026-10-17',
    reachedTerminalLifecycleState: true, observationCutoffAt: '2026-10-18T00:00:00Z', longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'NO_ASSIGNMENT');
});

test('no assignment event + NOT yet terminal adapts to RIGHT_CENSORED', () => {
  const result = adaptAssignmentLabelFromLifecycleEvents({
    positionEpisodeId: 'pe1', legRole: 'Q_SHORT_PUT', events: [], expirationDate: '2026-10-17',
    reachedTerminalLifecycleState: false, observationCutoffAt: '2026-10-05T00:00:00Z', longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'RIGHT_CENSORED');
});

test('CORE CLAIM: an assignment event followed by a real STOCK_DISPOSAL event adapts to a RESOLVED recovery episode with the real dates', () => {
  const events: LifecycleApplication[] = [
    baseEvent({
      eventKind: 'SHORT_PUT_ASSIGNMENT', optionLegId: 'leg1', stockLotId: 'lot1', shares: 100, strikePrice: 590,
      brokerBasisPerShare: null, economicBasisPerShare: 590, realizedOptionPnl: 250, occurredAt: '2026-10-17T15:00:00Z',
    }),
    baseEvent({
      eventKind: 'STOCK_DISPOSAL', stockLotId: 'lot1', disposedPricePerShare: 585, realizedStockPnl: -500,
      occurredAt: '2026-10-24T15:00:00Z',
    }),
  ];
  const row = adaptRecoverySurvivalFromLifecycleEvents({
    recoveryEpisodeId: 're1', events, observationCutoffAt: '2026-11-01T00:00:00Z', tradingDays: 5, dailyCapital: [],
  });
  assert.ok(row !== null);
  assert.equal(row?.status, 'RESOLVED');
  assert.equal(row?.assignmentAt, '2026-10-17T15:00:00Z');
  assert.equal(row?.terminalDispositionAt, '2026-10-24T15:00:00Z');
  assert.equal(row?.calendarDays, 7);
});

test('an assignment event with no disposal event adapts to a RIGHT_CENSORED (still open) recovery episode', () => {
  const events: LifecycleApplication[] = [baseEvent({
    eventKind: 'SHORT_PUT_ASSIGNMENT', optionLegId: 'leg1', stockLotId: 'lot1', shares: 100, strikePrice: 590,
    brokerBasisPerShare: null, economicBasisPerShare: 590, realizedOptionPnl: 250, occurredAt: '2026-10-17T15:00:00Z',
  })];
  const row = adaptRecoverySurvivalFromLifecycleEvents({
    recoveryEpisodeId: 're1', events, observationCutoffAt: '2026-11-01T00:00:00Z', tradingDays: null, dailyCapital: [],
  });
  assert.equal(row?.status, 'RIGHT_CENSORED');
  assert.equal(row?.terminalDispositionAt, null);
});

test('no assignment event at all adapts to null -- there is no recovery episode to report', () => {
  const row = adaptRecoverySurvivalFromLifecycleEvents({
    recoveryEpisodeId: 're1', events: [], observationCutoffAt: '2026-11-01T00:00:00Z', tradingDays: null, dailyCapital: [],
  });
  assert.equal(row, null);
});

function tca(overrides: Partial<TransactionCostAnalysis> = {}): TransactionCostAnalysis {
  return {
    contractVersion: 'theta-tca-v1', decisionMid: 1.25, arrivalMid: 1.26, fillPrice: 1.30,
    spreadAtDecision: 0.10, spreadAtArrival: 0.10, spreadAtFill: 0.08, limitAttempts: 1, latencyMs: 500,
    slippageDollars: 5, slippageBps: 400, spreadCapture: 0.5, fees: 1, estimatedMarketImpact: null,
    postFillMove: {}, quoteProvider: 'ALPACA', quoteSemantics: 'PAPER_INDICATIVE_REFERENCE',
    benchmarkClass: 'ALPACA_INDICATIVE_TCA', providerTimestamp: '2026-09-26T14:00:00Z', receivedAt: '2026-09-26T14:00:01Z',
    quoteAgeMs: 1000, unknownReasons: [], ...overrides,
  };
}

test('CORE CLAIM: a real, filled TransactionCostAnalysis adapts into a direction-normalized SlippageRow', () => {
  const row = adaptSlippageRowFromTca({ orderIntentId: 'o1', side: 'BUY', tca: tca() });
  assert.ok(row !== null);
  assert.equal(row?.fillPrice, 1.30);
  assert.equal(row?.decisionMid, 1.25);
  assert.ok(Math.abs((row?.directionNormalizedSlippage ?? 0) - 0.05) < 1e-9);
});

test('ADVERSARIAL: an unfilled order (fillPrice: null) adapts to null -- never a fabricated slippage value for a non-existent fill', () => {
  const row = adaptSlippageRowFromTca({ orderIntentId: 'o1', side: 'BUY', tca: tca({ fillPrice: null }) });
  assert.equal(row, null);
});
