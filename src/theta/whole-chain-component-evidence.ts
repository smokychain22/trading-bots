import { createHash } from 'node:crypto';
import { classifyFeeEvidence, type CostBasisKind } from './cost-basis-typing.js';

export const wholeChainComponentEvidenceVersion = 'theta-whole-chain-component-evidence-v3' as const;

export type WholeChainEvidenceStatus = 'KNOWN' | 'KNOWN_ZERO' | 'UNKNOWN';

export interface WholeChainEvidenceSource {
  readonly relation: string;
  readonly columns: readonly string[];
  readonly recordIds: readonly string[];
  readonly observedAt: string | null;
}

export interface WholeChainEvidenceField<T> {
  readonly value: T | null;
  readonly status: WholeChainEvidenceStatus;
  readonly sources: readonly WholeChainEvidenceSource[];
  readonly reasons: readonly string[];
  readonly asOf: string;
}

export interface StockLotBasisReference {
  readonly stockLotId: string;
  readonly shares: number;
  /** Current lifecycle writer semantics: assignment strike at acquisition. */
  readonly lifecycleEconomicBasisPerShare: number;
  /** Broker-recorded basis reference. It is not canonical whole-chain basis. */
  readonly brokerBasisPerShare: number | null;
  readonly acquiredAt: string;
  readonly disposedAt: string | null;
}

/**
 * Structurally compatible with Claude's WholeChainComponents contract. The
 * repository only constructs this object when every non-nullable economic
 * field is proven. UNKNOWN is never converted to zero to make it fit.
 */
export interface WholeChainComponentsInput {
  readonly cashflowBasis: 'ACTUAL_FILL_CASHFLOW';
  readonly initialPutPremium: number | null;
  readonly putCloseCosts: number | null;
  readonly rollCredits: number | null;
  readonly rollCloseCosts: number | null;
  readonly assignmentStrike: number | null;
  readonly stockSharesAssigned: number;
  readonly dividends: number;
  readonly coveredCallPremium: number | null;
  readonly coveredCallCloseCosts: number | null;
  readonly stockSaleOrCallAwayProceeds: number | null;
  readonly fees: number;
  /** Present only when the fee sources are proven broker relations (trade.fill / trade.fee_event). */
  readonly feeBasis?: CostBasisKind;
  readonly executionCostNotEmbeddedInCashflows: 0;
  readonly tcaExecutionShortfall: number | null;
  readonly currentStockMarkPerShare: number | null;
  readonly openStockShares: number;
}

export interface WholeChainComponentEvidence {
  readonly contractVersion: typeof wholeChainComponentEvidenceVersion;
  readonly chainId: string;
  readonly asOf: string;
  readonly contentHash: string;
  readonly initialPutPremium: WholeChainEvidenceField<number>;
  readonly putCloseCosts: WholeChainEvidenceField<number>;
  readonly rollCredits: WholeChainEvidenceField<number>;
  readonly rollCloseCosts: WholeChainEvidenceField<number>;
  readonly assignmentStrike: WholeChainEvidenceField<number>;
  readonly stockSharesAssigned: WholeChainEvidenceField<number>;
  readonly assignmentObservedAt: WholeChainEvidenceField<string>;
  readonly dividends: WholeChainEvidenceField<number>;
  readonly coveredCallPremium: WholeChainEvidenceField<number>;
  readonly coveredCallCloseCosts: WholeChainEvidenceField<number>;
  readonly stockSaleOrCallAwayProceeds: WholeChainEvidenceField<number>;
  readonly fees: WholeChainEvidenceField<number>;
  readonly tcaExecutionShortfall: WholeChainEvidenceField<number>;
  readonly currentStockMarkPerShare: WholeChainEvidenceField<number>;
  readonly openStockShares: WholeChainEvidenceField<number>;
  readonly stockLotBasisReferences: readonly StockLotBasisReference[];
  readonly components: WholeChainComponentsInput | null;
  readonly componentBlockers: readonly string[];
}

export const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
    : item,
);

export const wholeChainEvidenceHash = (value: Omit<WholeChainComponentEvidence, 'contentHash'>): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');

export const knownField = <T>(value: T, asOf: string, sources: readonly WholeChainEvidenceSource[],
  reasons: readonly string[] = []): WholeChainEvidenceField<T> => ({
  value,
  status: typeof value === 'number' && value === 0 ? 'KNOWN_ZERO' : 'KNOWN',
  sources,
  reasons,
  asOf,
});

