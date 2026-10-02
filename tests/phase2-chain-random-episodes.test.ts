import assert from 'node:assert/strict';
import test from 'node:test';
import { routeConfirmedFillLifecycle, routeConfirmedRollPair, type ConfirmedFillFact, type FillLifecycleContext } from '../src/execution/broker-fill-lifecycle-router.js';
import {
  computeWholeChainPnl as computeLedgerWholeChainPnl, type DividendEvent, type FeeEvent, type OptionLeg, type StockLot,
} from '../src/theta/ledger-contract.js';
import { computeEffectiveStockBasis, computeWholeChainPnl, type WholeChainComponents } from '../src/theta/whole-chain-economics.js';

// PHASE 2: deterministic randomized chain episodes. Three independent computations must agree for every seed:
//   A) router-derived ledger events -> WholeChainComponents -> computeWholeChainPnl (whole-chain-economics.ts)
//   B) router-derived ledger rows -> ledger-contract computeWholeChainPnl
//   C) a direct signed cash-flow sum written from the episode script itself (no router, no component names)
// UNKNOWN fees / dividends must keep A UNKNOWN while the known legs still sum to the known cash flows.

const EPISODE_TYPES = ['OPEN_CLOSE', 'OPEN_ROLL_CLOSE', 'OPEN_ROLL_ASSIGNMENT', 'ASSIGNMENT_STOCK_SALE', 'ASSIGNMENT_CC_EXPIRY',
  'ASSIGNMENT_CC_CALL_AWAY', 'MULTIPLE_ROLLS', 'PARTIAL_BUYBACK'] as const;
const SEEDS_PER_TYPE = 600;
const FEE_PER_OPTION_CONTRACT = 0.65;
const MULTIPLIER = 100;

function rng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const integer = (random: () => number, low: number, high: number): number => low + Math.floor(random() * (high - low + 1));

interface Episode {
  readonly seed: number; readonly type: typeof EPISODE_TYPES[number];
  readonly components: WholeChainComponents; readonly legs: OptionLeg[]; readonly lots: StockLot[];
  readonly feeEvents: FeeEvent[]; readonly dividendEvents: DividendEvent[];
  readonly direct: number; readonly directFees: number; readonly directDividends: number | null;
  readonly putSideNet: number; readonly feesKnown: boolean; readonly assignedStrike: number | null; readonly assignedShares: number;
  readonly exitedFully: boolean; readonly ccNet: number; readonly stockProceeds: number | null;
}

let hashCounter = 0;
const fillOf = (quantity: number, pricePerShare: number, feesKnown: boolean, occurredAt: string): ConfirmedFillFact => {
  hashCounter += 1;
  return { providerFillId: `f${hashCounter}`, providerActivityRefHash: hashCounter.toString(16).padStart(64, 'a'), quantity, pricePerShare, occurredAt,
    fees: feesKnown ? FEE_PER_OPTION_CONTRACT * quantity : null };
};
const baseContext = (over: Partial<FillLifecycleContext> & Pick<FillLifecycleContext, 'action' | 'orderQuantity' | 'fills'>): FillLifecycleContext => ({
  orderStatus: 'FILLED', chainId: 'chain', decisionId: 'decision', optionLegId: 'leg', optionContractId: 'contract', stockLotId: null,
  multiplier: MULTIPLIER, entryCreditDebit: null, economicBasisPerShare: null, nextState: null, ...over,
});
const at = (day: number): string => new Date(Date.UTC(2026, 8, 1) + day * 86_400_000).toISOString();

