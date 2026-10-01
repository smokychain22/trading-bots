import assert from 'node:assert/strict';
import test from 'node:test';
import { routeConfirmedFillLifecycle, routeConfirmedRollPair, type ConfirmedFillFact, type FillLifecycleContext } from '../src/execution/broker-fill-lifecycle-router.js';
import { computeEffectiveStockBasis, computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

let counter = 0;
const fill = (quantity: number, pricePerShare: number, occurredAt: string): ConfirmedFillFact => {
  counter += 1;
  return { providerFillId: `f${counter}`, providerActivityRefHash: counter.toString(16).padStart(64, 'a'), quantity, pricePerShare, occurredAt, fees: null };
};
const context = (over: Partial<FillLifecycleContext> & Pick<FillLifecycleContext, 'action' | 'orderQuantity' | 'fills'>): FillLifecycleContext => ({
  orderStatus: 'FILLED', chainId: 'chain', decisionId: 'decision', optionLegId: 'leg', optionContractId: 'contract', stockLotId: null,
  multiplier: 100, entryCreditDebit: null, economicBasisPerShare: null, nextState: null, ...over,
});
const zeroComponents: WholeChainComponents = {
  cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 0, putCloseCosts: 0, rollCredits: 0, rollCloseCosts: 0, assignmentStrike: null,
  stockSharesAssigned: 0, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0, stockSaleOrCallAwayProceeds: null, fees: 0,
  executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: null, currentStockMarkPerShare: null, openStockShares: 0,
};

test('chain A: CSP open -> profit close; the routed ledger events reconcile exactly to whole-chain P&L', () => {
  const open = routeConfirmedFillLifecycle(context({ action: 'OPEN_CSP', orderQuantity: 2, fills: [fill(2, 2.0, '2026-09-14T14:30:00Z')] }));
  assert.equal(open.state, 'CONFIRMED');
  assert.equal(open.application?.eventKind, 'SHORT_PUT_OPEN');
  const credit = open.application?.eventKind === 'SHORT_PUT_OPEN' ? open.application.entryCreditDebit : NaN;
  assert.equal(credit, 400);
  const close = routeConfirmedFillLifecycle(context({ action: 'CLOSE_CSP', orderQuantity: 2, entryCreditDebit: credit, originalLegQuantity: 2,
    nextState: 'REDEPLOY', fills: [fill(2, 0.5, '2026-09-20T14:30:00Z')] }));
  assert.equal(close.application?.eventKind, 'OPTION_CLOSE');
  const realized = close.application?.eventKind === 'OPTION_CLOSE' ? close.application.realizedOptionPnl : NaN;
  assert.equal(realized, 300);
  const chain = computeWholeChainPnl({ ...zeroComponents, initialPutPremium: credit, putCloseCosts: 0.5 * 100 * 2 });
  assert.equal(chain.wholeChainPnl, realized, 'ledger event P&L == whole-chain P&L');
});

test('chain B: CSP -> losing roll -> assignment -> covered call -> call-away; the old loss is immutable and the total reconciles', () => {
  const open = routeConfirmedFillLifecycle(context({ action: 'OPEN_CSP', orderQuantity: 1, fills: [fill(1, 3.0, '2026-09-01T14:30:00Z')] }));
  const putCredit = open.application?.eventKind === 'SHORT_PUT_OPEN' ? open.application.entryCreditDebit : NaN;
  assert.equal(putCredit, 300);

  const roll = routeConfirmedRollPair({ legKind: 'SHORT_PUT', chainId: 'chain', decisionId: 'decision', oldOptionLegId: 'leg', newOptionLegId: 'leg2',
    newOptionContractId: 'contract2', multiplier: 100, oldEntryCreditDebit: putCredit,
    close: { orderStatus: 'FILLED', orderQuantity: 1, fills: [fill(1, 5.0, '2026-09-10T14:30:00Z')] },
    open: { orderStatus: 'FILLED', orderQuantity: 1, fills: [fill(1, 4.0, '2026-09-10T14:30:01Z')] } });
  assert.equal(roll.state, 'CONFIRMED');
  assert.equal(roll.application?.eventKind, 'OPTION_ROLL');
  if (roll.application?.eventKind !== 'OPTION_ROLL') throw new Error('roll expected');
  assert.equal(roll.application.oldRealizedPnl, -200, 'the old leg loss is realized and immutable');
  assert.equal(roll.application.newEntryCreditDebit, 400);

  // Assignment at strike 95 (100 shares), then a covered call and a call-away at 100.
  const ccOpen = routeConfirmedFillLifecycle(context({ action: 'OPEN_CC', orderQuantity: 1, optionLegId: 'cc', optionContractId: 'cc-contract',
    fills: [fill(1, 1.5, '2026-09-25T14:30:00Z')] }));
  const ccCredit = ccOpen.application?.eventKind === 'COVERED_CALL_OPEN' ? ccOpen.application.entryCreditDebit : NaN;
  assert.equal(ccCredit, 150);

  const components: WholeChainComponents = { ...zeroComponents, initialPutPremium: putCredit, rollCredits: roll.application.newEntryCreditDebit,
    rollCloseCosts: 5.0 * 100, assignmentStrike: 95, stockSharesAssigned: 100, coveredCallPremium: ccCredit, stockSaleOrCallAwayProceeds: 100 * 100 };
  const chain = computeWholeChainPnl(components);
  const stockPnl = 100 * 100 - 95 * 100; // 500
  assert.equal(chain.wholeChainPnl, roll.application.oldRealizedPnl + roll.application.newEntryCreditDebit + ccCredit + stockPnl);
  assert.equal(chain.wholeChainPnl, 850);
  const basis = computeEffectiveStockBasis(components).effectiveStockBasisPerShare;
  assert.equal(basis, 95 - (300 + 400 - 500) / 100, 'the roll loss raises the effective basis instead of disappearing');
  // Re-running the identical inputs is deterministic.
  assert.equal(computeWholeChainPnl(components).wholeChainPnl, 850);
});

test('a partially filled or missing broker leg can never advance the ledger', () => {
  const partial = routeConfirmedFillLifecycle(context({ action: 'OPEN_CSP', orderQuantity: 2, orderStatus: 'PARTIAL', fills: [fill(1, 2.0, '2026-09-14T14:30:00Z')] }));
  assert.equal(partial.application, null);
  const none = routeConfirmedFillLifecycle(context({ action: 'OPEN_CSP', orderQuantity: 1, fills: [] }));
  assert.equal(none.application, null);
  assert.equal(none.state, 'UNKNOWN');
});