export const unknownField = <T>(asOf: string, reasons: readonly string[],
  sources: readonly WholeChainEvidenceSource[] = [], value: T | null = null): WholeChainEvidenceField<T> => ({
  value,
  status: 'UNKNOWN',
  sources,
  reasons,
  asOf,
});

export function componentsFromEvidence(evidence: Omit<WholeChainComponentEvidence, 'components' | 'componentBlockers' | 'contentHash'>): {
  readonly components: WholeChainComponentsInput | null;
  readonly blockers: readonly string[];
} {
  const required: Array<readonly [string, WholeChainEvidenceField<number>]> = [
    ['initialPutPremium', evidence.initialPutPremium],
    ['putCloseCosts', evidence.putCloseCosts],
    ['rollCredits', evidence.rollCredits],
    ['rollCloseCosts', evidence.rollCloseCosts],
    ['stockSharesAssigned', evidence.stockSharesAssigned],
    ['dividends', evidence.dividends],
    ['coveredCallPremium', evidence.coveredCallPremium],
    ['coveredCallCloseCosts', evidence.coveredCallCloseCosts],
    ['fees', evidence.fees],
    ['openStockShares', evidence.openStockShares],
  ];
  if ((evidence.stockSharesAssigned.value ?? 0) > 0) {
    required.push(['assignmentStrike', evidence.assignmentStrike]);
  }
  if ((evidence.openStockShares.value ?? 0) > 0) {
    required.push(['currentStockMarkPerShare', evidence.currentStockMarkPerShare]);
  }
  if (evidence.stockSharesAssigned.value !== null && evidence.openStockShares.value !== null
      && evidence.stockSharesAssigned.value > evidence.openStockShares.value) {
    required.push(['stockSaleOrCallAwayProceeds', evidence.stockSaleOrCallAwayProceeds]);
  }
  const blockers: string[] = [];
  const decisionMs = Date.parse(evidence.asOf);
  if (!Number.isFinite(decisionMs)) blockers.push('asOf:INVALID');
  for (const [name, field] of required) {
    if (field.status === 'UNKNOWN') { blockers.push(`${name}:UNKNOWN`); continue; }
    if (typeof field.value !== 'number' || !Number.isFinite(field.value)) blockers.push(`${name}:INVALID`);
    const times = [field.asOf, ...field.sources.map(item => item.observedAt).filter((time): time is string => time !== null)];
    if (times.some(time => !Number.isFinite(Date.parse(time)) || Date.parse(time) > decisionMs)) blockers.push(`${name}:PIT_INVALID`);
  }
  // A modeled/assumed cost must never be accepted as the broker-actual fee of a
  // realized whole chain. Unproven-but-neutral origins keep their prior behavior.
  const feeBasis = classifyFeeEvidence(evidence.fees);
  if (feeBasis === 'MODELED_OPENING_COST') blockers.push('fees:MODELED_NOT_BROKER_ACTUAL');
  const assigned = evidence.stockSharesAssigned.value, open = evidence.openStockShares.value;
  if (assigned !== null && open !== null && (assigned < 0 || open < 0 || open > assigned)) {
    blockers.push('stockShares:INVALID_IDENTITY');
  }
  if (blockers.length > 0) return { components: null, blockers };
  return {
    components: {
      cashflowBasis: 'ACTUAL_FILL_CASHFLOW',
      initialPutPremium: evidence.initialPutPremium.value,
      putCloseCosts: evidence.putCloseCosts.value,
      rollCredits: evidence.rollCredits.value,
      rollCloseCosts: evidence.rollCloseCosts.value,
      assignmentStrike: evidence.assignmentStrike.value,
      stockSharesAssigned: evidence.stockSharesAssigned.value as number,
      dividends: evidence.dividends.value as number,
      coveredCallPremium: evidence.coveredCallPremium.value,
      coveredCallCloseCosts: evidence.coveredCallCloseCosts.value,
      stockSaleOrCallAwayProceeds: evidence.stockSaleOrCallAwayProceeds.value,
      fees: evidence.fees.value as number,
      ...(feeBasis === 'BROKER_ACTUAL_FEE' ? { feeBasis } : {}),
      executionCostNotEmbeddedInCashflows: 0,
      tcaExecutionShortfall: evidence.tcaExecutionShortfall.value,
      currentStockMarkPerShare: evidence.currentStockMarkPerShare.value,
      openStockShares: evidence.openStockShares.value as number,
    },
    blockers: [],
  };
}
