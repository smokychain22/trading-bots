import type { NormalizedEventEvidence } from '../theta/normalized-event-evidence.js';

/**
 * Research/shadow only. `brokerAuthority: false` always. This module owns
 * NO event-evidence Production schema authority -- `normalized-event-
 * evidence.ts` (Codex-owned) remains the canonical event normalization/
 * conflict-reconciliation contract, consumed here read-only, never
 * recomputed or redefined.
 *
 * Confirmed gap this module closes: Codex's canonical `NormalizedEventEvidence`
 * carries exactly two timing fields (`knownAt`, `observedAt`) plus
 * `eventTime`. The directive's five-field distinction
 * (eventTime / providerPublishedAt / providerKnownAt / thetaFirstObservedAt /
 * ingestedAt) is genuinely finer-grained than what exists in Production
 * today -- in particular there is no persisted "first time THETA itself
 * ever observed this event, across repeated polling" concept distinct from
 * a single raw observation's own `knownAt`. This module defines that
 * research-level distinction and the utilities to reason about it, without
 * inventing or backfilling any value Production does not actually have.
 * Where Codex's contract does not yet supply a field this module wants
 * (providerPublishedAt, ingestedAt, a persisted thetaFirstObservedAt), the
 * caller must supply it explicitly as `null` -- this module never guesses
 * one field from another.
 */
export const eventPitToolkitVersion = 'theta-event-pit-toolkit-v1' as const;

export interface FiveFieldEventTiming {
  /** When the underlying real-world event itself occurs/occurred (e.g. the
   * earnings date). Never the same as when anyone learned about it. */
  readonly eventTime: string | null;
  /** When the PROVIDER first published this event record, per the
   * provider's own timestamp -- distinct from when THETA received it. */
  readonly providerPublishedAt: string | null;
  /** The provider's own claimed "as of" / knowledge timestamp for this
   * record (maps to Codex's canonical `knownAt` when available). */
  readonly providerKnownAt: string | null;
  /** The first time THIS event identity was ever observed by THETA,
   * across all repeated polling -- must be monotonically non-decreasing
   * across re-observations of the same identity, and is the ONLY field
   * this module treats as authoritative for "did THETA itself know." */
  readonly thetaFirstObservedAt: string | null;
  /** When THETA's own pipeline ingested/persisted this specific row
   * (maps to Codex's canonical `observedAt` when available). */
  readonly ingestedAt: string | null;
}

export interface EventPitRecord extends FiveFieldEventTiming {
  readonly identityKey: string;
  readonly underlying: string;
  readonly eventType: string;
  /**
   * Required, explicit caller attestation that `providerKnownAt` was
   * independently corroborated as historically retrievable (e.g. cross-
   * checked against an archived response captured at or near that time),
   * not merely a field the provider's CURRENT API happens to report.
   * Repair for a defect Codex's A-D acceptance review found
   * (docs/research/THETA_CLAUDE_A_D_ACCEPTANCE_2026-09-21.md, item A): a
   * provider can compute/backfill a `knownAt`-looking field long after the
   * fact, so its mere presence and its being <= eventTime is NOT proof
   * THETA (or anyone) could actually have retrieved it at that historical
   * moment. Defaults to `false` semantics wherever a caller does not
   * explicitly set `true` -- this module never assumes verification.
   */
  readonly providerTimestampIndependentlyVerified: boolean;
}

function validInstant(value: string | null): value is string {
  return value !== null && Number.isFinite(Date.parse(value));
}

/**
 * Maps Codex's canonical NormalizedEventEvidence onto the five-field
 * timing model. `providerPublishedAt` and a persisted `thetaFirstObservedAt`
 * are NOT present in the canonical contract today -- they are explicitly
 * left `null` (UNKNOWN) here rather than approximated from `knownAt`/
 * `observedAt`, since conflating them is exactly the mistake this module
 * exists to prevent.
 */
export function fromCanonicalEventEvidence(event: NormalizedEventEvidence): EventPitRecord {
  return {
    identityKey: event.identityKey, underlying: event.underlying, eventType: event.eventType,
    eventTime: event.eventTime,
    providerPublishedAt: null,
    providerKnownAt: event.knownAt,
    thetaFirstObservedAt: null,
    ingestedAt: event.observedAt,
    // Codex's canonical contract carries no independent-verification signal
    // today -- mapping FROM it can never claim verification that does not
    // exist. A caller with real corroborating evidence must override this
    // explicitly, never infer it from the mere presence of `knownAt`.
    providerTimestampIndependentlyVerified: false,
  };
}

/**
 * Deterministic event identity. Prefers a real provider event ID when
 * available (matching Codex's canonical `${source}:${providerEventId}`
 * convention); falls back to `underlying|eventFamily|eventDateTime` only
 * when no provider ID exists -- needed for historical/research sources
 * that never carried one, per directive section 3. The fallback identity
 * is explicitly weaker (two events with the same underlying/family/date
 * from a provider that omits IDs will collide) and this function names
 * that weakness in `identityBasis` rather than hiding it.
 */