function buildEpisode(seed: number): Episode {
  const random = rng(seed);
  const type = EPISODE_TYPES[seed % EPISODE_TYPES.length] as typeof EPISODE_TYPES[number];
  const feesKnown = random() > 0.2;
  let day = 0;
  const nextDay = (): string => at(day += 1);
  const contractsAtOpen = type === 'PARTIAL_BUYBACK' ? integer(random, 2, 4) : integer(random, 1, 4);

  let direct = 0, directFees = 0, putSideNet = 0, ccNet = 0;
  let initialPutPremium = 0, putCloseCosts = 0, rollCredits = 0, rollCloseCosts = 0, ccPremium = 0, ccCloseCosts = 0;
  const legs: OptionLeg[] = [];
  const optionFee = (contracts: number): void => { directFees += FEE_PER_OPTION_CONTRACT * contracts; };
  let legCounter = 0;
  const legRecord = (entry: number, quantity: number, openedAt: string, rolledFrom: string | null): OptionLeg => {
    legCounter += 1;
    const leg: OptionLeg = { optionLegId: `leg-${legCounter}`, chainId: 'chain', side: 'SHORT', quantity, entryCreditDebit: entry, openedAt,
      closedAt: null, closeReason: null, realizedPnl: null, rolledFromOptionLegId: rolledFrom, rolledToOptionLegId: null };
    legs.push(leg);
    return leg;
  };
  const closeLeg = (leg: OptionLeg, reason: NonNullable<OptionLeg['closeReason']>, realizedPnl: number, closedAt: string, rolledTo: string | null = null): OptionLeg => {
    const closed: OptionLeg = { ...leg, closedAt, closeReason: reason, realizedPnl, rolledToOptionLegId: rolledTo };
    legs[legs.indexOf(leg)] = closed;
    return closed;
  };

  // ---- put side -----------------------------------------------------------------------------------------------
  const openPrice = integer(random, 20, 600) / 100;
  const open = routeConfirmedFillLifecycle(baseContext({ action: 'OPEN_CSP', orderQuantity: contractsAtOpen,
    fills: [fillOf(contractsAtOpen, openPrice, feesKnown, nextDay())] }));
  assert.equal(open.application?.eventKind, 'SHORT_PUT_OPEN');
  const openEntry = open.application?.eventKind === 'SHORT_PUT_OPEN' ? open.application.entryCreditDebit : NaN;
  initialPutPremium = openEntry;
  direct += openPrice * MULTIPLIER * contractsAtOpen; putSideNet += openPrice * MULTIPLIER * contractsAtOpen; optionFee(contractsAtOpen);
  let current = legRecord(openEntry, contractsAtOpen, at(day), null);
  let contracts = contractsAtOpen;
  let strike = integer(random, 1000, 40000) / 100;
  let partialDebit = 0;

  if (type === 'PARTIAL_BUYBACK') {
    const closedContracts = integer(random, 1, contractsAtOpen - 1);
    const price = integer(random, 5, 400) / 100;
    const partial = routeConfirmedFillLifecycle(baseContext({ action: 'CLOSE_CSP', orderStatus: 'CANCELED', orderQuantity: contractsAtOpen,
      orderIntentId: 'intent', originalLegQuantity: contractsAtOpen, optionLegId: current.optionLegId, entryCreditDebit: openEntry,
      nextState: 'REDEPLOY', fills: [fillOf(closedContracts, price, feesKnown, nextDay())] }));
    assert.equal(partial.application?.eventKind, 'OPTION_PARTIAL_CLOSE');
    if (partial.application?.eventKind !== 'OPTION_PARTIAL_CLOSE') throw new Error('partial expected');
    partialDebit = partial.application.closingDebit;
    putCloseCosts += partialDebit;
    direct -= price * MULTIPLIER * closedContracts; putSideNet -= price * MULTIPLIER * closedContracts; optionFee(closedContracts);
    contracts = contractsAtOpen - closedContracts;
  }

  const rollCount = type === 'OPEN_ROLL_CLOSE' || type === 'OPEN_ROLL_ASSIGNMENT' ? integer(random, 1, 3)
    : type === 'MULTIPLE_ROLLS' ? integer(random, 2, 4)
      : (type === 'ASSIGNMENT_STOCK_SALE' || type === 'ASSIGNMENT_CC_EXPIRY' || type === 'ASSIGNMENT_CC_CALL_AWAY') ? integer(random, 0, 2) : 0;
  for (let index = 0; index < rollCount; index += 1) {
    const closePrice = integer(random, 5, 700) / 100;
    const newPrice = integer(random, 5, 700) / 100;
    const when = nextDay();
    const pair = routeConfirmedRollPair({ legKind: 'SHORT_PUT', chainId: 'chain', decisionId: 'decision', oldOptionLegId: current.optionLegId,
      newOptionLegId: `leg-${legCounter + 1}`, newOptionContractId: 'contract', multiplier: MULTIPLIER, oldEntryCreditDebit: current.entryCreditDebit as number,
      close: { orderStatus: 'FILLED', orderQuantity: contracts, fills: [fillOf(contracts, closePrice, feesKnown, when)] },
      open: { orderStatus: 'FILLED', orderQuantity: contracts, fills: [fillOf(contracts, newPrice, feesKnown, when)] } });
    assert.equal(pair.application?.eventKind, 'OPTION_ROLL');
    if (pair.application?.eventKind !== 'OPTION_ROLL') throw new Error('roll expected');
    rollCloseCosts += (current.entryCreditDebit as number) - pair.application.oldRealizedPnl;
    rollCredits += pair.application.newEntryCreditDebit;
    direct += -closePrice * MULTIPLIER * contracts + newPrice * MULTIPLIER * contracts;
    putSideNet += -closePrice * MULTIPLIER * contracts + newPrice * MULTIPLIER * contracts; optionFee(contracts * 2);
    const next = legRecord(pair.application.newEntryCreditDebit, contracts, when, current.optionLegId);
    closeLeg(current, 'ROLLED', pair.application.oldRealizedPnl, when, next.optionLegId);
    current = legs[legs.indexOf(next)] as OptionLeg;
    strike = Math.max(1, strike - integer(random, 0, 300) / 100);
  }

  const assigns = type === 'OPEN_ROLL_ASSIGNMENT' || type === 'ASSIGNMENT_STOCK_SALE' || type === 'ASSIGNMENT_CC_EXPIRY'
    || type === 'ASSIGNMENT_CC_CALL_AWAY' || (type === 'PARTIAL_BUYBACK' && random() < 0.5) || (type === 'MULTIPLE_ROLLS' && random() < 0.4);
  const lots: StockLot[] = [];
  const dividendEvents: DividendEvent[] = [];
  let assignedStrike: number | null = null, assignedShares = 0;
  let proceeds: number | null = null, openShares = 0, mark: number | null = null;
  let dividends: number | null = 0;
  let directDividends: number | null = 0;

  if (!assigns) {
    const closeIt = type === 'OPEN_CLOSE' ? random() < 0.6 : type === 'OPEN_ROLL_CLOSE' ? random() < 0.6 : false;
    if (closeIt) {
      const closePrice = integer(random, 5, 900) / 100;
      const closed = routeConfirmedFillLifecycle(baseContext({ action: 'CLOSE_CSP', orderQuantity: contracts, originalLegQuantity: contracts,
        optionLegId: current.optionLegId, entryCreditDebit: current.entryCreditDebit, nextState: 'REDEPLOY',
        fills: [fillOf(contracts, closePrice, feesKnown, nextDay())] }));
      assert.equal(closed.application?.eventKind, 'OPTION_CLOSE');
      if (closed.application?.eventKind !== 'OPTION_CLOSE') throw new Error('close expected');
      putCloseCosts += (current.entryCreditDebit as number) - closed.application.realizedOptionPnl;
      direct -= closePrice * MULTIPLIER * contracts; putSideNet -= closePrice * MULTIPLIER * contracts; optionFee(contracts);
      closeLeg(current, 'BTC_CLOSE', closed.application.realizedOptionPnl, at(day));
    } else {
      closeLeg(current, 'EXPIRE_OTM', (current.entryCreditDebit as number) - partialDebit, nextDay());
    }
  } else {
    closeLeg(current, 'ASSIGNED', (current.entryCreditDebit as number) - partialDebit, nextDay());
    assignedStrike = strike; assignedShares = contracts * MULTIPLIER;
    direct -= strike * assignedShares; // assignment cash deduction: strike * 100 * contracts, exactly once
    let lot: StockLot = { stockLotId: 'lot-1', chainId: 'chain', shares: assignedShares, economicBasisPerShare: strike, brokerBasisPerShare: null,
      assignmentOptionLegId: current.optionLegId, acquiredAt: at(day), disposedAt: null, disposedPricePerShare: null, realizedPnl: null,
      currentPricePerShare: null };

    const plan = type === 'ASSIGNMENT_STOCK_SALE' ? 'SELL' : type === 'OPEN_ROLL_ASSIGNMENT' || type === 'PARTIAL_BUYBACK' || type === 'MULTIPLE_ROLLS'
      ? (['SELL', 'HOLD'] as const)[integer(random, 0, 1)] as 'SELL' | 'HOLD'
      : type === 'ASSIGNMENT_CC_EXPIRY' ? 'CC_EXPIRY' : 'CC_CALL_AWAY';

    const ccOpen = (): { leg: OptionLeg; entry: number } => {
      const price = integer(random, 5, 400) / 100;
      const opened = routeConfirmedFillLifecycle(baseContext({ action: 'OPEN_CC', orderQuantity: contracts, optionLegId: `cc-${legCounter + 1}`,
        optionContractId: 'cc-contract', fills: [fillOf(contracts, price, feesKnown, nextDay())] }));
      assert.equal(opened.application?.eventKind, 'COVERED_CALL_OPEN');
      const entry = opened.application?.eventKind === 'COVERED_CALL_OPEN' ? opened.application.entryCreditDebit : NaN;
      ccPremium += entry; ccNet += price * MULTIPLIER * contracts; direct += price * MULTIPLIER * contracts; optionFee(contracts);
      return { leg: legRecord(entry, contracts, at(day), null), entry };
    };
    const dividendBeforeExit = (): void => {
      if (random() < 0.5) return;
      if (random() < 0.15) { dividends = null; directDividends = null; return; }
      const perShare = integer(random, 1, 80) / 100;
      dividendEvents.push({ stockLotId: 'lot-1', exDate: at(day).slice(0, 10), amountPerShare: perShare });
      dividends = perShare * assignedShares; directDividends = perShare * assignedShares; direct += perShare * assignedShares;
    };
    const sellStock = (): void => {
      const price = integer(random, Math.max(100, Math.floor(strike * 40)), Math.floor(strike * 170) + 100) / 100;
      const sold = routeConfirmedFillLifecycle(baseContext({ action: 'SELL_STOCK', orderQuantity: assignedShares, openStockLots: [{ stockLotId: 'lot-1', shares: assignedShares, economicBasisPerShare: strike, acquiredAt: at(day) }],
        multiplier: null, fills: [fillOf(assignedShares, price, true, nextDay())] }));
      assert.equal(sold.application?.eventKind, 'STOCK_DISPOSAL');
      if (sold.application?.eventKind !== 'STOCK_DISPOSAL') throw new Error('disposal expected');
      proceeds = sold.application.realizedStockPnl + strike * assignedShares;
      direct += price * assignedShares;
      lot = { ...lot, disposedAt: at(day), disposedPricePerShare: price, realizedPnl: sold.application.realizedStockPnl };
    };
    const hold = (): void => {
      mark = integer(random, Math.max(100, Math.floor(strike * 50)), Math.floor(strike * 140) + 100) / 100;
      openShares = assignedShares; direct += mark * assignedShares; lot = { ...lot, currentPricePerShare: mark };
    };

    if (plan === 'SELL') { dividendBeforeExit(); sellStock(); }
    else if (plan === 'HOLD') { dividendBeforeExit(); hold(); }
    else if (plan === 'CC_EXPIRY') {
      for (let cycle = 0; cycle < integer(random, 1, 2); cycle += 1) {
        const cc = ccOpen();
        closeLeg(cc.leg, 'EXPIRE_OTM', cc.entry, nextDay());
      }
      dividendBeforeExit();
      if (random() < 0.5) sellStock(); else hold();
    } else {
      const variant = integer(random, 0, 2);
      let cc = ccOpen();
      if (variant === 1) {
        const closePrice = integer(random, 5, 600) / 100;
        const closed = routeConfirmedFillLifecycle(baseContext({ action: 'CLOSE_CC', orderQuantity: contracts, originalLegQuantity: contracts,
          optionLegId: cc.leg.optionLegId, entryCreditDebit: cc.entry, nextState: 'RECOVERY_WAIT', fills: [fillOf(contracts, closePrice, feesKnown, nextDay())] }));
        assert.equal(closed.application?.eventKind, 'OPTION_CLOSE');
        if (closed.application?.eventKind !== 'OPTION_CLOSE') throw new Error('cc close expected');
        ccCloseCosts += cc.entry - closed.application.realizedOptionPnl; ccNet -= closePrice * MULTIPLIER * contracts;
        direct -= closePrice * MULTIPLIER * contracts; optionFee(contracts);
        closeLeg(cc.leg, 'BTC_CLOSE', closed.application.realizedOptionPnl, at(day));
        cc = ccOpen();
      } else if (variant === 2) {
        const closePrice = integer(random, 5, 600) / 100;
        const newPrice = integer(random, 5, 400) / 100;
        const when = nextDay();
        const pair = routeConfirmedRollPair({ legKind: 'COVERED_CALL', chainId: 'chain', decisionId: 'decision', oldOptionLegId: cc.leg.optionLegId,
          newOptionLegId: `leg-${legCounter + 1}`, newOptionContractId: 'cc-contract-2', multiplier: MULTIPLIER, oldEntryCreditDebit: cc.entry,
          close: { orderStatus: 'FILLED', orderQuantity: contracts, fills: [fillOf(contracts, closePrice, feesKnown, when)] },
          open: { orderStatus: 'FILLED', orderQuantity: contracts, fills: [fillOf(contracts, newPrice, feesKnown, when)] } });
        assert.equal(pair.application?.eventKind, 'OPTION_ROLL');
        if (pair.application?.eventKind !== 'OPTION_ROLL') throw new Error('cc roll expected');
        ccCloseCosts += cc.entry - pair.application.oldRealizedPnl; ccPremium += pair.application.newEntryCreditDebit;
        ccNet += -closePrice * MULTIPLIER * contracts + newPrice * MULTIPLIER * contracts;
        direct += -closePrice * MULTIPLIER * contracts + newPrice * MULTIPLIER * contracts; optionFee(contracts * 2);
        const next = legRecord(pair.application.newEntryCreditDebit, contracts, when, cc.leg.optionLegId);
        closeLeg(cc.leg, 'ROLLED', pair.application.oldRealizedPnl, when, next.optionLegId);
        cc = { leg: legs[legs.indexOf(next)] as OptionLeg, entry: pair.application.newEntryCreditDebit };
      }
      dividendBeforeExit();
      const callStrike = integer(random, Math.max(100, Math.floor(strike * 70)), Math.floor(strike * 150) + 100) / 100;
      closeLeg(cc.leg, 'ASSIGNED', cc.entry, nextDay());
      proceeds = callStrike * assignedShares;
      direct += callStrike * assignedShares;
      lot = { ...lot, disposedAt: at(day), disposedPricePerShare: callStrike, realizedPnl: (callStrike - strike) * assignedShares };
    }
    lots.push(lot);
  }

  const ccPremiumTotal = ccPremium, ccCloseTotal = ccCloseCosts;
  const components: WholeChainComponents = {
    cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium, putCloseCosts, rollCredits, rollCloseCosts,
    assignmentStrike: assignedStrike, stockSharesAssigned: assignedShares, dividends, coveredCallPremium: ccPremiumTotal,
    coveredCallCloseCosts: ccCloseTotal, stockSaleOrCallAwayProceeds: assignedShares > 0 && openShares === 0 ? proceeds : null,
    fees: feesKnown ? directFees : null, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: null,
    currentStockMarkPerShare: mark, openStockShares: openShares,
  };
  const feeEvents: FeeEvent[] = feesKnown ? [{ chainId: 'chain', feeType: 'OPTION_REGULATORY', amount: directFees, incurredAt: at(day) }] : [];
  return { seed, type, components, legs, lots, feeEvents, dividendEvents, direct: direct, directFees, directDividends, putSideNet,
    feesKnown, assignedStrike, assignedShares, exitedFully: assignedShares > 0 && openShares === 0, ccNet,
    stockProceeds: assignedShares > 0 && openShares === 0 ? proceeds : null };
}

