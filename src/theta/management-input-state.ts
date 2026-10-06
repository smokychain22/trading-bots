import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withRuntimePostgresTransaction } from './runtime-postgres-client.js';
import type { ThetaLifecycleState } from './runtime-state.js';
import type { ManagementActionFrontier } from './management-action-frontier.js';
import { PostgresWholeChainComponentsRepository } from './postgres-whole-chain-components-repository.js';
import { componentsFromEvidence, wholeChainEvidenceHash, type WholeChainComponentEvidence } from './whole-chain-component-evidence.js';
import type { WholeChainComponents } from './whole-chain-economics.js';
import { securedContractCapacity } from './secured-contract-capacity.js';
import type { ManagementCandidateDiscovery } from './management-candidate-evidence.js';
import { loadManagementEntryThesis, type ManagementEntryThesis } from './management-entry-thesis.js';
import type { BrokerStockInventoryEvidence } from './stock-share-reconciliation.js';

/** Staleness limits of the BROKER evidence a management decision is built from (named, not inline; the pre-submit quote window is a separate policy). */
export const managementBrokerQuoteMaxAgeMs = 30_000;
export const managementBrokerAccountMaxAgeMs = 180_000;

export const managementInputVersion = 'theta-management-input-v5' as const;

export interface ManagementAssignmentCapacityEvidence {
  readonly state: 'KNOWN' | 'UNKNOWN' | 'NOT_APPLICABLE';
  readonly unit: 'WHOLE_CONTRACTS';
  readonly source: 'ALPACA_ACCOUNT_AND_OPTION_POSITION_RECONCILIATION' | null;
  readonly accountSnapshotId: string | null;
  readonly accountObservedAt: string | null;
  readonly derivedAt: string;
  readonly availableCapitalSource: 'OPTIONS_BUYING_POWER' | 'BUYING_POWER' | null;
  readonly availableCapital: number | null;
  readonly strike: number | null;
  readonly multiplier: number | null;
  readonly collateralPerContract: number | null;
  readonly reconciliationQuality: string | null;
  readonly brokerOptionSymbol: string | null;
  readonly brokerOptionPositionObservedAt: string | null;
  readonly ledgerOpenLotsForContract: number | null;
  readonly brokerConfirmedShortPutLots: number | null;
  readonly reservedCollateral: number | null;
  readonly derivationVersion: 'theta-secured-contract-capacity-v2';
  readonly reason: string | null;
}

/** Raw result of ONE bounded Alpaca stock quote read (fetchLatestStockQuote shape). Never a bid/ask invented here. */
export interface ManagementStockQuoteRead {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly bidSize: number | null;
  readonly askSize: number | null;
  readonly timestamp: string | null;
  readonly feed: 'iex' | 'sip';
}

/** Injected reader: production passes fetchLatestStockQuote bound to the paper Alpaca config; tests pass a mock. */
export type ManagementStockQuoteReader = (symbol: string) => Promise<ManagementStockQuoteRead>;

export interface ManagementStockQuoteReadOutcome {
  readonly quote: ManagementStockQuoteRead | null;
  readonly readFailed: boolean;
  readonly receivedAt: string;
}

/**
 * Executable stock bid/ask evidence for SELL_STOCK. KNOWN only when the quote is two-sided, positive, uncrossed, timestamped,
 * not in the future and not older than managementStockQuoteMaximumAgeMs at the decision time. Anything else is UNKNOWN with a
 * typed reason and NO usable prices are retained as authority (the policy emits no stock evidence for UNKNOWN).
 */
export interface ManagementStockExecutionQuote {
  readonly state: 'KNOWN' | 'UNKNOWN';
  readonly source: 'ALPACA_STOCK_QUOTE';
  readonly symbol: string;
  readonly feed: 'iex' | 'sip' | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly bidSize: number | null;
  readonly askSize: number | null;
  readonly providerTimestamp: string | null;
  readonly receivedAt: string | null;
  readonly ageMs: number | null;
  readonly reason: 'STOCK_QUOTE_READ_FAILED' | 'STOCK_QUOTE_MISSING' | 'STOCK_QUOTE_TIMESTAMP_MISSING'
    | 'STOCK_QUOTE_TIMESTAMP_IN_FUTURE' | 'STOCK_QUOTE_STALE' | 'STOCK_QUOTE_NONPOSITIVE_BID'
    | 'STOCK_QUOTE_NONPOSITIVE_ASK' | 'STOCK_QUOTE_CROSSED' | null;
}

export const managementStockQuoteMaximumAgeMs = 30_000;

const positiveFinite = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/** Pure fail-closed classification of a stock quote read against the (later frozen) decision time. */
export function classifyManagementStockQuote(symbol: string, outcome: ManagementStockQuoteReadOutcome,
  decisionAsOf: string): ManagementStockExecutionQuote {
  const quote = outcome.quote;
  const unknown = (reason: NonNullable<ManagementStockExecutionQuote['reason']>, ageMs: number | null = null): ManagementStockExecutionQuote => ({
    state: 'UNKNOWN', source: 'ALPACA_STOCK_QUOTE', symbol, feed: quote?.feed ?? null, bid: null, ask: null, bidSize: null, askSize: null,
    providerTimestamp: quote?.timestamp ?? null, receivedAt: outcome.receivedAt, ageMs, reason,
  });
  if (outcome.readFailed) return unknown('STOCK_QUOTE_READ_FAILED');
  if (quote === null || quote.bid === null || quote.ask === null) return unknown('STOCK_QUOTE_MISSING');
  if (quote.timestamp === null || !Number.isFinite(Date.parse(quote.timestamp))) return unknown('STOCK_QUOTE_TIMESTAMP_MISSING');
  const ageMs = Date.parse(decisionAsOf) - Date.parse(quote.timestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0) return unknown('STOCK_QUOTE_TIMESTAMP_IN_FUTURE');
  if (ageMs > managementStockQuoteMaximumAgeMs) return unknown('STOCK_QUOTE_STALE', ageMs);
  if (!positiveFinite(quote.bid)) return unknown('STOCK_QUOTE_NONPOSITIVE_BID', ageMs);
  if (!positiveFinite(quote.ask)) return unknown('STOCK_QUOTE_NONPOSITIVE_ASK', ageMs);
  if (quote.bid > quote.ask) return unknown('STOCK_QUOTE_CROSSED', ageMs);
  return { state: 'KNOWN', source: 'ALPACA_STOCK_QUOTE', symbol, feed: quote.feed, bid: quote.bid, ask: quote.ask,
    bidSize: quote.bidSize, askSize: quote.askSize, providerTimestamp: quote.timestamp, receivedAt: outcome.receivedAt,
    ageMs, reason: null };
}

export interface ManagementDecisionEvidenceBundle {
  readonly decisionAsOf: string;
  readonly reconciliationObservedAt: string | null;
  readonly accountStateAsOf: string | null;
  readonly accountReceivedAt: string | null;
  readonly positionStateAsOf: string | null;
  readonly fusionSnapshotAsOf: string | null;
  readonly fusionSnapshotHash?: string | null;
  readonly currentLegQuoteObservedAt: string | null;
  readonly currentLegQuoteReceivedAt: string | null;
  readonly candidateDiscoveryObservedAt?: string | null;
  readonly candidateLatestQuoteReceivedAt?: string | null;
  readonly timingState: 'VALID' | 'PARTIAL' | 'FUTURE_EVIDENCE';
}

