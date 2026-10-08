import type { PoolClient } from 'pg';
import { masterPaperActionPlanSchema, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import { actionPlanContentHash } from './action-plan-integrity.js';
import { capitalFootprint, capitalProposalSchema, moneyUnits, type CapitalProposal } from './portfolio-capital-reservation.js';
import type { AccountCapitalInput } from './qualified-account-capital.js';
import type { PersistedPaperOrderIntent } from './paper-order-coordinator.js';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';

export type PlanCapitalObservation = Omit<AccountCapitalInput, 'commitments' | 'now'>;

/** Runtime failure receipts accept bounded code tokens, not concatenated
 * schema paths or account-specific dimension labels. Keep the full reasons
 * available to the admission consumer without leaking them into public logs. */
export class CapitalPlanAdmissionError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    const primary = reasons[0]?.split(':')[0];
    super(`CAPITAL_PLAN_BLOCKED:${primary && /^CAPITAL_[A-Z0-9_]{1,96}$/.test(primary) ? primary : 'MISSING_ADMISSION'}`);
    this.reasons = [...reasons];
  }
}

/** Schema compatibility, not a feature flag. A failed/unknown catalog read
 * never selects the legacy path. Deployment still requires the governed 071
 * compatibility release, which is intentionally NOT enabled by this module. */
export async function capitalReservationRequired(client: Pick<PoolClient, 'query'>): Promise<boolean> {
  const result = await client.query("SELECT to_regclass('trade.capital_reservation') IS NOT NULL AS capital_required");
  const required = result.rows[0]?.capital_required;
  if (typeof required !== 'boolean') throw new Error('CAPITAL_SCHEMA_CAPABILITY_UNKNOWN');
  return required;
}

/** The canonical plan supplies quantity and economic authority. Contract and
 * cost evidence are read from its persisted decision, never a caller's budget. */
export function proposalForPlan(plan: ApprovedMasterPaperActionPlan, observation: PlanCapitalObservation,
  costsPerContract: string): CapitalProposal {
  if (plan.executionAccountId !== observation.executionAccountId || plan.decisionAuthority !== 'NEW_RISK'
    || !['OPEN_CSP', 'OPEN_DEFINED_RISK'].includes(plan.action)) throw new Error('CAPITAL_PLAN_AUTHORITY_INVALID');
  const occ = parseOccOptionSymbol(plan.symbol);
  if (!occ || occ.optionType !== 'PUT' || occ.underlying !== plan.underlying)
    throw new Error('CAPITAL_PLAN_CONTRACT_INVALID');
  const contract = observation.contracts.find(c => c.symbol === plan.symbol);
  if (!contract || contract.multiplier !== plan.multiplier || moneyUnits(contract.strike) !== moneyUnits(String(occ.strike)))
    throw new Error('CAPITAL_PLAN_CONTRACT_EVIDENCE_MISSING');
  const pkg = plan.definedRisk;
  if (pkg) {
    for (const leg of pkg.legs) {
      const evidence = observation.contracts.find(c => c.symbol === leg.occSymbol);
      if (!evidence || evidence.multiplier !== leg.multiplier || moneyUnits(evidence.strike) !== moneyUnits(String(leg.strike)))
        throw new Error('CAPITAL_PLAN_CONTRACT_EVIDENCE_MISSING');
    }
  }
  const costUnits = moneyUnits(costsPerContract) * BigInt(pkg ? 2 : 1);
  const costsPerPackage = `${costUnits / 100_000_000n}.${(costUnits % 100_000_000n).toString().padStart(8,'0')}`;
  const amount = capitalFootprint({ shortStrike: contract.strike, multiplier: contract.multiplier, costsPerPackage,
    ...(pkg ? { longStrike: String(pkg.legs[1].strike), minimumCreditPerShare: String(plan.economicBoundary) } : {}) });
  const group = observation.groups?.members[plan.underlying];
  const perUnit = { CASH: amount, BROKER: amount, PORTFOLIO: amount,
    // Defined-max-loss is not CSP ownership/assignment collateral. Native
    // assignment exposure is separately guarded by D's lifecycle/AEGIS gates.
    ASSIGNMENT: pkg ? '0' : capitalFootprint({ shortStrike: contract.strike, multiplier: contract.multiplier, costsPerPackage: '0' }),
    [`TICKER:${plan.underlying}`]: amount,
    [`SECTOR:${group?.sector ?? `SINGLE_UNDERLYING_PROXY:${plan.underlying}`}`]: amount,
    [`CORRELATION:${group?.correlation ?? `SINGLE_UNDERLYING_PROXY:${plan.underlying}`}`]: amount };
  return capitalProposalSchema.parse({ reservationId: plan.actionPlanId, proposalRef: plan.actionPlanId,
    decisionId: plan.decisionId, candidateRef: plan.candidateId, strategy: plan.strategyBranch ?? 'THETA_CONVENTIONAL',
    quantity: plan.quantity, canonicalMaximumQuantity: plan.canonicalQuantity, quoteExpiresAt: plan.decisionExpiresAt,
    perUnit, authorityHash: actionPlanContentHash(plan) });
}

