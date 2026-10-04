// Normalized storage of candidate point-in-time evidence. The legacy writer stored every candidate with ALL sixteen JSON documents, repeating the decision-wide ones
// (volatility surface, provider metrics, technical state, event, flow, account, portfolio, provenance...) once per candidate (measured: 82.9x, 97% of the bytes).
// Here a decision's shared values are stored ONCE in dp.decision_context and each candidate row (dp.pit_candidate) keeps only what is specific to it. The SQL view
// dp.candidate_point_in_time_evidence_v rebuilds the exact legacy row with one object merge per column, so every existing reader keeps working unchanged.
import { createHash } from 'node:crypto';
import { canonicalJson } from './archive-manifest.js';
import { FLAT_CHILD, FLAT_PRESENT, normalizeDecision, denormalizeDecision, type NormalizedDecision } from './decision-context.js';

export const PIT_OBJECT_COLUMNS = ['contract_json', 'market_json', 'volatility_json', 'technical_json', 'event_json', 'flow_json', 'ownership_json', 'account_json', 'portfolio_json', 'aegis_json', 'execution_json', 'known_economics_json'] as const;
export const PIT_ARRAY_COLUMNS = ['unknown_economics_json', 'hard_blockers_json', 'soft_evidence_json', 'provider_provenance_json'] as const;
export const PIT_JSON_COLUMNS = [...PIT_OBJECT_COLUMNS, ...PIT_ARRAY_COLUMNS] as const;
export const PIT_SCALAR_COLUMNS = ['candidate_id', 'decision_id', 'fusion_snapshot_id', 'decision_time', 'branch', 'rank_at_decision', 'selected', 'hard_status', 'soft_status', 'rejection_reason',
  'strategy_version', 'risk_version', 'feature_version', 'cost_model_version', 'regime_version', 'execution_model_version', 'content_hash'] as const;

export type PitEvidenceRow = Readonly<Record<(typeof PIT_SCALAR_COLUMNS)[number] | (typeof PIT_JSON_COLUMNS)[number], unknown>>;

export interface NormalizedPit {
  /** keyed by JSON column: for object columns the shared children, for array columns the whole shared value */
  readonly context: Readonly<Record<string, unknown>>;
  readonly contextHash: string;
  readonly rows: readonly { readonly scalars: Readonly<Record<string, unknown>>; readonly inline: Readonly<Record<string, unknown>> }[];
  readonly stats: NormalizedDecision['stats'];
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** flat keys (`column`, or `column<CHILD>child`, or the presence marker) to a nested object keyed by column */
function nestFlat(flat: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const split = key.indexOf(FLAT_CHILD);
    if (split === -1) { nested[key] = value; continue; }
    const column = key.slice(0, split);
    const child = key.slice(split + 1);
    if (child === FLAT_PRESENT) { if (!isObject(nested[column])) nested[column] = {}; continue; }
    if (!isObject(nested[column])) nested[column] = {};
    (nested[column] as Record<string, unknown>)[child] = value;
  }
  return nested;
}

function flattenNested(nested: Readonly<Record<string, unknown>>, objectColumns: ReadonlySet<string>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(nested)) {
    if (objectColumns.has(column) && isObject(value)) for (const [child, childValue] of Object.entries(value)) flat[`${column}${FLAT_CHILD}${child}`] = childValue;
    else flat[column] = value;
  }
  return flat;
}

export function normalizePitRows(rows: readonly PitEvidenceRow[], minimumBytes?: number): NormalizedPit {
  const jsonOnly = rows.map((row) => Object.fromEntries(PIT_JSON_COLUMNS.map((column) => [column, row[column]])));
  // one level of descent, no dictionary: the SQL view rebuilds a column with `context || inline`
  const normalized = normalizeDecision(jsonOnly, { descendObjects: true, dictionary: false, ...(minimumBytes === undefined ? {} : { minimumBytes }) });
  const context = nestFlat(normalized.context);
  return {
    context,
    contextHash: normalized.contextHash,
    rows: rows.map((row, index) => ({ scalars: Object.fromEntries(PIT_SCALAR_COLUMNS.map((column) => [column, row[column]])), inline: nestFlat(normalized.rows[index]?.inline ?? {}) })),
    stats: normalized.stats,
  };
}

/** Exact inverse: the JSON columns of every row, rebuilt from the context and the inline parts. */
export function reconstructPitRows(normalized: Pick<NormalizedPit, 'context' | 'rows'>): Record<string, unknown>[] {
  const objectColumns = new Set<string>(PIT_OBJECT_COLUMNS);
  return normalized.rows.map((row) => {
    const flatContext = flattenNested(normalized.context, objectColumns);
    const flatInline = flattenNested(row.inline, objectColumns);
    // the object columns that were flattened carry a presence marker in the original flat form; rebuild them as objects even when no child remains
    const markers: Record<string, unknown> = {};
    for (const column of PIT_OBJECT_COLUMNS) if (column in normalized.context || column in row.inline || Object.keys(flatContext).concat(Object.keys(flatInline)).some((key) => key.startsWith(`${column}${FLAT_CHILD}`))) markers[`${column}${FLAT_CHILD}${FLAT_PRESENT}`] = true;
    const rebuilt = denormalizeDecision({ context: { ...flatContext, ...markers }, dictionary: {}, rows: [{ inline: flatInline, refs: {} }] })[0] ?? {};
    for (const column of PIT_OBJECT_COLUMNS) if (!isObject(rebuilt[column])) rebuilt[column] = {};
    return { ...row.scalars, ...rebuilt };
  });
}

/** Canonical equality of two PIT rows (jsonb has no key order, so canonical JSON is the exact equivalence). */
export const pitRowsEqual = (left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean => canonicalJson(left) === canonicalJson(right);

export const decisionContextId = (fusionSnapshotId: string, contextHash: string): string => {
  const hex = createHash('sha256').update(`theta-dp-decision-context-v1:${fusionSnapshotId}:${contextHash}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
