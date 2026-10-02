import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { buildManagementActionFrontier, type ManagementFrontierAction } from '../src/theta/management-action-frontier.js';
import { assembleManagementInput, type ManagementInputState } from '../src/theta/management-input-state.js';
import { jobTypesForScope } from '../src/theta/autonomous-runtime.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import {
  assertValidLifecycleTransition, InvalidLifecycleTransitionError, isValidLifecycleTransition,
  THETA_LIFECYCLE_TRANSITIONS, type ThetaLifecycleState,
} from '../src/theta/runtime-state.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 2: explicit legal-state transition matrix, legal outgoing management actions per state, the evidence each
// action requires, and the rule that existing-position management outranks a new Q entry.

// The requested vocabulary mapped onto the states that really exist in src/theta/runtime-state.ts. A null mapping is a
// state that the code does NOT model as a lifecycle state (see register rows MGMT-STATE-*).
const requestedToReal: Readonly<Record<string, ThetaLifecycleState | readonly ThetaLifecycleState[] | null>> = {
  FLAT: 'WAIT', ENTRY_PROPOSED: 'CSP_PROPOSED', ENTRY_WORKING: null, CSP_OPEN: 'CSP_OPEN',
  PROFIT_MANAGEMENT: null, LOSS_MANAGEMENT: null, // a management DECISION on CSP_OPEN (HOLD/CLOSE_FULL/ROLL), not a state
  ROLL_PROPOSED: 'ROLL_DECISION', ROLL_WORKING: null,
  EXPIRY_APPROACHING: null, // derived from market.dte === 0 inside CSP_OPEN/CC_OPEN
  ASSIGNMENT_PENDING: null, // ASSIGNED is entered only after broker-confirmed assignment
  ASSIGNED_STOCK: ['ASSIGNED', 'STOCK_HELD'], RECOVERY: 'RECOVERY_WAIT', CC_PROPOSED: 'CC_PROPOSED', CC_OPEN: 'CC_OPEN',
  CC_MANAGEMENT: null, CALL_AWAY: 'CALL_AWAY', STOCK_SOLD: 'CLOSE_STOCK', CASH: ['CLOSED', 'REDEPLOY'], SYSTEM_HOLD: null,
};

const allStates = Object.keys(THETA_LIFECYCLE_TRANSITIONS) as ThetaLifecycleState[];

// An independently written literal. If someone edits the production table, this matrix must be edited deliberately.
const legalMatrix: Readonly<Record<ThetaLifecycleState, readonly ThetaLifecycleState[]>> = {
  WAIT: ['CSP_PROPOSED'],
  CSP_PROPOSED: ['CSP_OPEN', 'WAIT'],
  CSP_OPEN: ['BTC_CLOSE', 'EXPIRE_OTM', 'ROLL_DECISION', 'ASSIGNED'],
  BTC_CLOSE: ['REDEPLOY', 'CLOSED'],
  EXPIRE_OTM: ['REDEPLOY', 'RECOVERY_WAIT'],
  ROLL_DECISION: ['CSP_PROPOSED', 'CC_PROPOSED', 'ASSIGNED'],
  ASSIGNED: ['STOCK_HELD'],
  STOCK_HELD: ['RECOVERY_WAIT'],
  RECOVERY_WAIT: ['CLOSE_STOCK', 'CC_PROPOSED'],
  CC_PROPOSED: ['CC_OPEN', 'RECOVERY_WAIT'],
  CC_OPEN: ['CLOSE_CC', 'EXPIRE_OTM', 'ROLL_DECISION', 'CALL_AWAY'],
  CLOSE_CC: ['RECOVERY_WAIT', 'CLOSE_STOCK', 'REDEPLOY'],
  CALL_AWAY: ['CLOSED'],
  CLOSE_STOCK: ['CLOSED'],
  REDEPLOY: ['WAIT'],
  CLOSED: [],
};

