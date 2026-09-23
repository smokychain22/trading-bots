import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AlpacaCalendarSession } from './alpaca-provider.js';
import type { CorporateActionRead } from './alpaca-corporate-action-evidence.js';
import type { OptionomicsEarningsEvidence } from './earnings-event-evidence.js';
import type { MacroRiskEvidence } from './macro-event-policy.js';

export const instrumentClassificationPolicyVersion = 'theta-paper-instrument-classification-v1' as const;
export const companyEventPaperPolicyVersion = 'theta-company-event-paper-policy-v1' as const;
export const corporateActionPaperPolicyVersion = 'theta-corporate-action-paper-policy-v1' as const;
export const paperEntrySafetyPolicyVersion = 'theta-paper-entry-safety-policy-v1' as const;

export type InstrumentClass = 'OPERATING_COMPANY' | 'NON_COMPANY_FUND' | 'UNKNOWN' | 'CONFLICT';

export interface PaperInstrumentManifestEntry {
  readonly symbol: string;
  readonly instrumentClass: Exclude<InstrumentClass, 'UNKNOWN' | 'CONFLICT'>;
  readonly paperBootstrapApproved: boolean;
  readonly authorityRef: string;
  readonly effectiveAt: string;
  readonly reviewedAt: string;
}

/**
 * Intentionally empty until an authoritative classification is approved.
 * Research ETF labels and model knowledge never populate Production policy.
 */
export const paperInstrumentClassificationManifest = {
  version: instrumentClassificationPolicyVersion,
  entries: [] as readonly PaperInstrumentManifestEntry[],
} as const;

export interface InstrumentClassificationEvidence {
  readonly policyVersion: typeof instrumentClassificationPolicyVersion;
  readonly symbol: string;
  readonly state: InstrumentClass;
  readonly paperBootstrapApproved: boolean;
  readonly authority: 'VERSIONED_MANIFEST' | 'OPTIONOMICS_POSITIVE_EARNINGS' | 'UNQUALIFIED' | 'CONFLICT';
  readonly evidenceIds: readonly string[];
  readonly observedAt: string | null;
  readonly reason: string;
}

export function classifyPaperInstrument(input: {
  readonly symbol: string;
  readonly decisionAsOf: string;
  readonly earnings: OptionomicsEarningsEvidence;
  readonly manifest?: readonly PaperInstrumentManifestEntry[];
}): InstrumentClassificationEvidence {
  const symbol = input.symbol.toUpperCase();
  const manifest = input.manifest ?? paperInstrumentClassificationManifest.entries;
  const entries = manifest.filter((entry) => entry.symbol === symbol && Date.parse(entry.effectiveAt) <= Date.parse(input.decisionAsOf));
  if (entries.length > 1 || entries.some((entry) => !Number.isFinite(Date.parse(entry.effectiveAt)))) return {
    policyVersion: instrumentClassificationPolicyVersion, symbol, state: 'CONFLICT', paperBootstrapApproved: false,
    authority: 'CONFLICT', evidenceIds: [], observedAt: null, reason: 'INSTRUMENT_MANIFEST_CONFLICT_OR_INVALID_TIME',
  };
  const manifestEntry = entries[0];
  const positiveEarnings = input.earnings.state === 'KNOWN_POSITIVE_DISTANCE';
  if (manifestEntry !== undefined) {
    if (positiveEarnings && manifestEntry.instrumentClass === 'NON_COMPANY_FUND') return {
      policyVersion: instrumentClassificationPolicyVersion, symbol, state: 'CONFLICT', paperBootstrapApproved: false,
      authority: 'CONFLICT', evidenceIds: input.earnings.evidenceId === null ? [] : [input.earnings.evidenceId],
      observedAt: input.earnings.thetaObservedAt, reason: 'MANIFEST_CONFLICTS_WITH_POSITIVE_COMPANY_EARNINGS_EVIDENCE',
    };
    return {
      policyVersion: instrumentClassificationPolicyVersion, symbol, state: manifestEntry.instrumentClass,
      paperBootstrapApproved: manifestEntry.paperBootstrapApproved, authority: 'VERSIONED_MANIFEST',
      evidenceIds: [manifestEntry.authorityRef], observedAt: manifestEntry.reviewedAt,
      reason: 'VERSIONED_OWNER_APPROVED_INSTRUMENT_CLASSIFICATION',
    };
  }
  if (positiveEarnings) return {
    policyVersion: instrumentClassificationPolicyVersion, symbol, state: 'OPERATING_COMPANY',
    paperBootstrapApproved: false, authority: 'OPTIONOMICS_POSITIVE_EARNINGS',
    evidenceIds: input.earnings.evidenceId === null ? [] : [input.earnings.evidenceId],
    observedAt: input.earnings.thetaObservedAt, reason: 'POSITIVE_EARNINGS_DISTANCE_PROVES_COMPANY_APPLICABILITY_ONLY',
  };
  return {
    policyVersion: instrumentClassificationPolicyVersion, symbol, state: 'UNKNOWN', paperBootstrapApproved: false,
    authority: 'UNQUALIFIED', evidenceIds: [], observedAt: null,
    reason: 'NO_PRODUCTION_AUTHORITY_PROVES_COMPANY_OR_FUND_CLASSIFICATION',
  };
}

