import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAlpacaLimitOrder } from '../src/execution/order-construction.js';
import { computeWholeChainPnl, type OptionLeg, type StockLot } from '../src/theta/ledger-contract.js';
import { forwardContinuationCashFlow, forwardRollCashFlow } from '../src/theta/common-horizon-economics.js';
import { assembleManagementInput } from '../src/theta/management-input-state.js';
import { evaluateCoveredCallCandidates, type CoveredCallCandidate } from '../src/theta/covered-call-lattice.js';
import { coveredCallContractCapacity, securedContractCapacity } from '../src/theta/secured-contract-capacity.js';

// PHASE 2 economic false-value sweep: regressions for the UNSAFE hits fixed in this pass, plus pinned SAFE guards.

const NOW = '2026-09-12T14:00:00.000Z';
const leg = (over: Partial<OptionLeg> = {}): OptionLeg => ({ optionLegId: 'leg-1', chainId: 'chain', side: 'SHORT', quantity: 1, entryCreditDebit: 200,
  openedAt: NOW, closedAt: NOW, closeReason: 'BTC_CLOSE', realizedPnl: -30, rolledFromOptionLegId: null, rolledToOptionLegId: null, ...over });
const lot = (over: Partial<StockLot> = {}): StockLot => ({ stockLotId: 'lot-1', chainId: 'chain', shares: 100, economicBasisPerShare: 50, brokerBasisPerShare: null,
  assignmentOptionLegId: 'leg-1', acquiredAt: NOW, disposedAt: NOW, disposedPricePerShare: 45, realizedPnl: -500, currentPricePerShare: null, ...over });

test('UNSAFE_ZERO fixed (ledger-contract): a closed option leg with an unknown realized P&L makes the chain total UNKNOWN, never a realized zero', () => {
  // Types allow null although the zod schema rejects it; an unparsed row must not become `?? 0`.
  const result = computeWholeChainPnl([leg({ realizedPnl: null })], [lot()], [], []);
  assert.equal(result.wholeChainPnl, null);
  assert.ok(result.valuationIssues.includes('CLOSED_OPTION_REALIZED_PNL_UNAVAILABLE'));
  const known = computeWholeChainPnl([leg({ realizedPnl: -30 })], [lot()], [], []);
  assert.equal(known.wholeChainPnl, -530);
  assert.deepEqual(known.valuationIssues, []);
});

test('UNSAFE_ZERO fixed (ledger-contract): a disposed stock lot with an unknown realized P&L makes the chain total UNKNOWN', () => {
  const result = computeWholeChainPnl([leg()], [lot({ realizedPnl: null })], [], []);
  assert.equal(result.wholeChainPnl, null);
  assert.ok(result.valuationIssues.includes('DISPOSED_STOCK_REALIZED_PNL_UNAVAILABLE'));
});

test('UNSAFE_ONE fixed (order-construction): a covered-call coverage check never assumes a 100 multiplier when the multiplier is unknown', () => {
  const base = { action: 'OPEN_CC' as const, symbol: 'AAPL261016C00180000', quantity: 2, limitPrice: 1, clientOrderId: 'cc' };
  assert.throws(() => buildAlpacaLimitOrder({ ...base, confirmedCoveredShares: 200 }), /multiplier/);
  assert.throws(() => buildAlpacaLimitOrder({ ...base, confirmedCoveredShares: 200, optionMultiplier: 150 }), /coverage/);
  assert.throws(() => buildAlpacaLimitOrder({ ...base, optionMultiplier: 100 }), /coverage/);
  const ok = buildAlpacaLimitOrder({ ...base, confirmedCoveredShares: 200, optionMultiplier: 100, committedShortCallContracts: 0 });
  assert.equal(ok.qty, 2);
  assert.equal(ok.side, 'sell');
});

test('SAFE guard: a roll never defaults a missing leg to zero; a single-leg action reports only the leg that exists', () => {
  assert.equal(forwardRollCashFlow(Number.NaN, 100).netCashFlow, null);
  assert.equal(forwardRollCashFlow(100, Number.POSITIVE_INFINITY).netCashFlow, null);
  assert.equal(forwardContinuationCashFlow({ closeCostDollars: null, openCreditDollars: null }).netCashFlow, null);
  assert.equal(forwardContinuationCashFlow({ closeCostDollars: -1, openCreditDollars: 5 }).netCashFlow, null);
  assert.equal(forwardContinuationCashFlow({ closeCostDollars: 40, openCreditDollars: null }).netCashFlow, -40);
});