test('MATRIX: every requested state either maps to a real lifecycle state or is reported as not modeled', () => {
  const missing: string[] = [];
  for (const [requested, real] of Object.entries(requestedToReal)) {
    if (real === null) { missing.push(requested); continue; }
    for (const state of Array.isArray(real) ? real : [real as ThetaLifecycleState]) {
      assert.ok(allStates.includes(state), `${requested} -> ${state} must exist`);
    }
  }
  assert.deepEqual(missing.sort(), ['ASSIGNMENT_PENDING', 'CC_MANAGEMENT', 'ENTRY_WORKING', 'EXPIRY_APPROACHING',
    'LOSS_MANAGEMENT', 'PROFIT_MANAGEMENT', 'ROLL_WORKING', 'SYSTEM_HOLD']);
  assert.equal(allStates.length, 16);
});

test('MATRIX: all 256 ordered pairs are legal exactly when the independent literal says so', () => {
  assert.deepEqual([...allStates].sort(), (Object.keys(legalMatrix) as ThetaLifecycleState[]).sort());
  let legal = 0, illegal = 0;
  for (const from of allStates) {
    for (const to of allStates) {
      const expected = legalMatrix[from].includes(to);
      assert.equal(isValidLifecycleTransition(from, to), expected, `${from} -> ${to}`);
      if (expected) { legal += 1; assert.doesNotThrow(() => assertValidLifecycleTransition(from, to)); }
      else {
        illegal += 1;
        assert.throws(() => assertValidLifecycleTransition(from, to), InvalidLifecycleTransitionError, `${from} -> ${to}`);
      }
    }
  }
  assert.equal(legal, Object.values(legalMatrix).reduce((sum, row) => sum + row.length, 0));
  assert.equal(legal + illegal, 256);
});

