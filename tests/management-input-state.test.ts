import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleManagementInput, diffManagementInputs } from '../src/theta/management-input-state.js';
import { buildManagementActionFrontier } from '../src/theta/management-action-frontier.js';

const base = {
  chain_id: 'chain-1', lifecycle_state: 'CSP_OPEN', underlying_id:'underlying-1', underlying: 'AAPL',
  option_leg_id: 'leg-1', option_contract_id:'contract-1', quantity: '1',
  entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200',
  expiration_date: '2026-10-16', multiplier: '100', bid: '1.00', ask: '1.10',
  quote_as_of: '2026-09-12T14:00:00.000Z', feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '-50',
  open_stock_shares: '0', stock_basis_per_share: null, realized_stock_pnl: '0', dividends: '0', fees: '2',
  buying_power: '50000', options_buying_power: '40000', account_as_of: '2026-09-12T14:00:00.000Z', fusion_snapshot_id: 'fusion-1',
  unknown_fill_fees: false,
  snapshot_json: { eventState: { state: 'CLEAR' }, riskState: { assignmentCapacity: 2, newRiskState: 'ALLOW_FULL' },
    portfolioExposure: { concentration: 0.1, sectorCorrelation: 0.2 }, expertPriorState: { state: 'GOOD' } },
  broker_position: null,
};

test('management assembly uses executable ask for a short option and preserves whole-chain loss', () => {
  const state = assembleManagementInput(base, {
    managementInputSnapshotId: 'input-1', reconciliationSnapshotId: 'recon-1', observedAt: '2026-09-12T14:00:00.000Z',
  });
  assert.ok(state.economics.unrealizedOptionPnl !== null && Math.abs(state.economics.unrealizedOptionPnl - 90) < 1e-9);
  assert.equal(state.economics.realizedOptionPnl, -50);
  assert.ok(state.economics.wholeChainPnl !== null && Math.abs(state.economics.wholeChainPnl - 38) < 1e-9);
  assert.equal(state.market.moneyness, null);
  assert.equal(state.underlyingId,'underlying-1');
  assert.equal(state.contract.optionContractId,'contract-1');
  assert.equal(state.economicModelState, 'EV_MODEL_NOT_EMPIRICALLY_READY');
});

test('missing quote and multiplier stay unknown and create mechanical blockers', () => {
  const state = assembleManagementInput({ ...base, multiplier: null, bid: null, ask: null, quote_as_of: null }, {
    managementInputSnapshotId: 'input-2', reconciliationSnapshotId: 'recon-1', observedAt: '2026-09-12T14:00:00.000Z',
  });
  assert.equal(state.economics.unrealizedOptionPnl, null);
  assert.equal(state.economics.wholeChainPnl, null);
  assert.deepEqual(state.hardBlockers, ['EXECUTABLE_QUOTE_UNAVAILABLE', 'MULTIPLIER_UNKNOWN']);
  assert.ok(state.unknownFields.includes('market.iv'));
  assert.ok(state.unknownFields.includes('context.dividendExDateState'));
});

test('a management candidate received after the decision time cannot enter an earlier frozen input',()=>{
  const candidate={optionContractId:'target-1',symbol:'AAPL261023P00195000',optionType:'PUT' as const,
    strike:195,expiration:'2026-10-23',multiplier:100,quantity:1,bid:1.5,ask:1.6,
    quoteSnapshotId:7,quoteTimestamp:'2026-09-12T14:00:00.000Z',
    quoteReceivedAt:'2026-09-12T14:00:01.000Z',quoteFeed:'PAPER_INDICATIVE_REFERENCE' as const};
  const state=assembleManagementInput(base,{managementInputSnapshotId:'candidate-timing',
    reconciliationSnapshotId:'recon-1',observedAt:'2026-09-12T14:00:00.000Z',
    managementCandidateDiscovery:{contractVersion:'theta-management-candidate-discovery-v1',state:'READY',
      provider:'ALPACA',quoteSemantics:'PAPER_INDICATIVE_REFERENCE',observedAt:'2026-09-12T14:00:01.000Z',
      contractsComplete:true,quotesComplete:true,rollCandidates:[candidate],ccCandidates:[],rollCcCandidates:[],
      rejections:[],reason:null}});
  assert.equal(state.evidenceBundle.timingState,'FUTURE_EVIDENCE');
  assert.ok(state.hardBlockers.includes('EVIDENCE_OBSERVED_AFTER_DECISION'));
  assert.equal(state.managementCandidateDiscovery?.rollCandidates.length,1);
});

