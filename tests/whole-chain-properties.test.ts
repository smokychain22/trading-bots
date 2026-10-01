import assert from 'node:assert/strict';
import test from 'node:test';
import { computeEffectiveStockBasis, computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

// Deterministic PRNG (mulberry32) so the property runs are reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cents = (random: () => number, max: number): number => Math.round(random() * max * 100) / 100;

function assigned(random: () => number): WholeChainComponents {
  const lots = 1 + Math.floor(random() * 5);
  const shares = lots * 100;
  return {
    cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: cents(random, 900), putCloseCosts: 0,
    rollCredits: cents(random, 600), rollCloseCosts: cents(random, 700),
    assignmentStrike: 20 + Math.floor(random() * 300), stockSharesAssigned: shares,
    dividends: cents(random, 80), coveredCallPremium: cents(random, 500), coveredCallCloseCosts: cents(random, 200),
    stockSaleOrCallAwayProceeds: 0, fees: cents(random, 10), executionCostNotEmbeddedInCashflows: cents(random, 15),
    tcaExecutionShortfall: cents(random, 5), currentStockMarkPerShare: null, openStockShares: 0,
  };
}

test('accounting identity: fully exited chain P&L == covered-call net + dividends + stock P&L measured against the effective basis', () => {
  const random = rng(20261001);
  for (let i = 0; i < 500; i++) {
    const base = assigned(random);
    const salePerShare = 10 + random() * 400;
    const components: WholeChainComponents = { ...base, stockSaleOrCallAwayProceeds: Math.round(salePerShare * base.stockSharesAssigned * 100) / 100 };
    const pnl = computeWholeChainPnl(components).wholeChainPnl;
    const basis = computeEffectiveStockBasis(components).effectiveStockBasisPerShare;
    assert.ok(pnl !== null && basis !== null, `case ${i} must be complete`);
    const expected = (components.stockSaleOrCallAwayProceeds as number) - basis * components.stockSharesAssigned
      + (components.coveredCallPremium as number) - (components.coveredCallCloseCosts as number) + (components.dividends as number);
    assert.ok(Math.abs(pnl - expected) < 1e-6, `case ${i}: ${pnl} vs ${expected}`);
  }
});

test('no loss laundering: raising any roll close cost (a realized loss) lowers whole-chain P&L by exactly that amount and raises basis', () => {
  const random = rng(7);
  for (let i = 0; i < 200; i++) {
    const base = { ...assigned(random), stockSaleOrCallAwayProceeds: 5000 };
    const worse = { ...base, rollCloseCosts: (base.rollCloseCosts as number) + 123.45 };
    const delta = (computeWholeChainPnl(base).wholeChainPnl as number) - (computeWholeChainPnl(worse).wholeChainPnl as number);
    assert.ok(Math.abs(delta - 123.45) < 1e-6);
    assert.ok((computeEffectiveStockBasis(worse).effectiveStockBasisPerShare as number)
      > (computeEffectiveStockBasis(base).effectiveStockBasisPerShare as number));
  }
});

test('any single unknown component makes the chain total UNKNOWN, never a partial sum', () => {
  const random = rng(99);
  const nullable = ['initialPutPremium', 'putCloseCosts', 'rollCredits', 'rollCloseCosts', 'dividends', 'coveredCallPremium',
    'coveredCallCloseCosts', 'fees', 'executionCostNotEmbeddedInCashflows', 'stockSaleOrCallAwayProceeds'] as const;
  for (let i = 0; i < 100; i++) {
    const base = { ...assigned(random), stockSaleOrCallAwayProceeds: 9000 };
    assert.notEqual(computeWholeChainPnl(base).wholeChainPnl, null);
    for (const key of nullable) {
      const broken = { ...base, [key]: null } as WholeChainComponents;
      assert.equal(computeWholeChainPnl(broken).wholeChainPnl, null, `${key}=null must poison the total`);
    }
  }
});

test('non-finite or impossible share identities never produce a number', () => {
  const random = rng(5);
  const base = { ...assigned(random), stockSaleOrCallAwayProceeds: 9000 };
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(computeWholeChainPnl({ ...base, initialPutPremium: bad }).wholeChainPnl, null);
    assert.equal(computeWholeChainPnl({ ...base, fees: bad }).wholeChainPnl, null);
  }
  assert.equal(computeWholeChainPnl({ ...base, openStockShares: base.stockSharesAssigned + 100 }).wholeChainPnl, null, 'more open shares than assigned');
});