test('MATRIX: structural invariants - CLOSED is terminal, WAIT is only re-entered by REDEPLOY, no self loops, no skipping assignment', () => {
  assert.deepEqual(THETA_LIFECYCLE_TRANSITIONS.CLOSED, []);
  for (const from of allStates) assert.ok(!THETA_LIFECYCLE_TRANSITIONS[from].includes(from), `${from} self loop`);
  const entering = (target: ThetaLifecycleState) => allStates.filter((from) => THETA_LIFECYCLE_TRANSITIONS[from].includes(target));
  assert.deepEqual(entering('WAIT').sort(), ['CSP_PROPOSED', 'REDEPLOY']);
  assert.deepEqual(entering('CSP_OPEN'), ['CSP_PROPOSED'], 'a CSP exists only after a proposal');
  assert.deepEqual(entering('STOCK_HELD'), ['ASSIGNED'], 'stock inventory only follows a broker-confirmed assignment');
  assert.deepEqual(entering('CALL_AWAY'), ['CC_OPEN'], 'called away is only reachable from an open covered call');
  assert.ok(!THETA_LIFECYCLE_TRANSITIONS.STOCK_HELD.includes('CC_PROPOSED'), 'a covered call is not proposed before recovery evaluation');
  assert.ok(!THETA_LIFECYCLE_TRANSITIONS.CSP_OPEN.includes('CSP_OPEN'));
  // every state is reachable from WAIT and can reach CLOSED (no dead-ends / orphans)
  const reach = (start: ThetaLifecycleState, edges: (s: ThetaLifecycleState) => readonly ThetaLifecycleState[]) => {
    const seen = new Set<ThetaLifecycleState>([start]); const queue = [start];
    while (queue.length > 0) for (const next of edges(queue.shift() as ThetaLifecycleState)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    return seen;
  };
  assert.equal(reach('WAIT', (s) => THETA_LIFECYCLE_TRANSITIONS[s]).size, 16);
  for (const state of allStates) assert.ok(reach(state, (s) => THETA_LIFECYCLE_TRANSITIONS[s]).has('CLOSED'), `${state} reaches CLOSED`);
});

// ---------------------------------------------------------------------------
// Management inputs for every lifecycle state.
// ---------------------------------------------------------------------------
const NOW = '2026-09-12T14:00:00.000Z';

function managementInput(lifecycle: ThetaLifecycleState, overrides: Record<string, unknown> = {}, observedAt = NOW,
  extra: { readonly spot?: number; readonly aegis?: string | null; readonly isOpen?: boolean } = {}): ManagementInputState {
  const hasOption = lifecycle === 'CSP_OPEN' || lifecycle === 'CC_OPEN';
  const optionType = lifecycle === 'CC_OPEN' ? 'CALL' : 'PUT';
  const hasStock = ['STOCK_HELD', 'RECOVERY_WAIT', 'CC_OPEN', 'CC_PROPOSED', 'CLOSE_STOCK'].includes(lifecycle);
  return assembleManagementInput({
    chain_id: 'chain', lifecycle_state: lifecycle, underlying_id: 'underlying', underlying: 'AAPL',
    option_leg_id: hasOption ? 'leg' : null, option_contract_id: hasOption ? 'contract' : null,
    quantity: hasOption ? '1' : null, entry_credit_debit: hasOption ? '200' : null,
    contract_symbol: hasOption ? `AAPL261016${optionType === 'CALL' ? 'C' : 'P'}00200000` : null,
    option_type: hasOption ? optionType : null, strike: hasOption ? '200' : null, expiration_date: hasOption ? '2026-10-16' : null,
    multiplier: hasOption ? '100' : null, bid: hasOption ? '1' : null, ask: hasOption ? '1.1' : null,
    quote_as_of: hasOption ? observedAt : null, feed: hasOption ? 'OPRA' : null, quote_quality: hasOption ? 'GOOD' : null,
    realized_option_pnl: '0', open_stock_shares: hasStock ? '100' : '0', stock_basis_per_share: hasStock ? '195' : null,
    realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000', options_buying_power: '40000',
    account_as_of: observedAt, fusion_snapshot_id: 'fusion', reconciliation_quality: 'GOOD',
    broker_option_symbol: hasOption ? `AAPL261016${optionType === 'CALL' ? 'C' : 'P'}00200000` : null,
    broker_option_quantity: hasOption ? '1' : null, broker_option_side: hasOption ? 'short' : null,
    broker_option_asset_class: hasOption ? 'us_option' : null, broker_option_observed_at: hasOption ? observedAt : null,
    ledger_option_contract_quantity: hasOption ? '1' : '0',
    snapshot_json: { underlyingState: { last: extra.spot ?? (hasStock ? 190 : 205) }, marketSession: { isOpen: extra.isOpen ?? true },
      riskState: { assignmentCapacity: 1, newRiskState: extra.aegis === undefined ? 'ALLOW_FULL' : extra.aegis },
      eventState: { state: 'CLEAR' } },
    broker_position: hasStock ? { currentPrice: extra.spot ?? 190 } : null, ...overrides,
  }, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt });
}

const actionSetByState: Readonly<Partial<Record<ThetaLifecycleState, readonly ManagementFrontierAction[]>>> = {
  CSP_OPEN: ['HOLD', 'CLOSE_FULL', 'ROLL', 'LET_EXPIRE', 'ACCEPT_ASSIGNMENT', 'REDEPLOY'],
  // MGMT-STOCKHELD-ACTION-EDGE fixed: STOCK_HELD may only wait; exits start at RECOVERY_WAIT (the only state the fill applier accepts)
  STOCK_HELD: ['RECOVERY_WAIT'],
  RECOVERY_WAIT: ['RECOVERY_WAIT', 'SELL_STOCK', 'SELL_CC'],
  CC_OPEN: ['HOLD_CC', 'CLOSE_CC', 'ROLL_CC', 'ALLOW_CALL_AWAY'],
};

