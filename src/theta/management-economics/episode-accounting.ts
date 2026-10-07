// EpisodeAccountingReceipt: one economic episode for Q -> assignment -> A -> C -> exit (guide 36). Folds an ordered,
// event-ID-deduplicated lifecycle event list into the existing whole-chain identity (whole-chain-economics.ts
// computeWholeChainPnl -- reused, not duplicated) and adds capital-days, slippage and immutable per-leg realized P&L.
// A roll is CLOSE old + OPEN new: the closed leg's realized P&L is frozen at the close event and never absorbed.

import { computeWholeChainPnl, type WholeChainComponents, type WholeChainPnlBreakdown } from '../whole-chain-economics.js';

export const episodeAccountingVersion = 'theta-episode-accounting-v1' as const;

export type EpisodeEvent =
  | { readonly id: string; readonly at: string; readonly kind: 'PUT_OPEN'; readonly legId: string; readonly strike: number; readonly contracts: number; readonly creditPerShare: number; readonly slippageUsd: number | null }
  | { readonly id: string; readonly at: string; readonly kind: 'PUT_CLOSE'; readonly legId: string; readonly debitPerShare: number; readonly isRoll: boolean; readonly slippageUsd: number | null }
  | { readonly id: string; readonly at: string; readonly kind: 'PUT_EXPIRED'; readonly legId: string }
  | { readonly id: string; readonly at: string; readonly kind: 'PUT_ASSIGNED'; readonly legId: string }
  | { readonly id: string; readonly at: string; readonly kind: 'CALL_OPEN'; readonly legId: string; readonly strike: number; readonly contracts: number; readonly creditPerShare: number; readonly slippageUsd: number | null }
  | { readonly id: string; readonly at: string; readonly kind: 'CALL_CLOSE'; readonly legId: string; readonly debitPerShare: number; readonly slippageUsd: number | null }
  | { readonly id: string; readonly at: string; readonly kind: 'CALL_EXPIRED'; readonly legId: string }
  | { readonly id: string; readonly at: string; readonly kind: 'CALLED_AWAY'; readonly legId: string }
  | { readonly id: string; readonly at: string; readonly kind: 'STOCK_SALE'; readonly shares: number; readonly pricePerShare: number; readonly slippageUsd: number | null }
  | { readonly id: string; readonly at: string; readonly kind: 'DIVIDEND'; readonly amountUsd: number }
  | { readonly id: string; readonly at: string; readonly kind: 'FEE'; readonly amountUsd: number };

export interface LegRealization {
  readonly legId: string;
  readonly right: 'PUT' | 'CALL';
  readonly strike: number;
  readonly openCreditUsd: number;
  readonly closeDebitUsd: number | null;
  readonly realizedPnlUsd: number | null;
  readonly closedBy: 'CLOSE' | 'ROLL_CLOSE' | 'EXPIRED' | 'ASSIGNED' | 'CALLED_AWAY' | 'OPEN';
  readonly closedAt: string | null;
}

export interface EpisodeAccountingReceipt {
  readonly contractVersion: typeof episodeAccountingVersion;
  readonly episodeId: string;
  readonly multiplier: number;
  readonly duplicateEventIdsIgnored: readonly string[];
  readonly legs: readonly LegRealization[];
  readonly components: WholeChainComponents;
  readonly wholeChain: WholeChainPnlBreakdown;
  readonly putPremiumUsd: number;
  readonly coveredCallPremiumUsd: number;
  readonly assignmentBasisPerShare: number | null;
  readonly effectiveBasisPerShare: number | null;
  readonly stockPnlUsd: number | null;
  readonly slippageUsd: number | null;
  readonly capitalDays: number;
  readonly returnPerCapitalDay: number | null;
  readonly assigned: boolean;
  readonly calledAway: boolean;
  readonly state: 'OPEN' | 'CLOSED';
}

const DAY = 86_400_000;
const r4 = (v: number) => Number(v.toFixed(4));

