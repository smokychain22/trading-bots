import { z } from 'zod';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import { paperBootstrapRuntimePolicy as policy } from '../theta/paper-bootstrap-runtime-policy.js';
import { capitalContentHash, capitalEnvelopeSchema, capitalProposalSchema, moneySchema, moneyUnits,
  type CapitalEnvelope } from './portfolio-capital-reservation.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);
const time = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().max(1_000_000);
const stamp = z.object({ accountHash: hash, snapshotId: id, requestedAt: time, receivedAt: time,
  contentHash: hash }).strict();
const contract = z.object({ symbol: id, strike: moneySchema, multiplier: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // Only verified standard cash-deliverable CSPs are supported by this first producer.
  deliverable: z.literal('STANDARD'), evidenceHash: hash }).strict();
const position = z.object({ symbol: id, quantity: z.number().int().negative(), side: z.literal('short'),
  assetClass: z.literal('us_option') }).strict();
const order = z.object({ orderId: id, clientOrderId: id, symbol: id, quantity: count,
  filledQuantity: count, positionIntent: z.enum(['sell_to_open', 'buy_to_close']),
  status: z.enum(['new', 'accepted', 'pending_new', 'partially_filled', 'pending_cancel', 'pending_replace']),
}).strict();

/** Input boundary for the existing broker/snapshot loader. No network calls,
 * broker mutation, quantity selection, or invented account budgets. Unsupported
 * structures fail closed until their canonical native-leg producer is supplied. */
export const accountCapitalInputSchema = z.object({
  envelopeId: z.string().uuid(), executionAccountId: z.string().uuid(), accountHash: hash,
  now: time, policyVersion: id, policyHash: hash,
  reconciliation: z.literal('GOOD'),
  account: stamp.extend({ equity: moneySchema, cash: moneySchema, optionsBuyingPower: moneySchema,
    status: z.literal('ACTIVE'), tradingBlocked: z.literal(false) }).strict(),
  positions: stamp.extend({ rows: z.array(position).max(1000), complete: z.literal(true) }).strict(),
  orders: stamp.extend({ rows: z.array(order).max(1000), complete: z.literal(true) }).strict(),
  contracts: z.array(contract).max(2000),
  underlyings: z.array(z.string().regex(/^[A-Z]{1,6}$/)).min(1).max(100),
  // A grouping source is necessary when the single-underlying proxy is not
  // applicable. Do not substitute ticker concentration for multi-ticker risk.
  groups: z.object({ evidenceHash: hash, policyVersion: id, observedAt: time, expiresAt: time,
    members: z.record(z.string(), z.object({ sector: id, correlation: id }).strict()) }).strict().nullable(),
  commitments: z.array(z.object({ reservationId: z.string().uuid(), remainingQuantity: count,
    proposal: capitalProposalSchema, accountHash: hash,
    intent: z.object({ orderIntentId: z.string().uuid(), decisionId: z.string().uuid(),
      clientOrderId: id, brokerOrderId: id, symbol: id, quantity: count,
      filledQuantity: count, orderClass: z.literal('simple') }).strict().nullable(),
  }).strict()).max(1000),
}).strict();
export type AccountCapitalInput = z.infer<typeof accountCapitalInputSchema>;
export const accountCapitalPolicyHash = capitalContentHash(policy);
const format = (v: bigint): string => `${v / 100_000_000n}.${(v % 100_000_000n).toString().padStart(8, '0')}`;
const nonnegative = (v: bigint): bigint => v < 0n ? 0n : v;
export type QualifiedAccountCapital = {
  state: 'QUALIFIED'; scope: 'CASH_SECURED_PUT_ACCOUNT_CAPACITY'; envelope: CapitalEnvelope;
  accountHash: string; policyHash: string; inputHash: string; receiptHash: string;
  usedByDimension: Record<string, string>; softLimitByDimension: Record<string, string>;
  reflectionProofs: readonly { reservationId: string; orderIntentId: string; brokerOrderId: string;
    pendingQuantity: number; dimensions: Record<string, string> }[];
  retainedReasons: readonly string[]; aegisReassessmentRequired: true; brokerAuthority: false;
};
export type AccountCapitalResult = QualifiedAccountCapital | { state: 'BLOCKED'; reasons: readonly string[]; envelope: null };

