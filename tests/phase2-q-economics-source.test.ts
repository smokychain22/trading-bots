import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import {
  classifyFeeEvidence, modeledLinesInActual, sumCostLines, typedLinesFromModeledOpeningCosts,
} from '../src/theta/cost-basis-typing.js';
import { mergeOptionChain, type AlpacaOptionSnapshot, type OptionomicsChainEntry } from '../src/theta/option-chain-ingestion.js';
import { normalizeOptionContract, normalizedOptionContractSchema } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse } from '../src/theta/strategy-router-contract.js';
import { computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';
import {
  componentsFromEvidence, knownField, unknownField, wholeChainComponentEvidenceVersion,
  type WholeChainComponentEvidence,
} from '../src/theta/whole-chain-component-evidence.js';

// Phase 2 area Q items 4 and 5: executable-quote source of truth and the typing
// of modeled vs broker-actual costs. Synthetic data only.

const NOW = '2026-10-01T15:00:00.000Z';
const raw = (over: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): Parameters<typeof normalizeOptionContract>[0] => ({
  source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261106P00500000', occSymbol: 'SPY261106P00500000',
  optionType: 'PUT', strike: 500, expiration: '2026-11-06', asOfDate: '2026-10-01', multiplier: 100,
  underlyingBid: 599.9, underlyingAsk: 600.1, underlyingLast: 600, underlyingTimestamp: NOW,
  bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: null, lastTradeSize: null,
  quoteTimestamp: NOW, tradeTimestamp: null, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
  openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
  rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15, ...over,
});

const routing = parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: (['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as const).map((strategyFamily) => ({
    strategyFamily, eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
});
const caps = { riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6,
  tailRiskQtyCap: 3, correlationQtyCap: 3, liquidityQtyCap: 3, reducedStateMultiplier: 0.5 };
const frontierFor = (contracts: ReturnType<typeof normalizeOptionContract>[], openingCostPolicy: unknown = {
  commissionPerContract: 0.65, feesPerContract: 0.05, estimatedSlippagePerContract: 1.0, costModelVersion: 'cost-test' }) =>
  buildCanonicalStrategyFrontier({
    snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: 9,
    aegisNewRiskState: 'ALLOW_FULL', buyingPower: 1_000_000, brokerAllowedQty: 9, sizingPolicy: caps,
    eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0, optionomicsContext: { state: 'UNKNOWN' },
    openingCostPolicy, contracts, routing,
  } as never);
const qCandidates = (frontier: ReturnType<typeof frontierFor>) =>
  frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL')?.candidates ?? [];

test('every Q candidate economics record carries the exact contract, bid, ask, spread and quote timestamp, and premium IS the Alpaca bid', () => {
  const contract = normalizeOptionContract(raw({ bid: 3.64, ask: 3.76, strike: 706, optionSymbol: 'SPY261120P00706000', occSymbol: 'SPY261120P00706000' }), NOW);
  const [candidate] = qCandidates(frontierFor([contract]));
  assert.ok(candidate);
  const leg = candidate.legs[0];
  assert.ok(leg);
  assert.equal(leg.optionSymbol, 'SPY261120P00706000');
  assert.equal(leg.bid, 3.64);
  assert.equal(leg.ask, 3.76);
  assert.equal(leg.quoteTimestamp, NOW);
  assert.equal(candidate.spreadPct, contract.spreadPct);
  assert.ok(candidate.spreadPct !== null && Math.abs(candidate.spreadPct - 0.12 / 3.7) < 1e-9);
  assert.equal(candidate.economics.premiumPerShare, 3.64, 'the executable side for a seller is the bid, never the mid');
  assert.equal(candidate.economics.grossPremium, 364);
  assert.equal(candidate.economics.collateral, 70_600);
  assert.ok(!candidate.unknownEvidence.some((item) => item.startsWith('EXECUTION_QUOTE_REQUIRED')), 'an Alpaca-executable quote needs no further execution qualification marker');
  assert.equal(contract.source, 'ALPACA');
  assert.equal(candidate.executionAuthorized, false);
});

test('an Optionomics-sourced quote can never be executable: schema forbids it and the frontier marks EXECUTION_QUOTE_REQUIRED', () => {
  const optionomicsSourced = normalizeOptionContract(raw({ source: 'OPTIONOMICS' }), NOW);
  assert.equal(optionomicsSourced.executable, false);
  assert.match(optionomicsSourced.nonExecutableReason ?? '', /not Alpaca executable truth/);
  assert.throws(() => normalizedOptionContractSchema.parse({ ...optionomicsSourced, executable: true, nonExecutableReason: null }),
    /Paper-executable option quotes require Alpaca/);
  const [candidate] = qCandidates(frontierFor([optionomicsSourced]));
  assert.ok(candidate?.unknownEvidence.some((item) => item.startsWith('EXECUTION_QUOTE_REQUIRED:quote source is not Alpaca executable truth')));
  assert.equal(candidate?.executionAuthorized, false);
});

test('Optionomics can supply OI/volume/Greeks but never bid, ask, mid or order economics, even when its payload carries them', () => {
  const alpaca: AlpacaOptionSnapshot = { bid: 2, ask: 2.1, bidSize: 20, askSize: 18, quoteTimestamp: NOW,
    greeks: { delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03 }, impliedVolatility: 0.28, dailyVolume: null };
  const hostile = { symbol: 'SPY261106P00500000', delta: null, gamma: null, theta: null, vega: null, rho: null,
    impliedVolatility: null, volume: 100, openInterest: 300,
    bid: 9.9, ask: 10.1, mid: 10, price: 10, mark: 10, premium: 10 } as OptionomicsChainEntry;
  const listing = [{ symbol: 'SPY261106P00500000', strikePrice: 500, expirationDate: '2026-11-06', optionType: 'PUT' as const, multiplier: 100 }];
  const merged = mergeOptionChain({ underlying: 'SPY', asOfDate: '2026-10-01', contracts: listing,
    snapshotsBySymbol: new Map([['SPY261106P00500000', alpaca]]), optionomicsBySymbol: new Map([['SPY261106P00500000', hostile]]),
    requestedFeed: 'OPRA', defaultMultiplierForUnknownContracts: 100, receivedAt: NOW,
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15 });
  assert.equal(merged[0]?.bid, 2);
  assert.equal(merged[0]?.ask, 2.1);
  assert.equal(merged[0]?.midpointReference, 2.05);
  assert.equal(merged[0]?.openInterest, 300);
  assert.equal(merged[0]?.openInterestSource, 'OPTIONOMICS');
  assert.equal(merged[0]?.source, 'ALPACA');

  const noAlpaca = mergeOptionChain({ underlying: 'SPY', asOfDate: '2026-10-01', contracts: listing,
    snapshotsBySymbol: new Map(), optionomicsBySymbol: new Map([['SPY261106P00500000', hostile]]),
    requestedFeed: 'OPRA', defaultMultiplierForUnknownContracts: 100, receivedAt: NOW,
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15 });
  assert.equal(noAlpaca[0]?.bid, null, 'Optionomics bid must not fill a missing Alpaca bid');
  assert.equal(noAlpaca[0]?.ask, null);
  assert.equal(noAlpaca[0]?.executable, false);
});

test('static guard: no source file feeds an Optionomics bid/ask/mid into an option contract, premium or order economics', () => {
  const root = path.resolve('src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.ts')) files.push(full);
    }
  };
  walk(root);
  const offenders: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // Optionomics-derived values flowing into executable economics fields.
    if (/optionomics\w*\??\.(bid|ask|mid|midpoint|price|mark)\b[^;\n]*(entryPremiumPerShare|limitPrice|bid:|ask:)/i.test(text)
      || /(entryPremiumPerShare|limitPrice)\s*:\s*[^,\n]*optionomics\w*\??\.(bid|ask|mid|price|mark)/i.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
  const ingestion = readFileSync(path.resolve('src/theta/option-chain-ingestion.ts'), 'utf8');
  assert.match(ingestion, /source: 'ALPACA'/);
  assert.match(ingestion, /bid: snapshot\?\.bid \?\? null, ask: snapshot\?\.ask \?\? null/);
  assert.doesNotMatch(ingestion, /optionomics\??\.(bid|ask)/);
  // Every entry premium the Q orchestrator is handed comes from the contract's own (Alpaca) bid.
  const shadow = readFileSync(path.resolve('src/theta/theta-shadow-cycle.ts'), 'utf8');
  for (const match of shadow.matchAll(/entryPremiumPerShare:\s*([^,\n]+)/g)) assert.equal(match[1]?.trim(), 'contract.bid');
});

