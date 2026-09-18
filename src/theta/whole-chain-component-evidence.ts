import { createHash } from 'node:crypto';

export const wholeChainComponentEvidenceVersion = 'theta-whole-chain-component-evidence-v2' as const;

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
  const required: ReadonlyArray<readonly [string, WholeChainEvidenceField<unknown>]> = [
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
  const blockers = required.filter(([, field]) => field.status === 'UNKNOWN').map(([name]) => `${name}:UNKNOWN`);
  if (evidence.stockSharesAssigned.status !== 'UNKNOWN' && (evidence.stockSharesAssigned.value ?? 0) > 0
      && evidence.assignmentStrike.status === 'UNKNOWN') {
    blockers.push('assignmentStrike:UNKNOWN');
  }
  if (evidence.openStockShares.status !== 'UNKNOWN' && (evidence.openStockShares.value ?? 0) > 0
      && evidence.currentStockMarkPerShare.status === 'UNKNOWN') {
    blockers.push('currentStockMarkPerShare:UNKNOWN');
  }
  if (evidence.stockSharesAssigned.status !== 'UNKNOWN' && (evidence.stockSharesAssigned.value ?? 0) > 0
      && evidence.openStockShares.status !== 'UNKNOWN' && evidence.openStockShares.value === 0
      && evidence.stockSaleOrCallAwayProceeds.status === 'UNKNOWN') {
    blockers.push('stockSaleOrCallAwayProceeds:UNKNOWN');
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
      executionCostNotEmbeddedInCashflows: 0,
      tcaExecutionShortfall: evidence.tcaExecutionShortfall.value,
      currentStockMarkPerShare: evidence.currentStockMarkPerShare.value,
      openStockShares: evidence.openStockShares.value as number,
    },
    blockers: [],
  };
}