export interface ManagementInputState {
  readonly contractVersion: typeof managementInputVersion;
  readonly managementInputSnapshotId: string;
  readonly reconciliationSnapshotId: string;
  readonly fusionSnapshotId: string | null;
  readonly chainId: string;
  readonly observedAt: string;
  readonly evidenceBundle: ManagementDecisionEvidenceBundle;
  readonly managementCandidateDiscovery?: ManagementCandidateDiscovery | null;
  /** One bounded stock quote read per underlying per scan; present only when a reader was supplied and shares are held. */
  readonly stockExecutionQuote?: ManagementStockExecutionQuote;
  /** Broker-confirmed stock inventory for this underlying from the reconciliation snapshot (the SECOND share truth beside the ledger). */
  readonly brokerStockInventory?: BrokerStockInventoryEvidence;
  /**
   * Ledger shares of this underlying across EVERY open chain of the same bot account. The broker position is account-wide, so the
   * two share truths are only comparable at account level (two chains on one underlying must not read as a mismatch). null = UNKNOWN.
   */
  readonly accountStockLedgerShares?: number | null;
  readonly originalEntryThesis?: ManagementEntryThesis;
  /** Immutable strategy lineage of the open short-put chain. UNKNOWN keeps
   * strategy-specific management fail closed instead of treating H as Q. */
  readonly strategyOrigin?: 'THETA_CONVENTIONAL' | 'THETA_HOLD_STRIKE' | 'UNKNOWN';
  readonly wholeChainComponentEvidence?: WholeChainComponentEvidence;
  readonly wholeChainComponents?: WholeChainComponents | null;
  readonly assignedAtObservedAt?: string | null;
  readonly lifecycleState: ThetaLifecycleState;
  readonly underlying: string;
  readonly underlyingId: string;
  readonly contract: {
    readonly optionLegId: string | null;
    readonly optionContractId: string | null;
    readonly symbol: string | null;
    readonly optionType: 'PUT' | 'CALL' | null;
    readonly strike: number | null;
    readonly expiration: string | null;
    readonly multiplier: number | null;
    readonly contracts: number | null;
  };
  readonly economics: {
    readonly entryCreditDebit: number | null;
    readonly realizedOptionPnl: number;
    readonly unrealizedOptionPnl: number | null;
    readonly openStockShares: number;
    readonly stockBasisPerShare: number | null;
    readonly stockMarkPerShare: number | null;
    readonly unrealizedStockPnl: number | null;
    readonly realizedStockPnl: number;
    readonly dividends: number;
    readonly fees: number | null;
    readonly wholeChainPnl: number | null;
  };
  readonly market: {
    readonly spot: number | null;
    readonly optionBid: number | null;
    readonly optionAsk: number | null;
    readonly quoteTimestamp: string | null;
    readonly quoteFeed: string | null;
    readonly quoteQuality: string | null;
    readonly marketOpen: boolean | null;
    readonly clockTimestamp: string | null;
    readonly nextOpen: string | null;
    readonly nextClose: string | null;
    readonly calendarSessions: readonly {readonly date:string;readonly open:string|null;readonly close:string|null}[] | null;
    readonly dte: number | null;
    readonly moneyness: number | null;
    readonly delta: number | null;
    readonly gamma: number | null;
    readonly theta: number | null;
    readonly vega: number | null;
    readonly iv: number | null;
    readonly ivState: unknown | null;
  };
  readonly account: {
    readonly buyingPower: number | null;
    readonly optionsBuyingPower: number | null;
    readonly availableCapital: number | null;
  };
  readonly context: {
    readonly eventState: unknown | null;
    readonly dividendExDateState: unknown | null;
    readonly ownershipQuality: unknown | null;
    readonly ownershipAssessment?: unknown | null;
    readonly assignmentCapacity: number | null;
    readonly assignmentCapacityEvidence: ManagementAssignmentCapacityEvidence;
    readonly recoveryState: unknown | null;
    readonly concentration: unknown | null;
    readonly sectorCorrelation: unknown | null;
    readonly aegisState: unknown | null;
    readonly executionState: unknown | null;
    readonly regimeState: unknown | null;
    readonly opportunityAlternatives: unknown | null;
    readonly strategyVersions: unknown | null;
  };
  readonly unknownFields: readonly string[];
  readonly hardBlockers: readonly string[];
  readonly economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY';
  readonly contentHash: string;
}

type Row = Record<string, unknown>;

const numeric = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

const text = (value: unknown): string | null => value == null ? null : String(value);

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function managementCalendarSessions(value: unknown): readonly { readonly date: string; readonly open: string | null; readonly close: string | null }[] | null {
  if (!Array.isArray(value)) return null;
  const sessions: { date: string; open: string | null; close: string | null }[] = [];
  for (const item of value) {
    const row = object(item);
    const sessionDate = text(row.date);
    const dateMs = sessionDate === null ? NaN : Date.parse(`${sessionDate}T00:00:00.000Z`);
    if (sessionDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)
      || !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== sessionDate) return null;
    sessions.push({ date: sessionDate, open: text(row.open), close: text(row.close) });
  }
  return sessions;
}

/**
 * Broker inventory for the underlying. A reconciliation snapshot with NO position row for the symbol means the broker holds
 * none (KNOWN zero, observed at the reconciliation time); a row whose side/quantity/asset class cannot be read is UNKNOWN.
 */
export function brokerStockInventoryEvidence(row: Row): BrokerStockInventoryEvidence {
  const unknown = (reason: NonNullable<BrokerStockInventoryEvidence['reason']>): BrokerStockInventoryEvidence =>
    ({ state: 'UNKNOWN', quantity: null, observedAt: null, reason });
  const position = row.broker_position;
  if (position === null || position === undefined) {
    const observedAt = text(row.reconciliation_observed_at);
    return observedAt === null ? unknown('BROKER_POSITION_UNAVAILABLE') : { state: 'KNOWN', quantity: 0, observedAt, reason: null };
  }
  const quantity = numeric(row.broker_stock_quantity);
  const side = text(row.broker_stock_side)?.toLowerCase() ?? null;
  const assetClass = text(row.broker_stock_asset_class)?.toLowerCase() ?? null;
  const observedAt = text(row.position_observed_at);
  if (quantity === null) return unknown('BROKER_POSITION_QUANTITY_INVALID');
  if (observedAt === null || (assetClass !== null && assetClass !== 'us_equity')) return unknown('BROKER_POSITION_UNAVAILABLE');
  if (side !== 'long' && side !== 'short') return unknown('BROKER_POSITION_SIDE_UNKNOWN');
  const signed = side === 'long' ? Math.abs(quantity) : -Math.abs(quantity);
  return { state: 'KNOWN', quantity: signed, observedAt, reason: null };
}