test('SAFE guard: whole-chain P&L on the management state stays UNKNOWN for unknown option mark, stock mark, fees, or any past stock lot', () => {
  const row = (over: Record<string, unknown>) => assembleManagementInput({
    chain_id: 'chain', lifecycle_state: 'CSP_OPEN', underlying_id: 'underlying', underlying: 'AAPL', option_leg_id: 'leg', option_contract_id: 'contract',
    quantity: '1', entry_credit_debit: '200', contract_symbol: 'AAPL261016P00200000', option_type: 'PUT', strike: '200', expiration_date: '2026-10-16',
    multiplier: '100', bid: '1', ask: '1.1', quote_as_of: NOW, feed: 'OPRA', quote_quality: 'GOOD', realized_option_pnl: '0', open_stock_shares: '0',
    stock_basis_per_share: null, realized_stock_pnl: '0', dividends: '0', fees: '0', buying_power: '50000', options_buying_power: '40000',
    account_as_of: NOW, fusion_snapshot_id: 'fusion', reconciliation_quality: 'GOOD', broker_option_symbol: 'AAPL261016P00200000',
    broker_option_quantity: '1', broker_option_side: 'short', broker_option_asset_class: 'us_option', broker_option_observed_at: NOW,
    ledger_option_contract_quantity: '1',
    snapshot_json: { underlyingState: { last: 205 }, marketSession: { isOpen: false }, riskState: { assignmentCapacity: 1, newRiskState: 'ALLOW_FULL' }, eventState: { state: 'CLEAR' } },
    broker_position: null, ...over,
  }, { managementInputSnapshotId: 'input', reconciliationSnapshotId: 'recon', observedAt: NOW });
  assert.ok(Math.abs((row({}).economics.wholeChainPnl as number) - 90) < 1e-9, 'entry 200 - ask 1.10*100 with fees 0 is the conservative known case');
  assert.equal(row({ ask: null }).economics.wholeChainPnl, null, 'unknown ask must not become a zero option mark');
  assert.equal(row({ unknown_fill_fees: true }).economics.wholeChainPnl, null, 'unknown fill fees must not become zero fees');
  assert.equal(row({ unknown_closed_leg_pnl: true }).economics.wholeChainPnl, null);
  assert.equal(row({ has_stock_lots: true }).economics.wholeChainPnl, null, 'a chain that ever held stock cannot prove its dividends');
  assert.equal(row({ quantity: null, ledger_option_contract_quantity: null }).contract.contracts, null, 'a missing quantity is never defaulted to one contract');
});

test('SAFE guard: unknown collateral inputs make secured-contract capacity UNKNOWN, never zero collateral or unlimited capacity', () => {
  assert.equal(securedContractCapacity(null, 20_000), null);
  assert.equal(securedContractCapacity(50_000, Number.NaN), null);
  assert.equal(securedContractCapacity(50_000, 0), null);
  assert.equal(securedContractCapacity(50_000, 20_000), 2);
  assert.equal(coveredCallContractCapacity(null, 0, 0), null);
  assert.equal(coveredCallContractCapacity(250, null, 0), null);
  assert.equal(coveredCallContractCapacity(250, 0, null), null);
  assert.equal(coveredCallContractCapacity(250, 1, 0), 1);
  assert.equal(coveredCallContractCapacity(150, 1, 1), 0);
});

test('SAFE guard: a covered-call candidate with a missing quote or fee/mark inputs reports UNKNOWN economics, never a free premium', () => {
  const chain = { cashflowBasis: 'ACTUAL_FILL_CASHFLOW' as const, initialPutPremium: 100, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0,
    assignmentStrike: 50, stockSharesAssigned: 100, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: null,
    fees: null, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: null };
  const candidate: CoveredCallCandidate = { symbol: 'c', optionContractId: 'c', strike: 55, expiration: '2026-11-20', delta: null, bid: 1, ask: 1.1,
    multiplier: 100, quantity: 1, openInterest: null, volume: null, dividendExDateRisk: 'UNKNOWN', eventRisk: 'UNKNOWN' };
  const weights = { upsideSacrificePerDollarWeight: 0, spreadPerDollarWeight: 0, eventRiskPenalty: 0, dividendExDateRiskPenalty: 0, belowBasisPenalty: 0,
    provenance: { policyVersion: 'p', configurationId: 'c', effectiveVersion: 'p', sourceReason: 'phase2-sweep' } };
  const [unknownFees] = evaluateCoveredCallCandidates(49, 52, 100, chain, [candidate], weights);
  assert.equal(unknownFees?.wholeChainPnlIfCalledAway, null, 'unknown fees keep both whole-chain scenarios UNKNOWN');
  assert.equal(unknownFees?.wholeChainPnlIfNotCalled, null);
  const [unknownMark] = evaluateCoveredCallCandidates(49, null, 100, { ...chain, fees: 0 }, [candidate], weights);
  assert.equal(unknownMark?.wholeChainPnlIfNotCalled, null, 'an unknown stock mark must not become a zero mark');
  const [noQuote] = evaluateCoveredCallCandidates(49, 52, 100, { ...chain, fees: 0 }, [{ ...candidate, bid: null }], weights);
  assert.equal(noQuote?.premiumIncomeDollars, null);
  assert.equal(noQuote?.wholeChainPnlIfCalledAway, null);
});