let casesRun = 0;
let mutationChecks = 0;
let unknownFeeCases = 0;
let unknownDividendCases = 0;
let assignedCases = 0;
const closeTo = (actual: number, expected: number, message: string): void => {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected} got ${actual}`);
};

for (const type of EPISODE_TYPES) {
  test(`random episodes ${type}: ledger-derived whole-chain P&L equals the independent direct cash-flow sum (${SEEDS_PER_TYPE} seeds)`, () => {
    for (let index = 0; index < SEEDS_PER_TYPE; index += 1) {
      const seed = index * EPISODE_TYPES.length + EPISODE_TYPES.indexOf(type) + 1000;
      const episode = buildEpisode(seed);
      assert.equal(episode.type, type);
      casesRun += 1;
      const label = `seed ${seed} ${episode.type}`;
      const dividendsKnown = episode.directDividends !== null;
      if (!episode.feesKnown) unknownFeeCases += 1;
      if (!dividendsKnown) unknownDividendCases += 1;
      if (episode.assignedShares > 0) assignedCases += 1;
      const result = computeWholeChainPnl(episode.components);

      // Direct signed cash-flow sum EXCLUDING fees (fees are UNKNOWN in some episodes).
      const knownExFees = episode.direct - (episode.feesKnown ? episode.directFees : 0); // dividends only when known; fees only when known

      if (episode.feesKnown && dividendsKnown) {
        // A) components vs C) direct
        assert.ok(result.wholeChainPnl !== null, `${label}: complete evidence must give a number`);
        closeTo(result.wholeChainPnl as number, episode.direct - episode.directFees, `${label} A vs direct`);
        // B) independent ledger rows
        const ledger = computeLedgerWholeChainPnl(episode.legs, episode.lots, episode.dividendEvents, episode.feeEvents);
        assert.deepEqual(ledger.valuationIssues, [], label);
        assert.ok(ledger.wholeChainPnl !== null, `${label}: ledger total`);
        closeTo(ledger.wholeChainPnl as number, episode.direct - episode.directFees, `${label} B vs direct`);
        closeTo(ledger.wholeChainPnl as number, result.wholeChainPnl as number, `${label} A vs B`);
        // chain results are never silently rounded or dropped: legs sum to the total
        closeTo(result.legLevelPnl.reduce((total, leg) => total + (leg.amount as number), 0), result.wholeChainPnl as number, `${label} legs`);
      } else {
        // UNKNOWN fees or dividends: the total stays UNKNOWN, known legs still equal the known cash flows.
        assert.equal(result.wholeChainPnl, null, `${label}: unknown evidence must keep the total UNKNOWN`);
        const knownLegSum = result.legLevelPnl.reduce((total, leg) => total + (leg.amount ?? 0), 0);
        closeTo(knownLegSum, knownExFees, `${label} known legs vs known cash flows`);
        if (!episode.feesKnown) assert.equal(result.legLevelPnl.find(leg => leg.label === 'FEES')?.amount, null, label);
        if (!dividendsKnown) assert.equal(result.legLevelPnl.find(leg => leg.label === 'DIVIDENDS')?.amount, null, label);
      }

      // Effective basis: independent derivation from the direct put-side cash flows.
      const basis = computeEffectiveStockBasis(episode.components);
      if (episode.assignedStrike === null) {
        assert.equal(basis.effectiveStockBasisPerShare, null, label);
      } else if (episode.feesKnown) {
        closeTo(basis.effectiveStockBasisPerShare as number,
          episode.assignedStrike - (episode.putSideNet - episode.directFees) / episode.assignedShares, `${label} basis`);
        // no option loss disappears: a more negative put-side history can only raise the basis
        const worse = computeEffectiveStockBasis({ ...episode.components, rollCloseCosts: (episode.components.rollCloseCosts as number) + 50 });
        assert.ok((worse.effectiveStockBasisPerShare as number) > (basis.effectiveStockBasisPerShare as number), label);
        if (episode.exitedFully && dividendsKnown) {
          const identity = (episode.stockProceeds as number) - (basis.effectiveStockBasisPerShare as number) * episode.assignedShares
            + episode.ccNet + (episode.directDividends ?? 0);
          closeTo(result.wholeChainPnl as number, identity, `${label} basis identity`);
        }
      } else {
        assert.equal(basis.effectiveStockBasisPerShare, null, `${label}: unknown fees keep the basis UNKNOWN`);
        assert.ok(basis.missingComponents.includes('fees'));
      }

      // Sensitivity: the classic accounting bugs must NOT reproduce the direct sum (guards the test itself).
      if (episode.feesKnown && dividendsKnown) {
        const target = episode.direct - episode.directFees;
        const mutants: WholeChainComponents[] = [
          { ...episode.components, initialPutPremium: (episode.components.initialPutPremium as number) * 2 }, // double premium
        ];
        if ((episode.components.putCloseCosts as number) > 0) mutants.push({ ...episode.components, putCloseCosts: 0 }); // missing close debit
        if ((episode.components.rollCloseCosts as number) > 0) mutants.push({ ...episode.components, rollCloseCosts: 0 }); // loss laundering
        if (episode.exitedFully) {
          mutants.push({ ...episode.components, stockSaleOrCallAwayProceeds: (episode.components.stockSaleOrCallAwayProceeds as number) * 2 }); // double proceeds
          mutants.push({ ...episode.components, stockSharesAssigned: episode.assignedShares * 2 }); // duplicated assignment cash flow
        }
        for (const mutant of mutants) {
          const mutated = computeWholeChainPnl(mutant).wholeChainPnl;
          assert.ok(mutated === null || Math.abs(mutated - target) > 1e-6, `${label}: a mutated chain reproduced the direct sum`);
          mutationChecks += 1;
        }
      }
    }
  });
}

test('RANDOM_PROPERTY_CASES: the seeded sweep ran every episode type with real coverage of unknown fees, unknown dividends and assignments', () => {
  const expected = EPISODE_TYPES.length * SEEDS_PER_TYPE;
  assert.equal(casesRun, expected);
  assert.ok(unknownFeeCases > expected * 0.1, `unknown-fee episodes ${unknownFeeCases}`);
  assert.ok(unknownDividendCases > 10, `unknown-dividend episodes ${unknownDividendCases}`);
  assert.ok(assignedCases > expected * 0.4, `assigned episodes ${assignedCases}`);
  assert.ok(mutationChecks > expected, `mutation checks ${mutationChecks}`);
  console.log(`RANDOM_PROPERTY_CASES=${casesRun} MUTATION_CHECKS=${mutationChecks} UNKNOWN_FEE_CASES=${unknownFeeCases} UNKNOWN_DIVIDEND_CASES=${unknownDividendCases} ASSIGNED_CASES=${assignedCases}`);
});