function daysToExpiration(expiration: string | null, observedAt: string): number | null {
  if (expiration === null) return null;
  const start = Date.parse(observedAt);
  const end = Date.parse(`${expiration.slice(0, 10)}T20:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - start) / 86_400_000));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export interface ManagementInputChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface PersistedManagementFrontier {
  readonly managementActionFrontierId: string;
  readonly managementInputSnapshotId: string;
  readonly frontier: ManagementActionFrontier;
}

export interface ManagementInputWithWholeChainEvidence {
  readonly state: ManagementInputState;
  readonly wholeChainEvidence: WholeChainComponentEvidence;
}

const ignoredChangePaths = new Set([
  'managementInputSnapshotId', 'reconciliationSnapshotId', 'observedAt', 'contentHash',
]);

export function diffManagementInputs(previous: ManagementInputState | null,
  current: ManagementInputState): readonly ManagementInputChange[] {
  if (previous === null) return [{ path:'INITIAL_SNAPSHOT', before:null, after:'PRESENT' }];
  const changes: ManagementInputChange[] = [];
  const visit = (before: unknown, after: unknown, path: string): void => {
    if (ignoredChangePaths.has(path)) return;
    if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object' &&
        !Array.isArray(before) && !Array.isArray(after)) {
      const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
      for (const key of [...keys].sort()) visit((before as Record<string,unknown>)[key],
        (after as Record<string,unknown>)[key], path ? `${path}.${key}` : key);
      return;
    }
    if (canonicalJson(before) !== canonicalJson(after)) changes.push({ path,before:before ?? null,after:after ?? null });
  };
  visit(previous,current,'');
  return changes;
}

export function assembleManagementInput(row: Row, input: {
  readonly managementInputSnapshotId: string;
  readonly reconciliationSnapshotId: string;
  readonly observedAt: string;
  readonly managementCandidateDiscovery?: ManagementCandidateDiscovery | null;
  readonly stockQuoteRead?: ManagementStockQuoteReadOutcome | null;
}): ManagementInputState {
  const candidateDiscovery = input.managementCandidateDiscovery ?? null;
  const candidateQuotes = candidateDiscovery === null ? [] : [
    ...candidateDiscovery.rollCandidates,...candidateDiscovery.ccCandidates,...candidateDiscovery.rollCcCandidates,
  ];
  const latestCandidateQuoteReceivedAt = candidateQuotes.map((candidate)=>candidate.quoteReceivedAt ?? null)
    .filter((value):value is string=>value!==null).sort().at(-1) ?? null;
  const snapshot = object(row.snapshot_json);
  const reconciliationDetail = object(row.reconciliation_detail);
  const marketSession = object(snapshot.marketSession);
  const reconciledMarketOpen = typeof reconciliationDetail.marketOpen==='boolean' ? reconciliationDetail.marketOpen
    : typeof marketSession.isOpen==='boolean' ? marketSession.isOpen : null;
  const reconciledCalendarSessions = managementCalendarSessions(reconciliationDetail.calendarSessions);
  const riskState = object(snapshot.riskState);
  const snapshotContracts = Array.isArray(snapshot.contractCandidates) ? snapshot.contractCandidates : [];
  const position = object(row.broker_position);
  const contractSymbol = text(row.contract_symbol);
  const snapshotContract = object(snapshotContracts.find((value) => {
    const candidate=object(value);
    return contractSymbol!==null && (candidate.occSymbol===contractSymbol || candidate.optionSymbol===contractSymbol);
  }));
  const multiplier = numeric(row.multiplier);
  const contracts = numeric(row.quantity);
  const entryCreditDebit = numeric(row.entry_credit_debit);
  const bid = numeric(row.bid);
  const ask = numeric(row.ask);
  // The loader's SQL COALESCE aggregates must produce numbers, including genuine zeroes.
  // A missing or malformed aggregate is broken ledger evidence, never a known zero.
  const requiredLedgerAggregate = (name: string, raw: unknown): number => {
    const value = numeric(raw);
    if (value === null) throw new Error(`MANAGEMENT_LEDGER_AGGREGATE_INVALID:${name}`);
    return value;
  };
  const stockShares = requiredLedgerAggregate('open_stock_shares', row.open_stock_shares);
  const stockBasis = numeric(row.stock_basis_per_share);
  const stockMark = numeric(position.currentPrice);
  const realizedOptionPnl = requiredLedgerAggregate('realized_option_pnl', row.realized_option_pnl);
  const realizedStockPnl = requiredLedgerAggregate('realized_stock_pnl', row.realized_stock_pnl);
  const dividends = requiredLedgerAggregate('dividends', row.dividends);
  const knownFees = requiredLedgerAggregate('fees', row.fees);
  const fees = row.unknown_fill_fees === true ? null : knownFees;
  const optionMark = entryCreditDebit !== null && ask !== null && multiplier !== null && contracts !== null
    ? entryCreditDebit - ask * multiplier * contracts : null;
  const stockMtm = stockShares === 0 ? 0
    : stockBasis !== null && stockMark !== null ? (stockMark - stockBasis) * stockShares : null;
  const hasOpenOption = contractSymbol !== null && contracts !== null && contracts > 0;
  // No dividend writer exists, so a chain that ever held stock cannot prove its dividends: the stored COALESCE zero is
  // "none recorded", not "none occurred". A closed leg without a realized P&L is likewise broken ledger evidence.
  const ledgerComplete = row.unknown_closed_leg_pnl !== true && row.has_stock_lots !== true;
  const wholeChainPnl = ledgerComplete && (!hasOpenOption || optionMark !== null) && stockMtm !== null && fees !== null
    ? realizedOptionPnl + (optionMark ?? 0) + realizedStockPnl + stockMtm + dividends - fees : null;
  const expiration = text(row.expiration_date)?.slice(0, 10) ?? null;
  const spot = stockMark ?? numeric(snapshot.underlyingState && object(snapshot.underlyingState).last);
  const strike = numeric(row.strike);
  const lifecycleState = String(row.lifecycle_state) as ThetaLifecycleState;
  const assignmentApplicable = lifecycleState === 'CSP_OPEN' && hasOpenOption && text(row.option_type) === 'PUT';
  const accountAgeForCapacity = row.account_as_of == null ? NaN
    : Date.parse(input.observedAt) - Date.parse(String(row.account_as_of));
  const accountFreshForCapacity = Number.isFinite(accountAgeForCapacity)
    && accountAgeForCapacity >= 0 && accountAgeForCapacity <= 180_000;
  const optionsBuyingPower = numeric(row.options_buying_power);
  const buyingPower = numeric(row.buying_power);
  const availableCapitalSource = optionsBuyingPower !== null ? 'OPTIONS_BUYING_POWER'
    : buyingPower !== null ? 'BUYING_POWER' : null;
  const availableCapital = optionsBuyingPower ?? buyingPower;
  const rawCollateral = strike !== null && multiplier !== null ? strike * multiplier : null;
  const collateralPerContract = rawCollateral !== null && Number.isFinite(rawCollateral) && rawCollateral > 0
    ? rawCollateral : null;
  const reconciliationQuality = text(row.reconciliation_quality);
  const brokerOptionSymbol = text(row.broker_option_symbol);
  const brokerOptionQuantity = numeric(row.broker_option_quantity);
  const ledgerOpenLotsForContract = numeric(row.ledger_option_contract_quantity);
  const brokerEvidenceInvalid = brokerOptionSymbol !== null && (
    brokerOptionQuantity === null || !Number.isSafeInteger(brokerOptionQuantity)
    || text(row.broker_option_side) === null || text(row.broker_option_asset_class) === null
    || text(row.broker_option_observed_at) === null);
  const brokerShortPutConfirmed = text(row.broker_option_side)?.toLowerCase() === 'short'
    && text(row.broker_option_asset_class)?.toLowerCase() === 'us_option'
    && brokerOptionQuantity !== null && Number.isSafeInteger(brokerOptionQuantity)
    && contracts !== null && Number.isSafeInteger(contracts) && contracts > 0
    && ledgerOpenLotsForContract !== null && Number.isSafeInteger(ledgerOpenLotsForContract)
    && ledgerOpenLotsForContract >= contracts
    && Math.abs(brokerOptionQuantity) >= ledgerOpenLotsForContract;
  const brokerConfirmedShortPutLots = reconciliationQuality !== 'GOOD' || brokerEvidenceInvalid
    || ledgerOpenLotsForContract === null || !Number.isSafeInteger(ledgerOpenLotsForContract) ? null
    : brokerShortPutConfirmed && contracts !== null ? contracts : 0;
  const reservedCollateral = brokerConfirmedShortPutLots !== null && collateralPerContract !== null
    ? brokerConfirmedShortPutLots * collateralPerContract : null;
  const assignmentCapacity = assignmentApplicable && accountFreshForCapacity && collateralPerContract !== null
    && brokerConfirmedShortPutLots !== null
    ? securedContractCapacity(availableCapital, collateralPerContract, brokerConfirmedShortPutLots) : null;
  let assignmentCapacityReason: string | null = null;
  if (!assignmentApplicable) assignmentCapacityReason = 'NO_OPEN_SHORT_PUT';
  else if (!accountFreshForCapacity) assignmentCapacityReason = 'ACCOUNT_EVIDENCE_STALE_OR_MISSING';
  else if (reconciliationQuality !== 'GOOD') assignmentCapacityReason = 'RECONCILIATION_EVIDENCE_UNAVAILABLE';
  else if (brokerEvidenceInvalid) assignmentCapacityReason = 'BROKER_OPTION_POSITION_EVIDENCE_INVALID';
  else if (ledgerOpenLotsForContract === null || !Number.isSafeInteger(ledgerOpenLotsForContract)) {
    assignmentCapacityReason = 'OPEN_CONTRACT_AGGREGATE_UNAVAILABLE';
  } else if (assignmentCapacity === null) assignmentCapacityReason = 'ACCOUNT_OR_CONTRACT_EVIDENCE_INVALID';
  else if (!brokerShortPutConfirmed) assignmentCapacityReason = 'BROKER_SHORT_PUT_NOT_CONFIRMED';
  const assignmentCapacityEvidence: ManagementAssignmentCapacityEvidence = {
    state: !assignmentApplicable ? 'NOT_APPLICABLE' : assignmentCapacity === null ? 'UNKNOWN' : 'KNOWN',
    unit: 'WHOLE_CONTRACTS', source: assignmentApplicable && assignmentCapacity !== null
      ? 'ALPACA_ACCOUNT_AND_OPTION_POSITION_RECONCILIATION' : null,
    accountSnapshotId: text(row.account_snapshot_id), accountObservedAt: text(row.account_as_of),
    derivedAt: input.observedAt, availableCapitalSource,
    availableCapital, strike, multiplier, collateralPerContract,
    reconciliationQuality, brokerOptionSymbol, brokerOptionPositionObservedAt: text(row.broker_option_observed_at),
    ledgerOpenLotsForContract,
    brokerConfirmedShortPutLots, reservedCollateral,
    derivationVersion: 'theta-secured-contract-capacity-v2',
    reason: assignmentCapacityReason,
  };
  const evidenceTimes = [text(row.reconciliation_observed_at),text(row.account_as_of),
    text(row.account_retrieved_at),text(row.position_observed_at),text(row.broker_option_observed_at),
    text(row.fusion_decision_time),
    text(row.quote_as_of),text(row.quote_retrieved_at),candidateDiscovery?.observedAt ?? null,
    ...candidateQuotes.flatMap((candidate)=>[candidate.quoteTimestamp ?? null,candidate.quoteReceivedAt ?? null])];
  const requiredEvidenceTimes = [text(row.reconciliation_observed_at),text(row.account_as_of),
    text(row.account_retrieved_at),text(row.fusion_decision_time),
    ...(hasOpenOption?[text(row.quote_as_of),text(row.quote_retrieved_at),text(row.broker_option_observed_at)]:[]),
    ...(stockShares>0?[text(row.position_observed_at)]:[])];
  const decisionMs = Date.parse(input.observedAt);
  const futureEvidence = !Number.isFinite(decisionMs) || evidenceTimes.some((value) => value !== null
    && (!Number.isFinite(Date.parse(value)) || Date.parse(value) > decisionMs));
  const evidenceBundle: ManagementDecisionEvidenceBundle = {
    decisionAsOf: input.observedAt, reconciliationObservedAt:text(row.reconciliation_observed_at),
    accountStateAsOf:text(row.account_as_of),accountReceivedAt:text(row.account_retrieved_at),
    positionStateAsOf:text(row.position_observed_at),fusionSnapshotAsOf:text(row.fusion_decision_time),
    currentLegQuoteObservedAt:text(row.quote_as_of),currentLegQuoteReceivedAt:text(row.quote_retrieved_at),
    candidateDiscoveryObservedAt:candidateDiscovery?.observedAt ?? null,
    candidateLatestQuoteReceivedAt:latestCandidateQuoteReceivedAt,
    timingState:futureEvidence?'FUTURE_EVIDENCE':requiredEvidenceTimes.some((value)=>value===null)?'PARTIAL':'VALID',
  };
  const unknownFields: string[] = [];
  const required = (name: string, value: unknown): void => { if (value === null || value === undefined) unknownFields.push(name); };
  if (hasOpenOption) {
    required('contract.multiplier', multiplier);
    required('market.optionBid', bid);
    required('market.optionAsk', ask);
    required('market.quoteTimestamp', row.quote_as_of);
    required('market.delta', snapshotContract.delta ?? null);
    required('market.gamma', snapshotContract.gamma ?? null);
    required('market.theta', snapshotContract.theta ?? null);
    required('market.vega', snapshotContract.vega ?? null);
    required('market.iv', snapshotContract.iv ?? null);
  }
  if (stockShares > 0) required('economics.stockMarkPerShare', stockMark);
  required('market.marketOpen', reconciledMarketOpen);
  required('account.buyingPower', row.buying_power);
  required('account.optionsBuyingPower', row.options_buying_power);
  required('context.eventState', snapshot.eventState ?? null);
  const eventState=object(snapshot.eventState);
  required('context.dividendExDateState', eventState.exDividendState ?? eventState.exDividendDate ?? null);
  required('context.ownershipQuality', snapshot.expertPriorState ?? null);
  if (assignmentApplicable) required('context.assignmentCapacity', assignmentCapacity);
  required('context.concentration', object(snapshot.portfolioExposure).concentration ?? null);
  required('context.sectorCorrelation', object(snapshot.portfolioExposure).sectorCorrelation ?? null);
  required('context.aegisState', riskState.newRiskState ?? riskState.state ?? null);
  required('context.executionState', hasOpenOption ? snapshotContract.executable ?? null : 'NO_OPEN_OPTION');
  required('context.regimeState', snapshot.regimeState ?? null);
  required('context.opportunityAlternatives', snapshot.strategyRouterState ?? null);
  required('context.strategyVersions', snapshot.versions ?? null);
  required('economics.fees', fees);
  if (row.fusion_snapshot_id == null) unknownFields.push('fusionSnapshotId');
  if (Array.isArray(reconciliationDetail.calendarSessions) && reconciledCalendarSessions === null) {
    unknownFields.push('market.calendarSessions');
  }

  const hardBlockers: string[] = [];
  if (hasOpenOption && multiplier === null) hardBlockers.push('MULTIPLIER_UNKNOWN');
  // D6: a buy-to-close needs only a valid ASK. A zero BID (worthless short) is a valid, closable quote; a negative bid,
  // a missing/non-positive ask, a crossed quote, or a missing timestamp is not.
  if (hasOpenOption && (bid === null || ask === null || bid < 0 || ask <= 0 || bid > ask || row.quote_as_of == null)) hardBlockers.push('EXECUTABLE_QUOTE_UNAVAILABLE');
  if (hasOpenOption && text(row.quote_quality) !== 'GOOD') hardBlockers.push('BROKER_DATA_INVALID');
  const quoteAgeMs = row.quote_as_of == null ? null : Date.parse(input.observedAt) - Date.parse(String(row.quote_as_of));
  if (quoteAgeMs !== null && (!Number.isFinite(quoteAgeMs) || quoteAgeMs < 0 || quoteAgeMs > managementBrokerQuoteMaxAgeMs)) {
    hardBlockers.push('BROKER_DATA_STALE');
  }
  const accountAgeMs = row.account_as_of == null ? null : Date.parse(input.observedAt) - Date.parse(String(row.account_as_of));
  if (accountAgeMs === null || !Number.isFinite(accountAgeMs) || accountAgeMs < 0 || accountAgeMs > managementBrokerAccountMaxAgeMs) {
    hardBlockers.push('BROKER_DATA_STALE');
  }
  if (contracts !== null && contracts < 0) hardBlockers.push('INVALID_CONTRACT');
  if (row.lifecycle_state == null) hardBlockers.push('LIFECYCLE_TRUTH_BROKEN');
  if (assignmentApplicable && reconciliationQuality === 'GOOD' && !brokerShortPutConfirmed) {
    hardBlockers.push('BROKER_SHORT_PUT_POSITION_UNCONFIRMED');
  }
  if (evidenceBundle.timingState === 'FUTURE_EVIDENCE') hardBlockers.push('EVIDENCE_OBSERVED_AFTER_DECISION');

  const originalEntryThesis = loadManagementEntryThesis(row.original_entry_thesis, {
    decisionId: row.original_decision_id, snapshotId: row.original_snapshot_id,
    decidedAt: row.original_decided_at, underlying: String(row.underlying), managementAsOf: input.observedAt,
  });
  const unsigned = {
    contractVersion: managementInputVersion,
    managementInputSnapshotId: input.managementInputSnapshotId,
    reconciliationSnapshotId: input.reconciliationSnapshotId,
    fusionSnapshotId: text(row.fusion_snapshot_id), chainId: String(row.chain_id), observedAt: input.observedAt,
    evidenceBundle: { ...evidenceBundle, fusionSnapshotHash: text(row.fusion_content_hash) }, managementCandidateDiscovery:candidateDiscovery,
    ...(stockShares > 0 || row.broker_stock_quantity !== undefined
      ? { brokerStockInventory: brokerStockInventoryEvidence(row), accountStockLedgerShares: numeric(row.account_ledger_shares) } : {}),
    ...(stockShares > 0 && input.stockQuoteRead != null
      ? { stockExecutionQuote: classifyManagementStockQuote(String(row.underlying), input.stockQuoteRead, input.observedAt) } : {}),
    originalEntryThesis,
    // Strategy identity follows the persisted OPENING decision. The entry thesis is produced only by the Q orchestrator, so an H-opened
    // chain has none: without this an H position would lose its no-roll identity and its mandatory H lifecycle review under management.
    ...(row.original_strategy_branch === 'THETA_HOLD_STRIKE' ? { strategyOrigin: 'THETA_HOLD_STRIKE' as const }
      : originalEntryThesis.state === 'VERIFIED' && originalEntryThesis.receipt !== null
        ? { strategyOrigin: originalEntryThesis.receipt.strategy } : {}),
    lifecycleState, underlying: String(row.underlying),
    underlyingId: String(row.underlying_id),
    contract: { optionLegId: text(row.option_leg_id), optionContractId: text(row.option_contract_id), symbol: contractSymbol,
      optionType: text(row.option_type) as 'PUT' | 'CALL' | null, strike, expiration, multiplier, contracts },
    economics: { entryCreditDebit, realizedOptionPnl, unrealizedOptionPnl: hasOpenOption ? optionMark : 0,
      openStockShares: stockShares, stockBasisPerShare: stockBasis, stockMarkPerShare: stockMark,
      unrealizedStockPnl: stockMtm, realizedStockPnl, dividends, fees, wholeChainPnl },
    market: { spot, optionBid: bid, optionAsk: ask, quoteTimestamp: text(row.quote_as_of),
      quoteFeed: text(row.feed), quoteQuality: text(row.quote_quality), dte: daysToExpiration(expiration, input.observedAt),
      marketOpen: reconciledMarketOpen,
      clockTimestamp:text(row.clock_timestamp),nextOpen:text(reconciliationDetail.nextOpen),nextClose:text(reconciliationDetail.nextClose),
      calendarSessions:reconciledCalendarSessions,
      moneyness: spot !== null && strike !== null && spot > 0 ? strike / spot : null,
      delta: numeric(snapshotContract.delta), gamma: numeric(snapshotContract.gamma), theta: numeric(snapshotContract.theta),
      vega: numeric(snapshotContract.vega), iv: numeric(snapshotContract.iv),
      ivState: snapshot.optionomicsFeatureState ?? null },
    account: { buyingPower: numeric(row.buying_power), optionsBuyingPower: numeric(row.options_buying_power),
      availableCapital: numeric(row.options_buying_power) ?? numeric(row.buying_power) },
    context: { eventState: snapshot.eventState ?? null,
      dividendExDateState: eventState.exDividendState ?? eventState.exDividendDate ?? null,
      ownershipQuality: snapshot.expertPriorState ?? null,
      ownershipAssessment: row.management_ownership ?? null,
      assignmentCapacity, assignmentCapacityEvidence,
      recoveryState: snapshot.recoveryState ?? null,
      concentration: object(snapshot.portfolioExposure).concentration ?? null,
      sectorCorrelation: object(snapshot.portfolioExposure).sectorCorrelation ?? null,
      aegisState: riskState.newRiskState ?? riskState.state ?? null,
      executionState: hasOpenOption ? snapshotContract.executable ?? null : 'NO_OPEN_OPTION',
      regimeState: snapshot.regimeState ?? null, opportunityAlternatives: snapshot.strategyRouterState ?? null,
      strategyVersions: snapshot.versions ?? null },
    unknownFields: [...new Set(unknownFields)].sort(), hardBlockers: [...new Set(hardBlockers)].sort(),
    economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY' as const,
  };
  const hashable = Object.fromEntries(
    Object.entries(unsigned).filter(([key]) => key !== 'managementInputSnapshotId'),
  );
  return { ...unsigned, contentHash: createHash('sha256').update(canonicalJson(hashable)).digest('hex') };
}

/** Bind canonical ledger evidence before persistence and policy evaluation. */
export function bindManagementWholeChainEvidence(state: ManagementInputState,
  evidence: WholeChainComponentEvidence): ManagementInputState {
  if (evidence.chainId !== state.chainId || Date.parse(evidence.asOf) !== Date.parse(state.observedAt))
    throw new Error('MANAGEMENT_WHOLE_CHAIN_IDENTITY_MISMATCH');
  const { contentHash, ...unsignedEvidence } = evidence;
  if (wholeChainEvidenceHash(unsignedEvidence) !== contentHash) throw new Error('MANAGEMENT_WHOLE_CHAIN_HASH_MISMATCH');
  const projected = componentsFromEvidence(evidence);
  if (canonicalJson(projected.components) !== canonicalJson(evidence.components)
    || canonicalJson(projected.blockers) !== canonicalJson(evidence.componentBlockers))
    throw new Error('MANAGEMENT_WHOLE_CHAIN_PROJECTION_MISMATCH');
  if (evidence.openStockShares.status !== 'UNKNOWN' && evidence.openStockShares.value !== state.economics.openStockShares)
    throw new Error('MANAGEMENT_WHOLE_CHAIN_INVENTORY_MISMATCH');
  const assigned = evidence.assignmentObservedAt;
  const assignedAt = assigned.status !== 'UNKNOWN' && assigned.value !== null
    && Number.isFinite(Date.parse(assigned.value)) && Date.parse(assigned.value) <= Date.parse(state.observedAt)
    ? assigned.value : null;
  const bound = { ...state, wholeChainComponentEvidence: evidence, wholeChainComponents: projected.components,
    assignedAtObservedAt: assignedAt,
    unknownFields: [...new Set([...state.unknownFields, ...projected.blockers.map(reason => `wholeChain.${reason}`)])].sort() };
  const hashable = Object.fromEntries(Object.entries(bound)
    .filter(([key]) => key !== 'managementInputSnapshotId' && key !== 'contentHash'));
  return { ...bound, contentHash: createHash('sha256').update(canonicalJson(hashable)).digest('hex') };
}

export class PostgresManagementInputStore {
  private readonly wholeChainRepository: Pick<PostgresWholeChainComponentsRepository, 'load'>;
  constructor(private readonly pool: Pool, wholeChainRepository?: Pick<PostgresWholeChainComponentsRepository, 'load'>) {
    this.wholeChainRepository = wholeChainRepository ?? new PostgresWholeChainComponentsRepository(pool);
  }

  async assembleAndPersistOpenChains(connectionId: string, reconciliationSnapshotId: string, observedAt: string,
    candidateDiscoveryByChain: ReadonlyMap<string,ManagementCandidateDiscovery> = new Map(),
    stockQuoteReader?: ManagementStockQuoteReader): Promise<readonly ManagementInputState[]> {
    const result = await this.pool.query(`
      SELECT ec.chain_id,ec.lifecycle_state,u.underlying_id,u.symbol AS underlying,
        original_entry.decision_id AS original_decision_id,original_entry.fusion_snapshot_id AS original_snapshot_id,
        original_entry.decided_at AS original_decided_at,original_entry.entry_thesis AS original_entry_thesis,
        original_entry.strategy_branch AS original_strategy_branch,
        ol.option_leg_id,ol.remaining_quantity AS quantity,ol.entry_credit_debit,oc.option_contract_id,oc.contract_symbol,oc.option_type,
        oc.strike,oc.expiration_date,oc.multiplier,
        oq.bid,oq.ask,oq.as_of AS quote_as_of,oq.retrieved_at AS quote_retrieved_at,oq.feed,oq.quality AS quote_quality,
        totals.realized_option_pnl,stocks.open_stock_shares,stocks.stock_basis_per_share,acct.account_ledger_shares,
        totals.realized_stock_pnl,totals.dividends,totals.fees,totals.unknown_fill_fees,totals.unknown_closed_leg_pnl,totals.has_stock_lots,
        a.account_snapshot_id,a.buying_power,a.options_buying_power,a.as_of AS account_as_of,
        a.retrieved_at AS account_retrieved_at,fs.fusion_snapshot_id,fs.snapshot_json,fs.content_hash AS fusion_content_hash,
        latest_decision.ownership AS management_ownership,
        fs.decision_time AS fusion_decision_time,brs.observed_at AS reconciliation_observed_at,
        brs.data_quality AS reconciliation_quality,
        brs.provider_timestamp AS clock_timestamp,brs.detail_json AS reconciliation_detail,
        bp.observed_at AS position_observed_at,bp.quantity AS broker_stock_quantity,bp.side AS broker_stock_side,bp.asset_class AS broker_stock_asset_class,
        bop.symbol AS broker_option_symbol,bop.quantity AS broker_option_quantity,bop.side AS broker_option_side,
        bop.asset_class AS broker_option_asset_class,bop.observed_at AS broker_option_observed_at,
        contract_lots.total_remaining AS ledger_option_contract_quantity,
        CASE WHEN bp.symbol IS NULL THEN NULL ELSE jsonb_build_object(
          'averageEntryPrice',bp.average_entry_price,'currentPrice',bp.current_price,
          'marketValue',bp.market_value,'costBasis',bp.cost_basis,'unrealizedPnl',bp.unrealized_pnl
        ) END AS broker_position
      FROM trade.economic_chain ec
      JOIN market.underlying u ON u.underlying_id=ec.underlying_id
      JOIN core.bot_instance bi ON bi.bot_instance_id=ec.bot_instance_id AND bi.bot_code='THETA'
      JOIN core.trading_account ta ON ta.account_id=bi.account_id AND ta.environment='PAPER'
      JOIN core.provider_connection pc ON pc.provider_connection_id=ta.provider_connection_id
        AND pc.provider_code='ALPACA' AND pc.environment='PAPER'
      JOIN copy.follower_account master ON master.follower_account_id=$1
        AND master.account_role='MASTER_THETA_PAPER' AND master.environment='PAPER'
        AND master.workspace_id=ta.workspace_id AND master.provider_account_ref=ta.provider_account_id
      JOIN trade.broker_reconciliation_snapshot brs
        ON brs.reconciliation_snapshot_id=$2 AND brs.connection_id=$1
      LEFT JOIN LATERAL (
        SELECT l.*,l.quantity-COALESCE((SELECT sum(p.closed_quantity)
          FROM trade.option_partial_close_realization p WHERE p.option_leg_id=l.option_leg_id),0) AS remaining_quantity
        FROM trade.option_leg l WHERE l.chain_id=ec.chain_id AND l.closed_at IS NULL
        ORDER BY l.opened_at DESC LIMIT 1
      ) ol ON true
      LEFT JOIN market.option_contract oc ON oc.option_contract_id=ol.option_contract_id
      LEFT JOIN LATERAL (
        -- Logical receipt identities differ from storage UUIDs. Bind to the
        -- original receipt envelope, preserving the canonical row via first_leg.
        SELECT COALESCE(d.receipt_json #>> '{legacyThetaQReceipt,decisionId}',
            d.receipt_json #>> '{subordinateNewRiskEvidence,receipt,decisionId}') AS decision_id,
          COALESCE(d.receipt_json #>> '{legacyThetaQReceipt,snapshotId}',
            d.receipt_json #>> '{subordinateNewRiskEvidence,receipt,snapshotId}') AS fusion_snapshot_id,
          COALESCE(d.receipt_json #>> '{legacyThetaQReceipt,timestamp}',
            d.receipt_json #>> '{subordinateNewRiskEvidence,receipt,timestamp}') AS decided_at,
          COALESCE(d.receipt_json #> '{legacyThetaQReceipt,entryThesisReceipt}',
            d.receipt_json #> '{subordinateNewRiskEvidence,receipt,entryThesisReceipt}') AS entry_thesis,
          d.strategy_branch::text AS strategy_branch
        FROM trade.option_leg first_leg JOIN trade.decision d ON d.decision_id=first_leg.decision_id
        WHERE first_leg.chain_id=ec.chain_id
        ORDER BY first_leg.opened_at,first_leg.option_leg_id LIMIT 1
      ) original_entry ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(other_leg.quantity-COALESCE((SELECT sum(p.closed_quantity)
          FROM trade.option_partial_close_realization p WHERE p.option_leg_id=other_leg.option_leg_id),0)),0) AS total_remaining
        FROM trade.option_leg other_leg
        JOIN trade.economic_chain other_chain ON other_chain.chain_id=other_leg.chain_id
        JOIN core.bot_instance other_bot ON other_bot.bot_instance_id=other_chain.bot_instance_id
        WHERE other_leg.option_contract_id=oc.option_contract_id AND other_leg.closed_at IS NULL
          AND other_leg.side='SHORT' AND other_chain.closed_at IS NULL AND other_bot.account_id=bi.account_id
      ) contract_lots ON true
      LEFT JOIN LATERAL (
        SELECT q.* FROM market.option_quote_snapshot q WHERE q.option_contract_id=oc.option_contract_id
        ORDER BY q.as_of DESC,q.retrieved_at DESC,q.snapshot_id DESC LIMIT 1
      ) oq ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(l.realized_pnl),0)+COALESCE((SELECT sum(p.realized_pnl_before_fees)
          FROM trade.option_partial_close_realization p JOIN trade.option_leg pl ON pl.option_leg_id=p.option_leg_id
          WHERE pl.chain_id=ec.chain_id AND pl.closed_at IS NULL),0) AS realized_option_pnl,
          COALESCE((SELECT sum(s.realized_pnl) FROM trade.stock_lot s WHERE s.chain_id=ec.chain_id),0) AS realized_stock_pnl,
          COALESCE((SELECT sum(d.amount_per_share*s.shares) FROM trade.dividend_event d JOIN trade.stock_lot s ON s.stock_lot_id=d.stock_lot_id WHERE s.chain_id=ec.chain_id),0) AS dividends,
          COALESCE((SELECT sum(f.amount) FROM trade.fee_event f WHERE f.chain_id=ec.chain_id),0) AS fees,
          EXISTS(SELECT 1 FROM trade.option_leg cl WHERE cl.chain_id=ec.chain_id AND cl.closed_at IS NOT NULL
            AND cl.realized_pnl IS NULL) AS unknown_closed_leg_pnl,
          EXISTS(SELECT 1 FROM trade.stock_lot hs WHERE hs.chain_id=ec.chain_id) AS has_stock_lots,
          EXISTS(SELECT 1 FROM trade.fill fi JOIN trade.broker_order bo ON bo.broker_order_id=fi.broker_order_id
            JOIN trade.order_intent oi ON oi.order_intent_id=bo.order_intent_id WHERE oi.chain_id=ec.chain_id AND fi.fees IS NULL) AS unknown_fill_fees
        FROM trade.option_leg l WHERE l.chain_id=ec.chain_id
      ) totals ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(s.shares),0) AS open_stock_shares,
          CASE WHEN sum(s.shares)>0 THEN sum(s.economic_basis_per_share*s.shares)/sum(s.shares) END AS stock_basis_per_share
        FROM trade.stock_lot s WHERE s.chain_id=ec.chain_id AND s.disposed_at IS NULL
      ) stocks ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(s2.shares),0) AS account_ledger_shares
        FROM trade.stock_lot s2
        JOIN trade.economic_chain ec2 ON ec2.chain_id=s2.chain_id AND ec2.underlying_id=ec.underlying_id
        JOIN core.bot_instance bi2 ON bi2.bot_instance_id=ec2.bot_instance_id AND bi2.account_id=bi.account_id
        WHERE s2.disposed_at IS NULL
      ) acct ON true
      LEFT JOIN LATERAL (
        SELECT s.* FROM trade.account_snapshot s WHERE s.account_id=bi.account_id ORDER BY s.as_of DESC LIMIT 1
      ) a ON true
      LEFT JOIN LATERAL (
        SELECT f.* FROM trade.fusion_snapshot f WHERE f.bot_instance_id=bi.bot_instance_id
          AND f.snapshot_json #>> '{underlyingState,symbol}'=u.symbol
        ORDER BY f.decision_time DESC,f.fusion_snapshot_id DESC LIMIT 1
      ) fs ON true
      LEFT JOIN LATERAL (
        SELECT d.receipt_json #> '{managementContext,ownership}' AS ownership FROM trade.decision d
        WHERE d.fusion_snapshot_id=fs.fusion_snapshot_id
        ORDER BY d.decided_at DESC,d.decision_id DESC LIMIT 1
      ) latest_decision ON true
      LEFT JOIN trade.broker_position_snapshot bp ON bp.reconciliation_snapshot_id=$2 AND bp.symbol=u.symbol
      LEFT JOIN trade.broker_position_snapshot bop ON bop.reconciliation_snapshot_id=$2 AND bop.symbol=oc.contract_symbol
      WHERE ec.closed_at IS NULL AND ec.chain_kind='WHEEL'
        -- A WAIT chain that never reached the broker (its entry plan expired: no option leg, no stock lot, no live order intent) holds no
        -- exposure and has nothing to manage. It is not loaded, so it can not raise management hard blockers that would mask a real
        -- position's. The chain itself is untouched (the frozen lifecycle has no WAIT -> CLOSED transition); a WAIT chain with an
        -- in-flight entry order IS loaded.
        AND NOT (ec.lifecycle_state='WAIT'
          AND NOT EXISTS(SELECT 1 FROM trade.option_leg l0 WHERE l0.chain_id=ec.chain_id)
          AND NOT EXISTS(SELECT 1 FROM trade.stock_lot s0 WHERE s0.chain_id=ec.chain_id)
          AND NOT EXISTS(SELECT 1 FROM trade.order_intent oi0 WHERE oi0.chain_id=ec.chain_id
            AND oi0.status::text NOT IN ('FILLED','CANCELED','REJECTED','EXPIRED')))
      ORDER BY ec.opened_at,ec.chain_id`, [connectionId, reconciliationSnapshotId]);
    // The query may fetch an observation received after broker reconciliation.
    // Freeze the decision only after its evidence has been read, never at the
    // earlier reconciliation timestamp.
    // SELL_STOCK executable evidence: ONE bounded stock quote read per underlying that holds shares, read BEFORE the
    // decision time is frozen. A thrown/failed read becomes a typed UNKNOWN (never a price); no reader means no evidence.
    const stockQuotes = new Map<string, ManagementStockQuoteReadOutcome>();
    if (stockQuoteReader !== undefined) {
      for (const row of result.rows) {
        const symbol = String(row.underlying);
        const held = numeric(row.open_stock_shares);
        if (held === null || held <= 0 || stockQuotes.has(symbol)) continue;
        try {
          const quote = await stockQuoteReader(symbol);
          stockQuotes.set(symbol, { quote, readFailed: false, receivedAt: new Date().toISOString() });
        } catch {
          stockQuotes.set(symbol, { quote: null, readFailed: true, receivedAt: new Date().toISOString() });
        }
      }
    }
    const decisionAsOf = new Date().toISOString();
    if (Date.parse(decisionAsOf) < Date.parse(observedAt)) throw new Error('MANAGEMENT_DECISION_CLOCK_BEFORE_RECONCILIATION');
    const states: ManagementInputState[] = result.rows.map((row) => assembleManagementInput(row, {
      managementInputSnapshotId: randomUUID(), reconciliationSnapshotId, observedAt:decisionAsOf,
      managementCandidateDiscovery:candidateDiscoveryByChain.get(String(row.chain_id)) ?? null,
      stockQuoteRead: stockQuotes.get(String(row.underlying)) ?? null,
    }));
    if (states.length === 0) return [];
    // Each ledger read owns/releases its transaction before the persistence
    // transaction starts. Bounded sequential reads cannot starve the pool.
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index];
      if (state === undefined) throw new Error('MANAGEMENT_INPUT_INDEX_INVALID');
      const evidence = await this.wholeChainRepository.load(state.chainId, state.observedAt,
        { connectionId, reconciliationSnapshotId });
      states[index] = bindManagementWholeChainEvidence(state, evidence);
    }
    await withRuntimePostgresTransaction(this.pool, async (client) => {
      for (let index = 0; index < states.length; index += 1) {
        let state = states[index];
        if (state === undefined) throw new Error('MANAGEMENT_INPUT_INDEX_INVALID');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [state.chainId]);
        const previous = await client.query(
          `SELECT management_input_snapshot_id,input_json,content_hash FROM trade.management_input_snapshot
           WHERE chain_id=$1 ORDER BY observed_at DESC,created_at DESC LIMIT 1`, [state.chainId],
        );
        const previousState = previous.rowCount === 1 ? previous.rows[0].input_json as ManagementInputState : null;
        if (previous.rows[0]?.content_hash === state.contentHash) {
          state = { ...state, managementInputSnapshotId:String(previous.rows[0].management_input_snapshot_id) };
          states[index] = state;
          continue;
        }
        const changes = diffManagementInputs(previousState,state);
        await client.query(
        `INSERT INTO trade.management_input_snapshot(
          management_input_snapshot_id,previous_management_input_snapshot_id,reconciliation_snapshot_id,
          fusion_snapshot_id,chain_id,observed_at,lifecycle_state,input_json,unknown_fields_json,change_json,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)
         ON CONFLICT(chain_id,content_hash) DO NOTHING`,
        [state.managementInputSnapshotId,previous.rows[0]?.management_input_snapshot_id ?? null,
          state.reconciliationSnapshotId,state.fusionSnapshotId,state.chainId,state.observedAt,state.lifecycleState,
          JSON.stringify(state),JSON.stringify(state.unknownFields),JSON.stringify(changes),state.contentHash],
        );
      }
    });
    return states;
  }

  async persistFrontiers(states: readonly ManagementInputState[], frontiers: readonly ManagementActionFrontier[]): Promise<readonly PersistedManagementFrontier[]> {
    if (states.length !== frontiers.length) throw new Error('MANAGEMENT_FRONTIER_INPUT_COUNT_MISMATCH');
    const persisted: PersistedManagementFrontier[] = [];
    await withRuntimePostgresTransaction(this.pool, async (client) => {
      for (let index = 0; index < states.length; index += 1) {
        const state = states[index];
        const frontier = frontiers[index];
        if (state === undefined || frontier === undefined || state.chainId !== frontier.chainId) {
          throw new Error('MANAGEMENT_FRONTIER_CHAIN_MISMATCH');
        }
        const payload = canonicalJson(frontier);
        const contentHash=createHash('sha256').update(payload).digest('hex');
        await client.query(
          `INSERT INTO trade.management_action_frontier(
            management_action_frontier_id,management_input_snapshot_id,chain_id,observed_at,lifecycle_state,
            policy_version,policy_evidence_hash,economic_model_state,actions_json,selected_action,second_best_action,
            decision_state,reason_codes_json,content_hash)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14)
           ON CONFLICT(management_input_snapshot_id,content_hash) DO NOTHING`,
          [randomUUID(),state.managementInputSnapshotId,state.chainId,state.observedAt,state.lifecycleState,
            frontier.policyVersion, frontier.policyEvidenceHash, frontier.economicModelState,
            JSON.stringify(frontier.actions), frontier.selectedAction,
            frontier.secondBestAction, frontier.decisionState, JSON.stringify(frontier.reasonCodes),
            contentHash],
        );
        const stored=await client.query(`SELECT management_action_frontier_id FROM trade.management_action_frontier
          WHERE management_input_snapshot_id=$1 AND content_hash=$2`,[state.managementInputSnapshotId,contentHash]);
        const id=stored.rows[0]?.management_action_frontier_id as string|undefined;
        if(id===undefined)throw new Error('MANAGEMENT_FRONTIER_PERSISTENCE_FAILED');
        persisted.push({managementActionFrontierId:id,managementInputSnapshotId:state.managementInputSnapshotId,frontier});
      }
    });
    return persisted;
  }

  /**
   * Read-only compatibility surface for research callers. The resident path
   * binds these same components before persisting each management input above.
   */
  async attachWholeChainEvidence(states: readonly ManagementInputState[], connectionId: string):
  Promise<readonly ManagementInputWithWholeChainEvidence[]> {
    const results: ManagementInputWithWholeChainEvidence[] = [];
    for (const state of states) results.push({ state,
      wholeChainEvidence: await this.wholeChainRepository.load(state.chainId, state.observedAt, {
        connectionId,
        reconciliationSnapshotId: state.reconciliationSnapshotId,
      }),
    });
    return results;
  }
}