export function assertCapitalIntentMatchesPlan(intent: PersistedPaperOrderIntent, raw: unknown): ApprovedMasterPaperActionPlan {
  const plan = masterPaperActionPlanSchema.parse(raw) as ApprovedMasterPaperActionPlan;
  if (intent.executionAccountId !== plan.executionAccountId || intent.decisionId !== plan.decisionId
    || intent.action !== plan.action || intent.chainId !== plan.chainId || intent.underlyingId !== plan.underlyingId
    || intent.optionContractId !== plan.optionContractId || intent.request.qty !== plan.quantity
    || intent.authorizationEvidence.canonicalQuantity !== plan.canonicalQuantity
    || intent.authorizationEvidence.paperEvidenceQuantity !== plan.paperEvidenceQuantity
    || intent.authorizationEvidence.executionTier !== plan.executionTier
    || intent.authorizationEvidence.empiricalEconomicsReady !== plan.empiricalEconomicsReady
    || intent.authorizationEvidence.expectedAfterCostEv !== plan.expectedAfterCostEv
    || intent.executionEvidence.decisionExpiresAt !== plan.decisionExpiresAt
    || intent.executionEvidence.aegisState !== plan.aegisState || intent.request.side !== 'sell')
    throw new Error('CAPITAL_INTENT_PLAN_MISMATCH');
  if (plan.definedRisk) {
    const evidence = intent.multiLegEvidence;
    if (!evidence || evidence.packageIdentity !== plan.definedRisk.packageIdentity
      || intent.request.order_class !== 'mleg' || evidence.creditDebitDirection !== 'CREDIT'
      || intent.request.symbol !== evidence.packageIdentity || evidence.legs.length !== 2 || intent.request.legs?.length !== 2
      || evidence.legs.some((leg, index) => {
        const expected = plan.definedRisk?.legs[index], request = intent.request.legs?.[index];
        return !expected || !request || leg.optionContractId !== expected.optionContractId
          || leg.providerContractId !== expected.providerContractId || leg.legIndex !== expected.legIndex
          || leg.optionType !== expected.optionType || leg.deliverableIdentity !== expected.deliverableIdentity
          || leg.occSymbol !== expected.occSymbol || leg.positionIntent !== expected.positionIntent
          || leg.multiplier !== expected.multiplier || leg.strike !== expected.strike || leg.expiration !== expected.expiration
          || leg.ratioQuantity !== 1 || request.symbol !== expected.occSymbol || request.ratio_qty !== 1
          || request.position_intent !== expected.positionIntent || request.side !== (index === 0 ? 'sell' : 'buy');
      }) || !/^-\d+(\.\d{1,8})?$/.test(intent.request.limit_price)
      || moneyUnits(intent.request.limit_price.slice(1)) < moneyUnits(String(plan.economicBoundary)))
      throw new Error('CAPITAL_NATIVE_INTENT_PLAN_MISMATCH');
  } else if (intent.request.order_class === 'mleg' || intent.multiLegEvidence !== undefined
    || intent.request.symbol !== plan.symbol || intent.request.position_intent !== 'sell_to_open'
    || moneyUnits(intent.request.limit_price) < moneyUnits(String(plan.economicBoundary))) {
    throw new Error('CAPITAL_INTENT_PLAN_MISMATCH');
  }
  return plan;
}