export interface EventIdentityResult {
  readonly identityKey: string;
  readonly identityBasis: 'PROVIDER_EVENT_ID' | 'UNDERLYING_FAMILY_DATE_FALLBACK';
}

export function computeEventIdentity(input: {
  readonly source: string; readonly underlying: string; readonly eventFamily: string;
  readonly eventDateTime: string; readonly providerEventId: string | null;
}): EventIdentityResult {
  if (input.providerEventId !== null && input.providerEventId.trim().length > 0) {
    return { identityKey: `${input.source}:${input.providerEventId}`, identityBasis: 'PROVIDER_EVENT_ID' };
  }
  return {
    identityKey: `${input.source}:${input.underlying}:${input.eventFamily}:${input.eventDateTime}`,
    identityBasis: 'UNDERLYING_FAMILY_DATE_FALLBACK',
  };
}

/**
 * An already-established first-observed record for an event identity.
 * Once a value exists in this store for an identityKey, it is IMMUTABLE --
 * no later fold may change it, regardless of what earlier timestamp a
 * subsequent replay batch supplies. This is the repair for a defect
 * Codex's A-D acceptance review found (docs/research/
 * THETA_CLAUDE_A_D_ACCEPTANCE_2026-09-21.md, item A): the prior version of
 * this function recomputed a minimum over whatever observations happened
 * to be in a single input array, so replaying an old batch (or one
 * assembled in a different order) after a value was already established
 * could silently backdate it. A real persistence layer (Codex-owned, if/
 * when this graduates beyond research) is the durable equivalent of this
 * store; this module treats whatever the caller passes as `existingStore`
 * as that already-durable state and never second-guesses it.
 */
export type FirstObservedStore = ReadonlyMap<string, string>;
export const EMPTY_FIRST_OBSERVED_STORE: FirstObservedStore = new Map();

/**
 * Extends `existingStore` with any NEW event identities present in
 * `newObservations`. An identityKey already present in `existingStore` is
 * never touched -- its value is immutable, even if `newObservations`
 * contains an earlier timestamp for it (e.g. a replay of old poll data).
 * For an identity genuinely new to the store, the earliest valid
 * `ingestedAt` WITHIN THIS BATCH is used (multiple simultaneous new
 * observations of a never-before-seen identity still resolve to the
 * earliest of them). Returns a new store; never mutates `existingStore`.
 */
export function foldThetaFirstObservedAt(
  existingStore: FirstObservedStore,
  newObservations: readonly { readonly identityKey: string; readonly ingestedAt: string | null }[],
): FirstObservedStore {
  const result = new Map<string, string>(existingStore);
  const earliestNewInBatch = new Map<string, string>();
  for (const observation of newObservations) {
    if (!validInstant(observation.ingestedAt)) continue;
    if (result.has(observation.identityKey)) continue; // immutable: already established, never revisited
    const currentBatchBest = earliestNewInBatch.get(observation.identityKey);
    if (currentBatchBest === undefined || Date.parse(observation.ingestedAt) < Date.parse(currentBatchBest)) {
      earliestNewInBatch.set(observation.identityKey, observation.ingestedAt);
    }
  }
  for (const [identityKey, ingestedAt] of earliestNewInBatch) result.set(identityKey, ingestedAt);
  return result;
}

export type EventKnownAtDecisionResult = 'KNOWN' | 'UNKNOWN' | 'INVALID_TIMESTAMP';

/**
 * Answers WAS_EVENT_KNOWN_TO_THETA_AT_DECISION using ONLY thetaFirstObservedAt
 * -- never eventTime, never providerPublishedAt, never providerKnownAt.
 * Those three can all predate what THETA itself actually knew (a provider
 * can publish/claim-to-know something before THETA's own pipeline ever
 * observed it), so using them would be exactly the invalid substitution
 * the directive warns against.
 */
export function wasEventKnownToThetaAtDecision(
  thetaFirstObservedAt: string | null, decisionTime: string,
): EventKnownAtDecisionResult {
  if (!validInstant(decisionTime)) return 'INVALID_TIMESTAMP';
  if (thetaFirstObservedAt === null) return 'UNKNOWN';
  if (!validInstant(thetaFirstObservedAt)) return 'INVALID_TIMESTAMP';
  return Date.parse(thetaFirstObservedAt) <= Date.parse(decisionTime) ? 'KNOWN' : 'UNKNOWN';
}

export type HistoricalPitClassification =
  | 'PIT_SAFE_PROVIDER_TIMESTAMP' | 'PIT_SAFE_THETA_FIRST_OBSERVED'
  | 'HISTORICAL_NOT_PIT_SAFE' | 'AMBIGUOUS';

export interface HistoricalPitClassificationResult {
  readonly identityKey: string;
  readonly classification: HistoricalPitClassification;
  readonly reason: string;
}