export function tradingSessionsThroughExpiration(input: {
  readonly decisionAsOf: string;
  readonly expiration: string;
  readonly calendar: readonly AlpacaCalendarSession[];
}): number | null {
  const decision = Date.parse(input.decisionAsOf);
  const expiration = Date.parse(`${input.expiration}T23:59:59.999Z`);
  if (!Number.isFinite(decision) || !Number.isFinite(expiration) || expiration < decision) return null;
  const decisionDate = new Date(decision).toISOString().slice(0, 10);
  const sessions = input.calendar.filter((session) => session.date >= decisionDate && session.date <= input.expiration
    && session.open !== null && session.close !== null);
  if (sessions.length === 0 || sessions.at(-1)?.date !== input.expiration) return null;
  return sessions.length;
}

export type CompanyEventPaperPolicyState =
  | 'KNOWN_NEAR_EARNINGS_BLOCK' | 'KNOWN_AFTER_EXPIRY_CLEAR' | 'FUND_NOT_APPLICABLE_CLEAR'
  | 'MACRO_EVENT_BLOCK' | 'MACRO_COVERAGE_UNKNOWN_BLOCK' | 'COVERAGE_UNKNOWN_BLOCK'
  | 'INVALID_EVIDENCE_BLOCK' | 'INSTRUMENT_CLASSIFICATION_UNKNOWN_BLOCK';