test('unknown broker fill fees keep whole-chain economics unknown',()=>{
  const state=assembleManagementInput({...base,unknown_fill_fees:true},{managementInputSnapshotId:'input-fees',
    reconciliationSnapshotId:'recon-1',observedAt:'2026-09-12T14:00:00.000Z'});
  assert.equal(state.economics.fees,null);
  assert.equal(state.economics.wholeChainPnl,null);
  assert.ok(state.unknownFields.includes('economics.fees'));
});

test('stale account state and malformed numeric values fail closed',()=>{
  const state=assembleManagementInput({...base,account_as_of:null,bid:' ',ask:false},{
    managementInputSnapshotId:'input-stale',reconciliationSnapshotId:'recon-1',
    observedAt:'2026-09-12T14:00:00.000Z',
  });
  assert.equal(state.market.optionBid,null);
  assert.equal(state.market.optionAsk,null);
  assert.ok(state.hardBlockers.includes('BROKER_DATA_STALE'));
  assert.ok(state.hardBlockers.includes('EXECUTABLE_QUOTE_UNAVAILABLE'));
});

test('real broker stock marks expose assigned inventory losses', () => {
  const state = assembleManagementInput({ ...base, contract_symbol: null, option_leg_id: null, quantity: null,
    entry_credit_debit: null, bid: null, ask: null, quote_as_of: null, lifecycle_state: 'RECOVERY_WAIT',
    open_stock_shares: '100', stock_basis_per_share: '198', broker_position: { currentPrice: 180 } }, {
    managementInputSnapshotId: 'input-3', reconciliationSnapshotId: 'recon-1', observedAt: '2026-09-12T14:00:00.000Z',
  });
  assert.equal(state.economics.unrealizedStockPnl, -1800);
  assert.equal(state.economics.wholeChainPnl, -1852);
});

test('management changes identify economic and market changes without treating IDs as strategy evidence', () => {
  const previous = assembleManagementInput(base, {
    managementInputSnapshotId:'old',reconciliationSnapshotId:'old-recon',observedAt:'2026-09-12T14:00:00.000Z',
  });
  const current = assembleManagementInput({ ...base, ask:'1.50' }, {
    managementInputSnapshotId:'new',reconciliationSnapshotId:'new-recon',observedAt:'2026-09-12T14:00:01.000Z',
  });
  const changes = diffManagementInputs(previous,current);
  assert.ok(changes.some((change) => change.path === 'market.optionAsk'));
  assert.ok(changes.some((change) => change.path === 'economics.unrealizedOptionPnl'));
  assert.equal(changes.some((change) => change.path === 'managementInputSnapshotId'),false);
});

test('management content hash is deterministic and excludes its random persistence id', () => {
  const first = assembleManagementInput(base, {
    managementInputSnapshotId:'one',reconciliationSnapshotId:'recon',observedAt:'2026-09-12T14:00:00.000Z',
  });
  const second = assembleManagementInput(base, {
    managementInputSnapshotId:'two',reconciliationSnapshotId:'recon',observedAt:'2026-09-12T14:00:00.000Z',
  });
  assert.equal(first.contentHash,second.contentHash);
});

test('open put assignment capacity comes from fresh broker buying power, not the unpopulated fusion risk state', () => {
  const at = '2026-10-16T20:01:00.000Z';
  const row = { ...base, expiration_date:'2026-10-16', quote_as_of:at, account_as_of:at,
    account_snapshot_id:'501', options_buying_power:'0',reconciliation_quality:'GOOD',
    broker_option_symbol:'AAPL261016P00200000',broker_option_quantity:'1',broker_option_side:'short',broker_option_asset_class:'us_option',
    broker_option_observed_at:at,ledger_option_contract_quantity:'1',
    snapshot_json:{underlyingState:{last:190},marketSession:{isOpen:false},riskState:null} };
  const input = assembleManagementInput(row, {managementInputSnapshotId:'capacity-positive',
    reconciliationSnapshotId:'recon',observedAt:at});
  assert.equal(input.context.assignmentCapacity,1);
  assert.equal(input.context.assignmentCapacityEvidence.unit,'WHOLE_CONTRACTS');
  assert.equal(input.context.assignmentCapacityEvidence.accountSnapshotId,'501');
  assert.equal(input.context.assignmentCapacityEvidence.accountObservedAt,at);
  assert.equal(input.context.assignmentCapacityEvidence.collateralPerContract,20_000);
  assert.equal(input.context.assignmentCapacityEvidence.source,'ALPACA_ACCOUNT_AND_OPTION_POSITION_RECONCILIATION');
  assert.equal(input.context.assignmentCapacityEvidence.reservedCollateral,20_000);
  assert.ok(!input.unknownFields.includes('context.assignmentCapacity'));
  const action = buildManagementActionFrontier(input).actions.find((candidate)=>candidate.action==='ACCEPT_ASSIGNMENT');
  assert.equal(action?.feasibility,'FEASIBLE');
  assert.ok(!action?.blockers.includes('ASSIGNMENT_CAPACITY_UNKNOWN'));
});

