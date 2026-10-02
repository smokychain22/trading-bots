import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleManagementPaperPlans, compileManagementExecutionLegDirectives,
  type ManagementPaperPlanAssemblyInput } from '../src/execution/management-paper-plan-assembly.js';
import { decideAdaptiveLimit } from '../src/execution/adaptive-limit-policy.js';
import { routeConfirmedFillLifecycle, routeConfirmedRollPair, type ConfirmedFillFact,
  type FillLifecycleContext } from '../src/execution/broker-fill-lifecycle-router.js';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { buildManagementActionFrontier,
  type ManagementActionFrontier, type ManagementFrontierAction } from '../src/theta/management-action-frontier.js';
import { assembleManagementInput, type ManagementInputState } from '../src/theta/management-input-state.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { evaluatePaperBootstrapManagementPolicy, type PaperBootstrapPolicyInput,
  type RollCandidate } from '../src/theta/paper-bootstrap-management-policy.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 2: oscillation / idempotency, event + liquidity interaction for assignment / recovery / covered-call management,
// the economic plan for non-atomic roll execution, and executable-handoff characterization of the bootstrap policy.

const T0 = '2026-09-12T14:00:00.000Z';
const T_NEAR = '2026-10-13T14:00:00.000Z';
const UUID = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Opts {
  readonly lifecycle?: 'CSP_OPEN' | 'CC_OPEN' | 'RECOVERY_WAIT'; readonly bid?: number | null; readonly ask?: number | null;
  readonly spot?: number; readonly observedAt?: string; readonly aegis?: string | null; readonly event?: unknown;
  readonly isOpen?: boolean; readonly quoteAsOf?: string; readonly stockMark?: number | null; readonly shares?: string;
  readonly extra?: Record<string, unknown>;
}

function managed(o: Opts = {}): ManagementInputState {
  const lifecycle = o.lifecycle ?? 'CSP_OPEN';
  const observedAt = o.observedAt ?? T0;
  const hasOption = lifecycle !== 'RECOVERY_WAIT';
  const optionType = lifecycle === 'CC_OPEN' ? 'CALL' : 'PUT';
  const hasStock = lifecycle !== 'CSP_OPEN';
  const symbol = `AAPL261016${optionType === 'CALL' ? 'C' : 'P'}00200000`;
  const stockMark = o.stockMark === undefined ? 190 : o.stockMark;
  return assembleManagementInput({
    chain_id: UUID(4), lifecycle_state: lifecycle, underlying_id: UUID(5), underlying: 'AAPL',
    option_leg_id: hasOption ? UUID(7) : null, option_contract_id: hasOption ? UUID(6) : null,
    quantity: hasOption ? '1' : null, entry_credit_debit: hasOption ? '200' : null,
    contract_symbol: hasOption ? symbol : null, option_type: hasOption ? optionType : null, strike: hasOption ? '200' : null,
    expiration_date: hasOption ? '2026-10-16' : null, multiplier: hasOption ? '100' : null,
    bid: hasOption ? (o.bid === undefined ? 1 : o.bid) : null, ask: hasOption ? (o.ask === undefined ? 1.1 : o.ask) : null,
    quote_as_of: hasOption ? (o.quoteAsOf ?? observedAt) : null, feed: hasOption ? 'OPRA' : null, quote_quality: hasOption ? 'GOOD' : null,
    realized_option_pnl: '0', open_stock_shares: hasStock ? (o.shares ?? '100') : '0', stock_basis_per_share: hasStock ? '195' : null,
    realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000', options_buying_power: '40000',
    account_as_of: observedAt, fusion_snapshot_id: UUID(3), reconciliation_quality: 'GOOD',
    broker_option_symbol: hasOption ? symbol : null, broker_option_quantity: hasOption ? '1' : null,
    broker_option_side: hasOption ? 'short' : null, broker_option_asset_class: hasOption ? 'us_option' : null,
    broker_option_observed_at: hasOption ? observedAt : null, ledger_option_contract_quantity: hasOption ? '1' : '0',
    snapshot_json: { underlyingState: { last: o.spot ?? 205 }, marketSession: { isOpen: o.isOpen ?? true },
      riskState: { assignmentCapacity: 1, newRiskState: o.aegis === undefined ? 'ALLOW_FULL' : o.aegis },
      eventState: o.event === undefined ? { state: 'CLEAR' } : o.event },
    broker_position: hasStock && stockMark !== null ? { currentPrice: stockMark } : null, ...(o.extra ?? {}),
  }, { managementInputSnapshotId: UUID(1), reconciliationSnapshotId: UUID(2), observedAt });
}

const target = (overrides: Partial<RollCandidate> = {}): RollCandidate => ({
  optionContractId: UUID(10), symbol: 'AAPL261120P00195000', optionType: 'PUT', strike: 195,
  expiration: '2026-11-20', multiplier: 100, quantity: 1, bid: 1.5, ask: 1.6, ...overrides,
});
const decide = (input: PaperBootstrapPolicyInput) => {
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  return { evidence, frontier: buildManagementActionFrontier(input, evidence) };
};