export interface CompanyEventPaperPolicyDecision {
  readonly policyVersion: typeof companyEventPaperPolicyVersion;
  readonly authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE';
  readonly action: 'BLOCK' | 'CLEAR';
  readonly state: CompanyEventPaperPolicyState;
  readonly decisionAsOf: string;
  readonly validThrough: string | null;
  readonly instrument: InstrumentClassificationEvidence;
  readonly earningsDistanceTradingSessions: number | null;
  readonly sessionsThroughExpiration: number | null;
  readonly macroState: MacroRiskEvidence['state'];
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

export function applyCompanyEventPaperPolicy(input: {
  readonly decisionAsOf: string;
  readonly expiration: string;
  readonly calendar: readonly AlpacaCalendarSession[];
  readonly instrument: InstrumentClassificationEvidence;
  readonly earnings: OptionomicsEarningsEvidence;
  readonly macro: MacroRiskEvidence;
}): CompanyEventPaperPolicyDecision {
  const sessionsThroughExpiration = tradingSessionsThroughExpiration(input);
  const evidenceIds = [...new Set([
    ...input.instrument.evidenceIds, ...input.macro.evidenceIds,
    ...(input.earnings.evidenceId === null ? [] : [input.earnings.evidenceId]),
  ])].sort();
  const base = {
    policyVersion: companyEventPaperPolicyVersion,
    authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE' as const,
    decisionAsOf: input.decisionAsOf, validThrough: input.macro.validThrough,
    instrument: input.instrument, earningsDistanceTradingSessions: input.earnings.distanceTradingSessions,
    sessionsThroughExpiration, macroState: input.macro.state, evidenceIds,
  };
  if (input.macro.state === 'KNOWN_TRUE') return { ...base, action: 'BLOCK', state: 'MACRO_EVENT_BLOCK', reason: input.macro.reason };
  if (input.macro.state !== 'KNOWN_FALSE') return {
    ...base, action: 'BLOCK', state: input.macro.state === 'INVALID' ? 'INVALID_EVIDENCE_BLOCK' : 'MACRO_COVERAGE_UNKNOWN_BLOCK',
    reason: input.macro.reason,
  };
  if (input.instrument.state === 'UNKNOWN') return {
    ...base, action: 'BLOCK', state: 'INSTRUMENT_CLASSIFICATION_UNKNOWN_BLOCK', reason: input.instrument.reason,
  };
  if (input.instrument.state === 'CONFLICT') return { ...base, action: 'BLOCK', state: 'INVALID_EVIDENCE_BLOCK', reason: input.instrument.reason };
  if (input.instrument.state === 'NON_COMPANY_FUND') return {
    ...base, action: 'CLEAR', state: 'FUND_NOT_APPLICABLE_CLEAR', earningsDistanceTradingSessions: null,
    reason: 'COMPANY_EARNINGS_NOT_APPLICABLE_TO_QUALIFIED_NON_COMPANY_FUND',
  };
  if (input.earnings.state === 'INVALID') return { ...base, action: 'BLOCK', state: 'INVALID_EVIDENCE_BLOCK', reason: input.earnings.reason };
  if (input.earnings.state !== 'KNOWN_POSITIVE_DISTANCE' || sessionsThroughExpiration === null) return {
    ...base, action: 'BLOCK', state: 'COVERAGE_UNKNOWN_BLOCK', reason: sessionsThroughExpiration === null
      ? 'ALPACA_TRADING_SESSIONS_THROUGH_EXPIRATION_INCOMPLETE' : input.earnings.reason,
  };
  if ((input.earnings.distanceTradingSessions as number) <= sessionsThroughExpiration) return {
    ...base, action: 'BLOCK', state: 'KNOWN_NEAR_EARNINGS_BLOCK', reason: 'EARNINGS_WITHIN_CONTRACT_TRADING_SESSION_HORIZON',
  };
  return { ...base, action: 'CLEAR', state: 'KNOWN_AFTER_EXPIRY_CLEAR', reason: 'KNOWN_EARNINGS_AFTER_CONTRACT_EXPIRATION' };
}

export type CorporateActionRelevance = 'PENDING_RELEVANT' | 'EFFECTIVE_RELEVANT' | 'EXPIRED_NOT_RELEVANT' | 'UNKNOWN_RELEVANCE';
export type CorporateActionPaperPolicyState =
  | 'KNOWN_RELEVANT_ACTION_BLOCK' | 'ADJUSTED_CONTRACT_BLOCK' | 'PROVIDER_ERROR_BLOCK'
  | 'QUERY_INCOMPLETE_BLOCK' | 'NEGATIVE_ASSURANCE_UNKNOWN_BLOCK'
  | 'PAPER_BOOTSTRAP_LIMITED' | 'QUALIFIED_CLEAR';

export interface CorporateActionPaperPolicyDecision {
  readonly policyVersion: typeof corporateActionPaperPolicyVersion;
  readonly authority: 'ALPACA_BROKER_LIFECYCLE' | 'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE';
  readonly action: 'BLOCK' | 'CLEAR';
  readonly state: CorporateActionPaperPolicyState;
  readonly decisionAsOf: string;
  readonly queryObservedAt: string | null;
  readonly queryWindow: { readonly start: string; readonly end: string } | null;
  readonly paginationComplete: boolean;
  readonly negativeCoverageQualified: boolean;
  readonly positiveRelevance: CorporateActionRelevance;
  readonly missingPrerequisites: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly reason: string;
}

export function applyCorporateActionPaperPolicy(input: {
  readonly symbol: string;
  readonly decisionAsOf: string;
  readonly read: CorporateActionRead | null;
  readonly providerError: boolean;
  readonly currentPositiveRelevant: boolean;
  readonly persistedPositiveRelevance: CorporateActionRelevance;
  readonly standardOptionContract: boolean;
  readonly ordinaryDeliverable: boolean;
  readonly verifiedMultiplier: boolean;
  readonly approvedFirstPaperInstrument: boolean;
  readonly oneRiskyUnderlyingPolicy: boolean;
  readonly reconciliationGood: boolean;
  readonly aegisGood: boolean;
  readonly freshQuote: boolean;
}): CorporateActionPaperPolicyDecision {
  const relevance = input.currentPositiveRelevant ? 'PENDING_RELEVANT' : input.persistedPositiveRelevance;
  const base = {
    policyVersion: corporateActionPaperPolicyVersion,
    decisionAsOf: input.decisionAsOf,
    queryObservedAt: input.read?.firstObservedAt ?? null,
    queryWindow: input.read === null ? null : { start: input.read.start, end: input.read.end },
    paginationComplete: input.read?.paginationComplete ?? false,
    negativeCoverageQualified: input.read?.negativeCoverageQualified ?? false,
    positiveRelevance: relevance,
    evidenceIds: input.read?.observations.filter((row) => row.symbol === input.symbol).map((row) => row.payloadHash).sort() ?? [],
  };
  if (input.providerError || input.read === null) return {
    ...base, authority: 'ALPACA_BROKER_LIFECYCLE', action: 'BLOCK', state: 'PROVIDER_ERROR_BLOCK',
    missingPrerequisites: ['CORPORATE_ACTION_PROVIDER_READ'], reason: 'CORPORATE_ACTION_PROVIDER_READ_FAILED',
  };
  if (!input.read.paginationComplete) return {
    ...base, authority: 'ALPACA_BROKER_LIFECYCLE', action: 'BLOCK', state: 'QUERY_INCOMPLETE_BLOCK',
    missingPrerequisites: ['PAGINATION_COMPLETE'], reason: 'CORPORATE_ACTION_QUERY_INCOMPLETE',
  };
  if (relevance === 'PENDING_RELEVANT' || relevance === 'EFFECTIVE_RELEVANT' || relevance === 'UNKNOWN_RELEVANCE') return {
    ...base, authority: 'ALPACA_BROKER_LIFECYCLE', action: 'BLOCK', state: 'KNOWN_RELEVANT_ACTION_BLOCK',
    missingPrerequisites: [], reason: `CORPORATE_ACTION_${relevance}`,
  };
  if (!input.standardOptionContract || !input.ordinaryDeliverable || !input.verifiedMultiplier) return {
    ...base, authority: 'ALPACA_BROKER_LIFECYCLE', action: 'BLOCK', state: 'ADJUSTED_CONTRACT_BLOCK',
    missingPrerequisites: [
      ...(!input.standardOptionContract ? ['STANDARD_OPTION_CONTRACT'] : []),
      ...(!input.ordinaryDeliverable ? ['ORDINARY_DELIVERABLE'] : []),
      ...(!input.verifiedMultiplier ? ['VERIFIED_MULTIPLIER'] : []),
    ], reason: 'OPTION_CONTRACT_DELIVERABLE_NOT_PROVEN_STANDARD',
  };
  if (input.read.negativeCoverageQualified) return {
    ...base, authority: 'ALPACA_BROKER_LIFECYCLE', action: 'CLEAR', state: 'QUALIFIED_CLEAR',
    missingPrerequisites: [], reason: 'QUALIFIED_NEGATIVE_CORPORATE_ACTION_COVERAGE',
  };
  const prerequisites = {
    APPROVED_FIRST_PAPER_INSTRUMENT: input.approvedFirstPaperInstrument,
    ONE_RISKY_UNDERLYING_POLICY: input.oneRiskyUnderlyingPolicy,
    RECONCILIATION_GOOD: input.reconciliationGood,
    AEGIS_GOOD: input.aegisGood,
    FRESH_QUOTE: input.freshQuote,
  };
  const missingPrerequisites = Object.entries(prerequisites).filter(([, value]) => !value).map(([key]) => key).sort();
  if (missingPrerequisites.length > 0) return {
    ...base, authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE', action: 'BLOCK',
    state: 'NEGATIVE_ASSURANCE_UNKNOWN_BLOCK', missingPrerequisites,
    reason: 'PAPER_CORPORATE_ACTION_FALLBACK_PREREQUISITES_INCOMPLETE',
  };
  return {
    ...base, authority: 'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE', action: 'CLEAR',
    state: 'PAPER_BOOTSTRAP_LIMITED', missingPrerequisites: [],
    reason: 'BOUNDED_PAPER_FALLBACK_WITHOUT_COMPLETE_NEGATIVE_ASSURANCE',
  };
}

export interface PaperEntrySafetyPolicyReceipt {
  readonly contractVersion: typeof paperEntrySafetyPolicyVersion;
  readonly decisionAsOf: string;
  readonly action: 'BLOCK' | 'CLEAR';
  readonly companyEvent: CompanyEventPaperPolicyDecision;
  readonly corporateAction: CorporateActionPaperPolicyDecision;
  readonly contentHash: string;
}

const instrumentSchema = z.object({
  policyVersion: z.literal(instrumentClassificationPolicyVersion), symbol: z.string().min(1),
  state: z.enum(['OPERATING_COMPANY', 'NON_COMPANY_FUND', 'UNKNOWN', 'CONFLICT']),
  paperBootstrapApproved: z.boolean(), authority: z.enum(['VERSIONED_MANIFEST', 'OPTIONOMICS_POSITIVE_EARNINGS', 'UNQUALIFIED', 'CONFLICT']),
  evidenceIds: z.array(z.string()), observedAt: z.string().datetime({ offset: true }).nullable(), reason: z.string().min(1),
}).strict();

export const paperEntrySafetyPolicyReceiptSchema = z.object({
  contractVersion: z.literal(paperEntrySafetyPolicyVersion), decisionAsOf: z.string().datetime({ offset: true }),
  action: z.enum(['BLOCK', 'CLEAR']), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  companyEvent: z.object({
    policyVersion: z.literal(companyEventPaperPolicyVersion), authority: z.literal('PAPER_BOOTSTRAP_NOT_COMPLETE_COMPANY_COVERAGE'),
    action: z.enum(['BLOCK', 'CLEAR']), state: z.enum(['KNOWN_NEAR_EARNINGS_BLOCK', 'KNOWN_AFTER_EXPIRY_CLEAR', 'FUND_NOT_APPLICABLE_CLEAR',
      'MACRO_EVENT_BLOCK', 'MACRO_COVERAGE_UNKNOWN_BLOCK', 'COVERAGE_UNKNOWN_BLOCK', 'INVALID_EVIDENCE_BLOCK', 'INSTRUMENT_CLASSIFICATION_UNKNOWN_BLOCK']),
    decisionAsOf: z.string().datetime({ offset: true }), validThrough: z.string().nullable(), instrument: instrumentSchema,
    earningsDistanceTradingSessions: z.number().int().nonnegative().nullable(), sessionsThroughExpiration: z.number().int().nonnegative().nullable(),
    macroState: z.enum(['KNOWN_TRUE', 'KNOWN_FALSE', 'UNKNOWN', 'INVALID']), evidenceIds: z.array(z.string()), reason: z.string().min(1),
  }).strict(),
  corporateAction: z.object({
    policyVersion: z.literal(corporateActionPaperPolicyVersion),
    authority: z.enum(['ALPACA_BROKER_LIFECYCLE', 'PAPER_BOOTSTRAP_NOT_COMPLETE_NEGATIVE_ASSURANCE']),
    action: z.enum(['BLOCK', 'CLEAR']), state: z.enum(['KNOWN_RELEVANT_ACTION_BLOCK', 'ADJUSTED_CONTRACT_BLOCK', 'PROVIDER_ERROR_BLOCK',
      'QUERY_INCOMPLETE_BLOCK', 'NEGATIVE_ASSURANCE_UNKNOWN_BLOCK', 'PAPER_BOOTSTRAP_LIMITED', 'QUALIFIED_CLEAR']),
    decisionAsOf: z.string().datetime({ offset: true }), queryObservedAt: z.string().datetime({ offset: true }).nullable(),
    queryWindow: z.object({ start: z.string().date(), end: z.string().date() }).strict().nullable(),
    paginationComplete: z.boolean(), negativeCoverageQualified: z.boolean(),
    positiveRelevance: z.enum(['PENDING_RELEVANT', 'EFFECTIVE_RELEVANT', 'EXPIRED_NOT_RELEVANT', 'UNKNOWN_RELEVANCE']),
    missingPrerequisites: z.array(z.string()), evidenceIds: z.array(z.string()), reason: z.string().min(1),
  }).strict(),
}).strict();

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function buildPaperEntrySafetyPolicyReceipt(input: {
  readonly decisionAsOf: string;
  readonly companyEvent: CompanyEventPaperPolicyDecision;
  readonly corporateAction: CorporateActionPaperPolicyDecision;
}): PaperEntrySafetyPolicyReceipt {
  const action = input.companyEvent.action === 'CLEAR' && input.corporateAction.action === 'CLEAR' ? 'CLEAR' : 'BLOCK';
  const payload = { contractVersion: paperEntrySafetyPolicyVersion, decisionAsOf: input.decisionAsOf,
    action, companyEvent: input.companyEvent, corporateAction: input.corporateAction };
  return paperEntrySafetyPolicyReceiptSchema.parse({ ...payload,
    contentHash: createHash('sha256').update(canonical(payload)).digest('hex') }) as PaperEntrySafetyPolicyReceipt;
}

export function verifyPaperEntrySafetyPolicyReceipt(value: unknown): PaperEntrySafetyPolicyReceipt | null {
  const parsed = paperEntrySafetyPolicyReceiptSchema.safeParse(value);
  if (!parsed.success) return null;
  const { contentHash, ...payload } = parsed.data;
  const expected = createHash('sha256').update(canonical(payload)).digest('hex');
  return contentHash === expected ? parsed.data as PaperEntrySafetyPolicyReceipt : null;
}