/**
 * Classifies a historical event row's PIT safety for backfill/research use.
 * Never attempts to "repair" a row lacking a real knownAt by substituting
 * eventTime -- an unrepairable row is classified HISTORICAL_NOT_PIT_SAFE
 * or AMBIGUOUS, not silently upgraded.
 */
export function classifyHistoricalEventPit(record: EventPitRecord): HistoricalPitClassificationResult {
  const hasValidThetaFirstObserved = validInstant(record.thetaFirstObservedAt);
  const hasValidProviderKnownAt = validInstant(record.providerKnownAt);
  const hasValidEventTime = validInstant(record.eventTime);

  if (hasValidThetaFirstObserved) {
    return { identityKey: record.identityKey, classification: 'PIT_SAFE_THETA_FIRST_OBSERVED',
      reason: 'A persisted first-observation timestamp exists for this identity -- the strongest PIT basis available.' };
  }
  if (hasValidProviderKnownAt && hasValidEventTime && Date.parse(record.providerKnownAt as string) <= Date.parse(record.eventTime as string)) {
    if (record.providerTimestampIndependentlyVerified) {
      return { identityKey: record.identityKey, classification: 'PIT_SAFE_PROVIDER_TIMESTAMP',
        reason: 'No THETA first-observation timestamp exists, but the provider-claimed knownAt predates the event itself ' +
          'AND has been independently verified as historically retrievable at that time -- a defensible (if weaker) PIT proxy.' };
    }
    // Repair for a defect Codex's A-D acceptance review found: a provider
    // timestamp that merely LOOKS like it predates the event is not proof
    // it was retrievable at that historical moment -- a provider can
    // compute/backfill a knownAt-looking field long after the fact. Without
    // independent verification this stays AMBIGUOUS, never PIT_SAFE.
    return { identityKey: record.identityKey, classification: 'AMBIGUOUS',
      reason: 'providerKnownAt predates eventTime, but this has not been independently verified as historically ' +
        'retrievable -- a provider can backfill a plausible-looking knownAt long after the fact. Do not trust this as a ' +
        'PIT signal without corroborating evidence (e.g. an archived response captured near that time).' };
  }
  if (hasValidProviderKnownAt && hasValidEventTime) {
    return { identityKey: record.identityKey, classification: 'AMBIGUOUS',
      reason: 'providerKnownAt is present but postdates eventTime -- this is not proof of genuine advance knowledge ' +
        'and cannot be trusted as a PIT signal without further verification.' };
  }
  return { identityKey: record.identityKey, classification: 'HISTORICAL_NOT_PIT_SAFE',
    reason: 'Neither a persisted thetaFirstObservedAt nor a defensible providerKnownAt-before-eventTime relationship exists. ' +
      'This row cannot be used to answer whether THETA could have known about this event at any historical decision time.' };
}

export interface HistoricalEventPitStudySummary {
  readonly totalRows: number;
  readonly counts: Readonly<Record<HistoricalPitClassification, number>>;
  readonly examples: Readonly<Record<HistoricalPitClassification, readonly string[]>>;
}

/**
 * Produces counts and a bounded set of example identity keys per
 * classification -- descriptive only, no repair, no promotion.
 */
export function summarizeHistoricalEventPitStudy(
  records: readonly EventPitRecord[], maxExamplesPerClass = 5,
): HistoricalEventPitStudySummary {
  const classifications = records.map((record) => classifyHistoricalEventPit(record));
  const forClass = (cls: HistoricalPitClassification) => classifications.filter((row) => row.classification === cls);
  const counts: Record<HistoricalPitClassification, number> = {
    PIT_SAFE_PROVIDER_TIMESTAMP: forClass('PIT_SAFE_PROVIDER_TIMESTAMP').length,
    PIT_SAFE_THETA_FIRST_OBSERVED: forClass('PIT_SAFE_THETA_FIRST_OBSERVED').length,
    HISTORICAL_NOT_PIT_SAFE: forClass('HISTORICAL_NOT_PIT_SAFE').length,
    AMBIGUOUS: forClass('AMBIGUOUS').length,
  };
  const examplesFor = (cls: HistoricalPitClassification) => forClass(cls).slice(0, maxExamplesPerClass).map((row) => row.identityKey);
  const examples: Record<HistoricalPitClassification, readonly string[]> = {
    PIT_SAFE_PROVIDER_TIMESTAMP: examplesFor('PIT_SAFE_PROVIDER_TIMESTAMP'),
    PIT_SAFE_THETA_FIRST_OBSERVED: examplesFor('PIT_SAFE_THETA_FIRST_OBSERVED'),
    HISTORICAL_NOT_PIT_SAFE: examplesFor('HISTORICAL_NOT_PIT_SAFE'),
    AMBIGUOUS: examplesFor('AMBIGUOUS'),
  };
  return { totalRows: records.length, counts, examples };
}