test('known insufficient assignment lots block, while unavailable or stale broker evidence stays UNKNOWN', () => {
  const at = '2026-10-16T20:01:00.000Z';
  const row = { ...base, expiration_date:'2026-10-16', quote_as_of:at, account_as_of:at,
    reconciliation_quality:'GOOD',broker_option_quantity:'1',broker_option_side:'short',
    broker_option_symbol:'AAPL261016P00200000',broker_option_asset_class:'us_option',broker_option_observed_at:at,
    ledger_option_contract_quantity:'1',
    snapshot_json:{underlyingState:{last:190},marketSession:{isOpen:false},riskState:null} };
  const assemble = (overrides:Record<string,unknown>) => assembleManagementInput({...row,...overrides},
    {managementInputSnapshotId:'capacity-test',reconciliationSnapshotId:'recon',observedAt:at});
  const zero = assemble({options_buying_power:'0',broker_option_quantity:'0'});
  assert.equal(zero.context.assignmentCapacity,0);
  assert.equal(zero.context.assignmentCapacityEvidence.state,'KNOWN');
  assert.ok(buildManagementActionFrontier(zero).actions.find((action)=>action.action==='ACCEPT_ASSIGNMENT')
    ?.blockers.includes('NO_ASSIGNMENT_CAPACITY'));
  assert.ok(zero.hardBlockers.includes('BROKER_SHORT_PUT_POSITION_UNCONFIRMED'));
  const unknown = assemble({options_buying_power:null,buying_power:null});
  assert.equal(unknown.context.assignmentCapacity,null);
  assert.equal(unknown.context.assignmentCapacityEvidence.state,'UNKNOWN');
  assert.ok(buildManagementActionFrontier(unknown).actions.find((action)=>action.action==='ACCEPT_ASSIGNMENT')
    ?.blockers.includes('ASSIGNMENT_CAPACITY_UNKNOWN'));
  const stale = assemble({account_as_of:'2026-10-16T19:00:00.000Z'});
  assert.equal(stale.context.assignmentCapacityEvidence.reason,'ACCOUNT_EVIDENCE_STALE_OR_MISSING');
  assert.equal(stale.context.assignmentCapacity,null);
  const invalidBroker = assemble({broker_option_side:null,options_buying_power:'0'});
  assert.equal(invalidBroker.context.assignmentCapacityEvidence.state,'UNKNOWN');
  assert.equal(invalidBroker.context.assignmentCapacityEvidence.reason,'BROKER_OPTION_POSITION_EVIDENCE_INVALID');
  const sharedContractDrift = assemble({ledger_option_contract_quantity:'2',broker_option_quantity:'1',options_buying_power:'0'});
  assert.equal(sharedContractDrift.context.assignmentCapacity,0);
  assert.ok(sharedContractDrift.hardBlockers.includes('BROKER_SHORT_PUT_POSITION_UNCONFIRMED'));
  const noPut = assemble({lifecycle_state:'RECOVERY_WAIT',contract_symbol:null,quantity:null});
  assert.equal(noPut.context.assignmentCapacityEvidence.state,'NOT_APPLICABLE');
  assert.ok(!noPut.unknownFields.includes('context.assignmentCapacity'));
});

test('later-received broker quote cannot authorize an earlier management decision',()=>{
  const at='2026-10-16T20:01:00.000Z';
  const later='2026-10-16T20:01:01.000Z';
  const input=assembleManagementInput({...base,expiration_date:'2026-10-16',quote_as_of:at,
    quote_retrieved_at:later,account_as_of:at,
    snapshot_json:{underlyingState:{last:190},marketSession:{isOpen:false},riskState:null}},
  {managementInputSnapshotId:'pit-future',reconciliationSnapshotId:'recon',observedAt:at});
  assert.equal(input.evidenceBundle.decisionAsOf,at);
  assert.equal(input.evidenceBundle.currentLegQuoteReceivedAt,later);
  assert.equal(input.evidenceBundle.timingState,'FUTURE_EVIDENCE');
  assert.ok(input.hardBlockers.includes('EVIDENCE_OBSERVED_AFTER_DECISION'));
  const frontier=buildManagementActionFrontier(input);
  assert.ok(frontier.actions.find((action)=>action.action==='ACCEPT_ASSIGNMENT')
    ?.blockers.includes('EVIDENCE_OBSERVED_AFTER_DECISION'));
  assert.equal(frontier.selectedAction,'HOLD');
});
