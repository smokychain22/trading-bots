// Shared-context normalization. A decision's candidate rows repeat the same large JSON (account, portfolio, event, flow, technical, provenance...) hundreds of
// times. This module stores each distinct large value ONCE per decision (a hash-addressed dictionary) and leaves candidates with references. Fields identical across
// EVERY candidate of the decision form the canonical decision_context. Reconstruction is exact; time is never erased (the context belongs to ONE decision).
import { canonicalJson, sha256Hex } from './archive-manifest.js';

export interface NormalizedDecision {
  /** fields whose value is identical for every candidate: the canonical decision context */
  readonly context: Readonly<Record<string, unknown>>;
  /** hash of the canonical context, the decision_context_id source */
  readonly contextHash: string;
  /** values that vary between candidates but repeat: hash -> value, stored once */
  readonly dictionary: Readonly<Record<string, unknown>>;
  /** per candidate: inline fields plus references (field -> dictionary hash) */
  readonly rows: readonly NormalizedRow[];
  readonly stats: { readonly originalBytes: number; readonly normalizedBytes: number; readonly sharedFields: readonly string[]; readonly dictionaryEntries: number };
}

export interface NormalizedRow { readonly inline: Readonly<Record<string, unknown>>; readonly refs: Readonly<Record<string, string>> }

const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

/** only values at least this large are worth a reference; smaller ones stay inline */
export const defaultMinimumReferenceBytes = 128;

export const FLAT_CHILD = '\u0001';
export const FLAT_PRESENT = '\u0002';
const isPlainObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Descends ONE level into large object fields: `volatility_json.surface` becomes its own field, so a decision whose candidates share one large nested value
 * (measured on the legacy evidence: `surface` and `providerMetrics` were identical for every candidate of a decision, 82.9x repetition, 1.9 GiB of 2.1 GiB) is stored once
 * even when a small sibling (`contractVolatility`) differs per candidate. A presence marker keeps empty objects exact.
 */
function flattenRow(row: Record<string, unknown>, minimumBytes: number): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.includes(FLAT_CHILD) || key.includes(FLAT_PRESENT)) throw new Error('DECISION_CONTEXT_RESERVED_KEY');
    if (isPlainObject(value) && bytesOf(value) >= minimumBytes) {
      flat[`${key}${FLAT_CHILD}${FLAT_PRESENT}`] = true;
      for (const [childKey, child] of Object.entries(value)) {
        if (childKey.includes(FLAT_CHILD) || childKey.includes(FLAT_PRESENT)) throw new Error('DECISION_CONTEXT_RESERVED_KEY');
        flat[`${key}${FLAT_CHILD}${childKey}`] = child;
      }
    } else flat[key] = value;
  }
  return flat;
}

function unflattenRow(flat: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const split = key.indexOf(FLAT_CHILD);
    if (split === -1) { row[key] = value; continue; }
    const parent = key.slice(0, split);
    const child = key.slice(split + 1);
    if (child === FLAT_PRESENT) { if (!isPlainObject(row[parent])) row[parent] = {}; continue; }
    if (!isPlainObject(row[parent])) row[parent] = {};
    (row[parent] as Record<string, unknown>)[child] = value;
  }
  return row;
}

export interface NormalizeOptions { /** store varying-but-repeating large values in a dictionary (default true); the point-in-time writer turns this off so the SQL view can reconstruct with one merge */ readonly dictionary?: boolean; readonly minimumBytes?: number; /** descend one level into large object fields (default false; the PIT-style evidence of the legacy sessions needs true) */ readonly descendObjects?: boolean }