test('ACTIONS: states with an open exposure expose exactly the legal outgoing management actions; every other state exposes none', () => {
  for (const state of allStates) {
    const frontier = buildManagementActionFrontier(managementInput(state));
    const expected = actionSetByState[state] ?? [];
    assert.deepEqual(frontier.actions.map((a) => a.action), expected, state);
    if (expected.length === 0) {
      assert.equal(frontier.selectedAction, null, `${state} must not select an action`);
      assert.equal(frontier.decisionState, 'SYSTEM_HOLD_MISSING_EVIDENCE');
      assert.deepEqual(frontier.reasonCodes, ['LIFECYCLE_STATE_HAS_NO_MANAGEMENT_FRONTIER']);
    }
  }
});

test('ACTIONS: every selectable management action maps to a legal lifecycle edge (REDEPLOY is never selectable inside the cycle)', () => {
  const nextState: Readonly<Record<string, ThetaLifecycleState | null>> = {
    // CSP_OPEN
    CLOSE_FULL: 'BTC_CLOSE', ROLL: 'ROLL_DECISION', LET_EXPIRE: 'EXPIRE_OTM', ACCEPT_ASSIGNMENT: 'ASSIGNED',
    // STOCK_HELD / RECOVERY_WAIT
    SELL_STOCK: 'CLOSE_STOCK', SELL_CC: 'CC_PROPOSED',
    // CC_OPEN
    CLOSE_CC: 'CLOSE_CC', ROLL_CC: 'ROLL_DECISION', ALLOW_CALL_AWAY: 'CALL_AWAY',
  };
  const passive = new Set<ManagementFrontierAction>(['HOLD', 'RECOVERY_WAIT', 'HOLD_CC']);
  const unrealizable: string[] = [];
  for (const [state, actions] of Object.entries(actionSetByState) as [ThetaLifecycleState, readonly ManagementFrontierAction[]][]) {
    for (const action of actions) {
      if (passive.has(action) || action === 'REDEPLOY') continue;
      const to = nextState[action];
      assert.ok(to, `${action} needs a mapped next state`);
      if (!isValidLifecycleTransition(state, to)) unrealizable.push(`${state}:${action}->${to}`);
    }
  }
  // MGMT-STOCKHELD-ACTION-EDGE (fixed): STOCK_HELD used to offer SELL_STOCK / SELL_CC although the transition table (and the fill
  // applier, which applies COVERED_CALL_OPEN / STOCK_DISPOSAL only from RECOVERY_WAIT) allow only STOCK_HELD -> RECOVERY_WAIT. Every
  // offered action now maps to a legal edge; no management action can produce a fill the ledger cannot apply.
  assert.deepEqual(unrealizable.sort(), []);
  assert.deepEqual(THETA_LIFECYCLE_TRANSITIONS.STOCK_HELD, ['RECOVERY_WAIT']);
  const redeploy = buildManagementActionFrontier(managementInput('CSP_OPEN')).actions.find((a) => a.action === 'REDEPLOY');
  assert.equal(redeploy?.feasibility, 'UNKNOWN');
  assert.ok(redeploy?.blockers.includes('CURRENT_EXPOSURE_NOT_RESOLVED'));
  assert.ok(!isValidLifecycleTransition('CSP_OPEN', 'REDEPLOY'), 'REDEPLOY is only reached after BTC_CLOSE / EXPIRE_OTM / CLOSE_CC');
});