// ---------------------------------------------------------------------------
// 6. Oscillation and idempotency.
// ---------------------------------------------------------------------------

test('OSCILLATION: one decision state yields exactly one stable action however often and in whatever order it is evaluated', () => {
  const thresholdA = managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR });   // exactly on the near-exhausted boundary
  const thresholdB = managed({ bid: 0.15, ask: 0.21, observedAt: T_NEAR });  // one tick on the other side
  const breakEvenA = { ...managed({ bid: 1.0, ask: 1.1 }), rollCandidate: target({ bid: 1.1, ask: 1.2 }) };   // net credit 0
  const breakEvenB = { ...managed({ bid: 1.0, ask: 1.1 }), rollCandidate: target({ bid: 1.09, ask: 1.2 }) };  // net debit
  const states: readonly PaperBootstrapPolicyInput[] = [thresholdA, thresholdB, breakEvenA, breakEvenB];
  const baseline = states.map((s) => JSON.stringify(decide(s)));
  // interleave A,B,A,B... and reverse order: each state must reproduce ITS OWN baseline, i.e. no hidden carried state.
  for (let round = 0; round < 40; round += 1) {
    const order = round % 2 === 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
    for (const index of order) assert.equal(JSON.stringify(decide(states[index] as PaperBootstrapPolicyInput)), baseline[index]);
  }
  const selected = states.map((s) => decide(s).frontier.selectedAction);
  assert.deepEqual(selected, ['CLOSE_FULL', 'HOLD', 'ROLL', 'HOLD']);
});

test('OSCILLATION: a single decision state never selects two actions or returns to a prior action with a different reason', () => {
  const input = { ...managed(), rollCandidate: target() };
  const { frontier, evidence } = decide(input);
  assert.equal(frontier.actions.filter((a) => a.action === frontier.selectedAction).length, 1);
  assert.notEqual(frontier.secondBestAction, frontier.selectedAction);
  assert.equal(evidence?.selectedAction, frontier.selectedAction);
  const again = decide(input);
  assert.equal(again.frontier.policyEvidenceHash, frontier.policyEvidenceHash, 'identical state -> identical evidence hash');
  assert.deepEqual(again.frontier.reasonCodes, frontier.reasonCodes);
});

test('OSCILLATION: decision-state identity is deterministic and bound to the input hash and the decision timestamp', () => {
  const one = managed(), two = managed();
  assert.equal(one.contentHash, two.contentHash, 'identical inputs hash identically');
  assert.notEqual(managed({ observedAt: '2026-09-12T14:00:01.000Z' }).contentHash, one.contentHash);
  assert.notEqual(managed({ bid: 1.01 }).contentHash, one.contentHash);
  const evidence = evaluatePaperBootstrapManagementPolicy(one);
  assert.ok(evidence);
  assert.equal(evidence.inputContentHash, one.contentHash);
  assert.equal(evidence.decidedAt, one.observedAt);
  const accepted = buildManagementActionFrontier(one, evidence);
  assert.equal(accepted.decisionState, 'ACTION_SELECTED');
  // evidence computed for another snapshot or another instant is rejected, not trusted
  const wrongHash = buildManagementActionFrontier(one, { ...evidence, inputContentHash: managed({ bid: 1.01 }).contentHash });
  assert.equal(wrongHash.decisionState, 'SYSTEM_HOLD_MISSING_EVIDENCE');
  assert.ok(wrongHash.reasonCodes.includes('MANAGEMENT_POLICY_INPUT_HASH_MISMATCH'));
  const wrongTime = buildManagementActionFrontier(one, { ...evidence, decidedAt: '2026-09-12T14:00:01.000Z' });
  assert.ok(wrongTime.reasonCodes.includes('MANAGEMENT_POLICY_TIMESTAMP_MISMATCH'));
  assert.equal(wrongTime.selectedAction, 'HOLD');
  assert.equal(wrongTime.decisionState, 'SYSTEM_HOLD_MISSING_EVIDENCE');
  assert.equal(wrongTime.policyEvidenceHash, null);
  const noVersion = buildManagementActionFrontier(one, { ...evidence, contractVersion: 'old' as never });
  assert.ok(noVersion.reasonCodes.includes('MANAGEMENT_POLICY_VERSION_INVALID'));
});