export function normalizeDecision(rowsInput: readonly Record<string, unknown>[], optionsOrMinimum: NormalizeOptions | number = {}): NormalizedDecision {
  const options: NormalizeOptions = typeof optionsOrMinimum === 'number' ? { minimumBytes: optionsOrMinimum } : optionsOrMinimum;
  const minimumBytes = options.minimumBytes ?? defaultMinimumReferenceBytes;
  const descend = options.descendObjects ?? false;
  const useDictionary = options.dictionary ?? true;
  const rows = descend ? rowsInput.map((row) => flattenRow(row, minimumBytes)) : rowsInput;
  const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const hashOf = new Map<string, string>();
  const valueFor = new Map<string, unknown>();
  const hashes = (row: Record<string, unknown>, field: string): string | null => {
    if (!(field in row)) return null;
    const text = canonicalJson(row[field]);
    if (Buffer.byteLength(text) < minimumBytes) return null;
    const hash = sha256Hex(text);
    hashOf.set(`${field}\u0000${text}`, hash);
    valueFor.set(hash, row[field]);
    return hash;
  };
  const context: Record<string, unknown> = {};
  const sharedFields: string[] = [];
  const dictionary: Record<string, unknown> = {};
  const perRowRefs: Array<Record<string, string>> = rows.map(() => ({}));
  const everyRowHas = (field: string): boolean => rows.length > 0 && rows.every((row) => field in row);
  for (const field of fields) {
    const rowHashes = rows.map((row) => hashes(row, field));
    const large = rowHashes.every((hash) => hash !== null);
    if (large && everyRowHas(field) && rows.length > 1 && new Set(rowHashes).size === 1) {
      context[field] = rows[0]?.[field];
      sharedFields.push(field);
      continue;
    }
    // varying but repeating large values go to the dictionary; unique or small values stay inline
    const counts = new Map<string, number>();
    for (const hash of rowHashes) if (hash !== null) counts.set(hash, (counts.get(hash) ?? 0) + 1);
    rowHashes.forEach((hash, index) => {
      if (useDictionary && hash !== null && (counts.get(hash) ?? 0) > 1) { dictionary[hash] = valueFor.get(hash); (perRowRefs[index] as Record<string, string>)[field] = hash; }
    });
  }
  const normalizedRows: NormalizedRow[] = rows.map((row, index) => {
    const refs = perRowRefs[index] as Record<string, string>;
    const inline: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) if (!sharedFields.includes(key) && !(key in refs)) inline[key] = value;
    return { inline, refs };
  });
  const contextHash = sha256Hex(canonicalJson(context));
  return { context, contextHash, dictionary, rows: normalizedRows, stats: { originalBytes: rowsInput.reduce((sum, row) => sum + bytesOf(row), 0),
    normalizedBytes: bytesOf(context) + bytesOf(dictionary) + normalizedRows.reduce((sum, row) => sum + bytesOf(row.inline) + bytesOf(row.refs), 0), sharedFields, dictionaryEntries: Object.keys(dictionary).length } };
}

/** Exact inverse of normalizeDecision (key order is not part of the contract; values are identical). */
export function denormalizeDecision(normalized: Pick<NormalizedDecision, 'context' | 'dictionary' | 'rows'>): Record<string, unknown>[] {
  return normalized.rows.map((row) => unflattenRow(rebuildFlat(normalized, row)));
}

function rebuildFlat(normalized: Pick<NormalizedDecision, 'context' | 'dictionary' | 'rows'>, row: NormalizedRow): Record<string, unknown> {
  const rebuilt: Record<string, unknown> = { ...normalized.context, ...row.inline };
  for (const [field, hash] of Object.entries(row.refs)) {
    if (!(hash in normalized.dictionary)) throw new Error(`DECISION_CONTEXT_DICTIONARY_MISSING:${hash}`);
    rebuilt[field] = normalized.dictionary[hash];
  }
  return rebuilt;
}

/** Verifies a normalized decision against its source rows by canonical hash of every row. */
export function verifyNormalization(rows: readonly Record<string, unknown>[], normalized: NormalizedDecision): boolean {
  const rebuilt = denormalizeDecision(normalized);
  return rebuilt.length === rows.length && rows.every((row, index) => canonicalJson(row) === canonicalJson(rebuilt[index]));
}
