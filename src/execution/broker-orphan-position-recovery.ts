import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import { paperBootstrapRuntimePolicy } from '../theta/paper-bootstrap-runtime-policy.js';
import { deterministicRuntimeUuid } from '../theta/postgres-theta-cycle-store.js';
import { masterPaperActionPlanSchema, masterPaperActionPlanVersion, type ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import type { ManagementDecisionDraft } from './management-paper-plan-assembly.js';

/**
 * BROKER_CONFIRMED_ORPHAN_POSITION_RECOVERY (2026-10-07 XLE incident).
 *
 * A THETA SELL_TO_OPEN filled at the broker, but lifecycle registration of the fill failed (schema 069 rejected SHORT_PUT_OPEN).
 * The chain stayed WAIT with no option leg, so management (which loads DB chains only and excludes a WAIT chain with no legs and
 * only terminal intents) had no owner for a real short put.
 *
 * This module turns broker truth + the exact matching THETA lineage into a sovereign, RISK-REDUCING-ONLY management
 * representation. Its permitted actions are exactly HOLD and CLOSE_RISK (BUY_TO_CLOSE of exactly the broker-confirmed quantity of
 * exactly that contract). It can not open exposure, roll, substitute a contract or increase quantity: those are not representable.
 * It never submits. A close leaves this module only as an ApprovedMasterPaperActionPlan for the existing PaperOrderCoordinator
 * handoff (prepareMasterPaperAction -> MasterPaperExecutionOrchestrator), which keeps every quote/fence/expiry/idempotency gate.
 */
export const brokerOrphanRecoveryVersion = 'theta-broker-confirmed-orphan-position-recovery-v1' as const;
export const brokerConfirmedPositionLifecycleRegistrationBlocked = 'BROKER_CONFIRMED_POSITION_LIFECYCLE_REGISTRATION_BLOCKED' as const;

export type OrphanRefusalCode =
  | 'ORPHAN_BROKER_EVIDENCE_NOT_GOOD'
  | 'ORPHAN_NOT_AN_OPTION_POSITION'
  | 'ORPHAN_SIDE_MISMATCH'
  | 'ORPHAN_NO_THETA_LINEAGE'
  | 'ORPHAN_LINEAGE_AMBIGUOUS'
  | 'ORPHAN_SYMBOL_MISMATCH'
  | 'ORPHAN_LINEAGE_MISMATCH'
  | 'ORPHAN_QUANTITY_MISMATCH'
  | 'ORPHAN_FILL_PRICE_MISMATCH'
  | 'ORPHAN_ALREADY_LIFECYCLE_OWNED'
  | 'ORPHAN_ORDER_IN_FLIGHT'
  | 'ORPHAN_STRATEGY_NOT_SUPPORTED';

/** Short-put branches whose open is a single SELL_TO_OPEN put. D (native spreads) has its own typed lifecycle and is never adopted here. */
export const orphanRecoverableStrategyBranches = ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE'] as const;

/** Exact broker position from a GOOD reconciliation snapshot. signedQuantity < 0 is short. */
export interface BrokerConfirmedOptionPosition {
  readonly symbol: string;
  readonly signedQuantity: number;
  readonly averageEntryPricePerShare: number;
  readonly observedAt: string;
  readonly reconciliationQuality: 'GOOD' | 'DEGRADED' | 'UNKNOWN';
}

/** The THETA-owned evidence that created the position. Every field comes from durable rows; nothing is inferred. */
export interface OrphanThetaLineage {
  readonly chainId: string;
  readonly chainKind: string;
  readonly chainLifecycleState: string;
  readonly chainClosed: boolean;
  /** Open option legs on the chain. Any value > 0 means the lifecycle already owns the position. */
  readonly openOptionLegCount: number;
  /** SHORT_PUT_OPEN application state for this fill: APPLIED means lifecycle-owned; BLOCKED carries the typed failure. */
  readonly lifecycleApplication: { readonly state: 'NONE' | 'BLOCKED'; readonly blockedCode: string | null } | { readonly state: 'APPLIED' };
  readonly decisionId: string;
  readonly orderIntent: {
    readonly orderIntentId: string;
    readonly clientOrderId: string;
    readonly chainId: string;
    readonly decisionId: string;
    readonly status: string;
    readonly thetaAction: string;
    readonly side: string;
    readonly positionIntent: string;
    readonly symbol: string;
    readonly quantity: number;
  };
  readonly brokerOrder: { readonly orderIntentId: string; readonly status: string; readonly symbol: string; readonly filledQuantity: number };
  readonly fills: readonly { readonly quantity: number; readonly pricePerShare: number; readonly occurredAt: string }[];
  /** Non-terminal plans or intents on the chain (any in-flight order blocks a second mutation). */
  readonly nonTerminalChainOrders: number;
  /**
   * Generic lineage identity (any registration failure: schema bug, DB commit failure, crash between fill and registration).
   * A null member means the lineage can not be established exactly: the position is RECONCILING, never a guessed recovery.
   */
  readonly identity: {
    readonly strategyBranch: string | null;
    readonly candidateId: string | null;
    readonly actionPlanId: string | null;
    readonly providerOrderId: string | null;
  };
  /** Persisted identifiers the coordinator plan must carry. */
  readonly underlyingId: string;
  readonly optionContractId: string;
  readonly multiplier: number;
}

export interface OrphanManagementRepresentation {
  readonly contractVersion: typeof brokerOrphanRecoveryVersion;
  readonly classification: typeof brokerConfirmedPositionLifecycleRegistrationBlocked;
  readonly lifecycleBlockedCode: string | null;
  readonly chainId: string;
  readonly decisionId: string;
  readonly orderIntentId: string;
  readonly clientOrderId: string;
  readonly strategyBranch: (typeof orphanRecoverableStrategyBranches)[number];
  readonly candidateId: string;
  readonly actionPlanId: string;
  readonly providerOrderId: string;
  readonly underlying: string;
  readonly underlyingId: string;
  readonly optionContractId: string;
  readonly symbol: string;
  readonly optionType: 'PUT';
  readonly strike: number;
  readonly expiration: string;
  readonly multiplier: number;
  /** Broker-confirmed short contracts (positive count). The only quantity any action may ever use. */
  readonly contracts: number;
  readonly entryPricePerShare: number;
  readonly entryCreditDebit: number;
  readonly openedAt: string;
  readonly permittedActions: readonly ['HOLD', 'CLOSE_RISK'];
  readonly defaultAction: 'HOLD';
  readonly brokerObservedAt: string;
  readonly contentHash: string;
}

export const orphanLineageIncomplete = 'ORPHAN_LINEAGE_INCOMPLETE_RECONCILING' as const;

export type OrphanClassification =
  | { readonly state: 'ORPHAN_CONFIRMED'; readonly representation: OrphanManagementRepresentation }
  /** Broker truth and a single THETA lineage agree, but an identity member is missing: wait for reconciliation, adopt nothing. */
  | { readonly state: 'RECONCILING'; readonly reason: typeof orphanLineageIncomplete; readonly missing: readonly string[] }
  | { readonly state: 'REFUSED'; readonly reason: OrphanRefusalCode; readonly detail: string };

const terminalIntent = new Set(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED']);
const priceTolerance = 0.005;
const refuse = (reason: OrphanRefusalCode, detail = ''): OrphanClassification => ({ state: 'REFUSED', reason, detail });
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Classifies one broker-confirmed option position against every THETA lineage on the same contract. Exactly one lineage must
 * match exactly (symbol, side, quantity, fill price, chain, decision); anything else refuses with a typed code and nothing is
 * represented (an unexplained position stays an external/unknown reconciliation defect, never adopted).
 */
export function classifyBrokerConfirmedOrphan(position: BrokerConfirmedOptionPosition,
  lineages: readonly OrphanThetaLineage[]): OrphanClassification {
  if (position.reconciliationQuality !== 'GOOD' || !Number.isFinite(Date.parse(position.observedAt))) {
    return refuse('ORPHAN_BROKER_EVIDENCE_NOT_GOOD', position.reconciliationQuality);
  }
  const occ = parseOccOptionSymbol(position.symbol);
  if (occ === null) return refuse('ORPHAN_NOT_AN_OPTION_POSITION', position.symbol);
  // THETA only ever opens short puts on this path. A long or call position can never be a THETA CSP orphan.
  if (!Number.isSafeInteger(position.signedQuantity) || position.signedQuantity >= 0 || occ.optionType !== 'PUT') {
    return refuse('ORPHAN_SIDE_MISMATCH', `${occ.optionType}:${position.signedQuantity}`);
  }
  const contracts = -position.signedQuantity;
  const matching = lineages.filter((lineage) => lineage.orderIntent.symbol === position.symbol);
  if (matching.length === 0) {
    return lineages.length === 0 ? refuse('ORPHAN_NO_THETA_LINEAGE') : refuse('ORPHAN_SYMBOL_MISMATCH', position.symbol);
  }
  if (matching.length > 1) return refuse('ORPHAN_LINEAGE_AMBIGUOUS', String(matching.length));
  const lineage = matching[0] as OrphanThetaLineage;
  const intent = lineage.orderIntent;
  if (lineage.lifecycleApplication.state === 'APPLIED' || lineage.openOptionLegCount > 0) {
    return refuse('ORPHAN_ALREADY_LIFECYCLE_OWNED');
  }
  if (intent.thetaAction !== 'OPEN_CSP' || intent.side.toUpperCase() !== 'SELL'
    || intent.positionIntent.toUpperCase() !== 'SELL_TO_OPEN') {
    return refuse('ORPHAN_SIDE_MISMATCH', `${intent.thetaAction}:${intent.side}:${intent.positionIntent}`);
  }
  const identity = lineage.identity;
  const missing = ([
    ['STRATEGY_BRANCH', identity.strategyBranch], ['CANDIDATE', identity.candidateId], ['ACTION_PLAN', identity.actionPlanId],
    ['CLIENT_ORDER_ID', intent.clientOrderId], ['BROKER_ORDER_ID', identity.providerOrderId],
  ] as const).filter(([, value]) => value === null || String(value).trim() === '').map(([name]) => name);
  if (missing.length > 0) return { state: 'RECONCILING', reason: orphanLineageIncomplete, missing };
  const branch = identity.strategyBranch as string;
  if (!(orphanRecoverableStrategyBranches as readonly string[]).includes(branch)) return refuse('ORPHAN_STRATEGY_NOT_SUPPORTED', branch);
  if (intent.chainId !== lineage.chainId || intent.decisionId !== lineage.decisionId || lineage.chainClosed
    || lineage.chainKind !== 'WHEEL' || lineage.chainLifecycleState !== 'WAIT' || intent.status !== 'FILLED'
    || lineage.brokerOrder.orderIntentId !== intent.orderIntentId || lineage.brokerOrder.status !== 'FILLED'
    || lineage.brokerOrder.symbol !== position.symbol || occ.underlying.length === 0) {
    return refuse('ORPHAN_LINEAGE_MISMATCH');
  }
  const filled = lineage.fills.reduce((sum, fill) => sum + fill.quantity, 0);
  if (!Number.isSafeInteger(intent.quantity) || intent.quantity !== contracts || lineage.brokerOrder.filledQuantity !== contracts
    || filled !== contracts || lineage.fills.some((fill) => !(fill.quantity > 0))) {
    return refuse('ORPHAN_QUANTITY_MISMATCH', `broker=${contracts} intent=${intent.quantity} fills=${filled}`);
  }
  if (lineage.nonTerminalChainOrders > 0 || !terminalIntent.has(intent.status)) return refuse('ORPHAN_ORDER_IN_FLIGHT');
  const entryPrice = lineage.fills.reduce((sum, fill) => sum + fill.quantity * fill.pricePerShare, 0) / filled;
  if (!(entryPrice > 0) || Math.abs(entryPrice - position.averageEntryPricePerShare) > priceTolerance) {
    return refuse('ORPHAN_FILL_PRICE_MISMATCH', `${entryPrice}:${position.averageEntryPricePerShare}`);
  }
  if (!Number.isSafeInteger(lineage.multiplier) || lineage.multiplier <= 0) return refuse('ORPHAN_LINEAGE_MISMATCH', 'MULTIPLIER');
  const openedAt = [...lineage.fills].map((fill) => fill.occurredAt).sort().at(-1) as string;
  const body = {
    contractVersion: brokerOrphanRecoveryVersion, classification: brokerConfirmedPositionLifecycleRegistrationBlocked,
    lifecycleBlockedCode: lineage.lifecycleApplication.state === 'BLOCKED' ? lineage.lifecycleApplication.blockedCode : null,
    chainId: lineage.chainId, decisionId: lineage.decisionId, orderIntentId: intent.orderIntentId,
    clientOrderId: intent.clientOrderId, strategyBranch: branch as OrphanManagementRepresentation['strategyBranch'],
    candidateId: identity.candidateId as string, actionPlanId: identity.actionPlanId as string,
    providerOrderId: identity.providerOrderId as string,
    underlying: occ.underlying, underlyingId: lineage.underlyingId, optionContractId: lineage.optionContractId,
    symbol: position.symbol, optionType: 'PUT' as const, strike: occ.strike, expiration: occ.expiration,
    multiplier: lineage.multiplier, contracts, entryPricePerShare: entryPrice,
    entryCreditDebit: Number((entryPrice * lineage.multiplier * contracts).toFixed(6)), openedAt,
    permittedActions: ['HOLD', 'CLOSE_RISK'] as const, defaultAction: 'HOLD' as const, brokerObservedAt: position.observedAt,
  };
  return { state: 'ORPHAN_CONFIRMED', representation: Object.freeze({ ...body, contentHash: hash(body) }) };
}

/**
 * Owner-approved risk-close triggers. There is deliberately NO default: absent policy means HOLD with a typed reason, never an
 * invented threshold. Every configured trigger is evaluated; any one firing selects CLOSE_RISK.
 */
export interface OrphanRiskClosePolicy {
  readonly policyVersion: string;
  /** Close when the executable ask >= multiple x entry price (e.g. 3 = mark tripled). */
  readonly askMultipleOfEntry?: number;
  /** Close when spot <= strike x (1 + fraction) (e.g. 0.10 = within 10% of strike). */
  readonly spotWithinFractionOfStrike?: number;
  /** Close when calendar DTE <= this many days. */
  readonly maximumDte?: number;
  /** Maximum quote age for a close decision. */
  readonly maximumQuoteAgeMs: number;
}

export interface OrphanMarketEvidence {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteTimestamp: string | null;
  readonly spot: number | null;
  readonly now: string;
}

export type OrphanRiskDecision =
  | { readonly action: 'HOLD'; readonly reasons: readonly string[] }
  | { readonly action: 'CLOSE_RISK'; readonly reasons: readonly string[]; readonly directive: OrphanCloseDirective };

/** The only broker mutation shape this module can express. */
export interface OrphanCloseDirective {
  readonly thetaAction: 'CLOSE_CSP';
  readonly side: 'BUY';
  readonly positionIntent: 'buy_to_close';
  readonly symbol: string;
  readonly quantity: number;
  /** Maximum debit per share: the current executable ask. The coordinator's adaptive limit starts at the bid and never exceeds it. */
  readonly maximumDebitPerShare: number;
  readonly representationHash: string;
}

const dteOf = (expiration: string, now: string): number =>
  Math.ceil((Date.parse(`${expiration}T21:00:00.000Z`) - Date.parse(now)) / 86_400_000);

export function decideOrphanRiskAction(representation: OrphanManagementRepresentation, market: OrphanMarketEvidence,
  policy: OrphanRiskClosePolicy | null): OrphanRiskDecision {
  if (policy === null) return { action: 'HOLD', reasons: ['ORPHAN_RISK_CLOSE_POLICY_NOT_CONFIGURED'] };
  const fired: string[] = [];
  // An unknown spot never fires (and never clears) this trigger; it is reported on HOLD below.
  if (policy.spotWithinFractionOfStrike !== undefined && market.spot !== null && market.spot > 0
    && market.spot <= representation.strike * (1 + policy.spotWithinFractionOfStrike)) fired.push('ORPHAN_RISK_SPOT_NEAR_STRIKE');
  if (policy.maximumDte !== undefined && dteOf(representation.expiration, market.now) <= policy.maximumDte) fired.push('ORPHAN_RISK_DTE');
  const quoteAge = market.quoteTimestamp === null ? null : Date.parse(market.now) - Date.parse(market.quoteTimestamp);
  const quoteFresh = quoteAge !== null && Number.isFinite(quoteAge) && quoteAge >= 0 && quoteAge <= policy.maximumQuoteAgeMs;
  const ask = market.ask;
  const quoteValid = quoteFresh && ask !== null && ask > 0 && market.bid !== null && market.bid >= 0 && market.bid <= ask;
  if (policy.askMultipleOfEntry !== undefined && quoteValid
    && (ask as number) >= representation.entryPricePerShare * policy.askMultipleOfEntry) fired.push('ORPHAN_RISK_MARK_MULTIPLE');
  if (fired.length === 0) {
    const reasons = ['ORPHAN_HOLD_NO_RISK_TRIGGER'];
    if (!quoteValid) reasons.push('ORPHAN_QUOTE_NOT_FRESH_OR_INVALID');
    if (market.spot === null) reasons.push('ORPHAN_SPOT_UNKNOWN');
    return { action: 'HOLD', reasons };
  }
  // A fired trigger without a fresh executable quote cannot be priced: HOLD with the typed risk still visible (never a market order).
  if (!quoteValid) return { action: 'HOLD', reasons: [...fired, 'ORPHAN_CLOSE_REQUIRED_QUOTE_NOT_FRESH'] };
  return { action: 'CLOSE_RISK', reasons: fired, directive: Object.freeze({
    thetaAction: 'CLOSE_CSP' as const, side: 'BUY' as const, positionIntent: 'buy_to_close' as const,
    symbol: representation.symbol, quantity: representation.contracts, maximumDebitPerShare: ask as number,
    representationHash: representation.contentHash }) };
}

const uuid = z.string().uuid();

export interface OrphanClosePlanInput {
  readonly representation: OrphanManagementRepresentation;
  readonly directive: OrphanCloseDirective;
  readonly executionAccountId: string;
  readonly strategyVersion: string;
  /** Persisted orphan management authority rows (input snapshot + frontier selecting CLOSE_FULL). */
  readonly managementInputSnapshotId: string;
  readonly managementActionFrontierId: string;
  readonly optionsCapabilityVerified: boolean;
  readonly accountActive: boolean;
  readonly killSwitchActive: boolean;
  readonly now: string;
  readonly decisionExpiresAt: string;
}

export type OrphanClosePlanResult =
  | { readonly state: 'READY'; readonly plan: ApprovedMasterPaperActionPlan; readonly blockers: readonly [] }
  | { readonly state: 'BLOCKED'; readonly plan: null; readonly blockers: readonly string[] };

/**
 * Builds the single risk-reducing CLOSE_CSP plan for the existing coordinator handoff. Every identity is re-derived from the
 * representation and cross-checked against the directive, so a caller can not substitute a contract, raise the quantity, or
 * turn the close into an opening order. The plan uses the management decision window (never longer than the runtime policy).
 */
export function buildOrphanRiskClosePlan(input: OrphanClosePlanInput): OrphanClosePlanResult {
  const rep = input.representation, dir = input.directive;
  const blockers: string[] = [];
  const { contentHash, ...body } = rep;
  if (hash(body) !== contentHash) blockers.push('ORPHAN_REPRESENTATION_TAMPERED');
  if (dir.representationHash !== rep.contentHash) blockers.push('ORPHAN_DIRECTIVE_REPRESENTATION_MISMATCH');
  if (dir.thetaAction !== 'CLOSE_CSP' || dir.side !== 'BUY' || dir.positionIntent !== 'buy_to_close') {
    blockers.push('ORPHAN_ACTION_NOT_RISK_REDUCING');
  }
  if (dir.symbol !== rep.symbol) blockers.push('ORPHAN_CONTRACT_SUBSTITUTION_FORBIDDEN');
  if (!Number.isSafeInteger(dir.quantity) || dir.quantity <= 0) blockers.push('ORPHAN_CLOSE_QUANTITY_INVALID');
  else if (dir.quantity > rep.contracts) blockers.push('ORPHAN_CLOSE_QUANTITY_EXCEEDS_BROKER_POSITION');
  else if (dir.quantity !== rep.contracts) blockers.push('ORPHAN_CLOSE_MUST_BE_WHOLE_POSITION');
  if (!(Number.isFinite(dir.maximumDebitPerShare) && dir.maximumDebitPerShare > 0)) blockers.push('ORPHAN_MAXIMUM_DEBIT_INVALID');
  for (const [name, value] of [['EXECUTION_ACCOUNT', input.executionAccountId], ['MANAGEMENT_INPUT', input.managementInputSnapshotId],
    ['MANAGEMENT_FRONTIER', input.managementActionFrontierId], ['UNDERLYING', rep.underlyingId], ['OPTION_CONTRACT', rep.optionContractId],
    ['CHAIN', rep.chainId]] as const) if (!uuid.safeParse(value).success) blockers.push(`ORPHAN_${name}_ID_INVALID`);
  if (!input.strategyVersion.trim()) blockers.push('STRATEGY_VERSION_MISSING');
  if (!input.accountActive) blockers.push('MASTER_ACCOUNT_NOT_ACTIVE');
  if (!input.optionsCapabilityVerified) blockers.push('OPTIONS_CAPABILITY_NOT_VERIFIED');
  if (input.killSwitchActive) blockers.push('KILL_SWITCH_ACTIVE');
  const now = Date.parse(input.now), expires = Date.parse(input.decisionExpiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(expires) || expires <= now
    || expires - now > paperBootstrapRuntimePolicy.quoteAge.planWindowManagementMilliseconds) blockers.push('DECISION_EXPIRY_INVALID');
  if (blockers.length > 0) return { state: 'BLOCKED', plan: null, blockers: [...new Set(blockers)] };
  // The SAME authority reference and decision identity the sovereign management assembly uses, so publishManagementPlans'
  // authority checks (frontier row selected CLOSE_FULL, input snapshot, policy lineage, account) apply unchanged.
  const authorityRef = orphanManagementAuthorityRef(input.managementActionFrontierId);
  const actionPlanId = deterministicRuntimeUuid(`orphan-recovery-plan:${authorityRef}:${rep.symbol}:${rep.contentHash}`);
  const plan: ApprovedMasterPaperActionPlan = {
    contractVersion: masterPaperActionPlanVersion, actionPlanId, decisionAuthority: 'MANAGEMENT',
    managementInputSnapshotId: input.managementInputSnapshotId, managementActionFrontierId: input.managementActionFrontierId,
    actionGroupId: actionPlanId, legSequence: 1, dependsOnActionPlanId: null,
    executionAccountId: input.executionAccountId, decisionId: orphanManagementDecisionId(input.managementActionFrontierId),
    candidateId: authorityRef, strategyVersion: input.strategyVersion, chainId: rep.chainId,
    optionContractId: rep.optionContractId, underlyingId: rep.underlyingId, underlying: rep.underlying, optionType: 'PUT',
    symbol: rep.symbol, quantity: rep.contracts, canonicalQuantity: rep.contracts, paperEvidenceQuantity: rep.contracts,
    paperEvidenceRiskCap: rep.contracts, paperEvidenceCapReason: 'CANONICAL_QUANTITY_LOWER', executionTier: 'PAPER_EVIDENCE',
    multiplier: rep.multiplier, action: 'CLOSE_CSP', economicBoundary: dir.maximumDebitPerShare,
    // A risk close is not an EV bet: "economics remain positive" here means the close is still inside its debit boundary.
    economicsRemainPositive: true, expectedAfterCostEv: null, empiricalEconomicsReady: false,
    selectedByCanonicalAuthority: true, hardValidityPassed: true, accountVerified: true,
    optionsCapabilityVerified: input.optionsCapabilityVerified, noEquivalentExposureConflict: true,
    // AEGIS never gates a risk-reducing close (opensNewRisk=false); HOLD_ONLY records that this plan carries no new-risk permission.
    aegisState: 'HOLD_ONLY', killSwitchActive: false, decisionExpiresAt: input.decisionExpiresAt,
    pricingPolicy: { waitIntervalMs: 5_000, maxAttempts: 3, concessionFractions: [0, 0.5, 1], tickSize: 0.01 },
    pricingAttempt: 0, previousLimit: null,
  };
  const parsed = masterPaperActionPlanSchema.safeParse(plan);
  if (!parsed.success) return { state: 'BLOCKED', plan: null, blockers: parsed.error.issues.map((issue) => `PLAN_SCHEMA:${issue.message}`) };
  return { state: 'READY', plan: Object.freeze(plan), blockers: [] };
}

export const orphanManagementAuthorityRef = (managementActionFrontierId: string): string =>
  `management:${managementActionFrontierId}:CLOSE_FULL`;
export const orphanManagementDecisionId = (managementActionFrontierId: string): string =>
  deterministicRuntimeUuid(`management-decision:${orphanManagementAuthorityRef(managementActionFrontierId)}`);

/**
 * Default OBSERVE: read-only classification; the management job reports BROKER_CONFIRMED_POSITION_LIFECYCLE_REGISTRATION_BLOCKED and
 * nothing is written or ordered. CLOSE_RISK_CERTIFIED: governed authority rows are persisted and a risk close (only when an owner
 * trigger fires) is published through the existing management plan store. Explicit OFF disables the read. Unknown values -> OBSERVE.
 */
export type OrphanRecoveryMode = 'OFF' | 'OBSERVE' | 'CLOSE_RISK_CERTIFIED';
export function parseOrphanRecoveryMode(value: string | undefined | null): OrphanRecoveryMode {
  return value === 'OFF' || value === 'CLOSE_RISK_CERTIFIED' ? value : 'OBSERVE';
}

const orphanRiskClosePolicySchema = z.object({
  policyVersion: z.string().trim().min(1),
  askMultipleOfEntry: z.number().finite().gt(1).optional(),
  spotWithinFractionOfStrike: z.number().finite().positive().lt(1).optional(),
  maximumDte: z.number().int().nonnegative().optional(),
  maximumQuoteAgeMs: z.number().int().positive().max(paperBootstrapRuntimePolicy.quoteAge.planWindowManagementMilliseconds),
}).strict().refine((policy) => policy.askMultipleOfEntry !== undefined || policy.spotWithinFractionOfStrike !== undefined
  || policy.maximumDte !== undefined, { message: 'at least one trigger' });

/** Owner policy from configuration. Absent or invalid is null (HOLD), never a default threshold. */
export function parseOrphanRiskClosePolicy(raw: string | undefined | null):
{ readonly policy: OrphanRiskClosePolicy | null; readonly reason: 'NOT_CONFIGURED' | 'INVALID' | 'CONFIGURED' } {
  if (raw === undefined || raw === null || raw.trim() === '') return { policy: null, reason: 'NOT_CONFIGURED' };
  try {
    const parsed = orphanRiskClosePolicySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { policy: null, reason: 'INVALID' };
    const { askMultipleOfEntry, spotWithinFractionOfStrike, maximumDte, ...required } = parsed.data;
    return { policy: Object.freeze({ ...required, ...(askMultipleOfEntry === undefined ? {} : { askMultipleOfEntry }),
      ...(spotWithinFractionOfStrike === undefined ? {} : { spotWithinFractionOfStrike }),
      ...(maximumDte === undefined ? {} : { maximumDte }) }), reason: 'CONFIGURED' };
  } catch { return { policy: null, reason: 'INVALID' }; }
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item);
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');

export const orphanManagementPolicyEvidenceHash = (policy: OrphanRiskClosePolicy): string =>
  sha({ contractVersion: brokerOrphanRecoveryVersion, policy });

/** Discriminator stored in management_input_snapshot.input_json; the normal loader never treats such a row as its predecessor. */
export const orphanManagementInputKind = 'BROKER_CONFIRMED_ORPHAN' as const;

export interface OrphanManagementAuthorityRows {
  readonly inputSnapshot: {
    readonly managementInputSnapshotId: string;
    readonly reconciliationSnapshotId: string;
    readonly fusionSnapshotId: string;
    readonly chainId: string;
    readonly observedAt: string;
    readonly lifecycleState: 'WAIT';
    readonly inputJson: Readonly<Record<string, unknown>>;
    readonly unknownFields: readonly string[];
    readonly contentHash: string;
  };
  readonly frontier: {
    readonly managementActionFrontierId: string;
    readonly managementInputSnapshotId: string;
    readonly chainId: string;
    readonly observedAt: string;
    readonly lifecycleState: 'WAIT';
    readonly policyVersion: string | null;
    readonly policyEvidenceHash: string | null;
    readonly economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY';
    readonly actions: readonly Readonly<Record<string, unknown>>[];
    readonly selectedAction: 'HOLD' | 'CLOSE_FULL';
    readonly secondBestAction: 'HOLD' | 'CLOSE_FULL';
    readonly decisionState: 'ACTION_SELECTED';
    readonly reasonCodes: readonly string[];
    readonly contentHash: string;
  };
}

/**
 * Builds the governed management authority rows for one orphan observation: an immutable input snapshot (lifecycle_state WAIT, the
 * chain's truth) and a frontier selecting exactly HOLD or CLOSE_FULL. Identifiers are content-derived, so a replay of the same
 * observation (restart, retry) maps to the same rows and the writer's ON CONFLICT makes it a no-op.
 */
export function buildOrphanManagementAuthority(input: {
  readonly representation: OrphanManagementRepresentation;
  readonly decision: OrphanRiskDecision;
  readonly market: OrphanMarketEvidence;
  readonly policy: OrphanRiskClosePolicy | null;
  readonly reconciliationSnapshotId: string;
  readonly fusionSnapshotId: string;
  readonly observedAt: string;
}): OrphanManagementAuthorityRows {
  const rep = input.representation;
  const { contentHash, ...body } = rep;
  if (hash(body) !== contentHash) throw new Error('ORPHAN_REPRESENTATION_TAMPERED');
  if (input.decision.action === 'CLOSE_RISK' && (input.policy === null || input.decision.directive.representationHash !== contentHash)) {
    throw new Error('ORPHAN_CLOSE_DECISION_WITHOUT_POLICY_OR_REPRESENTATION');
  }
  for (const id of [input.reconciliationSnapshotId, input.fusionSnapshotId, rep.chainId, rep.underlyingId]) {
    if (!uuid.safeParse(id).success) throw new Error('ORPHAN_AUTHORITY_ID_INVALID');
  }
  if (!Number.isFinite(Date.parse(input.observedAt))) throw new Error('ORPHAN_AUTHORITY_TIME_INVALID');
  const unknownFields = [
    ...(input.market.bid === null || input.market.ask === null || input.market.quoteTimestamp === null ? ['market.quote'] : []),
    ...(input.market.spot === null ? ['market.spot'] : []),
    ...(input.policy === null ? ['policy'] : []),
  ];
  const inputJson = {
    inputKind: orphanManagementInputKind, contractVersion: brokerOrphanRecoveryVersion,
    classification: brokerConfirmedPositionLifecycleRegistrationBlocked,
    chainId: rep.chainId, underlyingId: rep.underlyingId, underlying: rep.underlying, observedAt: input.observedAt,
    representation: rep, market: input.market, riskDecision: input.decision,
    policyVersion: input.policy?.policyVersion ?? null,
  };
  const inputHash = sha(inputJson);
  const managementInputSnapshotId = deterministicRuntimeUuid(`orphan-management-input:${rep.chainId}:${inputHash}`);
  const close = input.decision.action === 'CLOSE_RISK' ? input.decision : null;
  const actions = [
    { action: 'HOLD', feasibility: 'FEASIBLE', blockers: [], executionEvidence: null },
    { action: 'CLOSE_FULL', feasibility: close === null ? 'NOT_SELECTED_NO_RISK_TRIGGER' : 'FEASIBLE',
      blockers: close === null ? [...input.decision.reasons] : [],
      executionEvidence: close === null ? null : { closeEconomicBoundary: close.directive.maximumDebitPerShare,
        economicsRemainPositive: true, expectedAfterCostEv: null, empiricalEconomicsReady: false,
        quantity: close.directive.quantity, symbol: close.directive.symbol } },
  ];
  const policyEvidenceHash = input.policy === null ? null : orphanManagementPolicyEvidenceHash(input.policy);
  const frontierBody = {
    managementInputSnapshotId, chainId: rep.chainId, observedAt: input.observedAt, lifecycleState: 'WAIT' as const,
    policyVersion: input.policy?.policyVersion ?? null, policyEvidenceHash,
    economicModelState: 'EV_MODEL_NOT_EMPIRICALLY_READY' as const, actions,
    selectedAction: close === null ? 'HOLD' as const : 'CLOSE_FULL' as const,
    secondBestAction: close === null ? 'CLOSE_FULL' as const : 'HOLD' as const,
    decisionState: 'ACTION_SELECTED' as const,
    reasonCodes: [brokerConfirmedPositionLifecycleRegistrationBlocked, ...input.decision.reasons],
  };
  const frontierHash = sha(frontierBody);
  return Object.freeze({
    inputSnapshot: Object.freeze({ managementInputSnapshotId, reconciliationSnapshotId: input.reconciliationSnapshotId,
      fusionSnapshotId: input.fusionSnapshotId, chainId: rep.chainId, observedAt: input.observedAt, lifecycleState: 'WAIT' as const,
      inputJson, unknownFields, contentHash: inputHash }),
    frontier: Object.freeze({ ...frontierBody,
      managementActionFrontierId: deterministicRuntimeUuid(`orphan-management-frontier:${managementInputSnapshotId}:${frontierHash}`),
      contentHash: frontierHash }),
  });
}

/** The management decision for publishManagementPlans; every field is derived from the persisted authority and the plan. */
export function buildOrphanManagementDecisionDraft(input: {
  readonly plan: ApprovedMasterPaperActionPlan;
  readonly authority: OrphanManagementAuthorityRows;
  readonly decision: Extract<OrphanRiskDecision, { action: 'CLOSE_RISK' }>;
  readonly policy: OrphanRiskClosePolicy;
  readonly decidedAt: string;
}): ManagementDecisionDraft {
  const frontier = input.authority.frontier;
  if (frontier.selectedAction !== 'CLOSE_FULL' || input.plan.managementActionFrontierId !== frontier.managementActionFrontierId
    || input.plan.managementInputSnapshotId !== frontier.managementInputSnapshotId || input.plan.action !== 'CLOSE_CSP'
    || frontier.policyEvidenceHash !== orphanManagementPolicyEvidenceHash(input.policy)
    || frontier.policyVersion !== input.policy.policyVersion) throw new Error('ORPHAN_DECISION_AUTHORITY_MISMATCH');
  return {
    decisionId: orphanManagementDecisionId(frontier.managementActionFrontierId), decisionKind: 'MANAGEMENT', actionCode: 'CLOSE_FULL',
    quantity: input.plan.canonicalQuantity, aegisAction: input.plan.aegisState, strategyVersion: input.plan.strategyVersion,
    managementPolicyVersion: input.policy.policyVersion, managementPolicyEvidenceHash: orphanManagementPolicyEvidenceHash(input.policy),
    authorityRef: orphanManagementAuthorityRef(frontier.managementActionFrontierId), decidedAt: input.decidedAt,
    reasonCodes: [brokerConfirmedPositionLifecycleRegistrationBlocked, ...input.decision.reasons],
  };
}

