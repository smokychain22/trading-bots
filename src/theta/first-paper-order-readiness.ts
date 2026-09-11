import { createHash } from 'node:crypto';

export type EvidenceState = 'GOOD' | 'UNKNOWN' | 'STALE' | 'INVALID' | 'NOT_ENTITLED';
export interface Evidence<T> {
  readonly state: EvidenceState;
  readonly value: T | null;
  readonly source: string;
  readonly asOf: string | null;
}

export interface FirstPaperOrderReadinessInput {
  readonly asOf: string;
  readonly broker: {
    readonly role: Evidence<string>;
    readonly host: Evidence<string>;
    readonly accountStatus: Evidence<string>;
    readonly identityVerified: Evidence<boolean>;
    readonly optionsApprovalLevel: Evidence<number>;
    readonly optionsTradingLevel: Evidence<number>;
    readonly equity: Evidence<number>;
    readonly cash: Evidence<number>;
    readonly buyingPower: Evidence<number>;
    readonly optionsBuyingPower: Evidence<number>;
    readonly positionCount: Evidence<number>;
    readonly openOrderCount: Evidence<number>;
  };
  readonly market: {
    readonly clockOpen: Evidence<boolean>;
    readonly calendarSessionConfirmed: Evidence<boolean>;
  };
  readonly selection: {
    readonly strategyBranch: Evidence<string>;
    readonly symbol: Evidence<string>;
    readonly occContract: Evidence<string>;
    readonly optionType: Evidence<'PUT' | 'CALL'>;
    readonly strike: Evidence<number>;
    readonly expiration: Evidence<string>;
    readonly dte: Evidence<number>;
    readonly multiplier: Evidence<number>;
    readonly positionIntent: Evidence<string>;
    readonly quantity: Evidence<number>;
    readonly collateral: Evidence<number>;
    readonly assignmentCapacity: Evidence<boolean>;
    readonly ownershipQuality: Evidence<string>;
    readonly eventState: Evidence<string>;
  };
  readonly quote: {
    readonly bid: Evidence<number>;
    readonly ask: Evidence<number>;
    readonly midpoint: Evidence<number>;
    readonly proposedLimit: Evidence<number>;
    readonly ageSeconds: Evidence<number>;
    readonly maximumAgeSeconds: number;
    readonly spreadProtectionPassed: Evidence<boolean>;
  };
  readonly economics: {
    readonly empiricalState: Evidence<string>;
    readonly expectedAfterCost: Evidence<number>;
    readonly downsideTailEvidence: Evidence<string>;
    readonly returnPerCapitalDay: Evidence<number>;
  };
  readonly aegis: {
    readonly result: Evidence<string>;
    readonly finalQuantity: Evidence<number>;
  };
  readonly identity: {
    readonly fusionSnapshotId: Evidence<string>;
    readonly fusionSnapshotHash: Evidence<string>;
    readonly decisionId: Evidence<string>;
    readonly orderIntentId: Evidence<string>;
    readonly clientOrderId: Evidence<string>;
  };
  readonly operations: {
    readonly idempotencyReserved: Evidence<boolean>;
    readonly persistenceDurable: Evidence<boolean>;
    readonly schedulerHealthy: Evidence<boolean>;
    readonly reconciliationHealthy: Evidence<boolean>;
    readonly executionBoundary: Evidence<string>;
    readonly alwaysOnWorker: 'NOT_YET_DEPLOYED';
  };
}

export interface FirstPaperOrderReadinessReceipt extends FirstPaperOrderReadinessInput {
  readonly receiptVersion: 'theta-first-paper-order-readiness-v1';
  readonly receiptHash: string;
  readonly blockers: readonly string[];
  readonly readyForFirstPaperOrder: 'YES' | 'NO';
  readonly masterPaperOrders: 0;
  readonly followerPaperOrders: 0;
  readonly liveOrders: 0;
}