test('EVIDENCE: each action is blocked, never defaulted feasible, when its required evidence is absent', () => {
  const blockers = (state: ManagementInputState, action: ManagementFrontierAction) =>
    buildManagementActionFrontier(state).actions.find((a) => a.action === action)?.blockers ?? ['<missing action>'];

  const csp = managementInput('CSP_OPEN');
  assert.deepEqual(blockers(csp, 'HOLD'), [], 'HOLD needs no evidence');
  assert.ok(blockers(csp, 'LET_EXPIRE').includes('NOT_AT_EXPIRATION'));
  assert.ok(blockers(csp, 'ACCEPT_ASSIGNMENT').includes('NOT_AT_ASSIGNMENT_WINDOW'));
  assert.ok(blockers(csp, 'ACCEPT_ASSIGNMENT').includes('OPTION_NOT_ITM_FOR_ASSIGNMENT'));
  assert.ok(blockers(csp, 'ROLL').includes('EMPIRICAL_ACTION_EV_UNKNOWN'), 'a roll never opens without known economics');

  const noQuote = managementInput('CSP_OPEN', { bid: null, ask: null });
  assert.ok(blockers(noQuote, 'CLOSE_FULL').includes('EXECUTABLE_OPTION_QUOTE_UNKNOWN'));
  assert.ok(blockers(noQuote, 'ROLL').includes('EXECUTABLE_OPTION_QUOTE_UNKNOWN'));

  const noAegis = managementInput('CSP_OPEN', {}, NOW, { aegis: null });
  assert.ok(blockers(noAegis, 'ROLL').includes('AEGIS_STATE_UNKNOWN'));
  const veto = managementInput('CSP_OPEN', {}, NOW, { aegis: 'HARD_VETO' });
  assert.ok(blockers(veto, 'ROLL').includes('AEGIS_NOT_APPROVED'));
  assert.deepEqual(blockers(veto, 'CLOSE_FULL'), [], 'a hard veto on new risk never blocks the risk-reducing close');

  const recovery = managementInput('RECOVERY_WAIT');
  assert.deepEqual(blockers(recovery, 'RECOVERY_WAIT'), []);
  assert.deepEqual(blockers(recovery, 'SELL_STOCK'), []);
  assert.ok(blockers(recovery, 'SELL_CC').includes('EMPIRICAL_ACTION_EV_UNKNOWN'));
  const noStock = managementInput('RECOVERY_WAIT', { open_stock_shares: '0' });
  assert.ok(blockers(noStock, 'SELL_STOCK').includes('NO_OPEN_STOCK_INVENTORY'));
  assert.ok(blockers(noStock, 'SELL_CC').includes('NO_OPEN_STOCK_INVENTORY'));
  const recoveryVeto = managementInput('RECOVERY_WAIT', {}, NOW, { aegis: 'HARD_VETO' });
  assert.deepEqual(blockers(recoveryVeto, 'SELL_STOCK'), [], 'liquidating inventory is risk-reducing and survives a veto');
  assert.ok(blockers(recoveryVeto, 'SELL_CC').includes('AEGIS_NOT_APPROVED'));

  const cc = managementInput('CC_OPEN');
  assert.deepEqual(blockers(cc, 'HOLD_CC'), []);
  assert.ok(blockers(cc, 'ALLOW_CALL_AWAY').includes('NOT_AT_CALL_AWAY_WINDOW'));
  assert.ok(blockers(cc, 'ROLL_CC').includes('EMPIRICAL_ACTION_EV_UNKNOWN'));
  const ccNoQuote = managementInput('CC_OPEN', { bid: null, ask: null });
  assert.ok(blockers(ccNoQuote, 'CLOSE_CC').includes('EXECUTABLE_OPTION_QUOTE_UNKNOWN'));
  const ccVeto = managementInput('CC_OPEN', {}, NOW, { aegis: 'HARD_VETO' });
  assert.deepEqual(blockers(ccVeto, 'CLOSE_CC'), []);
  assert.ok(blockers(ccVeto, 'ROLL_CC').includes('AEGIS_NOT_APPROVED'));
});

test('EVIDENCE: evidence observed after the decision time blocks every active action but never the passive ones', () => {
  for (const state of ['CSP_OPEN', 'RECOVERY_WAIT', 'CC_OPEN'] as const) {
    const input = managementInput(state);
    const future = { ...input, evidenceBundle: { ...input.evidenceBundle, timingState: 'FUTURE_EVIDENCE' as const } };
    const frontier = buildManagementActionFrontier(future);
    for (const action of frontier.actions) {
      if (['HOLD', 'RECOVERY_WAIT', 'HOLD_CC'].includes(action.action)) assert.ok(!action.blockers.includes('EVIDENCE_OBSERVED_AFTER_DECISION'));
      else assert.ok(action.blockers.includes('EVIDENCE_OBSERVED_AFTER_DECISION'), `${state}:${action.action}`);
    }
  }
});

