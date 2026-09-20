export type RiskPolicyStatus = 'APPROVED' | 'RESEARCH_CANDIDATE' | 'MISSING';

export interface RiskPolicyRegistryEntry {
  readonly key: 'SEVERE_DRAWDOWN' | 'CORRELATION_CLUSTERING' | 'SECTOR_MAPPING' | 'IV_SHOCK' | 'SPREAD_WIDENING';
  readonly status: RiskPolicyStatus;
  readonly policyVersion: string | null;
  readonly evidenceReference: string | null;
  readonly blocker: string | null;
}

export const RISK_POLICY_REGISTRY: readonly RiskPolicyRegistryEntry[] = Object.freeze([
  { key: 'SEVERE_DRAWDOWN', status: 'MISSING', policyVersion: null, evidenceReference: null, blocker: 'HORIZON_AND_THRESHOLD_NOT_OWNER_APPROVED' },
  { key: 'CORRELATION_CLUSTERING', status: 'MISSING', policyVersion: null, evidenceReference: null, blocker: 'LOOKBACK_AND_CLUSTER_POLICY_NOT_OWNER_APPROVED' },
  { key: 'SECTOR_MAPPING', status: 'MISSING', policyVersion: null, evidenceReference: null, blocker: 'AUTHORITATIVE_SECTOR_SOURCE_NOT_SELECTED' },
  { key: 'IV_SHOCK', status: 'MISSING', policyVersion: null, evidenceReference: null, blocker: 'IV_HORIZON_AND_SHOCK_POLICY_NOT_OWNER_APPROVED' },
  { key: 'SPREAD_WIDENING', status: 'MISSING', policyVersion: null, evidenceReference: null, blocker: 'SPREAD_BASELINE_AND_WIDENING_POLICY_NOT_OWNER_APPROVED' },
]);

export function validateRiskPolicyRegistry(entries: readonly RiskPolicyRegistryEntry[]): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key)) throw new Error(`duplicate risk policy: ${entry.key}`);
    keys.add(entry.key);
    if (entry.status === 'APPROVED' && (!entry.policyVersion || !entry.evidenceReference)) {
      throw new Error(`approved risk policy lacks versioned evidence: ${entry.key}`);
    }
    if (entry.status !== 'APPROVED' && (entry.policyVersion !== null || entry.evidenceReference !== null)) {
      throw new Error(`unapproved risk policy cannot claim an authoritative version: ${entry.key}`);
    }
  }
}

validateRiskPolicyRegistry(RISK_POLICY_REGISTRY);