test('IDEMPOTENCY: the same frontier and selected action always yield the same decision, group and plan identities', () => {
  const state = managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR });
  const base = buildManagementActionFrontier(state);
  const selected = (action: ManagementFrontierAction): ManagementActionFrontier => ({
    ...base, selectedAction: action, decisionState: 'ACTION_SELECTED', policyVersion: 'p-v1', policyEvidenceHash: 'a'.repeat(64),
    reasonCodes: [`SELECT_${action}`],
    actions: base.actions.map((a) => a.action === action ? { ...a, feasibility: 'FEASIBLE' as const, blockers: [] } : a),
  });
  const leg = { action: 'CLOSE_CSP' as const, symbol: 'AAPL261016P00200000', optionContractId: UUID(6), optionType: 'PUT' as const,
    multiplier: 100, canonicalQuantity: 1, economicBoundary: 0.2, economicsRemainPositive: true, expectedAfterCostEv: null,
    empiricalEconomicsReady: false };
  const input = (frontierId: string, frontier: ManagementActionFrontier): ManagementPaperPlanAssemblyInput => ({
    state, frontier: { ...frontier, actions: frontier.actions.map((a) => a.action === frontier.selectedAction
      ? { ...a, executionEvidence: { closeEconomicBoundary: 0.2, openEconomicBoundary: null, stockEconomicBoundary: null,
        economicsRemainPositive: true, expectedAfterCostEv: null, empiricalEconomicsReady: false,
        deterministicEconomicsValidated: false, deterministicNetCredit: null, targetContract: null } } : a) },
    managementActionFrontierId: frontierId, executionAccountId: UUID(9), strategyVersion: 'theta-conventional-v1',
    accountStatus: 'ACTIVE', optionsCapabilityVerified: true, aegisState: 'ALLOW_FULL', killSwitchActive: false, paperEvidenceRiskCap: 1,
    executionLegs: [leg], chainInFlight: { state: 'KNOWN', entries: [] }, now: T_NEAR, decisionExpiresAt: '2026-10-13T14:00:45.000Z',
  });
  const first = assembleManagementPaperPlans(input(UUID(8), selected('CLOSE_FULL')));
  const replay = assembleManagementPaperPlans(input(UUID(8), selected('CLOSE_FULL')));
  const nextCycle = assembleManagementPaperPlans(input(UUID(88), selected('CLOSE_FULL')));
  assert.equal(first.state, 'READY'); assert.equal(replay.state, 'READY'); assert.equal(nextCycle.state, 'READY');
  if (first.state !== 'READY' || replay.state !== 'READY' || nextCycle.state !== 'READY') return;
  assert.deepEqual(replay.decision, first.decision, 'replaying the same frontier is the same decision (store ON CONFLICT DO NOTHING)');
  assert.deepEqual(replay.plans.map((p) => p.actionPlanId), first.plans.map((p) => p.actionPlanId));
  assert.equal(first.decision.authorityRef, `management:${UUID(8)}:CLOSE_FULL`);
  assert.notEqual(nextCycle.decision.decisionId, first.decision.decisionId, 'a new frontier id is a new decision state');
  assert.notEqual(nextCycle.plans[0]?.actionPlanId, first.plans[0]?.actionPlanId);
  // MGMT-CROSS-CYCLE-DUP (D3): the literal is gone. noEquivalentExposureConflict is true only because the explicit in-flight
  // evidence (KNOWN, nothing else working for this chain) said so; see tests/phase2-fixpass-management-execution.test.ts for the
  // cross-cycle duplicate, UNKNOWN and replay cases.
  assert.equal(first.plans[0]?.noEquivalentExposureConflict, true);
});

test('OSCILLATION (characterization): there is no hysteresis - a quote straddling the boundary flips the action every cycle', () => {
  const sequence = [0.2, 0.21, 0.2, 0.21, 0.2, 0.21].map((ask) => decide(managed({ bid: 0.15, ask, observedAt: T_NEAR })).frontier.selectedAction);
  assert.deepEqual(sequence, ['CLOSE_FULL', 'HOLD', 'CLOSE_FULL', 'HOLD', 'CLOSE_FULL', 'HOLD']);
  // This is bounded: CLOSE_FULL ends the leg, so the flip cannot execute twice for one leg. The register row MGMT-NO-HYSTERESIS
  // records the missing dwell/cooldown for ROLL<->HOLD around a zero net credit and for close -> re-entry -> close churn.
  const rolls = [1.1, 1.09, 1.1, 1.09].map((bid) => decide({ ...managed({ bid: 1.0, ask: 1.1 }),
    rollCandidate: target({ bid, ask: bid + 0.1 }) }).frontier.selectedAction);
  assert.deepEqual(rolls, ['ROLL', 'HOLD', 'ROLL', 'HOLD']);
});

test('OSCILLATION: closing a leg is a different decision state from re-opening one - management never proposes the reopen itself', () => {
  const closed = buildManagementActionFrontier(managed(), evaluatePaperBootstrapManagementPolicy(managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR })));
  assert.ok(closed.actions.every((a) => a.action !== 'SELL_CC' || false));
  // REDEPLOY is infeasible inside the open-leg frontier, so CLOSE -> REOPEN cannot occur within one decision state.
  assert.ok(closed.actions.find((a) => a.action === 'REDEPLOY')?.blockers.includes('CURRENT_EXPOSURE_NOT_RESOLVED'));
  assert.notEqual(closed.selectedAction, 'REDEPLOY');
});

// ---------------------------------------------------------------------------
// 7 / 8. Event + liquidity interaction for new Q, existing CSP, roll, assignment, recovery and covered call.
// ---------------------------------------------------------------------------