test('EVIDENCE: without policy evidence the frontier is a conservative SYSTEM_HOLD, never an invented winner', () => {
  for (const state of ['CSP_OPEN', 'RECOVERY_WAIT', 'CC_OPEN'] as const) {
    const frontier = buildManagementActionFrontier(managementInput(state));
    assert.equal(frontier.decisionState === 'SYSTEM_HOLD_MISSING_EVIDENCE' || frontier.decisionState === 'ACTION_SELECTED', true);
    assert.ok(['HOLD', 'RECOVERY_WAIT', 'HOLD_CC', null].includes(frontier.selectedAction as never));
    assert.ok(frontier.reasonCodes.includes('EV_MODEL_NOT_EMPIRICALLY_READY'));
    assert.equal(frontier.economicModelState, 'EV_MODEL_NOT_EMPIRICALLY_READY');
  }
});

test('EVIDENCE: structural expiry selects by broker truth only: ITM CC is called away, OTM CC and everything else HOLDs', () => {
  const cutoff = '2026-10-16T21:00:00.000Z';
  const itm = buildManagementActionFrontier(managementInput('CC_OPEN', {}, cutoff, { spot: 210, isOpen: false }));
  assert.equal(itm.selectedAction, 'ALLOW_CALL_AWAY');
  assert.equal(itm.decisionState, 'ACTION_SELECTED');
  const otm = buildManagementActionFrontier(managementInput('CC_OPEN', {}, cutoff, { spot: 190, isOpen: false }));
  assert.equal(otm.selectedAction, 'HOLD_CC');
  const noShares = managementInput('CC_OPEN', { open_stock_shares: '0' }, cutoff, { spot: 210, isOpen: false });
  const refused = buildManagementActionFrontier(noShares);
  assert.notEqual(refused.selectedAction, 'ALLOW_CALL_AWAY', 'a call-away is never assumed without confirmed covering shares');
  assert.ok(refused.actions.find((a) => a.action === 'ALLOW_CALL_AWAY')?.blockers.includes('CALL_AWAY_SHARES_NOT_CONFIRMED'));
});

// ---------------------------------------------------------------------------
// Existing-position management outranks a new Q entry.
// ---------------------------------------------------------------------------
const CNOW = '2026-09-14T15:00:00.000Z';
const contract = () => normalizeOptionContract({
  source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
  optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
  underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: CNOW,
  bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1, quoteTimestamp: CNOW, tradeTimestamp: CNOW,
  volume: 250, volumeSource: 'ALPACA', openInterest: 1200, openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01,
  theta: -0.04, vega: 0.12, rho: -0.03, greeksTimestamp: CNOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
}, CNOW);

const routing = (eligible: readonly StrategyFamily[]) => {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: CNOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test route' }], policyVersion: 'router-v1',
    })),
  });
};

const frontierBase = {
  snapshotId: 'snap-1', timestamp: CNOW, strategyVersion: 'theta-strategy-package-v1', assignmentCapacityQty: 2,
  aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3,
    tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};
const heldStock = { underlying: 'AAPL', shares: 100, currentPrice: 190, brokerCostBasisPerShare: 195, wholeChainEconomicBasisPerShare: 195 };