export function buildEpisodeAccountingReceipt(input: { readonly episodeId: string; readonly multiplier: number; readonly events: readonly EpisodeEvent[];
  readonly asOf: string; readonly currentStockMarkPerShare: number | null; readonly feesKnown: boolean }): EpisodeAccountingReceipt {
  if (!(input.multiplier > 0)) throw new Error('EPISODE_MULTIPLIER_INVALID');
  const seen = new Set<string>(); const duplicates: string[] = [];
  const events = input.events.filter((e) => { if (seen.has(e.id)) { duplicates.push(e.id); return false; } seen.add(e.id); return true; })
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const m = input.multiplier;
  const legs = new Map<string, { right: 'PUT' | 'CALL'; strike: number; contracts: number; credit: number; openedAt: string; debit: number | null;
    closedBy: LegRealization['closedBy']; closedAt: string | null }>();
  let putPremium = 0; let putCloseCosts = 0; let rollCredits = 0; let rollCloseCosts = 0; let ccPremium = 0; let ccClose = 0;
  let dividends = 0; let fees = 0; let slippage: number | null = 0;
  let assignedShares = 0; let assignmentStrike: number | null = null; let openShares = 0; let proceeds = 0;
  let calledAway = false; let firstPutSeen = false; let rollPending = false;
  let capitalDays = 0; let stockHeldSince: string | null = null;
  const addSlip = (v: number | null) => { slippage = slippage === null || v === null ? null : slippage + v; };
  const closeLeg = (legId: string, at: string, debitPerShare: number | null, by: LegRealization['closedBy']) => {
    const leg = legs.get(legId);
    if (leg === undefined) throw new Error(`EPISODE_LEG_UNKNOWN:${legId}`);
    if (leg.closedBy !== 'OPEN') throw new Error(`EPISODE_LEG_ALREADY_CLOSED:${legId}`);
    leg.debit = debitPerShare === null ? null : debitPerShare * m * leg.contracts; leg.closedBy = by; leg.closedAt = at;
    if (leg.right === 'PUT') capitalDays += leg.strike * m * leg.contracts * Math.max(0, Date.parse(at) - Date.parse(leg.openedAt)) / DAY;
  };
  const stockStop = (at: string) => {
    if (stockHeldSince !== null && assignmentStrike !== null) capitalDays += assignmentStrike * openShares * Math.max(0, Date.parse(at) - Date.parse(stockHeldSince)) / DAY;
  };
  for (const e of events) {
    switch (e.kind) {
      case 'PUT_OPEN': {
        const credit = e.creditPerShare * m * e.contracts;
        if (!firstPutSeen) { putPremium += credit; firstPutSeen = true; } else if (rollPending) { rollCredits += credit; rollPending = false; }
        else putPremium += credit;
        legs.set(e.legId, { right: 'PUT', strike: e.strike, contracts: e.contracts, credit, openedAt: e.at, debit: null, closedBy: 'OPEN', closedAt: null });
        addSlip(e.slippageUsd); break;
      }
      case 'PUT_CLOSE': {
        closeLeg(e.legId, e.at, e.debitPerShare, e.isRoll ? 'ROLL_CLOSE' : 'CLOSE');
        const debit = e.debitPerShare * m * (legs.get(e.legId)?.contracts ?? 0);
        if (e.isRoll) { rollCloseCosts += debit; rollPending = true; } else putCloseCosts += debit;
        addSlip(e.slippageUsd); break;
      }
      case 'PUT_EXPIRED': closeLeg(e.legId, e.at, 0, 'EXPIRED'); break;
      case 'PUT_ASSIGNED': {
        const leg = legs.get(e.legId);
        closeLeg(e.legId, e.at, 0, 'ASSIGNED');
        stockStop(e.at);
        if (assignmentStrike !== null && leg !== undefined && assignmentStrike !== leg.strike) throw new Error('EPISODE_MULTIPLE_ASSIGNMENT_STRIKES_UNSUPPORTED');
        assignmentStrike = leg?.strike ?? null; assignedShares += (leg?.contracts ?? 0) * m; openShares += (leg?.contracts ?? 0) * m;
        stockHeldSince = e.at; break;
      }
      case 'CALL_OPEN': {
        if ((e.contracts * m) > openShares) throw new Error('EPISODE_NAKED_CALL_REJECTED');
        const credit = e.creditPerShare * m * e.contracts; ccPremium += credit;
        legs.set(e.legId, { right: 'CALL', strike: e.strike, contracts: e.contracts, credit, openedAt: e.at, debit: null, closedBy: 'OPEN', closedAt: null });
        addSlip(e.slippageUsd); break;
      }
      case 'CALL_CLOSE': closeLeg(e.legId, e.at, e.debitPerShare, 'CLOSE'); ccClose += e.debitPerShare * m * (legs.get(e.legId)?.contracts ?? 0); addSlip(e.slippageUsd); break;
      case 'CALL_EXPIRED': closeLeg(e.legId, e.at, 0, 'EXPIRED'); break;
      case 'CALLED_AWAY': {
        const leg = legs.get(e.legId);
        closeLeg(e.legId, e.at, 0, 'CALLED_AWAY');
        const shares = (leg?.contracts ?? 0) * m;
        stockStop(e.at); proceeds += (leg?.strike ?? 0) * shares; openShares -= shares; calledAway = true;
        stockHeldSince = openShares > 0 ? e.at : null; break;
      }
      case 'STOCK_SALE': {
        if (e.shares > openShares) throw new Error('EPISODE_SALE_EXCEEDS_SHARES');
        stockStop(e.at); proceeds += e.shares * e.pricePerShare; openShares -= e.shares;
        stockHeldSince = openShares > 0 ? e.at : null; addSlip(e.slippageUsd); break;
      }
      case 'DIVIDEND': dividends += e.amountUsd; break;
      case 'FEE': fees += e.amountUsd; break;
    }
  }
  // Open exposure accrues capital-days to asOf (not realized).
  for (const leg of legs.values()) if (leg.closedBy === 'OPEN' && leg.right === 'PUT') capitalDays += leg.strike * m * leg.contracts * Math.max(0, Date.parse(input.asOf) - Date.parse(leg.openedAt)) / DAY;
  stockStop(input.asOf);
  const components: WholeChainComponents = {
    cashflowBasis: 'ACTUAL_FILL_CASHFLOW', initialPutPremium: r4(putPremium), putCloseCosts: r4(putCloseCosts), rollCredits: r4(rollCredits),
    rollCloseCosts: r4(rollCloseCosts), assignmentStrike, stockSharesAssigned: assignedShares, dividends: r4(dividends),
    coveredCallPremium: r4(ccPremium), coveredCallCloseCosts: r4(ccClose), stockSaleOrCallAwayProceeds: assignedShares > openShares ? r4(proceeds) : null,
    fees: input.feesKnown ? r4(fees) : null, executionCostNotEmbeddedInCashflows: 0, tcaExecutionShortfall: null,
    currentStockMarkPerShare: input.currentStockMarkPerShare, openStockShares: openShares,
  };
  const wholeChain = computeWholeChainPnl(components);
  const legOut: LegRealization[] = [...legs.entries()].map(([legId, l]) => ({ legId, right: l.right, strike: l.strike, openCreditUsd: r4(l.credit),
    closeDebitUsd: l.debit === null ? null : r4(l.debit), realizedPnlUsd: l.closedBy === 'OPEN' || l.debit === null ? null : r4(l.credit - l.debit),
    closedBy: l.closedBy, closedAt: l.closedAt }));
  const stockPnl = assignmentStrike === null ? null : assignedShares > openShares ? r4(proceeds - assignmentStrike * (assignedShares - openShares)) : 0;
  const netPutPremium = putPremium - putCloseCosts + rollCredits - rollCloseCosts;
  const open = legOut.some((l) => l.closedBy === 'OPEN') || openShares > 0;
  return {
    contractVersion: episodeAccountingVersion, episodeId: input.episodeId, multiplier: m, duplicateEventIdsIgnored: duplicates, legs: legOut,
    components, wholeChain, putPremiumUsd: r4(putPremium + rollCredits), coveredCallPremiumUsd: r4(ccPremium),
    assignmentBasisPerShare: assignmentStrike,
    effectiveBasisPerShare: assignmentStrike === null || assignedShares === 0 ? null : r4(assignmentStrike - netPutPremium / assignedShares),
    stockPnlUsd: stockPnl, slippageUsd: slippage === null ? null : r4(slippage), capitalDays: r4(capitalDays),
    returnPerCapitalDay: wholeChain.wholeChainPnl === null || capitalDays <= 0 ? null : Number((wholeChain.wholeChainPnl / capitalDays).toFixed(10)),
    assigned: assignmentStrike !== null, calledAway, state: open ? 'OPEN' : 'CLOSED',
  };
}