test('EVENT: a blocked new-risk Q entry does not freeze management of an existing CSP (same cycle, same event)', () => {
  const now = '2026-09-14T15:00:00.000Z';
  const contract = normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000', optionType: 'PUT',
    strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100, underlyingBid: 199.9, underlyingAsk: 200.1,
    underlyingLast: 200, underlyingTimestamp: now, bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: now, tradeTimestamp: now, volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS',
    iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: now, greeksSource: 'OPTIONOMICS',
    feed: 'OPRA', dataQuality: 'GOOD', maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
  }, now);
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  const routing = parseStrategyRoutingResponse({ contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 's', timestamp: now,
    policyVersion: 'r1', results: families.map((strategyFamily) => ({ strategyFamily, eligible: strategyFamily === 'THETA_Q',
      eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'r1' })) });
  const entry = buildCanonicalStrategyFrontier({ snapshotId: 's', timestamp: now, strategyVersion: 'v', contracts: [contract], routing,
    stock: null, assignmentCapacityQty: 2, buyingPower: 100_000, brokerAllowedQty: 10,
    sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2,
      correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
    aegisNewRiskState: 'HOLD_ONLY', eventState: 'EVENT_NEAR', unmanagedBrokerPositionCount: 1, unevaluatedUnderlyingCount: 0,
    optionomicsContext: { state: 'UNKNOWN' } });
  assert.equal(entry.selectedQuantity, 0, 'new risk is blocked (HOLD_ONLY + event)');
  assert.notEqual(entry.primaryAction, 'OPEN_CSP');
  assert.equal(entry.globalWaitEarned, false, 'with an unmanaged position the cycle cannot claim a deliberate wait');
  // ... and the existing position is still managed in the same cycle by the independent management authority.
  const existing = decide(managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR, aegis: 'HOLD_ONLY', event: { state: 'EVENT_NEAR' } }));
  assert.equal(existing.frontier.selectedAction, 'CLOSE_FULL');
});

test('EVENT/LIQUIDITY: covered-call management keeps its risk-reducing close under a veto + event, and drops it on a stale quote', () => {
  const veto = decide(managed({ lifecycle: 'CC_OPEN', bid: 0.15, ask: 0.2, observedAt: T_NEAR, aegis: 'HARD_VETO', event: { state: 'EVENT_NEAR' } }));
  assert.equal(veto.frontier.selectedAction, 'CLOSE_CC');
  assert.ok(veto.frontier.actions.find((a) => a.action === 'ROLL_CC')?.blockers.includes('AEGIS_NOT_APPROVED'));
  const stale = decide(managed({ lifecycle: 'CC_OPEN', bid: 0.15, ask: 0.2, observedAt: T_NEAR, quoteAsOf: '2026-10-13T09:00:00.000Z' }));
  assert.equal(stale.frontier.selectedAction, 'HOLD_CC');
  assert.equal(stale.frontier.actions.find((a) => a.action === 'CLOSE_CC')?.feasibility, 'INFEASIBLE');
  const noQuote = decide(managed({ lifecycle: 'CC_OPEN', bid: null, ask: null, observedAt: T_NEAR }));
  assert.equal(noQuote.frontier.selectedAction, 'HOLD_CC');
  assert.ok(noQuote.frontier.actions.find((a) => a.action === 'CLOSE_CC')?.blockers.includes('EXECUTABLE_OPTION_QUOTE_UNKNOWN'));
});

test('EVENT/LIQUIDITY: recovery stock management is not frozen by a veto or an event, and never sells at an unknown price', () => {
  const veto = decide(managed({ lifecycle: 'RECOVERY_WAIT', aegis: 'HARD_VETO', event: { state: 'EVENT_NEAR' } }));
  assert.ok(veto.frontier.selectedAction === 'RECOVERY_WAIT' || veto.frontier.selectedAction === 'SELL_STOCK');
  assert.equal(veto.frontier.actions.find((a) => a.action === 'SELL_STOCK')?.feasibility, 'FEASIBLE');
  assert.ok(veto.frontier.actions.find((a) => a.action === 'SELL_CC')?.blockers.includes('AEGIS_NOT_APPROVED'));
  // with a thesis-failure bias the veto/event still permit liquidation (risk reducing), they only forbid selling a new call
  const noMark = decide(managed({ lifecycle: 'RECOVERY_WAIT', stockMark: null }));
  const sell = noMark.frontier.actions.find((a) => a.action === 'SELL_STOCK');
  assert.ok(sell?.blockers.includes('EXECUTABLE_STOCK_PRICE_UNKNOWN'));
  assert.notEqual(sell?.feasibility, 'FEASIBLE');
  assert.equal(noMark.evidence?.actionValues.find((v) => v.action === 'SELL_STOCK')?.utility ?? null, null);
  assert.notEqual(noMark.frontier.selectedAction, 'SELL_STOCK');
});