test('PRIORITY: with a held stock position a valid Q entry is delegated to management authority and sized to zero', () => {
  const control = buildCanonicalStrategyFrontier({ ...frontierBase, stock: null, contracts: [contract()], routing: routing(['THETA_Q']) });
  assert.equal(control.primaryAction, 'OPEN_CSP', 'control: with no stock the same Q candidate is the selection');
  assert.ok(control.selectedCandidateId !== null && control.selectedQuantity > 0);

  const qId = control.selectedCandidateId as string;
  const delegated = buildCanonicalStrategyFrontier({
    ...frontierBase, stock: heldStock, contracts: [contract()], routing: routing(['THETA_Q', 'THETA_A', 'THETA_C']),
    thetaQDecision: { snapshotId: 'snap-1', timestamp: CNOW, underlying: 'AAPL', winningAction: 'OPEN_FULL',
      selectedCandidateId: qId.replace(/^THETA_CONVENTIONAL:/, ''), quantity: 2 },
  });
  assert.equal(delegated.primaryAction, 'MANAGEMENT_AUTHORITY');
  assert.equal(delegated.selectedCandidateId, null);
  assert.equal(delegated.selectedQuantity, 0);
  assert.equal(delegated.selectedBranch, null);
  assert.equal(delegated.globalWaitEarned, false);
  assert.ok(delegated.globalWaitReasons.includes('EXISTING_POSITION_DELEGATED_TO_MANAGEMENT_AUTHORITY'));
  assert.equal(delegated.executionAuthorized, false);
});

test('PRIORITY: an unmanaged broker position can never earn a GLOBAL_WAIT (management must be attached first)', () => {
  const frontier = buildCanonicalStrategyFrontier({
    ...frontierBase, stock: null, contracts: [contract()], routing: routing(['THETA_Q']),
    sizingPolicy: { ...frontierBase.sizingPolicy, riskBudgetQtyCap: 0 }, unmanagedBrokerPositionCount: 1,
  });
  assert.equal(frontier.globalWaitEarned, false);
  assert.ok(frontier.globalWaitReasons.includes('OPEN_POSITION_MANAGEMENT_NOT_ATTACHED'));
  assert.notEqual(frontier.primaryAction, 'GLOBAL_WAIT');
});

test('PRIORITY: the runtime schedules position management before the opportunity scan, and management-only scope never scans', () => {
  const full = jobTypesForScope('FULL');
  assert.ok(full.indexOf('POSITION_RECONCILIATION') < full.indexOf('POSITION_MANAGEMENT_SCAN'));
  assert.ok(full.indexOf('POSITION_MANAGEMENT_SCAN') < full.indexOf('OPPORTUNITY_SCAN'));
  assert.ok(full.indexOf('ASSIGNMENT_EXPIRY_RECONCILIATION') < full.indexOf('OPPORTUNITY_SCAN'));
  assert.ok(!jobTypesForScope('MANAGEMENT').includes('OPPORTUNITY_SCAN'));
  assert.ok(!jobTypesForScope('LIFECYCLE').includes('OPPORTUNITY_SCAN'));
  assert.ok(jobTypesForScope('MANAGEMENT').includes('POSITION_MANAGEMENT_SCAN'));
  // the risk-reducing/expiry reconciliation work is never dropped by a narrower scope that still manages positions
  assert.ok(jobTypesForScope('CORE').includes('POSITION_MANAGEMENT_SCAN'));
});

test('PRIORITY: an open CSP alone does not delegate - a second Q entry is then gated by sizing caps, not by management (policy row)', () => {
  // No stock => no THETA_RECOVERY / THETA_CC branch => managementAuthorityRequired is false. The frontier does not itself
  // block a second short put while one is open; concentration / assignment / collateral caps in the sizing policy do.
  const zeroConcentration = buildCanonicalStrategyFrontier({
    ...frontierBase, stock: null, contracts: [contract()], routing: routing(['THETA_Q']),
    sizingPolicy: { ...frontierBase.sizingPolicy, concentrationQtyCap: 0 },
  });
  assert.notEqual(zeroConcentration.primaryAction, 'MANAGEMENT_AUTHORITY');
  assert.equal(zeroConcentration.selectedQuantity, 0, 'quantity zero is the valid outcome of a binding portfolio cap');
});
