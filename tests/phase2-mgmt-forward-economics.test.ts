import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/research/point-in-time-evidence.js';
import { empiricalPolicyPromotionContractVersion } from '../src/theta/empirical-policy-promotion.js';
import {
  buildManagementActionFrontier, managementPolicyEvidenceVersion, type ManagementPolicyEvidence,
} from '../src/theta/management-action-frontier.js';
import { assembleManagementInput, type ManagementInputState } from '../src/theta/management-input-state.js';
import {
  evaluatePaperBootstrapManagementPolicy, type PaperBootstrapPolicyInput, type RollCandidate,
} from '../src/theta/paper-bootstrap-management-policy.js';
import { createPromotedManagementPolicyProvider } from '../src/theta/promoted-management-policy-provider.js';
import { evaluateAssignmentUtility } from '../src/theta/assignment-utility.js';
import {
  buildCommonHorizonComparison, forwardContinuationCashFlow, forwardRollCashFlow, sunkRealizedEconomics,
} from '../src/theta/common-horizon-economics.js';
import { evaluateRollCandidates } from '../src/theta/roll-incremental-utility.js';
import { buildShadowManagementPolicyEvidence } from '../src/theta/shadow-management-policy.js';

// Phase 2 (offline deterministic economic correctness): profit / loss / roll /
// event / liquidity management. Every assertion is on the CURRENT forward
// economics of a position; none of them may depend on historical realized P&L.

const T0 = '2026-09-12T14:00:00.000Z';   // 34 DTE to 2026-10-16
const T_NEAR = '2026-10-13T14:00:00.000Z'; // 3 DTE to 2026-10-16

interface Opts {
  readonly bid?: number | null; readonly ask?: number | null; readonly spot?: number; readonly observedAt?: string;
  readonly entry?: string; readonly realizedOption?: string; readonly realizedStock?: string; readonly fees?: string;
  readonly aegis?: string | null; readonly event?: unknown; readonly isOpen?: boolean; readonly quoteAsOf?: string;
  readonly dividends?: string;
}

function csp(o: Opts = {}): ManagementInputState {
  const observedAt = o.observedAt ?? T0;
  return assembleManagementInput({
    chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying_id: 'underlying', underlying: 'AAPL',
    option_leg_id: 'leg', option_contract_id: 'contract', quantity: '1', entry_credit_debit: o.entry ?? '200',
    contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200', expiration_date: '2026-10-16',
    multiplier: '100', bid: o.bid === undefined ? 1 : o.bid, ask: o.ask === undefined ? 1.1 : o.ask,
    quote_as_of: o.quoteAsOf ?? observedAt, feed: 'OPRA', quote_quality: 'GOOD',
    realized_option_pnl: o.realizedOption ?? '0', open_stock_shares: '0', stock_basis_per_share: null,
    realized_stock_pnl: o.realizedStock ?? '0', dividends: o.dividends ?? '0', fees: o.fees ?? '0',
    buying_power: '50000', options_buying_power: '40000', account_as_of: observedAt, fusion_snapshot_id: 'fusion',
    reconciliation_quality: 'GOOD', broker_option_symbol: 'AAPL261016P00200000', broker_option_quantity: '1',
    broker_option_side: 'short', broker_option_asset_class: 'us_option', broker_option_observed_at: observedAt,
    ledger_option_contract_quantity: '1',
    snapshot_json: { underlyingState: { last: o.spot ?? 205 }, marketSession: { isOpen: o.isOpen ?? true },
      riskState: { assignmentCapacity: 1, newRiskState: o.aegis === undefined ? 'ALLOW_FULL' : o.aegis },
      eventState: o.event === undefined ? { state: 'CLEAR' } : o.event },
    broker_position: null,
  }, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt });
}

const target = (overrides: Partial<RollCandidate> = {}): RollCandidate => ({
  optionContractId: 'target', symbol: 'AAPL261120P00195000', optionType: 'PUT', strike: 195,
  expiration: '2026-11-20', multiplier: 100, quantity: 1, bid: 1.5, ask: 1.6, ...overrides,
});

const near = (actual: number | null | undefined, expected: number, message?: string): void =>
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, message ?? `expected ~${expected}, got ${actual}`);

const decide = (input: PaperBootstrapPolicyInput) => {
  const evidence = evaluatePaperBootstrapManagementPolicy(input);
  const frontier = buildManagementActionFrontier(input, evidence);
  return { evidence, frontier };
};
const fingerprint = (input: PaperBootstrapPolicyInput) => {
  const { evidence, frontier } = decide(input);
  return { selected: frontier.selectedAction, decisionState: frontier.decisionState,
    values: evidence?.actionValues.map((v) => [v.action, v.utility, v.executionEvidence?.deterministicNetCredit ?? null,
      v.executionEvidence?.closeEconomicBoundary ?? null, v.executionEvidence?.openEconomicBoundary ?? null]) };
};

// ---------------------------------------------------------------------------
// 2. Profit management is not a fixed percentage.
// ---------------------------------------------------------------------------

test('PROFIT: gains of 10/30/50/80/92 percent with ample DTE never trigger a percentage rule', () => {
  // ask -> percent of the $200 credit that is already captured at the executable (ask-side) close cost
  const table: ReadonlyArray<readonly [number, number]> = [[1.8, 10], [1.4, 30], [1.0, 50], [0.4, 80], [0.16, 92]];
  for (const [ask, percent] of table) {
    const { frontier } = decide(csp({ bid: Math.max(0, ask - 0.05), ask }));
    assert.equal(frontier.selectedAction, 'HOLD', `${percent}% captured with 34 DTE must not be closed by a fixed target`);
  }
});