test('EVENT/LIQUIDITY: assignment handling at the cutoff does not depend on the option quote being liquid', () => {
  const cutoff = '2026-10-16T21:00:00.000Z';
  for (const quote of [{ bid: null, ask: null }, { bid: 0, ask: 0.05 }]) {
    const itm = decide(managed({ observedAt: cutoff, isOpen: false, spot: 190, ...quote, event: { state: 'EVENT_NEAR' }, aegis: 'HARD_VETO' }));
    assert.equal(itm.frontier.selectedAction, 'ACCEPT_ASSIGNMENT', JSON.stringify(quote));
    const otm = decide(managed({ observedAt: cutoff, isOpen: false, spot: 215, ...quote }));
    assert.equal(otm.frontier.selectedAction, 'LET_EXPIRE', JSON.stringify(quote));
  }
});

test('LIQUIDITY (D6 fixed, MGMT-ZERO-BID-CLOSE): a zero bid is a valid quote for a buy-to-close, which needs only a valid ASK', () => {
  const state = managed({ bid: 0, ask: 0.02, observedAt: T_NEAR });
  assert.ok(!state.hardBlockers.includes('EXECUTABLE_QUOTE_UNAVAILABLE'), 'a worthless short must be closable');
  const { frontier } = decide(state);
  assert.equal(frontier.selectedAction, 'CLOSE_FULL');
  assert.equal(frontier.actions.find((a) => a.action === 'CLOSE_FULL')?.feasibility, 'FEASIBLE');
  // an unusable ask, a negative bid, a crossed or missing quote still block (fail closed)
  for (const bad of [{ bid: 0, ask: 0 }, { bid: -0.01, ask: 0.02 }, { bid: 0.05, ask: 0.02 }, { bid: null, ask: null }, { bid: 0, ask: null }]) {
    const blocked = managed({ ...bad, observedAt: T_NEAR });
    const result = decide(blocked).frontier;
    assert.notEqual(result.selectedAction, 'CLOSE_FULL', JSON.stringify(bad));
    assert.equal(result.actions.find((a) => a.action === 'CLOSE_FULL')?.feasibility === 'FEASIBLE', false, JSON.stringify(bad));
  }
  // the zero-bid short reaches an order end to end: see tests/phase2-fixpass-management-execution.test.ts
});

// ---------------------------------------------------------------------------
// 4 (execution structure). A roll is two broker orders; the economic plan must never assume an atomic fill.
// ---------------------------------------------------------------------------
const h = (c: string) => c.repeat(64);
const fill = (id: string, quantity: number, price: number, at = '2026-09-14T14:30:00Z', fees: number | null = 0.5): ConfirmedFillFact =>
  ({ providerFillId: id, providerActivityRefHash: h(id), quantity, pricePerShare: price, occurredAt: at, fees });
const rollClose = (over: Partial<FillLifecycleContext> = {}): FillLifecycleContext => ({
  action: 'ROLL_CSP_CLOSE', orderStatus: 'FILLED', orderQuantity: 2, orderIntentId: 'close-intent', originalLegQuantity: 2,
  chainId: 'chain', decisionId: 'decision', optionLegId: 'old-leg', optionContractId: 'old-contract', stockLotId: null, multiplier: 100,
  entryCreditDebit: 600, economicBasisPerShare: null, nextState: 'ROLL_DECISION', fills: [fill('a', 2, 1.1)], ...over,
});
const pair = (close: Partial<Parameters<typeof routeConfirmedRollPair>[0]['close']> = {},
  open: Partial<Parameters<typeof routeConfirmedRollPair>[0]['open']> = {}) => routeConfirmedRollPair({
  legKind: 'SHORT_PUT', chainId: 'chain', decisionId: 'decision', oldOptionLegId: 'old-leg', newOptionLegId: 'new-leg',
  newOptionContractId: 'new-contract', multiplier: 100, oldEntryCreditDebit: 600,
  close: { orderStatus: 'FILLED', orderQuantity: 2, fills: [fill('b', 2, 1.1)], ...close },
  open: { orderStatus: 'FILLED', orderQuantity: 2, fills: [fill('c', 2, 1.5)], ...open },
});

test('ROLL EXEC: close-old fills first and its realized P&L is immutable and independent of whether the open leg ever fills', () => {
  const closed = routeConfirmedFillLifecycle(rollClose());
  assert.equal(closed.state, 'CONFIRMED');
  assert.equal(closed.application?.eventKind, 'OPTION_CLOSE');
  if (closed.application?.eventKind === 'OPTION_CLOSE') {
    assert.equal(closed.application.nextState, 'ROLL_DECISION');
    assert.equal(closed.application.realizedOptionPnl, 600 - 1.1 * 100 * 2); // 380, old leg only
  }
  // the new opening credit is NOT recorded by the close route and the open route alone cannot advance a roll
  const openAlone = routeConfirmedFillLifecycle(rollClose({ action: 'ROLL_CSP_OPEN', fills: [fill('d', 2, 1.5)], nextState: null }));
  assert.deepEqual(openAlone, { state: 'UNKNOWN', reasonCode: 'ROLL_LEGS_REQUIRE_ATOMIC_PAIR', application: null });
});