// ---- fees / slippage typing ------------------------------------------------------------

test('modeled opening cost splits into separately typed MODELED_OPENING_COST and SLIPPAGE_ASSUMPTION lines, never a BROKER_ACTUAL_FEE', () => {
  const [candidate] = qCandidates(frontierFor([normalizeOptionContract(raw(), NOW)]));
  const costs = candidate?.economics.modeledOpeningCosts;
  assert.ok(costs);
  assert.equal(costs.state, 'KNOWN_MODELED');
  const lines = typedLinesFromModeledOpeningCosts(costs);
  assert.deepEqual(lines.map((line) => line.kind), ['MODELED_OPENING_COST', 'SLIPPAGE_ASSUMPTION']);
  assert.ok(Math.abs((sumCostLines(lines, 'MODELED_OPENING_COST') as number) - 0.7) < 1e-12);
  assert.equal(sumCostLines(lines, 'SLIPPAGE_ASSUMPTION'), 1);
  assert.equal(sumCostLines(lines, 'BROKER_ACTUAL_FEE'), 0, 'no modeled line may be summed as an actual fee');
  assert.equal(modeledLinesInActual(lines).length, 2);
  const unknownCandidate = qCandidates(frontierFor([normalizeOptionContract(raw(), NOW)], null))[0];
  assert.ok(unknownCandidate);
  const unknown = typedLinesFromModeledOpeningCosts(unknownCandidate.economics.modeledOpeningCosts);
  assert.equal(unknown[0]?.amount, null, 'a missing cost policy is UNKNOWN, never zero');
});