test('PROFIT: 50 percent captured with 3 DTE still holds; only a near-exhausted executable remainder closes', () => {
  assert.equal(decide(csp({ bid: 0.95, ask: 1.0, observedAt: T_NEAR })).frontier.selectedAction, 'HOLD');
  assert.equal(decide(csp({ bid: 0.4, ask: 0.5, observedAt: T_NEAR })).frontier.selectedAction, 'HOLD');
  assert.equal(decide(csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR })).frontier.selectedAction, 'CLOSE_FULL');
});

test('PROFIT: the near-exhausted boundary is closed at exactly 10 percent and open just above it', () => {
  assert.equal(decide(csp({ bid: 0.15, ask: 0.2, observedAt: T_NEAR })).frontier.selectedAction, 'CLOSE_FULL');
  assert.equal(decide(csp({ bid: 0.15, ask: 0.21, observedAt: T_NEAR })).frontier.selectedAction, 'HOLD');
});

test('PROFIT: a profitable position with remaining DTE above the ceiling is not closed even when nearly worthless', () => {
  // 8 DTE > 5 DTE ceiling, 2.5 percent executable remainder.
  const { frontier } = decide(csp({ bid: 0.04, ask: 0.05, observedAt: '2026-10-08T14:00:00.000Z' }));
  assert.equal(frontier.selectedAction, 'HOLD');
});

test('PROFIT: every unmodeled forward quantity stays UNKNOWN, never zero (EV, tail, capital opportunity cost)', () => {
  const { evidence, frontier } = decide(csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR }));
  assert.equal(frontier.economicModelState, 'EV_MODEL_NOT_EMPIRICALLY_READY');
  for (const value of evidence?.actionValues ?? []) {
    assert.equal(value.expectedFutureValue, null, `${value.action} must not fabricate a continuation EV`);
    assert.equal(value.downsideTailEstimate, null, `${value.action} must not fabricate a tail estimate`);
    assert.equal(value.opportunityCost, null, `${value.action} must not fabricate a capital opportunity cost`);
    assert.notEqual(value.executionEvidence?.empiricalEconomicsReady, true);
  }
});

test('PROFIT: event approaching and a hard-veto AEGIS state do not freeze a risk-reducing close', () => {
  const { frontier } = decide(csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR, aegis: 'HARD_VETO', event: { state: 'EVENT_NEAR' } }));
  assert.equal(frontier.selectedAction, 'CLOSE_FULL');
  assert.equal(frontier.actions.find((a) => a.action === 'CLOSE_FULL')?.feasibility, 'FEASIBLE');
  // ... while the risk-adding branch of the same frontier is blocked by AEGIS.
  assert.ok(frontier.actions.find((a) => a.action === 'ROLL')?.blockers.includes('AEGIS_NOT_APPROVED'));
});

test('PROFIT: research percentage challengers (FIXED_50 etc.) are observations and never become the final action', () => {
  const input = csp({ bid: 0.95, ask: 1.0 }); // 50 percent captured, 34 DTE
  const shadow = buildShadowManagementPolicyEvidence(input, {
    peakUnrealizedPnlSinceCapture: 150, captureStartedAt: T0, previousInput: null,
  });
  const fixed50 = shadow.challengerPolicies.find((c) => c.policy === 'FIXED_50');
  assert.equal(fixed50?.disposition, 'WOULD_CLOSE');
  assert.equal(shadow.challengerPolicies.find((c) => c.policy === 'FIFTY_PERCENT_OR_DTE_21')?.disposition, 'WOULD_CLOSE');
  assert.ok(shadow.challengerPolicies.every((c) => c.executionAuthorized === false));
  assert.equal(shadow.shadowPreferredAction, null);
  assert.equal(shadow.productionPolicyEvidence, null);
  assert.equal(shadow.executionAuthorized, false);
  assert.equal(shadow.policyReadiness, 'NOT_EMPIRICALLY_PROMOTED');
  assert.equal(decide(input).frontier.selectedAction, 'HOLD', 'the production action is independent of every challenger');
  assert.ok(shadow.actionComparisons.every((c) => c.utility === null && c.expectedAfterCostValue === null));
});

test('PROFIT: peak-then-giveback is recorded as shadow evidence but the production action uses current economics only', () => {
  const input = csp({ bid: 1.35, ask: 1.4 }); // 30 percent captured now
  const withPeak = buildShadowManagementPolicyEvidence(input, { peakUnrealizedPnlSinceCapture: 100, captureStartedAt: T0, previousInput: null });
  assert.equal(withPeak.profitPreservation.profitGiveback, 40);
  const noPeak = buildShadowManagementPolicyEvidence(input, { peakUnrealizedPnlSinceCapture: null, captureStartedAt: null, previousInput: null });
  assert.equal(noPeak.profitPreservation.profitGiveback, null, 'an unknown peak is UNKNOWN giveback, never zero giveback');
  assert.ok(noPeak.profitPreservation.unknownReasons.includes('PEAK_UNREALIZED_PNL_UNKNOWN'));
  // Production decision is a pure function of the ManagementInputState, which carries no path field.
  assert.deepEqual(fingerprint(input), fingerprint(csp({ bid: 1.35, ask: 1.4 })));
});

// ---------------------------------------------------------------------------
// Research challengers must not silently become final unless promoted.
// ---------------------------------------------------------------------------