test('ROLL EXEC: both legs fully filled is the ONLY outcome that records an OPTION_ROLL, with old P&L and new credit kept separate', () => {
  const ok = pair();
  assert.equal(ok.state, 'CONFIRMED');
  assert.equal(ok.application?.eventKind, 'OPTION_ROLL');
  if (ok.application?.eventKind === 'OPTION_ROLL') {
    assert.equal(ok.application.oldRealizedPnl, 600 - 1.1 * 100 * 2);
    assert.equal(ok.application.newEntryCreditDebit, 1.5 * 100 * 2);
    assert.equal(ok.application.newQuantity, 2);
  }
});

test('ROLL EXEC: partial close, partial open, rejected leg, timeout and cancel each refuse to record an atomic roll', () => {
  const partials = [
    ['partial close', pair({ orderStatus: 'PARTIAL', fills: [fill('b', 1, 1.1)] })],
    ['partial open', pair({}, { orderStatus: 'PARTIAL', fills: [fill('c', 1, 1.5)] })],
    ['open rejected', pair({}, { orderStatus: 'REJECTED', fills: [] })],
    ['close rejected', pair({ orderStatus: 'REJECTED', fills: [] })],
    ['open timed out', pair({}, { orderStatus: 'EXPIRED', fills: [] })],
    ['close canceled', pair({ orderStatus: 'CANCELED', fills: [] })],
    ['open canceled after one contract', pair({}, { orderStatus: 'CANCELED', fills: [fill('c', 1, 1.5)] })],
  ] as const;
  for (const [label, result] of partials) {
    assert.equal(result.application, null, label);
    assert.equal(result.state, 'PARTIAL', label);
    assert.equal(result.reasonCode, 'ROLL_PAIR_NOT_FULLY_FILLED', label);
  }
});

test('ROLL EXEC: close filled + open rejected leaves a recorded CLOSE (flat), not a phantom roll and not an unrealized-loss absorption', () => {
  const closeLeg = routeConfirmedFillLifecycle(rollClose());
  const openLeg = pair({}, { orderStatus: 'REJECTED', fills: [] });
  assert.equal(closeLeg.application?.eventKind, 'OPTION_CLOSE');
  assert.equal(openLeg.application, null);
  if (closeLeg.application?.eventKind === 'OPTION_CLOSE') assert.equal(closeLeg.application.realizedOptionPnl, 380);
});

test('ROLL EXEC: a terminally canceled close with some fills books the filled portion exactly once and leaves the remainder open', () => {
  const partial = routeConfirmedFillLifecycle(rollClose({ orderStatus: 'CANCELED', orderQuantity: 2, originalLegQuantity: 2,
    fills: [fill('e', 1, 1.2, '2026-09-14T14:30:00Z', 0.25)], priorPartialClosedQuantity: 0 }));
  assert.equal(partial.state, 'PARTIAL');
  assert.equal(partial.reasonCode, 'TERMINAL_PARTIAL_CLOSE_RECORDED');
  assert.equal(partial.application?.eventKind, 'OPTION_PARTIAL_CLOSE');
  if (partial.application?.eventKind === 'OPTION_PARTIAL_CLOSE') {
    assert.equal(partial.application.closedQuantity, 1);
    assert.equal(partial.application.remainingQuantityAfter, 1);
    assert.equal(partial.application.allocatedOpeningCredit, 300);
    assert.equal(partial.application.closingDebit, 120);
    assert.equal(partial.application.realizedPnlBeforeFees, 180);
    assert.equal(partial.application.realizedPnlAfterFees, 179.75);
  }
});

test('ROLL EXEC: cancel/replace fills (two prices) volume-weight to one price; unknown fees keep after-fee P&L UNKNOWN, never zero', () => {
  const replaced = routeConfirmedFillLifecycle(rollClose({ fills: [fill('1', 1, 1.0, '2026-09-14T14:30:00Z'), fill('2', 1, 1.2, '2026-09-14T14:30:05Z')] }));
  assert.equal(replaced.state, 'CONFIRMED');
  if (replaced.application?.eventKind === 'OPTION_CLOSE') assert.equal(Math.round(replaced.application.closePricePerShare * 1e6) / 1e6, 1.1);
  const unknownFees = routeConfirmedFillLifecycle(rollClose({ orderStatus: 'CANCELED', fills: [fill('e', 1, 1.2, '2026-09-14T14:30:00Z', null)] }));
  if (unknownFees.application?.eventKind === 'OPTION_PARTIAL_CLOSE') {
    assert.equal(unknownFees.application.explicitFees, null);
    assert.equal(unknownFees.application.realizedPnlAfterFees, null);
  } else assert.fail('expected a partial close application');
});

