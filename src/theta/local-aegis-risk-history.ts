import { createHash } from 'node:crypto';
import { canonicalJson } from '../research/point-in-time-evidence.js';
import { parseOccOptionSymbol } from './account-exposure.js';
import {
  assessAlpacaContractIvStress,
  paperBootstrapAlpacaContractIvPolicy,
  parseAlpacaContractIvHistoryRow,
  type AlpacaContractIvAssessmentMap,
  type AlpacaContractIvHistoryRow,
} from './aegis-alpaca-iv-stress.js';
import {
  assessAegisSpreadStress,
  paperBootstrapAegisSpreadStressPolicy,
  type AegisSpreadStressAssessmentMap,
  type SpreadHistoryObservation,
} from './aegis-spread-stress.js';
import { normalizedOptionContractSchema, type NormalizedOptionContract } from './option-contract.js';

export const localAegisRiskHistoryVersion = 'theta-local-aegis-risk-history-v1' as const;

export interface LocalAegisRiskObservation {
  readonly contractVersion: typeof localAegisRiskHistoryVersion;
  readonly evidenceId: string;
  readonly sourceHash: string;
  readonly snapshotId: string;
  readonly decisionCycleId: string;
  readonly decisionTime: string;
  readonly contract: NormalizedOptionContract;
  readonly spreadHistoryState: 'QUALIFIED' | 'REJECTED';
  readonly spreadHistoryReason: string;
  readonly ivHistoryState: 'QUALIFIED' | 'REJECTED';
  readonly ivHistoryReason: string;
}

export interface LocalAegisRiskHistory {
  readonly spread: readonly SpreadHistoryObservation[];
  readonly alpacaIv: readonly AlpacaContractIvHistoryRow[];
  readonly scanned: number;
  readonly spreadRejected: number;
  readonly ivRejected: number;
}

const validIso = (value: string): boolean => Number.isFinite(Date.parse(value));
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function spreadHistoryFromObservation(observation: LocalAegisRiskObservation): SpreadHistoryObservation | null {
  const contract = observation.contract;
  const identity = contract.occSymbol === null ? null : parseOccOptionSymbol(contract.occSymbol);
  if (identity === null || contract.occSymbol !== contract.optionSymbol
    || identity.underlying !== contract.underlying || identity.optionType !== contract.optionType
    || identity.strike !== contract.strike || identity.expiration !== contract.expiration
    || contract.source !== 'ALPACA' || contract.dataQuality !== 'GOOD'
    || (contract.feed !== 'OPRA' && contract.feed !== 'INDICATIVE')
    || contract.quoteTimestamp === null || !validIso(contract.quoteTimestamp)
    || !validIso(contract.receivedAt) || !validIso(observation.decisionTime)
    || Date.parse(contract.quoteTimestamp) > Date.parse(contract.receivedAt)
    || Date.parse(contract.receivedAt) > Date.parse(observation.decisionTime)
    || (Date.parse(observation.decisionTime) - Date.parse(contract.quoteTimestamp)) / 1000
      > paperBootstrapAegisSpreadStressPolicy.maturity.maxCurrentObservationAgeSeconds
    || contract.spreadPct === null || !Number.isFinite(contract.spreadPct) || contract.spreadPct < 0
    || contract.moneyness === null || !Number.isFinite(contract.moneyness)
    || contract.underlyingReferencePrice === null || contract.underlyingReferencePrice <= 0
    || contract.underlyingQuoteSource !== 'ALPACA_IEX'
    || contract.underlyingTimestamp === null || !validIso(contract.underlyingTimestamp)
    || contract.underlyingQuoteReceivedAt === null || contract.underlyingQuoteReceivedAt === undefined
    || !validIso(contract.underlyingQuoteReceivedAt)
    || Date.parse(contract.underlyingTimestamp) > Date.parse(contract.underlyingQuoteReceivedAt)
    || Date.parse(contract.underlyingQuoteReceivedAt) > Date.parse(observation.decisionTime)
    || (Date.parse(observation.decisionTime) - Date.parse(contract.underlyingTimestamp)) / 1000
      > paperBootstrapAegisSpreadStressPolicy.maturity.maxCurrentObservationAgeSeconds
    || Math.abs((contract.underlyingReferencePrice - contract.strike) / contract.strike - contract.moneyness) > 1e-9) {
    return null;
  }
  return {
    evidenceId: observation.evidenceId,
    underlying: contract.underlying,
    optionType: contract.optionType,
    contractSymbol: contract.optionSymbol,
    dte: contract.dte,
    moneyness: contract.moneyness,
    relativeSpread: contract.spreadPct,
    providerTimestamp: contract.quoteTimestamp,
    ingestionTimestamp: contract.receivedAt,
    decisionTime: observation.decisionTime,
    source: 'ALPACA',
    feed: contract.feed,
    dataQuality: 'GOOD',
  };
}

