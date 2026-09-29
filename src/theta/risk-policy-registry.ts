export type RiskPolicyStatus = 'APPROVED' | 'PAPER_BOOTSTRAP_ACTIVE' | 'RESEARCH_CANDIDATE' | 'MISSING';

export interface RiskPolicyRegistryEntry {
  readonly key: 'SEVERE_DRAWDOWN' | 'CORRELATION_CLUSTERING' | 'SECTOR_MAPPING' | 'IV_SHOCK' | 'SPREAD_WIDENING';
  readonly status: RiskPolicyStatus;
  readonly policyVersion: string | null;
  readonly evidenceReference: string | null;
  readonly blocker: string | null;
}

export const RISK_POLICY_REGISTRY: readonly RiskPolicyRegistryEntry[] = Object.freeze([
  { key: 'SEVERE_DRAWDOWN', status: 'RESEARCH_CANDIDATE', policyVersion: 'theta-risk-policy-empirical-study-v1', evidenceReference: 'src/research/risk-policy-empirical-study.ts', blocker: 'EMPIRICAL_PROMOTION_REQUIRED' },
  { key: 'CORRELATION_CLUSTERING', status: 'PAPER_BOOTSTRAP_ACTIVE', policyVersion: 'theta-portfolio-correlation-paper-bootstrap-v1', evidenceReference: 'src/theta/portfolio-correlation-evidence.ts', blocker: null },
  { key: 'SECTOR_MAPPING', status: 'MISSING', policyVersion: null, evidenceReference: null, blocker: 'AUTHORITATIVE_SECTOR_SOURCE_NOT_SELECTED' },
  { key: 'IV_SHOCK', status: 'PAPER_BOOTSTRAP_ACTIVE', policyVersion: 'aegis-iv-shock-paper-bootstrap-v3', evidenceReference: 'src/theta/aegis-iv-stress.ts', blocker: null },
  { key: 'SPREAD_WIDENING', status: 'PAPER_BOOTSTRAP_ACTIVE', policyVersion: 'aegis-spread-widening-paper-bootstrap-v2', evidenceReference: 'src/theta/aegis-spread-stress.ts', blocker: null },
]);

export function validateRiskPolicyRegistry(entries: readonly RiskPolicyRegistryEntry[]): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (keys.has(entry.key)) throw new Error(`duplicate risk policy: ${entry.key}`);
    keys.add(entry.key);
    if (['APPROVED', 'PAPER_BOOTSTRAP_ACTIVE', 'RESEARCH_CANDIDATE'].includes(entry.status)
      && (!entry.policyVersion || !entry.evidenceReference)) {
      throw new Error(`implemented risk policy lacks versioned evidence: ${entry.key}`);
    }
    if (entry.status === 'MISSING' && (entry.policyVersion !== null || entry.evidenceReference !== null)) {
      throw new Error(`missing risk policy cannot claim an implemented version: ${entry.key}`);
    }
    if (entry.status === 'RESEARCH_CANDIDATE' && entry.blocker === null) {
      throw new Error(`research risk policy must name its promotion blocker: ${entry.key}`);
    }
    if (entry.status === 'PAPER_BOOTSTRAP_ACTIVE' && entry.blocker !== null) {
      throw new Error(`active Paper-bootstrap risk policy cannot retain a source blocker: ${entry.key}`);
    }
  }
}

validateRiskPolicyRegistry(RISK_POLICY_REGISTRY);