test('ROLL EXEC: unknown / contradictory broker results are UNKNOWN or PARTIAL and never advance the lifecycle', () => {
  assert.deepEqual(routeConfirmedFillLifecycle(rollClose({ fills: [] })), { state: 'UNKNOWN', reasonCode: 'NO_BROKER_FILL_EVIDENCE', application: null });
  assert.equal(routeConfirmedFillLifecycle(rollClose({ fills: [fill('3', 3, 1.1)] })).reasonCode, 'BROKER_FILL_QUANTITY_MISMATCH');
  assert.equal(routeConfirmedFillLifecycle(rollClose({ fills: [{ ...fill('3', 2, 1.1), providerActivityRefHash: 'not-a-hash' }] })).reasonCode,
    'BROKER_FILL_EVIDENCE_INVALID');
  assert.equal(routeConfirmedFillLifecycle(rollClose({ fills: [fill('3', 2, -1)] })).reasonCode, 'BROKER_FILL_EVIDENCE_INVALID');
  assert.equal(routeConfirmedFillLifecycle(rollClose({ entryCreditDebit: null })).reasonCode, 'LIFECYCLE_LINKAGE_INCOMPLETE');
  assert.equal(routeConfirmedFillLifecycle(rollClose({ nextState: null })).reasonCode, 'LIFECYCLE_LINKAGE_INCOMPLETE');
  // an over-filled pair is not a clean roll either
  const over = pair({ fills: [fill('b', 3, 1.1)] });
  assert.equal(over.application, null);
  // a pair with a malformed fill hash is unknown linkage, not a roll
  const badHash = pair({ fills: [{ ...fill('b', 2, 1.1), providerActivityRefHash: 'xyz' }] });
  assert.deepEqual([badHash.state, badHash.application], ['UNKNOWN', null]);
});

test('ROLL EXEC: the persisted economic plan encodes close-then-open dependency and forbids opening more than was closed', () => {
  const state = managed();
  const base = buildManagementActionFrontier(state);
  const evidence = { closeEconomicBoundary: 1.1, openEconomicBoundary: 1.5, /* USD per share */ stockEconomicBoundary: null, economicsRemainPositive: true,
    expectedAfterCostEv: null, empiricalEconomicsReady: false, deterministicEconomicsValidated: true, deterministicNetCredit: 40,
    targetContract: { symbol: 'AAPL261120P00195000', optionContractId: UUID(10), optionType: 'PUT' as const, multiplier: 100, quantity: 1 } };
  const frontier: ManagementActionFrontier = { ...base, selectedAction: 'ROLL', decisionState: 'ACTION_SELECTED', policyVersion: 'p',
    policyEvidenceHash: 'b'.repeat(64), reasonCodes: ['SELECT_ROLL'],
    actions: base.actions.map((a) => a.action === 'ROLL' ? { ...a, feasibility: 'FEASIBLE' as const, blockers: [], executionEvidence: evidence } : a) };
  const compiled = compileManagementExecutionLegDirectives(state, frontier);
  assert.equal(compiled.state, 'READY');
  if (compiled.state !== 'READY') return;
  assert.deepEqual(compiled.legs.map((l) => l.action), ['ROLL_CSP_CLOSE', 'ROLL_CSP_OPEN']);
  const make = (legs: ManagementPaperPlanAssemblyInput['executionLegs']) => assembleManagementPaperPlans({
    state, frontier, managementActionFrontierId: UUID(8), executionAccountId: UUID(9), strategyVersion: 's', accountStatus: 'ACTIVE',
    optionsCapabilityVerified: true, aegisState: 'ALLOW_FULL', killSwitchActive: false, paperEvidenceRiskCap: 5, executionLegs: legs,
    chainInFlight: { state: 'KNOWN' as const, entries: [] }, now: T0, decisionExpiresAt: '2026-09-12T14:00:45.000Z' });
  const ready = make(compiled.legs);
  assert.equal(ready.state, 'READY');
  if (ready.state === 'READY') {
    assert.equal(ready.plans[0]?.dependsOnActionPlanId, null);
    assert.equal(ready.plans[1]?.dependsOnActionPlanId, ready.plans[0]?.actionPlanId, 'open waits for the close plan');
    assert.equal(ready.plans[0]?.legSequence, 1);
  }
  const oversized = make([compiled.legs[0] as never, { ...(compiled.legs[1] as object), canonicalQuantity: 2 } as never]);
  assert.equal(oversized.state, 'BLOCKED');
  assert.ok(oversized.blockers.includes('ROLL_OPEN_QUANTITY_EXCEEDS_CLOSE'));
  const reversed = make([compiled.legs[1] as never, compiled.legs[0] as never]);
  assert.equal(reversed.state, 'BLOCKED');
  assert.ok(reversed.blockers.includes('MANAGEMENT_EXECUTION_LEG_SEQUENCE_INVALID'));
});

// ---------------------------------------------------------------------------
// Executable hand-off of what the bootstrap policy selects (OPEN DEFECTS, see register rows).
// ---------------------------------------------------------------------------