function promotedArtifact(policyVersion = 'challenger-v1') {
  const receipt = {
    contractVersion: empiricalPolicyPromotionContractVersion, policyKind: 'MANAGEMENT', policyVersion,
    datasetVersion: 'theta-r6-dataset-v5', datasetHash: 'a'.repeat(64), featureSetVersion: 'theta-profit-preservation-v1',
    strategyVersions: ['theta-conventional-v1'], labelResolverVersion: 'theta-outcome-resolution-v1',
    executionModelVersion: 'theta-market-mark-v1',
    trainWindow: { start: '2025-01-01T00:00:00.000Z', end: '2025-06-01T00:00:00.000Z' },
    validationWindow: { start: '2025-06-08T00:00:00.000Z', end: '2025-09-01T00:00:00.000Z' },
    outOfSampleWindow: { start: '2025-09-08T00:00:00.000Z', end: '2026-01-01T00:00:00.000Z' }, embargoDays: 7,
    metrics: { effectiveIndependentN: 100, managedEpisodeWinRate: 0.6, wholeChainWinRate: 0.55, afterCostExpectedValue: 12,
      profitFactor: 1.4, averageWin: 50, averageLoss: -35, maxDrawdown: -500, expectedShortfall: -80, capitalDays: 25_000,
      brierScore: 0.2, realizedSlippage: 3, deflatedSharpeRatio: 0.8, probabilityOfBacktestOverfitting: 0.2,
      returnOnSecuredCapital: 0.08, annualizedCapitalReturn: 0.12 },
    acceptanceCriteriaVersion: 'research-acceptance-v1',
    acceptanceCriteria: [{ id: 'positive-ev', description: 'After-cost EV passes', passed: true, evidenceReference: 'experiment:1' }],
    executionEvidence: 'PROVEN', approval: 'APPROVED', approvalIdentity: 'owner-governance',
    approvalTimestamp: '2026-01-02T00:00:00.000Z',
  } as const;
  const promotion = { state: 'PROMOTED' as const, policyVersion: receipt.policyVersion, datasetHash: receipt.datasetHash,
    approvedBy: 'owner-governance', approvedAt: '2026-01-03T00:00:00.000Z', governanceVersion: 'fixture-v1',
    receiptHash: createHash('sha256').update(canonicalJson(receipt)).digest('hex') };
  return { receipt: structuredClone(receipt),
    promotion: { ...promotion, contentHash: createHash('sha256').update(JSON.stringify(promotion)).digest('hex') } };
}

const holdEvidence = (input: ManagementInputState, policyVersion: string): ManagementPolicyEvidence => ({
  contractVersion: managementPolicyEvidenceVersion, inputContentHash: input.contentHash, decidedAt: input.observedAt,
  policyVersion, comparisonComplete: true, selectedAction: 'HOLD', reasonCodes: ['CHALLENGER_TEST'],
  actionValues: [{ action: 'HOLD', expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null,
    executionCostRisk: null, opportunityCost: null, uncertainty: null, utility: 0, executionEvidence: null, reasons: [] }],
});

test('CHALLENGER: no provider exists for an absent, unapproved, or unreviewed artifact', () => {
  assert.equal(createPromotedManagementPolicyProvider(null, async () => null), null);
  const unapproved = promotedArtifact();
  const tampered = { ...unapproved, receipt: { ...unapproved.receipt, approval: 'NOT_REQUESTED' as const, approvalIdentity: null, approvalTimestamp: null } };
  assert.equal(createPromotedManagementPolicyProvider(tampered as never, async () => null), null);
  const wrongStatePromotion = { ...unapproved, promotion: { ...unapproved.promotion, state: 'CANDIDATE' as never } };
  assert.equal(createPromotedManagementPolicyProvider(wrongStatePromotion, async () => null), null);
});

test('CHALLENGER: a promoted provider drops evidence from any other policy, snapshot, or decision time', async () => {
  const input = csp();
  const provider = createPromotedManagementPolicyProvider(promotedArtifact('challenger-v1'), async (state) => holdEvidence(state, 'some-other-research-policy'));
  assert.ok(provider);
  assert.equal(await provider.evaluate(input), null, 'a challenger that is not the promoted policy version is dropped');
  const stale = createPromotedManagementPolicyProvider(promotedArtifact('challenger-v1'), async (state) =>
    ({ ...holdEvidence(state, 'challenger-v1'), inputContentHash: 'f'.repeat(64) }));
  assert.ok(stale);
  assert.equal(await stale.evaluate(input), null);
  const retimed = createPromotedManagementPolicyProvider(promotedArtifact('challenger-v1'), async (state) =>
    ({ ...holdEvidence(state, 'challenger-v1'), decidedAt: '2026-09-12T14:00:01.000Z' }));
  assert.ok(retimed);
  assert.equal(await retimed.evaluate(input), null);
  const exact = createPromotedManagementPolicyProvider(promotedArtifact('challenger-v1'), async (state) => holdEvidence(state, 'challenger-v1'));
  assert.ok(exact);
  assert.equal((await exact.evaluate(input))?.policyVersion, 'challenger-v1');
  assert.equal(exact.authority,'EMPIRICALLY_PROMOTED_MANAGEMENT_POLICY');
});

test('CHALLENGER: the frontier rejects challenger-shaped evidence that is not an exact argmax of its own comparison', () => {
  const input = csp({ bid: 0.95, ask: 1.0 });
  // A FIXED_50-style challenger that wants to CLOSE while declaring HOLD the higher utility.
  const challenger: ManagementPolicyEvidence = {
    ...holdEvidence(input, 'fixed-50-challenger'), selectedAction: 'CLOSE_FULL',
    actionValues: [
      { action: 'HOLD', expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null, executionCostRisk: null,
        opportunityCost: null, uncertainty: null, utility: 0, executionEvidence: null, reasons: [] },
      { action: 'CLOSE_FULL', expectedFutureValue: null, downsideTailEstimate: null, incrementalCapitalDays: null, executionCostRisk: null,
        opportunityCost: null, uncertainty: null, utility: -1, executionEvidence: null, reasons: [] },
    ],
  };
  const frontier = buildManagementActionFrontier(input, challenger);
  assert.equal(frontier.selectedAction, 'HOLD', 'the rejected challenger leaves only the passive fallback');
  assert.notEqual(frontier.selectedAction, 'CLOSE_FULL');
  assert.ok(frontier.reasonCodes.includes('MANAGEMENT_POLICY_SELECTION_NOT_ARGMAX'));
  assert.equal(frontier.policyVersion, null);
  assert.equal(frontier.decisionState, 'SYSTEM_HOLD_MISSING_EVIDENCE');
});