const PAPER_HOST = 'https://paper-api.alpaca.markets';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireGood<T>(evidence: Evidence<T>, code: string, blockers: string[]): T | null {
  if (evidence.state !== 'GOOD' || evidence.value === null) {
    blockers.push(`${code}_${evidence.state}`);
    return null;
  }
  return evidence.value;
}

function positiveFinite(value: number | null): boolean {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function buildFirstPaperOrderReadinessReceipt(input: FirstPaperOrderReadinessInput): FirstPaperOrderReadinessReceipt {
  const blockers: string[] = [];
  const role = requireGood(input.broker.role, 'BROKER_ROLE', blockers);
  const host = requireGood(input.broker.host, 'BROKER_HOST', blockers);
  const status = requireGood(input.broker.accountStatus, 'ACCOUNT_STATUS', blockers);
  const identityVerified = requireGood(input.broker.identityVerified, 'BROKER_IDENTITY', blockers);
  const approval = requireGood(input.broker.optionsApprovalLevel, 'OPTIONS_APPROVAL', blockers);
  const tradingLevel = requireGood(input.broker.optionsTradingLevel, 'OPTIONS_TRADING_LEVEL', blockers);
  const financials = [
    ['EQUITY', requireGood(input.broker.equity, 'EQUITY', blockers)],
    ['CASH', requireGood(input.broker.cash, 'CASH', blockers)],
    ['BUYING_POWER', requireGood(input.broker.buyingPower, 'BUYING_POWER', blockers)],
    ['OPTIONS_BUYING_POWER', requireGood(input.broker.optionsBuyingPower, 'OPTIONS_BUYING_POWER', blockers)],
  ] as const;
  const positionCount = requireGood(input.broker.positionCount, 'POSITION_COUNT', blockers);
  const openOrderCount = requireGood(input.broker.openOrderCount, 'OPEN_ORDER_COUNT', blockers);
  if (role !== null && role !== 'MASTER_THETA_PAPER') blockers.push('BROKER_ROLE_NOT_MASTER_THETA_PAPER');
  if (host !== null && host !== PAPER_HOST) blockers.push('BROKER_HOST_NOT_EXACT_PAPER_HOST');
  if (status !== null && status !== 'ACTIVE') blockers.push('ACCOUNT_NOT_ACTIVE');
  if (identityVerified === false) blockers.push('BROKER_IDENTITY_NOT_VERIFIED');
  if (approval !== null && (!Number.isInteger(approval) || approval < 1)) blockers.push('OPTIONS_NOT_APPROVED');
  if (tradingLevel !== null && (!Number.isInteger(tradingLevel) || tradingLevel < 1)) blockers.push('OPTIONS_TRADING_NOT_ENABLED');
  for (const [name, value] of financials) if (value !== null && (!Number.isFinite(value) || value < 0)) blockers.push(`${name}_INVALID`);
  if (positionCount !== null && (!Number.isInteger(positionCount) || positionCount < 0)) blockers.push('POSITION_COUNT_INVALID');
  if (openOrderCount !== null && (!Number.isInteger(openOrderCount) || openOrderCount < 0)) blockers.push('OPEN_ORDER_COUNT_INVALID');

  const marketOpen = requireGood(input.market.clockOpen, 'MARKET_CLOCK', blockers);
  const calendar = requireGood(input.market.calendarSessionConfirmed, 'MARKET_CALENDAR', blockers);
  if (marketOpen === false) blockers.push('MARKET_NOT_OPEN');
  if (calendar === false) blockers.push('MARKET_SESSION_NOT_CONFIRMED');

  const branch = requireGood(input.selection.strategyBranch, 'STRATEGY_BRANCH', blockers);
  const symbol = requireGood(input.selection.symbol, 'UNDERLYING', blockers);
  const contract = requireGood(input.selection.occContract, 'OCC_CONTRACT', blockers);
  const optionType = requireGood(input.selection.optionType, 'OPTION_TYPE', blockers);
  const strike = requireGood(input.selection.strike, 'STRIKE', blockers);
  const expiration = requireGood(input.selection.expiration, 'EXPIRATION', blockers);
  const dte = requireGood(input.selection.dte, 'DTE', blockers);
  const multiplier = requireGood(input.selection.multiplier, 'CONTRACT_MULTIPLIER', blockers);
  const positionIntent = requireGood(input.selection.positionIntent, 'POSITION_INTENT', blockers);
  const quantity = requireGood(input.selection.quantity, 'QUANTITY', blockers);
  const collateral = requireGood(input.selection.collateral, 'COLLATERAL', blockers);
  const assignmentCapacity = requireGood(input.selection.assignmentCapacity, 'ASSIGNMENT_CAPACITY', blockers);
  const ownership = requireGood(input.selection.ownershipQuality, 'OWNERSHIP_QUALITY', blockers);
  const eventState = requireGood(input.selection.eventState, 'EVENT_STATE', blockers);
  if (branch !== null && branch.length === 0) blockers.push('STRATEGY_BRANCH_INVALID');
  if (symbol !== null && !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) blockers.push('UNDERLYING_INVALID');
  if (contract !== null && contract.length < 10) blockers.push('OCC_CONTRACT_INVALID');
  if (optionType !== null && optionType !== 'PUT') blockers.push('FIRST_THETA_ORDER_MUST_BE_CSP_PUT');
  if (positionIntent !== null && positionIntent !== 'SELL_TO_OPEN') blockers.push('FIRST_THETA_INTENT_NOT_SELL_TO_OPEN');
  if (!positiveFinite(strike)) blockers.push('STRIKE_NOT_POSITIVE');
  if (expiration !== null && Number.isNaN(Date.parse(`${expiration}T00:00:00Z`))) blockers.push('EXPIRATION_INVALID');
  if (dte !== null && (!Number.isInteger(dte) || dte < 1)) blockers.push('DTE_NOT_POSITIVE');
  if (multiplier !== null && (!Number.isInteger(multiplier) || multiplier <= 0)) blockers.push('CONTRACT_MULTIPLIER_INVALID');
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) blockers.push('QUANTITY_NOT_EXECUTABLE');
  if (assignmentCapacity === false) blockers.push('ASSIGNMENT_CAPACITY_FAILED');
  if (ownership !== null && ownership === 'UNKNOWN') blockers.push('OWNERSHIP_QUALITY_UNKNOWN');
  if (eventState !== null && eventState !== 'CLEAR') blockers.push('EVENT_STATE_BLOCKED');
  if (strike !== null && multiplier !== null && quantity !== null && collateral !== null) {
    const expected = strike * multiplier * quantity;
    if (!Number.isFinite(collateral) || Math.abs(collateral - expected) > 0.000001) blockers.push('COLLATERAL_FORMULA_MISMATCH');
  }

  const bid = requireGood(input.quote.bid, 'BID', blockers);
  const ask = requireGood(input.quote.ask, 'ASK', blockers);
  const midpoint = requireGood(input.quote.midpoint, 'MIDPOINT', blockers);
  const limit = requireGood(input.quote.proposedLimit, 'PROPOSED_LIMIT', blockers);
  const quoteAge = requireGood(input.quote.ageSeconds, 'QUOTE_AGE', blockers);
  const spreadPassed = requireGood(input.quote.spreadProtectionPassed, 'SPREAD_PROTECTION', blockers);
  if (!positiveFinite(bid) || !positiveFinite(ask) || (bid !== null && ask !== null && bid > ask)) blockers.push('BBO_INVALID');
  if (bid !== null && ask !== null && midpoint !== null && Math.abs(midpoint - (bid + ask) / 2) > 0.000001) blockers.push('MIDPOINT_MISMATCH');
  if (bid !== null && ask !== null && limit !== null && (limit < bid || limit > ask)) blockers.push('LIMIT_OUTSIDE_BBO');
  if (quoteAge !== null && (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > input.quote.maximumAgeSeconds)) blockers.push('QUOTE_STALE');
  if (input.quote.bid.source !== 'ALPACA' || input.quote.ask.source !== 'ALPACA') blockers.push('QUOTE_PROVENANCE_NOT_ALPACA');
  if (spreadPassed === false) blockers.push('SPREAD_PROTECTION_FAILED');

  const empirical = requireGood(input.economics.empiricalState, 'EV_MODEL', blockers);
  const ev = requireGood(input.economics.expectedAfterCost, 'EXPECTED_AFTER_COST', blockers);
  const tail = requireGood(input.economics.downsideTailEvidence, 'TAIL_EVIDENCE', blockers);
  const capitalDay = requireGood(input.economics.returnPerCapitalDay, 'CAPITAL_DAY_ECONOMICS', blockers);
  if (empirical !== null && empirical !== 'EMPIRICALLY_READY') blockers.push('EV_MODEL_NOT_EMPIRICALLY_READY');
  if (ev !== null && (!Number.isFinite(ev) || ev <= 0)) blockers.push('EXPECTED_AFTER_COST_NOT_POSITIVE');
  if (tail !== null && tail !== 'VALIDATED') blockers.push('TAIL_EVIDENCE_NOT_VALIDATED');
  if (capitalDay !== null && (!Number.isFinite(capitalDay) || capitalDay <= 0)) blockers.push('CAPITAL_DAY_ECONOMICS_NOT_POSITIVE');

  const aegis = requireGood(input.aegis.result, 'AEGIS', blockers);
  const aegisQuantity = requireGood(input.aegis.finalQuantity, 'AEGIS_QUANTITY', blockers);
  if (aegis !== null && !['ALLOW_FULL', 'ALLOW_REDUCED'].includes(aegis)) blockers.push('AEGIS_BLOCKS_NEW_RISK');
  if (aegisQuantity !== null && quantity !== null && aegisQuantity !== quantity) blockers.push('AEGIS_QUANTITY_MISMATCH');

  for (const [name, evidence] of Object.entries(input.identity)) {
    const value = requireGood(evidence, name.toUpperCase(), blockers);
    if (value !== null && value.trim().length === 0) blockers.push(`${name.toUpperCase()}_EMPTY`);
  }
  const idempotency = requireGood(input.operations.idempotencyReserved, 'IDEMPOTENCY', blockers);
  const persistence = requireGood(input.operations.persistenceDurable, 'PERSISTENCE', blockers);
  const scheduler = requireGood(input.operations.schedulerHealthy, 'SCHEDULER', blockers);
  const reconciliation = requireGood(input.operations.reconciliationHealthy, 'RECONCILIATION', blockers);
  const boundary = requireGood(input.operations.executionBoundary, 'EXECUTION_BOUNDARY', blockers);
  if (idempotency === false) blockers.push('IDEMPOTENCY_NOT_RESERVED');
  if (persistence === false) blockers.push('PERSISTENCE_NOT_DURABLE');
  if (scheduler === false) blockers.push('SCHEDULER_NOT_HEALTHY');
  if (reconciliation === false) blockers.push('RECONCILIATION_NOT_HEALTHY');
  if (boundary !== null && boundary !== 'LOCKED_BEFORE_FIRST_POST') blockers.push('FIRST_POST_BOUNDARY_NOT_LOCKED');

  const uniqueBlockers = [...new Set(blockers)].sort();
  const base = {
    receiptVersion: 'theta-first-paper-order-readiness-v1' as const,
    ...input,
    blockers: uniqueBlockers,
    readyForFirstPaperOrder: uniqueBlockers.length === 0 ? 'YES' as const : 'NO' as const,
    masterPaperOrders: 0 as const, followerPaperOrders: 0 as const, liveOrders: 0 as const,
  };
  return { ...base, receiptHash: createHash('sha256').update(canonical(base)).digest('hex') };
}