test('HANDOFF (D1 fixed, MGMT-CLOSE-EVIDENCE): a policy-selected CLOSE_FULL carries risk-reducing execution evidence and compiles to one BTC leg', () => {
  const state = managed({ bid: 0.15, ask: 0.2, observedAt: T_NEAR });
  const { frontier } = decide(state);
  assert.equal(frontier.selectedAction, 'CLOSE_FULL');
  const evidence = frontier.actions.find((a) => a.action === 'CLOSE_FULL')?.executionEvidence;
  assert.ok(evidence);
  // maximum price we will pay = the current ASK, USD per share
  assert.equal(evidence.closeEconomicBoundary, 0.2);
  assert.equal(evidence.openEconomicBoundary, null);
  assert.equal(evidence.stockEconomicBoundary, null);
  // "economicsRemainPositive" has the narrow meaning: closing beats HOLD and is the risk-reducing action. No EV is claimed.
  assert.equal(evidence.economicsRemainPositive, true);
  assert.equal(evidence.expectedAfterCostEv, null);
  assert.equal(evidence.empiricalEconomicsReady, false);
  assert.equal(evidence.deterministicEconomicsValidated, true);
  const compiled = compileManagementExecutionLegDirectives(state, frontier);
  assert.equal(compiled.state, 'READY');
  if (compiled.state !== 'READY') return;
  assert.deepEqual(compiled.legs.map((l) => [l.action, l.economicBoundary, l.canonicalQuantity]), [['CLOSE_CSP', 0.2, 1]]);
});

test('HANDOFF (D1): a close that does NOT beat HOLD never carries a positive-economics flag, so it cannot compile', () => {
  // far from exhausted: the close utility is below the HOLD baseline
  const state = managed({ bid: 1.0, ask: 1.1 });
  const closeValue = evaluatePaperBootstrapManagementPolicy(state)?.actionValues.find((v) => v.action === 'CLOSE_FULL');
  assert.equal(closeValue?.executionEvidence?.economicsRemainPositive, false);
  const base = buildManagementActionFrontier(state);
  const forced: ManagementActionFrontier = { ...base, selectedAction: 'CLOSE_FULL', decisionState: 'ACTION_SELECTED', policyVersion: 'p',
    policyEvidenceHash: 'c'.repeat(64), reasonCodes: ['SELECT_CLOSE_FULL'],
    actions: base.actions.map((a) => a.action === 'CLOSE_FULL'
      ? { ...a, feasibility: 'FEASIBLE' as const, blockers: [], executionEvidence: closeValue?.executionEvidence ?? null } : a) };
  const compiled = compileManagementExecutionLegDirectives(state, forced);
  assert.equal(compiled.state, 'BLOCKED');
  assert.deepEqual(compiled.blockers, ['MANAGEMENT_EXECUTION_EVIDENCE_MISSING']);
});

test('HANDOFF (D2 fixed, MGMT-BOUNDARY-UNITS): policy roll boundaries are per-share option prices the limit policy can reach', () => {
  const state = managed();
  const { frontier } = decide({ ...state, rollCandidate: target() });
  assert.equal(frontier.selectedAction, 'ROLL');
  const compiled = compileManagementExecutionLegDirectives(state, frontier);
  assert.equal(compiled.state, 'READY');
  if (compiled.state !== 'READY') return;
  const [closeLeg, openLeg] = compiled.legs;
  assert.ok(Math.abs((closeLeg?.economicBoundary ?? 0) - 1.1) < 1e-9, 'close boundary is the $1.10 per-share ask, not $110');
  assert.ok(Math.abs((openLeg?.economicBoundary ?? 0) - 1.5) < 1e-9, 'open boundary is the $1.50 per-share bid, not $150');
  const policy = { waitIntervalMs: 5_000, maxAttempts: 3, concessionFractions: [0, 0.5, 1], tickSize: 0.01 };
  const sell = decideAdaptiveLimit({ side: 'SELL', quote: { bid: 1.5, ask: 1.6, bidSize: 10, askSize: 10 } as never, attempt: 0,
    previousLimit: null, economicBoundary: openLeg?.economicBoundary ?? 0, economicsRemainPositive: true, policy });
  assert.equal(sell.action, 'PLACE');
  assert.equal(sell.limitPrice, 1.6);
  const buy = decideAdaptiveLimit({ side: 'BUY', quote: { bid: 1.0, ask: 1.1, bidSize: 10, askSize: 10 } as never, attempt: 0,
    previousLimit: null, economicBoundary: closeLeg?.economicBoundary ?? 0, economicsRemainPositive: true, policy });
  assert.equal(buy.action, 'PLACE');
  assert.equal(buy.limitPrice, 1.0);
  // a dollar-total boundary (the old defect) is still rejected by the limit policy rather than clamped
  const dollars = decideAdaptiveLimit({ side: 'SELL', quote: { bid: 1.5, ask: 1.6, bidSize: 10, askSize: 10 } as never, attempt: 0,
    previousLimit: null, economicBoundary: 150, economicsRemainPositive: true, policy });
  assert.equal(dollars.action, 'CANCEL');
  assert.equal(dollars.reason, 'ECONOMIC_BOUNDARY_UNREACHABLE');
});