// ---------------------------------------------------------------------------
// 3. Loss management: forward economics only; no sunk-cost logic either way.
// ---------------------------------------------------------------------------

test('LOSS: small / moderate / large / deep-ITM losses are neither "must close" nor "must hold"', () => {
  const cases: ReadonlyArray<readonly [string, Opts]> = [
    ['small', { bid: 2.2, ask: 2.3 }], ['moderate', { bid: 4.9, ask: 5.0 }], ['large', { bid: 14.5, ask: 15 }],
    ['deep-itm', { bid: 30, ask: 31, spot: 170 }],
  ];
  for (const [label, opts] of cases) {
    const early = decide(csp(opts)).frontier;
    assert.equal(early.selectedAction, 'HOLD', `${label}: a red position with ample DTE is not force-closed by loss size`);
    const near = decide(csp({ ...opts, observedAt: T_NEAR })).frontier;
    assert.equal(near.selectedAction, 'HOLD', `${label}: a red position near expiry is not force-closed by loss size alone`);
  }
});

test('LOSS: a red position is still closed or rolled when - and only when - its forward economics say so', () => {
  // An in-the-red leg whose executable remainder is genuinely exhausted is not possible by definition; the symmetric
  // proof is that an identical forward state closes regardless of whether the chain is green or red historically.
  const green = csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR, realizedOption: '800' });
  const red = csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR, realizedOption: '-4000' });
  assert.equal(decide(green).frontier.selectedAction, 'CLOSE_FULL');
  assert.equal(decide(red).frontier.selectedAction, 'CLOSE_FULL');
});

test('LOSS (no sunk cost): identical forward economics with different historical realized loss yield identical decisions', () => {
  const histories: readonly Pick<Opts, 'realizedOption' | 'realizedStock' | 'fees' | 'dividends'>[] = [
    { realizedOption: '0', realizedStock: '0', fees: '0', dividends: '0' },
    { realizedOption: '-500', realizedStock: '0', fees: '1.3', dividends: '0' },
    { realizedOption: '-5000', realizedStock: '-2500', fees: '9', dividends: '12' },
    { realizedOption: '+3000', realizedStock: '700', fees: '0', dividends: '0' },
  ];
  const scenarios: ReadonlyArray<readonly [string, Opts, Partial<PaperBootstrapPolicyInput>]> = [
    ['hold', { bid: 1, ask: 1.1 }, {}],
    ['close', { bid: 0.01, ask: 0.02, observedAt: T_NEAR }, {}],
    ['roll', { bid: 1, ask: 1.1 }, { rollCandidate: target() }],
    ['roll-debit', { bid: 1, ask: 1.1 }, { rollCandidate: target({ bid: 0.3, ask: 0.4 }) }],
    ['thesis-bias', { bid: 2.5, ask: 2.6 }, { thesisFailureUtilityBias: 3 }],
  ];
  for (const [label, opts, extra] of scenarios) {
    const baseline = fingerprint({ ...csp({ ...opts, ...histories[0] }), ...extra });
    for (const history of histories.slice(1)) {
      assert.deepEqual(fingerprint({ ...csp({ ...opts, ...history }), ...extra }), baseline, `${label}: ${JSON.stringify(history)}`);
    }
  }
});

test('LOSS (no sunk cost): the roll forward net credit is independent of the old leg realized loss, and the loss is not an excuse to roll', () => {
  const before = decide({ ...csp({ realizedOption: '-5000' }), rollCandidate: target() }).evidence;
  const after = decide({ ...csp({ realizedOption: '0' }), rollCandidate: target() }).evidence;
  const net = (e: typeof before) => e?.actionValues.find((v) => v.action === 'ROLL')?.executionEvidence?.deterministicNetCredit;
  assert.equal(net(before), net(after));
  near(net(before), 40); // 150 open credit (bid) - 110 close cost (ask)
  const rollReasons = before?.actionValues.find((v) => v.action === 'ROLL')?.reasons ?? [];
  assert.ok(rollReasons.includes('SUNK_REALIZED_PNL_EXCLUDED_FROM_FORWARD_COMPARISON'));
  // A loss-recovery rationale must not appear as a reason code anywhere in the evidence.
  assert.ok(!JSON.stringify(before).match(/RECOVER_?(PREVIOUS|PRIOR)?_?LOSS|MAKE_?BACK|BREAKEVEN_RECOVERY/i));
  // And the realized loss cannot flip a net-debit roll into a selected roll.
  const debit = decide({ ...csp({ realizedOption: '-5000' }), rollCandidate: target({ bid: 0.3, ask: 0.4 }) }).frontier;
  assert.equal(debit.selectedAction, 'HOLD');
});

test('LOSS (no sunk cost): sunk and forward economics are structurally separate quantities', () => {
  assert.equal(sunkRealizedEconomics({ realizedOptionPnl: -300, realizedStockPnl: 50, dividends: 10, fees: 2 }), -242);
  assert.equal(sunkRealizedEconomics({ realizedOptionPnl: -300, realizedStockPnl: 50, dividends: 10, fees: null }), null,
    'unknown fees make sunk economics UNKNOWN, never zero fees');
  // forwardContinuationCashFlow cannot even receive sunk P&L as an input field.
  assert.deepEqual(Object.keys(forwardContinuationCashFlow({ closeCostDollars: 110, openCreditDollars: 150 })).sort(),
    ['complete', 'netCashFlow', 'reasons']);
  assert.equal(forwardContinuationCashFlow({ closeCostDollars: 110, openCreditDollars: 150 }).netCashFlow, 40);
  const horizon = buildCommonHorizonComparison(T0, { realizedOptionPnl: -300, realizedStockPnl: 0, dividends: 0, fees: 1 },
    '2026-10-16', ['2026-11-20', null, '2026-10-30']);
  assert.equal(horizon.horizonAnchor, '2026-11-20');
  assert.equal(horizon.sunkRealizedPnl, -301);
  assert.deepEqual(horizon.candidateExpirations, ['2026-10-16', '2026-11-20', '2026-10-30']);
});