const asOf = '2026-09-18T15:00:00.000Z';
const brokerSource = [{ relation: 'trade.fill', columns: ['fees', 'filled_at'], recordIds: ['f1'], observedAt: asOf }];
const modeledSource = [{ relation: 'model.cost_model_opening', columns: ['total'], recordIds: ['m1'], observedAt: asOf }];
const fixtureSource = [{ relation: 'test.fact', columns: ['value'], recordIds: ['one'], observedAt: asOf }];
function evidence(fees: WholeChainComponentEvidence['fees']): Omit<WholeChainComponentEvidence, 'components' | 'componentBlockers' | 'contentHash'> {
  return {
    contractVersion: wholeChainComponentEvidenceVersion, chainId: 'chain-one', asOf,
    initialPutPremium: knownField(200, asOf, fixtureSource), putCloseCosts: knownField(0, asOf, fixtureSource),
    rollCredits: knownField(0, asOf, fixtureSource), rollCloseCosts: knownField(0, asOf, fixtureSource),
    assignmentStrike: unknownField(asOf, ['NO_ASSIGNMENT']), stockSharesAssigned: knownField(0, asOf, fixtureSource),
    assignmentObservedAt: unknownField(asOf, ['NO_ASSIGNMENT']), dividends: knownField(0, asOf, fixtureSource),
    coveredCallPremium: knownField(0, asOf, fixtureSource), coveredCallCloseCosts: knownField(0, asOf, fixtureSource),
    stockSaleOrCallAwayProceeds: unknownField(asOf, ['NO_STOCK_EXIT']), fees,
    tcaExecutionShortfall: knownField(0, asOf, fixtureSource), currentStockMarkPerShare: unknownField(asOf, ['NO_OPEN_STOCK']),
    openStockShares: knownField(0, asOf, fixtureSource), stockLotBasisReferences: [],
  };
}