export function deriveQualifiedAccountEnvelope(raw: unknown): AccountCapitalResult {
  const parsed = accountCapitalInputSchema.safeParse(raw);
  if (!parsed.success) return { state: 'BLOCKED', envelope: null,
    reasons: ['CAPITAL_REQUIRED_EVIDENCE_INVALID', ...parsed.error.issues.map(x => x.path.join('.'))] };
  const v = parsed.data;
  const blocked = (...reasons: string[]): AccountCapitalResult => ({ state: 'BLOCKED', envelope: null, reasons });
  if (v.policyVersion !== policy.policyVersion || v.policyHash !== accountCapitalPolicyHash)
    return blocked('CAPITAL_POLICY_IDENTITY_CONFLICT');
  const stamps = [v.account, v.positions, v.orders];
  const now = Date.parse(v.now), start = Math.min(...stamps.map(x => Date.parse(x.requestedAt)));
  const observed = Math.max(...stamps.map(x => Date.parse(x.receivedAt)));
  const expires = start + policy.quoteAge.planWindowNewRiskMilliseconds;
  if (stamps.some(x => x.accountHash !== v.accountHash || x.snapshotId !== v.account.snapshotId))
    return blocked('CAPITAL_ACCOUNT_OR_SNAPSHOT_MISMATCH');
  if (stamps.some(x => Date.parse(x.receivedAt) < Date.parse(x.requestedAt)) || now < observed || now >= expires)
    return blocked('CAPITAL_OBSERVATION_STALE_OR_FUTURE');
  const equity = moneyUnits(v.account.equity);
  if (equity <= 0n) return blocked('CAPITAL_EQUITY_INVALID');
  const contracts = new Map(v.contracts.map(x => [x.symbol, x]));
  if (contracts.size !== v.contracts.length || new Set(v.positions.rows.map(x => x.symbol)).size !== v.positions.rows.length
    || new Set(v.orders.rows.map(x => x.orderId)).size !== v.orders.rows.length
    || new Set(v.orders.rows.map(x => x.clientOrderId)).size !== v.orders.rows.length
    || new Set(v.commitments.map(x => x.reservationId)).size !== v.commitments.length)
    return blocked('CAPITAL_DUPLICATE_EVIDENCE');
  const symbols = [...v.positions.rows.map(x => x.symbol), ...v.orders.rows.map(x => x.symbol)];
  const units = new Map<string, { underlying: string; amount: bigint }>();
  for (const symbol of symbols) {
    const c = contracts.get(symbol), occ = parseOccOptionSymbol(symbol);
    if (!c || !occ || occ.optionType !== 'PUT' || moneyUnits(c.strike) !== moneyUnits(String(occ.strike)))
      return blocked('CAPITAL_CONTRACT_OR_NATIVE_STRUCTURE_UNQUALIFIED');
    units.set(symbol, { underlying: occ.underlying, amount: moneyUnits(c.strike) * BigInt(c.multiplier) });
  }
  const underlyings = [...new Set([...v.underlyings, ...[...units.values()].map(x => x.underlying)])].sort();
  if (v.groups !== null && v.groups.policyVersion !== v.policyVersion) return blocked('CAPITAL_GROUP_POLICY_MISMATCH');
  if (v.groups !== null && (Date.parse(v.groups.observedAt) > observed || Date.parse(v.groups.expiresAt) <= now
    || Date.parse(v.groups.expiresAt) <= Date.parse(v.groups.observedAt))) return blocked('CAPITAL_GROUP_EVIDENCE_STALE_OR_FUTURE');
  if (underlyings.length > 1 && (v.groups === null || underlyings.some(x => !v.groups?.members[x])))
    return blocked('CAPITAL_MULTI_UNDERLYING_GROUP_EVIDENCE_REQUIRED');
  const keysFor = (underlying: string): string[] => {
    const group = v.groups?.members[underlying];
    return ['CASH', 'PORTFOLIO', 'ASSIGNMENT', `TICKER:${underlying}`,
      `SECTOR:${group?.sector ?? `SINGLE_UNDERLYING_PROXY:${underlying}`}`,
      `CORRELATION:${group?.correlation ?? `SINGLE_UNDERLYING_PROXY:${underlying}`}`];
  };
  const used = new Map<string, bigint>();
  for (const u of underlyings) for (const key of keysFor(u)) used.set(key, 0n);
  const add = (symbol: string, quantity: number) => {
    const unit = units.get(symbol);
    if (unit === undefined) throw new Error('CAPITAL_VALIDATED_CONTRACT_MISSING');
    for (const key of keysFor(unit.underlying)) used.set(key, (used.get(key) ?? 0n) + unit.amount * BigInt(quantity));
  };
  for (const p of v.positions.rows) add(p.symbol, -p.quantity);
  for (const o of v.orders.rows) {
    if (o.quantity <= 0 || o.filledQuantity > o.quantity) return blocked('CAPITAL_ORDER_QUANTITY_INVALID');
    if (o.positionIntent === 'sell_to_open') add(o.symbol, o.quantity - o.filledQuantity);
    // A close does not reduce exposure until positions and fills reconcile.
  }
  const available: Record<string, string> = { BROKER: v.account.optionsBuyingPower };
  const softLimitByDimension: Record<string, string> = {};
  for (const [key, amount] of used) {
    if (key === 'CASH') { available[key] = format(nonnegative(moneyUnits(v.account.cash) - amount)); continue; }
    const fraction = key === 'PORTFOLIO' ? policy.aegis.maximumPortfolioCapitalAtRiskPct
      : key === 'ASSIGNMENT' ? policy.aegis.maximumAssignmentCapacityPct
        : key.startsWith('TICKER:') ? policy.aegis.maximumTickerConcentrationPct
          : key.startsWith('SECTOR:') ? policy.aegis.maximumSectorConcentrationPct : policy.aegis.maximumCorrelationClusterPct;
    const soft = equity * moneyUnits(String(fraction)) / 100_000_000n;
    const hard = soft * moneyUnits(String(policy.aegis.hardCapMultiplier)) / 100_000_000n;
    softLimitByDimension[key] = format(soft);
    // AEGIS rejects equality at the hard limit. Keep the exact fixed-scale
    // boundary, not a rounded inclusive limit or new percentage threshold.
    available[key] = format(nonnegative(hard - amount - 1n));
  }
  const reflected: CapitalEnvelope['reflected'] = {};
  const reflectionProofs: QualifiedAccountCapital['reflectionProofs'][number][] = [];
  const retainedReasons: string[] = [], consumedOrders = new Set<string>();
  for (const held of v.commitments) {
    if (held.accountHash !== v.accountHash || held.reservationId !== held.proposal.reservationId
      || held.remainingQuantity > held.proposal.quantity) return blocked('CAPITAL_COMMITMENT_IDENTITY_INVALID');
    const intent = held.intent;
    if (intent === null) { retainedReasons.push(`${held.reservationId}:UNBOUND_OR_AMBIGUOUS_COMMITMENT_RETAINED`); continue; }
    const o = v.orders.rows.find(x => x.orderId === intent.brokerOrderId);
    if (!o) { retainedReasons.push(`${held.reservationId}:POSITION_LOT_REFLECTION_NOT_PROVEN`); continue; }
    if (consumedOrders.has(o.orderId)) return blocked('CAPITAL_REFLECTION_ORDER_REUSED');
    consumedOrders.add(o.orderId);
    if (intent.decisionId !== held.proposal.decisionId || intent.quantity !== held.proposal.quantity
      || o.quantity !== intent.quantity || o.filledQuantity !== intent.filledQuantity
      || o.symbol !== intent.symbol || o.clientOrderId !== intent.clientOrderId || o.positionIntent !== 'sell_to_open'
      || held.proposal.strategy === 'THETA_DEFINED_RISK') return blocked('CAPITAL_REFLECTION_LINEAGE_CONFLICT');
    const pending = o.quantity - o.filledQuantity;
    if (o.quantity > held.remainingQuantity) return blocked('CAPITAL_REFLECTION_QUANTITY_CONFLICT');
    const unit = units.get(o.symbol);
    if (unit === undefined) return blocked('CAPITAL_REFLECTION_CONTRACT_MISSING');
    const dimensions: Record<string, string> = {};
    for (const key of keysFor(unit.underlying)) {
      const reserved = held.proposal.perUnit[key];
      if (reserved === undefined || moneyUnits(reserved) < unit.amount) return blocked('CAPITAL_REFLECTION_FOOTPRINT_CONFLICT');
      // Only the secured amount actually deducted above is credited. Fees and
      // other nonreflected buffers stay reserved. Filled lots also stay held.
      dimensions[key] = format(unit.amount * BigInt(pending));
    }
    reflected[held.reservationId] = dimensions;
    reflectionProofs.push({ reservationId: held.reservationId, orderIntentId: intent.orderIntentId,
      brokerOrderId: o.orderId, pendingQuantity: pending, dimensions });
    // Alpaca's aggregate options BP does not itemize each order's actual BP
    // debit. An open order is not proof of an exact broker-dimension amount.
    retainedReasons.push(`${held.reservationId}:BROKER_BP_ATTRIBUTION_UNPROVEN_RETAINED`);
  }
  const inputHash = capitalContentHash(v);
  const envelopeResult = capitalEnvelopeSchema.safeParse({ envelopeId: v.envelopeId, executionAccountId: v.executionAccountId,
    observedAt: new Date(observed).toISOString(), expiresAt: new Date(expires).toISOString(),
    evidenceHash: inputHash, available, reflected, policyVersion: v.policyVersion });
  if (!envelopeResult.success) return blocked('CAPITAL_DERIVED_ENVELOPE_BOUND_INVALID');
  const envelope = envelopeResult.data;
  const receipt = { state: 'QUALIFIED' as const, scope: 'CASH_SECURED_PUT_ACCOUNT_CAPACITY' as const,
    envelope, accountHash: v.accountHash, policyHash: v.policyHash, inputHash,
    usedByDimension: Object.fromEntries([...used].map(([k, amount]) => [k, format(amount)])),
    softLimitByDimension, reflectionProofs, retainedReasons,
    aegisReassessmentRequired: true as const, brokerAuthority: false as const };
  return { ...receipt, receiptHash: capitalContentHash(receipt) };
}