test('LOSS: executable (ask-side) widening makes the roll worse without manufacturing an analytical loss', () => {
  const tight = decide({ ...csp({ bid: 1.0, ask: 1.1 }), rollCandidate: target() }).evidence;
  const wide = decide({ ...csp({ bid: 1.0, ask: 1.5 }), rollCandidate: target() }).evidence;
  const net = (e: typeof tight) => e?.actionValues.find((v) => v.action === 'ROLL')?.executionEvidence?.deterministicNetCredit;
  near(net(tight), 40);
  near(net(wide), 0); // close cost 150 now equals the 150 open credit
  // a widened ask alone never becomes an analytical loss reason on HOLD
  const hold = wide?.actionValues.find((v) => v.action === 'HOLD');
  assert.ok(!hold?.reasons.some((r) => r.startsWith('ANALYTICAL_MARK_EXCEEDS')));
});

test('LOSS: assignment attractive vs unattractive is a forward cash-flow comparison independent of premium already collected', () => {
  const itm = csp({ spot: 190, bid: 10.5, ask: 11 });
  const compare = (state: ManagementInputState, openCredit: number | null) =>
    evaluateAssignmentUtility(state, 1100, openCredit === null ? null : { openCreditDollars: openCredit });
  const a = compare(itm, null), b = compare(csp({ spot: 190, bid: 10.5, ask: 11, entry: '5' }), null);
  assert.equal(a.best?.action === 'LET_EXPIRE' || a.best?.action === 'ACCEPT_ASSIGNMENT', true, 'closing at -$1100 never beats a $0 continuation');
  assert.deepEqual(a.assessments.map((x) => [x.action, x.utility]), b.assessments.map((x) => [x.action, x.utility]),
    'the premium already collected is sunk and must not move the comparison');
  assert.equal(a.assessments.find((x) => x.action === 'CLOSE')?.utility, -1100);
  // a roll that clears the close debit and credits the account is the best forward action
  assert.equal(compare(itm, 1500).best?.action, 'ROLL');
  // an unknown opening credit is UNKNOWN, never a zero credit
  const unknown = compare(itm, null);
  assert.equal(unknown.assessments.find((x) => x.action === 'ROLL')?.utility, null);
  const nullCredit = evaluateAssignmentUtility(itm, 1100, { openCreditDollars: null });
  assert.equal(nullCredit.assessments.find((x) => x.action === 'ROLL')?.forwardCashFlowDollars, null);
  assert.deepEqual(nullCredit.assessments.find((x) => x.action === 'ROLL')?.reasons, ['ROLL_OPEN_CREDIT_UNKNOWN']);
});

test('LOSS: at the expiration cutoff broker truth selects assignment or expiry; an unfunded assignment is never accepted', () => {
  const cutoff = '2026-10-16T21:00:00.000Z';
  const base = { observedAt: cutoff, isOpen: false } as const;
  const itm = decide(csp({ ...base, spot: 190, bid: 10, ask: 10.5 }));
  assert.equal(itm.frontier.selectedAction, 'ACCEPT_ASSIGNMENT');
  assert.equal(itm.evidence, null, 'the bootstrap policy steps aside at the structural cutoff');
  const otm = decide(csp({ ...base, spot: 215, bid: 0, ask: 0.05 }));
  assert.equal(otm.frontier.selectedAction, 'LET_EXPIRE');
  // no assignment capacity -> ACCEPT_ASSIGNMENT is infeasible and not selected
  const noCapacity = csp({ ...base, spot: 190, bid: 10, ask: 10.5 });
  const stripped = { ...noCapacity, context: { ...noCapacity.context, assignmentCapacity: 0 } };
  const frontier = buildManagementActionFrontier(stripped, null);
  assert.notEqual(frontier.selectedAction, 'ACCEPT_ASSIGNMENT');
  assert.ok(frontier.actions.find((a) => a.action === 'ACCEPT_ASSIGNMENT')?.blockers.includes('NO_ASSIGNMENT_CAPACITY'));
});

test('LOSS (OWNER_POLICY characterization, MGMT-LOSS-ENTRY-ANCHOR): the near-exhausted trigger is anchored to the ORIGINAL entry credit, not to forward dollars', () => {
  // Same executable close cost ($5), same DTE, same strike/spot: the forward economics are identical.
  const richEntry = decide(csp({ bid: 0.04, ask: 0.05, observedAt: T_NEAR, entry: '200' })).frontier.selectedAction;
  const poorEntry = decide(csp({ bid: 0.04, ask: 0.05, observedAt: T_NEAR, entry: '20' })).frontier.selectedAction;
  assert.equal(richEntry, 'CLOSE_FULL');
  assert.equal(poorEntry, 'HOLD');
  // KNOWN GAP (register row MGMT-LOSS-ENTRY-ANCHOR): identical forward state diverges on a historical quantity.
});

// ---------------------------------------------------------------------------
// 4. Roll economics.
// ---------------------------------------------------------------------------