test('whole-chain realized evidence: a modeled fee is rejected as broker-actual, a broker fill fee is typed BROKER_ACTUAL_FEE, UNKNOWN stays UNKNOWN', () => {
  const modeled = componentsFromEvidence(evidence(knownField(1.7, asOf, modeledSource)));
  assert.equal(modeled.components, null);
  assert.deepEqual(modeled.blockers, ['fees:MODELED_NOT_BROKER_ACTUAL']);
  const byReason = componentsFromEvidence(evidence(knownField(1.7, asOf, brokerSource, ['MODELED_COST_ASSUMPTION'])));
  assert.deepEqual(byReason.blockers, ['fees:MODELED_NOT_BROKER_ACTUAL']);
  const actual = componentsFromEvidence(evidence(knownField(1.3, asOf, brokerSource, ['ALL_LINKED_FILLS_HAVE_EXPLICIT_FEE_VALUES'])));
  assert.equal(actual.components?.fees, 1.3);
  assert.equal(actual.components?.feeBasis, 'BROKER_ACTUAL_FEE');
  const zero = componentsFromEvidence(evidence(knownField(0, asOf, brokerSource)));
  assert.equal(zero.components?.fees, 0, 'an observed broker zero is a KNOWN zero, distinct from UNKNOWN');
  assert.equal(zero.components?.feeBasis, 'BROKER_ACTUAL_FEE');
  const unknown = componentsFromEvidence(evidence(unknownField(asOf, ['ONE_OR_MORE_FILL_FEES_UNKNOWN'], brokerSource)));
  assert.equal(unknown.components, null);
  assert.deepEqual(unknown.blockers, ['fees:UNKNOWN']);
  assert.equal(classifyFeeEvidence(unknownField(asOf, ['x'])), 'UNKNOWN_ACTUAL_FEE');
  assert.equal(classifyFeeEvidence(knownField(1, asOf, fixtureSource)), null, 'an unproven-origin fee is neither blessed as broker-actual nor flagged as modeled');
});

test('computeWholeChainPnl: realized (ACTUAL_FILL) P&L becomes UNKNOWN if its fee basis is modeled/slippage/unknown, and is unchanged for broker-actual or legacy callers', () => {
  const base: WholeChainComponents = {
    cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: 200, putCloseCosts: 50, rollCredits: 0, rollCloseCosts: 0,
    assignmentStrike: null, stockSharesAssigned: 0, dividends: 0, coveredCallPremium: 0, coveredCallCloseCosts: 0,
    stockSaleOrCallAwayProceeds: null, fees: 1.7, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: null,
    currentStockMarkPerShare: null, openStockShares: 0,
  };
  assert.equal(computeWholeChainPnl(base).wholeChainPnl, 200 - 50 - 1.7, 'legacy callers keep their numbers');
  assert.equal(computeWholeChainPnl({ ...base, feeBasis: 'BROKER_ACTUAL_FEE' }).wholeChainPnl, 200 - 50 - 1.7);
  for (const feeBasis of ['MODELED_OPENING_COST', 'MODELED_CLOSING_COST', 'SLIPPAGE_ASSUMPTION', 'UNKNOWN_ACTUAL_FEE'] as const) {
    const result = computeWholeChainPnl({ ...base, feeBasis });
    assert.equal(result.wholeChainPnl, null, `${feeBasis} must not yield a realized whole-chain P&L`);
    assert.ok(result.legLevelPnl.some((leg) => leg.label === `FEE_BASIS_NOT_BROKER_ACTUAL:${feeBasis}`));
  }
  // A forward-looking benchmark scenario may legitimately use modeled costs.
  assert.equal(computeWholeChainPnl({ ...base, cashflowBasis: 'BENCHMARK_CASHFLOW', feeBasis: 'MODELED_OPENING_COST' }).wholeChainPnl, 200 - 50 - 1.7);
});

test('persisted whole-chain fee evidence in production reads only broker fill economics (static guard on the repository)', () => {
  const repository = readFileSync(path.resolve('src/theta/postgres-whole-chain-components-repository.ts'), 'utf8');
  assert.match(repository, /source\('trade\.fill', \['fees','filled_at'\]/);
  assert.match(repository, /ONE_OR_MORE_FILL_FEES_UNKNOWN/);
  assert.doesNotMatch(repository, /modeledOpeningCosts|estimatedSlippage|feesPerContract|commissionPerContract/);
  const worker = readFileSync(path.resolve('src/execution/broker-reconciliation-worker.ts'), 'utf8');
  assert.match(worker, /VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,NULL\)/, 'a provider fill without explicit fees is stored as NULL (UNKNOWN), never a modeled fee or zero');
});