function ivHistoryFromObservation(observation: LocalAegisRiskObservation): AlpacaContractIvHistoryRow | null {
  const contract = observation.contract;
  return parseAlpacaContractIvHistoryRow({
    candidate_id: observation.evidenceId,
    decision_time: observation.decisionTime,
    content_hash: observation.sourceHash,
    contract_json: {
      underlying: contract.underlying, contractSymbol: contract.optionSymbol, optionType: contract.optionType,
      strike: contract.strike, expiration: contract.expiration, dte: contract.dte, moneyness: contract.moneyness,
    },
    market_json: {
      feed: contract.feed, dataQuality: contract.dataQuality, quoteSource: contract.source,
      quoteTimestamp: contract.quoteTimestamp, quoteReceivedAt: contract.receivedAt,
      underlyingQuoteSource: contract.underlyingQuoteSource ?? null,
      underlyingQuoteTimestamp: contract.underlyingTimestamp,
      underlyingQuoteReceivedAt: contract.underlyingQuoteReceivedAt ?? null,
      underlyingReferencePrice: contract.underlyingReferencePrice,
    },
    volatility_json: {
      iv: contract.iv, ivSource: contract.greeksSource,
      ivEvidenceAuthority: 'ALPACA_OPTION_SNAPSHOT_CONTRACT_IV', ivFeed: contract.feed,
      ivAvailableAt: contract.greeksTimestamp,
    },
  });
}

export function createLocalAegisRiskObservation(input: {
  readonly snapshotId: string;
  readonly decisionCycleId: string;
  readonly decisionTime: string;
  readonly contract: NormalizedOptionContract;
}): LocalAegisRiskObservation {
  const contract = normalizedOptionContractSchema.parse(input.contract);
  if (!validIso(input.decisionTime)) throw new Error('LOCAL_AEGIS_DECISION_TIME_INVALID');
  const sourceHash = sha256(canonicalJson(contract));
  const evidenceId = `${input.snapshotId}:${contract.optionSymbol}`;
  const base = {
    contractVersion: localAegisRiskHistoryVersion,
    evidenceId,
    sourceHash,
    snapshotId: input.snapshotId,
    decisionCycleId: input.decisionCycleId,
    decisionTime: new Date(input.decisionTime).toISOString(),
    contract,
  } as const;
  const provisional = {
    ...base,
    spreadHistoryState: 'REJECTED' as const,
    spreadHistoryReason: 'UNASSESSED',
    ivHistoryState: 'REJECTED' as const,
    ivHistoryReason: 'UNASSESSED',
  };
  const spread = spreadHistoryFromObservation(provisional);
  const iv = ivHistoryFromObservation(provisional);
  return {
    ...base,
    spreadHistoryState: spread === null ? 'REJECTED' : 'QUALIFIED',
    spreadHistoryReason: spread === null ? 'SPREAD_LINEAGE_OR_COHORT_UNQUALIFIED' : 'QUALIFIED_ALPACA_BBO_COHORT',
    ivHistoryState: iv === null ? 'REJECTED' : 'QUALIFIED',
    ivHistoryReason: iv === null ? 'ALPACA_IV_LINEAGE_OR_TIMING_UNQUALIFIED' : 'QUALIFIED_ALPACA_CONTRACT_IV_COHORT',
  };
}

export function buildLocalAegisRiskHistory(values: readonly unknown[]): LocalAegisRiskHistory {
  const observations: LocalAegisRiskObservation[] = [];
  for (const value of values) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const row = value as Partial<LocalAegisRiskObservation>;
    if (row.contractVersion !== localAegisRiskHistoryVersion || typeof row.evidenceId !== 'string'
      || typeof row.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.sourceHash)
      || typeof row.snapshotId !== 'string' || typeof row.decisionCycleId !== 'string'
      || typeof row.decisionTime !== 'string' || !validIso(row.decisionTime)) continue;
    const contract = normalizedOptionContractSchema.safeParse(row.contract);
    if (!contract.success || sha256(canonicalJson(contract.data)) !== row.sourceHash
      || row.evidenceId !== `${row.snapshotId}:${contract.data.optionSymbol}`) continue;
    observations.push(createLocalAegisRiskObservation({ snapshotId: row.snapshotId,
      decisionCycleId: row.decisionCycleId, decisionTime: row.decisionTime, contract: contract.data }));
  }
  const spread = observations.flatMap((observation) => {
    const row = spreadHistoryFromObservation(observation); return row === null ? [] : [row];
  });
  const alpacaIv = observations.flatMap((observation) => {
    const row = ivHistoryFromObservation(observation); return row === null ? [] : [row];
  });
  return { spread, alpacaIv, scanned: observations.length,
    spreadRejected: observations.length - spread.length, ivRejected: observations.length - alpacaIv.length };
}

export function localAegisAssessors(history: LocalAegisRiskHistory): {
  readonly spread: (input: { readonly contracts: readonly NormalizedOptionContract[];
    readonly decisionAsOf: string }) => Promise<AegisSpreadStressAssessmentMap>;
  readonly alpacaIv: (input: { readonly contracts: readonly NormalizedOptionContract[];
    readonly decisionAsOf: string }) => Promise<AlpacaContractIvAssessmentMap>;
} {
  return {
    spread: async ({ contracts, decisionAsOf }) => Object.fromEntries(contracts.map((contract) => [contract.optionSymbol,
      assessAegisSpreadStress({ current: contract, history: history.spread, decisionAsOf,
        policy: paperBootstrapAegisSpreadStressPolicy })])),
    alpacaIv: async ({ contracts, decisionAsOf }) => Object.fromEntries(contracts.map((contract) => [contract.optionSymbol,
      assessAlpacaContractIvStress({ current: contract, history: history.alpacaIv, decisionAsOf,
        policy: paperBootstrapAlpacaContractIvPolicy })])),
  };
}