test('ROLL: complete economics are carried (close debit, open credit, net, expiry, capital-days) with the sunk loss excluded', () => {
  const evidence = decide({ ...csp({ realizedOption: '-1200' }), rollCandidate: target() }).evidence;
  const roll = evidence?.actionValues.find((v) => v.action === 'ROLL');
  // boundaries are PER-SHARE option prices (ask 1.10 to buy back, bid 1.50 to sell); the $110 / $150 totals live in the net credit
  near(roll?.executionEvidence?.closeEconomicBoundary, 1.1);
  assert.equal(roll?.executionEvidence?.openEconomicBoundary, 1.5);
  near(roll?.executionEvidence?.deterministicNetCredit, 40);
  assert.equal(roll?.executionEvidence?.empiricalEconomicsReady, false);
  assert.equal(roll?.executionEvidence?.expectedAfterCostEv, null);
  assert.deepEqual(roll?.executionEvidence?.targetContract, { symbol: 'AAPL261120P00195000', optionContractId: 'target',
    optionType: 'PUT', multiplier: 100, quantity: 1 });
  assert.ok(roll?.reasons.includes('HORIZON_ANCHOR_2026-11-20'));
  assert.ok(roll?.reasons.includes('OPEN_CREDIT_BID_SIDE_150.00'), 'the new credit is the executable bid side, not mid');
  assert.ok(roll?.reasons.includes('CLOSE_COST_ASK_SIDE_110.00'), 'the old close cost is the executable ask side, not mid');
  // capital-days: new (195*100) over 69 days minus old (200*100) over 34 days, a real signed number
  const days = (to: string) => (Date.parse(to) - Date.parse(T0)) / 86_400_000; // date-only expiry = UTC date boundary
  near(roll?.incrementalCapitalDays, 19_500 * days('2026-11-20') - 20_000 * days('2026-10-16'));
  // fees/slippage are NOT in the deterministic number: execution cost risk is a separate field
  assert.ok((roll?.executionCostRisk ?? 0) > 0);
});

test('ROLL: net credit alone does not make a roll attractive when a justified capital-day penalty exceeds it', () => {
  const input = csp();
  // higher strike (more collateral), 4 months out, credit still exceeds the close debit
  const far = target({ optionContractId: 'far', strike: 210, expiration: '2027-01-15', bid: 3.0, ask: 3.1, symbol: 'AAPL270115P00210000' });
  const free = decide({ ...input, rollCandidates: [far] }).frontier.selectedAction;
  const penalized = decide({ ...input, rollCandidates: [far], rollIncrementalCapitalDayWeight: 0.01 }).frontier.selectedAction;
  assert.equal(free, 'ROLL', 'with a zero (uninformed) capital-day weight a net-credit roll is preferred');
  assert.equal(penalized, 'HOLD', 'the same positive net credit loses to HOLD once its extra capital-days are priced');
});

test('ROLL: evaluateRollCandidates keeps every component and never lets sunk P&L or the sign of net credit alone decide', () => {
  const oldLeg = { closeCostDollars: 110, strike: 200, expiration: '2026-10-16', delta: -0.25, capitalCommittedDollars: 20_000 };
  const candidates = [
    { symbol: 'S1', optionContractId: 'a', strike: 200, expiration: '2026-11-20', delta: null, openCreditDollars: 150, capitalCommittedDollars: 20_000 },
    { symbol: 'S2', optionContractId: 'b', strike: 210, expiration: '2027-02-19', delta: null, openCreditDollars: 400, capitalCommittedDollars: 21_000 },
  ];
  const lossy = evaluateRollCandidates(oldLeg, -9_000, candidates, 0.001);
  const profitable = evaluateRollCandidates(oldLeg, +9_000, candidates, 0.001);
  assert.deepEqual(lossy.assessments.map((a) => a.rollIncrementalUtility), profitable.assessments.map((a) => a.rollIncrementalUtility));
  assert.equal(lossy.sunkRealizedPnl, -9_000, 'the immutable old realized P&L is preserved on the result');
  assert.equal(lossy.assessments[0]?.netCreditDollars, 40);
  assert.equal(lossy.assessments[1]?.netCreditDollars, 290);
  // candidate b has the bigger credit but a much larger capital-day burden: 1000 * 91d * 0.001 = 91 < 290, still wins;
  // raise the weight and the bigger credit loses to the smaller one, then to HOLD.
  const heavy = evaluateRollCandidates(oldLeg, 0, candidates, 0.01);
  assert.equal(heavy.bestCandidate?.candidate.optionContractId, 'a');
  const second = candidates[1];
  assert.ok(second);
  const prohibitive = evaluateRollCandidates(oldLeg, 0, [second], 0.5);
  assert.equal(prohibitive.bestBeatsHold, false);
  assert.throws(() => evaluateRollCandidates(oldLeg, 0, candidates, -1), /INVALID_CAPITAL_DAY_WEIGHT/);
});

test('ROLL: an unknown opening credit stays UNKNOWN and blocks ROLL; zero is not substituted', () => {
  const oldLeg = { closeCostDollars: 110, strike: 200, expiration: '2026-10-16', delta: null, capitalCommittedDollars: 20_000 };
  const unknown = evaluateRollCandidates(oldLeg, 0, [{ symbol: 'S', optionContractId: 'u', strike: 195, expiration: '2026-11-20',
    delta: null, openCreditDollars: null, capitalCommittedDollars: 19_500 }], 0);
  assert.equal(unknown.assessments[0]?.netCreditDollars, null);
  assert.equal(unknown.assessments[0]?.rollIncrementalUtility, null);
  assert.deepEqual(unknown.assessments[0]?.reasons, ['FORWARD_ECONOMICS_INCOMPLETE']);
  assert.equal(unknown.bestCandidate, null);
  assert.equal(unknown.bestBeatsHold, false);
  const unknownClose = evaluateRollCandidates({ ...oldLeg, closeCostDollars: null }, 0, [{ symbol: 'S', optionContractId: 'u',
    strike: 195, expiration: '2026-11-20', delta: null, openCreditDollars: 100, capitalCommittedDollars: 19_500 }], 0);
  assert.equal(unknownClose.assessments[0]?.netCreditDollars, null, 'an unknown CLOSE leg is as blocking as an unknown OPEN leg');
  assert.equal(forwardRollCashFlow(110, Number.NaN).complete, false);
  assert.equal(forwardRollCashFlow(-1, 100).complete, false);
  assert.equal(forwardContinuationCashFlow({ closeCostDollars: null, openCreditDollars: null }).complete, false);
  // end to end: no quote on the target, a crossed quote, or a non-finite quote never produce a selectable ROLL
  for (const bad of [target({ bid: null as never, ask: null as never }), target({ bid: 2, ask: 1 }), target({ bid: Number.NaN, ask: 1 })]) {
    const result = decide({ ...csp(), rollCandidate: bad });
    assert.equal(result.frontier.selectedAction, 'HOLD');
    const roll = result.evidence?.actionValues.find((v) => v.action === 'ROLL');
    assert.equal(roll?.utility, null);
    assert.equal(roll?.executionEvidence, null);
  }
  // and with no usable old-leg quote the roll cannot be priced either
  const noOldQuote = decide({ ...csp({ bid: null, ask: null }), rollCandidate: target() });
  assert.equal(noOldQuote.frontier.selectedAction, 'HOLD');
});

test('ROLL: a zero-credit roll beats HOLD only through the bootstrap tie rule (characterization of a policy gap)', () => {
  // net credit exactly 0: close 110, open 110 -> utility 0.5 > HOLD 0.
  const zero = decide({ ...csp(), rollCandidate: target({ bid: 1.1, ask: 1.2 }) });
  assert.equal(zero.frontier.selectedAction, 'ROLL');
  // KNOWN GAP (register row MGMT-ROLL-ZERO-CREDIT): extension of exposure for $0 net credit is selected with no priced risk.
});

// ---------------------------------------------------------------------------
// 7. Event interaction: blocks new risk, never necessary risk reduction.
// ---------------------------------------------------------------------------

test('EVENT: a blocked new-risk branch never freezes risk-reducing management on CSP_OPEN (close / assignment / expiry)', () => {
  const events: readonly unknown[] = [{ state: 'EVENT_NEAR' }, { state: 'EARNINGS_WITHIN_WINDOW' }, { state: 'UNKNOWN' }, null];
  for (const event of events) {
    const input = csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR, aegis: 'HARD_VETO', event });
    const { frontier } = decide(input);
    assert.equal(frontier.selectedAction, 'CLOSE_FULL', `event=${JSON.stringify(event)}`);
    const byAction = new Map(frontier.actions.map((a) => [a.action, a]));
    assert.equal(byAction.get('CLOSE_FULL')?.blockers.length, 0);
    assert.ok(byAction.get('ROLL')?.blockers.includes('AEGIS_NOT_APPROVED'), 'new risk is the thing that is blocked');
    assert.ok(byAction.get('REDEPLOY')?.blockers.includes('AEGIS_NOT_APPROVED'));
  }
  // assignment and expiry at the cutoff are unaffected by an event or a veto
  const cutoff = '2026-10-16T21:00:00.000Z';
  assert.equal(decide(csp({ observedAt: cutoff, isOpen: false, spot: 190, bid: 10, ask: 10.5, aegis: 'HARD_VETO',
    event: { state: 'EVENT_NEAR' } })).frontier.selectedAction, 'ACCEPT_ASSIGNMENT');
  assert.equal(decide(csp({ observedAt: cutoff, isOpen: false, spot: 215, bid: 0, ask: 0.05, aegis: 'HARD_VETO',
    event: { state: 'EVENT_NEAR' } })).frontier.selectedAction, 'LET_EXPIRE');
});

test('EVENT: unknown AEGIS state blocks only the new-risk actions, with an UNKNOWN (not zero-risk) reason', () => {
  const { frontier } = decide(csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR, aegis: null }));
  assert.equal(frontier.selectedAction, 'CLOSE_FULL');
  assert.ok(frontier.actions.find((a) => a.action === 'ROLL')?.blockers.includes('AEGIS_STATE_UNKNOWN'));
});

test('EVENT: an event state can never by itself manufacture a roll or a close in the bootstrap ranking', () => {
  const baseline = fingerprint(csp());
  for (const event of [{ state: 'EVENT_NEAR' }, { state: 'PRESENT' }, 'earnings', { state: 'CLEAR' }, null]) {
    assert.deepEqual(fingerprint(csp({ event })), baseline, JSON.stringify(event));
  }
});

// ---------------------------------------------------------------------------
// 8. Liquidity interaction: never a fake executable price.
// ---------------------------------------------------------------------------

test('LIQUIDITY: no two-sided option quote leaves management at HOLD with UNKNOWN (not zero) close economics', () => {
  for (const quote of [{ bid: null, ask: null }, { bid: 1, ask: null }, { bid: null, ask: 1 }]) {
    const input = csp({ ...quote, observedAt: T_NEAR });
    const { evidence, frontier } = decide(input);
    assert.equal(frontier.selectedAction, 'HOLD');
    const close = frontier.actions.find((a) => a.action === 'CLOSE_FULL');
    assert.notEqual(close?.feasibility, 'FEASIBLE');
    assert.ok(close?.blockers.includes('EXECUTABLE_OPTION_QUOTE_UNKNOWN'));
    const value = evidence?.actionValues.find((v) => v.action === 'CLOSE_FULL');
    assert.equal(value?.utility ?? null, null, 'no fabricated close utility without a quote');
    assert.equal(value?.executionEvidence ?? null, null, 'no fabricated executable boundary');
  }
});

test('LIQUIDITY: a stale broker quote disqualifies CLOSE and ROLL (no stale-price execution) while HOLD stays available', () => {
  const stale = csp({ bid: 0.01, ask: 0.02, observedAt: T_NEAR, quoteAsOf: '2026-10-13T10:00:00.000Z' });
  assert.ok(stale.hardBlockers.includes('BROKER_DATA_STALE'));
  const { frontier } = decide({ ...stale, rollCandidate: target() });
  assert.equal(frontier.selectedAction, 'HOLD', 'an otherwise near-exhausted close is not taken on a stale price');
  for (const action of ['CLOSE_FULL', 'ROLL'] as const) {
    const row = frontier.actions.find((a) => a.action === action);
    assert.equal(row?.feasibility, 'INFEASIBLE');
    assert.ok(row?.blockers.includes('EXECUTION_MARKET_NOT_QUALIFIED'));
  }
  assert.equal(frontier.actions.find((a) => a.action === 'HOLD')?.feasibility, 'FEASIBLE');
});

test('LIQUIDITY: a crossed or non-finite current quote produces no close cost at all', () => {
  for (const quote of [{ bid: 2, ask: 1 }, { bid: -1, ask: 1 }]) {
    const { evidence, frontier } = decide(csp({ ...quote, observedAt: T_NEAR }));
    assert.equal(frontier.selectedAction, 'HOLD');
    const close = evidence?.actionValues.find((v) => v.action === 'CLOSE_FULL');
    assert.equal(close?.utility ?? null, null);
  }
});

test('LIQUIDITY: one liquid and one illiquid roll leg - only the fully quoted target is priced, the other stays UNKNOWN', () => {
  const liquid = target({ optionContractId: 'liquid', bid: 1.5, ask: 1.6 });
  const illiquid = target({ optionContractId: 'illiquid', strike: 190, symbol: 'AAPL261120P00190000', bid: null as never, ask: null as never });
  const result = decide({ ...csp(), rollCandidates: [illiquid, liquid] });
  const roll = result.evidence?.actionValues.find((v) => v.action === 'ROLL');
  assert.equal(roll?.executionEvidence?.targetContract?.optionContractId, 'liquid');
  assert.ok(roll?.reasons.includes('BEST_OF_1_ROLL_CANDIDATES'), 'the unquoted candidate is excluded, not priced at zero');
  // when the ONLY candidate is the illiquid one, the roll is unselectable
  const onlyIlliquid = decide({ ...csp(), rollCandidates: [illiquid] });
  assert.equal(onlyIlliquid.frontier.selectedAction, 'HOLD');
  assert.equal(onlyIlliquid.evidence?.actionValues.find((v) => v.action === 'ROLL')?.utility ?? null, null);
  // a zero bid on the new leg is a KNOWN zero credit (a net debit), never a free option
  const zeroBid = decide({ ...csp(), rollCandidate: target({ bid: 0, ask: 0.5 }) });
  assert.equal(zeroBid.frontier.selectedAction, 'HOLD');
  near(zeroBid.evidence?.actionValues.find((v) => v.action === 'ROLL')?.executionEvidence?.deterministicNetCredit, -110);
});

test('LIQUIDITY: spread widening raises the executable close cost used for decisions, not the analytical mark', () => {
  const tight = decide(csp({ bid: 0.15, ask: 0.2, observedAt: T_NEAR })).evidence;
  const wide = decide(csp({ bid: 0.0, ask: 0.5, observedAt: T_NEAR })).evidence;
  const reasons = (e: typeof tight) => e?.actionValues.find((v) => v.action === 'CLOSE_FULL')?.reasons ?? [];
  assert.ok(reasons(tight).includes('CLOSE_COST_ASK_SIDE_20.00'));
  assert.ok(reasons(wide).includes('CLOSE_COST_ASK_SIDE_50.00'));
  assert.ok(reasons(wide).includes('CLOSE_COST_MID_REFERENCE_ANALYTICAL_ONLY_25.00'));
  // the same mid-market position is closable when tight and not when the executable cost is wide
  assert.equal(buildManagementActionFrontier(csp({ bid: 0.15, ask: 0.2, observedAt: T_NEAR }), tight).selectedAction, 'CLOSE_FULL');
  assert.equal(buildManagementActionFrontier(csp({ bid: 0.0, ask: 0.5, observedAt: T_NEAR }), wide).selectedAction, 'HOLD');
});

test('ROLL (D4 fixed, MGMT-ROLL-SAME-CAPITAL-EXTENSION): extending the same collateral by months IS priced in RollIncrementalUtility', () => {
  const oldLeg = { closeCostDollars: 110, strike: 200, expiration: '2026-10-16', delta: null, capitalCommittedDollars: 20_000 };
  const sameCapital = { symbol: 'S', optionContractId: 'same', strike: 200, expiration: '2027-04-16', delta: null,
    openCreditDollars: 150, capitalCommittedDollars: 20_000 };
  const result = evaluateRollCandidates(oldLeg, 0, [sameCapital], 1, T0);
  assert.equal(result.assessments[0]?.daysExtended, 182);
  const extensionDays = (Date.parse('2027-04-16') - Date.parse('2026-10-16')) / 86_400_000;
  near(result.assessments[0]?.incrementalCapitalDays, 20_000 * extensionDays);
  near(result.assessments[0]?.rollIncrementalUtility, 40 - 20_000 * extensionDays);
  // weight 0 (the default, never an invented number) leaves ranking at pure net credit
  assert.equal(evaluateRollCandidates(oldLeg, 0, [sameCapital], 0, T0).assessments[0]?.rollIncrementalUtility, 40);
});
