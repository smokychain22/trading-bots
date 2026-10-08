import type { Pool } from 'pg';
import { fetchLatestStockQuote, fetchOptionSnapshots, type AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import { withRuntimePostgresTransaction } from '../theta/runtime-postgres-client.js';
import {
  brokerConfirmedPositionLifecycleRegistrationBlocked, buildOrphanManagementAuthority, buildOrphanManagementDecisionDraft,
  buildOrphanRiskClosePlan, classifyBrokerConfirmedOrphan, decideOrphanRiskAction, orphanLineageIncomplete,
  type BrokerConfirmedOptionPosition, type OrphanManagementAuthorityRows, type OrphanMarketEvidence, type OrphanRecoveryMode,
  type OrphanRiskClosePolicy, type OrphanThetaLineage,
} from './broker-orphan-position-recovery.js';
import type { ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import type { ManagementChainInFlightState, ManagementDecisionDraft } from './management-paper-plan-assembly.js';

type Row = Record<string, unknown>;
const num = (value: unknown): number | null =>
  (typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '')
    || !Number.isFinite(Number(value)) ? null : Number(value);
const text = (value: unknown): string | null => value === null || value === undefined ? null : String(value);
const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);

/** One broker-confirmed option position without a canonical lifecycle owner, with every recoverable THETA lineage on that exact contract. */
export interface OrphanCandidate {
  readonly position: BrokerConfirmedOptionPosition;
  readonly lineages: readonly OrphanThetaLineage[];
  /** Latest fusion snapshot of the owning bot for the underlying (management decisions require one); null blocks persistence. */
  readonly fusionSnapshotId: string | null;
  readonly strategyVersion: string | null;
}

/**
 * READ-ONLY. Unowned option positions in a reconciliation snapshot, joined to the THETA OPEN_CSP lineage of the same contract
 * in this execution account. A position held by a Wheel leg or a registered native spread in this account is already owned.
 */
export async function loadBrokerConfirmedOrphanCandidates(pool: Pick<Pool, 'query'>, input: {
  readonly reconciliationSnapshotId: string; readonly executionAccountId: string;
}): Promise<readonly OrphanCandidate[]> {
  const positions = await pool.query(`SELECT bp.symbol,bp.quantity,bp.side,bp.average_entry_price,bp.observed_at,brs.data_quality
    FROM trade.broker_position_snapshot bp
    JOIN trade.broker_reconciliation_snapshot brs ON brs.reconciliation_snapshot_id=bp.reconciliation_snapshot_id
    JOIN copy.follower_account fa ON fa.follower_account_id=brs.connection_id AND fa.follower_account_id=bp.connection_id
    JOIN trade.execution_account ea ON ea.provider_account_ref_hash=encode(digest(fa.provider_account_ref,'sha256'),'hex')
    WHERE bp.reconciliation_snapshot_id=$1 AND ea.execution_account_id=$2 AND bp.asset_class='us_option'
      AND NOT EXISTS(SELECT 1 FROM trade.option_leg l JOIN market.option_contract oc ON oc.option_contract_id=l.option_contract_id
        JOIN trade.economic_chain ec ON ec.chain_id=l.chain_id
        WHERE oc.contract_symbol=bp.symbol AND l.closed_at IS NULL AND ec.closed_at IS NULL
          AND EXISTS(SELECT 1 FROM trade.order_intent owner_intent WHERE owner_intent.chain_id=ec.chain_id
            AND owner_intent.option_contract_id=l.option_contract_id AND owner_intent.execution_account_id=ea.execution_account_id))
      AND NOT EXISTS(SELECT 1 FROM trade.defined_risk_position dp
        JOIN trade.order_intent di ON di.order_intent_id=dp.order_intent_id AND di.chain_id=dp.chain_id
        JOIN trade.economic_chain dc ON dc.chain_id=dp.chain_id
        JOIN trade.order_intent_leg dl ON dl.order_intent_id=di.order_intent_id
        WHERE di.execution_account_id=ea.execution_account_id AND dl.occ_symbol=bp.symbol
          AND di.theta_action='OPEN_DEFINED_RISK' AND di.order_class='mleg'
          AND dc.chain_kind='DEFINED_RISK' AND dc.closed_at IS NULL AND dp.closed_at IS NULL)
    ORDER BY bp.symbol`, [input.reconciliationSnapshotId, input.executionAccountId]);
  const candidates: OrphanCandidate[] = [];
  for (const raw of positions.rows as Row[]) {
    const quantity = num(raw.quantity);
    const side = String(raw.side ?? '').toLowerCase();
    const signedQuantity = quantity === null || !['short','long'].includes(side) ? Number.NaN : side === 'short' ? -Math.abs(quantity) : quantity;
    const average = num(raw.average_entry_price);
    const quality = String(raw.data_quality);
    const position: BrokerConfirmedOptionPosition = { symbol: String(raw.symbol), signedQuantity,
      averageEntryPricePerShare: average === null ? Number.NaN : average, observedAt: iso(raw.observed_at),
      reconciliationQuality: quality === 'GOOD' ? 'GOOD' : quality === 'DEGRADED' ? 'DEGRADED' : 'UNKNOWN' };
    // Owned spread legs were excluded by exact account/contract lineage above.
    // An unexplained long is a visible refusal, never presumed to be a hedge.
    const lineageRows = await pool.query(`SELECT oi.order_intent_id,oi.client_order_id,oi.chain_id,oi.decision_id,oi.status::text AS status,
        oi.theta_action,oi.side,oi.position_intent,oi.quantity,oi.option_contract_id,oi.underlying_id,oc.contract_symbol,oc.multiplier,
        ec.chain_kind,ec.lifecycle_state::text AS chain_state,ec.closed_at IS NOT NULL AS chain_closed,ec.bot_instance_id,u.symbol AS underlying,
        (SELECT count(*)::int FROM trade.option_leg l WHERE l.chain_id=ec.chain_id AND l.closed_at IS NULL) AS open_legs,
        EXISTS(SELECT 1 FROM trade.lifecycle_application la WHERE la.chain_id=ec.chain_id AND la.event_kind='SHORT_PUT_OPEN') AS open_applied,
        bo.order_intent_id AS broker_order_intent_id,bo.provider_order_id,upper(COALESCE(bo.broker_status,'')) AS broker_status,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('quantity',f.quantity,'price',f.price_per_share,'at',f.filled_at) ORDER BY f.filled_at)
          FROM trade.fill f WHERE f.broker_order_id=bo.broker_order_id),'[]'::jsonb) AS fills,
        ((SELECT count(*) FROM trade.master_paper_action_plan p WHERE p.execution_account_id=oi.execution_account_id
            AND p.plan_json->>'chainId'=oi.chain_id::text AND p.status IN ('READY','CLAIMED','WAITING_GATE'))
          +(SELECT count(*) FROM trade.order_intent x WHERE x.chain_id=oi.chain_id
            AND x.status::text NOT IN ('FILLED','CANCELED','REJECTED','EXPIRED')))::int AS in_flight,
        d.strategy_branch,plan.action_plan_id,plan.plan_json->>'candidateId' AS candidate_id,plan.plan_json->>'strategyVersion' AS strategy_version,
        (SELECT f2.fusion_snapshot_id FROM trade.fusion_snapshot f2 WHERE f2.bot_instance_id=ec.bot_instance_id
          AND f2.snapshot_json #>> '{underlyingState,symbol}'=u.symbol ORDER BY f2.decision_time DESC,f2.fusion_snapshot_id DESC LIMIT 1)
          AS fusion_snapshot_id
      FROM trade.order_intent oi
      JOIN market.option_contract oc ON oc.option_contract_id=oi.option_contract_id
      JOIN trade.economic_chain ec ON ec.chain_id=oi.chain_id
      JOIN market.underlying u ON u.underlying_id=ec.underlying_id
      LEFT JOIN trade.decision d ON d.decision_id=oi.decision_id
      LEFT JOIN LATERAL(SELECT b.* FROM trade.broker_order b WHERE b.order_intent_id=oi.order_intent_id
        ORDER BY b.created_at DESC LIMIT 1) bo ON true
      LEFT JOIN LATERAL(SELECT p.action_plan_id,p.plan_json FROM trade.master_paper_action_plan p
        WHERE p.execution_order_intent_id=oi.order_intent_id ORDER BY p.created_at LIMIT 1) plan ON true
      WHERE oi.execution_account_id=$1 AND oc.contract_symbol=$2 AND oi.theta_action IN ('OPEN_CSP','ROLL_CSP_OPEN')
      ORDER BY oi.created_at,oi.order_intent_id`, [input.executionAccountId, position.symbol]);
    let fusionSnapshotId: string | null = null, strategyVersion: string | null = null;
    const lineages = (lineageRows.rows as Row[]).map((row): OrphanThetaLineage => {
      fusionSnapshotId ??= text(row.fusion_snapshot_id);
      strategyVersion ??= text(row.strategy_version);
      const fills = Array.isArray(row.fills) ? (row.fills as Row[]).map((fill) => ({ quantity: Number(fill.quantity),
        pricePerShare: Number(fill.price), occurredAt: iso(fill.at) })) : [];
      return {
        chainId: String(row.chain_id), chainKind: String(row.chain_kind), chainLifecycleState: String(row.chain_state),
        chainClosed: row.chain_closed === true, openOptionLegCount: Number(row.open_legs),
        lifecycleApplication: row.open_applied === true ? { state: 'APPLIED' } : { state: 'NONE', blockedCode: null },
        decisionId: String(row.decision_id),
        orderIntent: { orderIntentId: String(row.order_intent_id), clientOrderId: String(row.client_order_id ?? ''),
          chainId: String(row.chain_id), decisionId: String(row.decision_id), status: String(row.status),
          thetaAction: String(row.theta_action), side: String(row.side), positionIntent: String(row.position_intent ?? ''),
          symbol: String(row.contract_symbol), quantity: Number(row.quantity) },
        brokerOrder: { orderIntentId: String(row.broker_order_intent_id ?? ''), status: String(row.broker_status ?? ''),
          symbol: String(row.contract_symbol), filledQuantity: fills.reduce((sum, fill) => sum + fill.quantity, 0) },
        fills, nonTerminalChainOrders: Number(row.in_flight),
        identity: { strategyBranch: text(row.strategy_branch), candidateId: text(row.candidate_id),
          actionPlanId: text(row.action_plan_id), providerOrderId: text(row.provider_order_id) },
        underlyingId: String(row.underlying_id), optionContractId: String(row.option_contract_id), multiplier: Number(row.multiplier),
      };
    });
    candidates.push({ position, lineages, fusionSnapshotId, strategyVersion });
  }
  return candidates;
}

/** Governed, idempotent writer for the orphan's management authority rows (immutable tables; replays are no-ops). */
export class PostgresOrphanManagementAuthorityStore {
  constructor(private readonly pool: Pool) {}

  async persist(rows: OrphanManagementAuthorityRows): Promise<{ readonly managementInputSnapshotId: string; readonly managementActionFrontierId: string }> {
    const input = rows.inputSnapshot, frontier = rows.frontier;
    if (frontier.managementInputSnapshotId !== input.managementInputSnapshotId || frontier.chainId !== input.chainId) {
      throw new Error('ORPHAN_AUTHORITY_ROWS_MISMATCH');
    }
    return withRuntimePostgresTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.chainId]);
      // Same chain-state guard publication relies on: the orphan authority is only valid while the chain is still an open WAIT chain.
      const chain = await client.query(`SELECT lifecycle_state::text AS state,closed_at FROM trade.economic_chain WHERE chain_id=$1 FOR SHARE`,
        [input.chainId]);
      const current = chain.rows[0] as Row | undefined;
      if (current === undefined || current.closed_at !== null || current.state !== 'WAIT') throw new Error('ORPHAN_CHAIN_NO_LONGER_WAIT');
      await client.query(`INSERT INTO trade.management_input_snapshot(
          management_input_snapshot_id,previous_management_input_snapshot_id,reconciliation_snapshot_id,
          fusion_snapshot_id,chain_id,observed_at,lifecycle_state,input_json,unknown_fields_json,change_json,content_hash)
        VALUES($1,NULL,$2,$3,$4,$5,'WAIT',$6::jsonb,$7::jsonb,$8::jsonb,$9)
        ON CONFLICT(chain_id,content_hash) DO NOTHING`,
      [input.managementInputSnapshotId, input.reconciliationSnapshotId, input.fusionSnapshotId, input.chainId, input.observedAt,
        JSON.stringify(input.inputJson), JSON.stringify(input.unknownFields),
        JSON.stringify([{ path: 'ORPHAN_OBSERVATION', before: null, after: 'PRESENT' }]), input.contentHash]);
      const storedInput = await client.query(`SELECT management_input_snapshot_id FROM trade.management_input_snapshot
        WHERE chain_id=$1 AND content_hash=$2`, [input.chainId, input.contentHash]);
      const inputId = text((storedInput.rows[0] as Row | undefined)?.management_input_snapshot_id);
      if (inputId !== input.managementInputSnapshotId) throw new Error('ORPHAN_MANAGEMENT_INPUT_IDEMPOTENCY_COLLISION');
      await client.query(`INSERT INTO trade.management_action_frontier(
          management_action_frontier_id,management_input_snapshot_id,chain_id,observed_at,lifecycle_state,
          policy_version,policy_evidence_hash,economic_model_state,actions_json,selected_action,second_best_action,
          decision_state,reason_codes_json,content_hash)
        VALUES($1,$2,$3,$4,'WAIT',$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13)
        ON CONFLICT(management_input_snapshot_id,content_hash) DO NOTHING`,
      [frontier.managementActionFrontierId, inputId, frontier.chainId, frontier.observedAt, frontier.policyVersion,
        frontier.policyEvidenceHash, frontier.economicModelState, JSON.stringify(frontier.actions), frontier.selectedAction,
        frontier.secondBestAction, frontier.decisionState, JSON.stringify(frontier.reasonCodes), frontier.contentHash]);
      const storedFrontier = await client.query(`SELECT management_action_frontier_id FROM trade.management_action_frontier
        WHERE management_input_snapshot_id=$1 AND content_hash=$2`, [inputId, frontier.contentHash]);
      const frontierId = text((storedFrontier.rows[0] as Row | undefined)?.management_action_frontier_id);
      if (frontierId !== frontier.managementActionFrontierId) throw new Error('ORPHAN_MANAGEMENT_FRONTIER_IDEMPOTENCY_COLLISION');
      return { managementInputSnapshotId: inputId, managementActionFrontierId: frontierId };
    });
  }
}

export interface OrphanRecoveryDependencies {
  readonly mode: OrphanRecoveryMode;
  readonly policy: OrphanRiskClosePolicy | null;
  readonly reconciliation: { readonly snapshotId: string; readonly observedAt: string; readonly accountStatus: string };
  readonly executionAccountId: string | null;
  readonly optionsCapabilityVerified: boolean;
  readonly killSwitchActive: boolean;
  readonly decisionWindowMs: number;
  readonly loadCandidates: () => Promise<readonly OrphanCandidate[]>;
  readonly readMarket: (symbol: string, expiration: string, strike: number, underlying: string) => Promise<OrphanMarketEvidence>;
  readonly readChainInFlight: (chainId: string) => Promise<ManagementChainInFlightState>;
  readonly persistAuthority: (rows: OrphanManagementAuthorityRows) => Promise<{ readonly managementInputSnapshotId: string; readonly managementActionFrontierId: string }>;
  readonly publishManagementPlans: (decision: ManagementDecisionDraft, plans: readonly ApprovedMasterPaperActionPlan[], createdAt: string) => Promise<number>;
}

export interface OrphanRecoveryItem {
  readonly symbol: string;
  readonly state: 'ORPHAN_HOLD' | 'ORPHAN_CLOSE_PUBLISHED' | 'ORPHAN_CLOSE_BLOCKED' | 'RECONCILING' | 'REFUSED' | 'OBSERVED';
  readonly reasons: readonly string[];
  readonly chainId: string | null;
}

export interface OrphanRecoveryReport {
  readonly mode: OrphanRecoveryMode;
  readonly items: readonly OrphanRecoveryItem[];
  /** Typed job reason when any broker-confirmed position lacks a lifecycle owner; null when none (or mode OFF). */
  readonly blockingCode: typeof brokerConfirmedPositionLifecycleRegistrationBlocked | typeof orphanLineageIncomplete | null;
  readonly published: number;
}

/**
 * The orphan path inside POSITION_MANAGEMENT_SCAN. It never submits and never calls the broker: in CLOSE_RISK_CERTIFIED mode a risk
 * close is published as an ordinary MANAGEMENT plan through PostgresMasterPaperActionPlanStore.publishManagementPlans, and the normal
 * dispatch/coordinator path (quote refresh, mutation fence, plan expiry, claim, verifyBeforeSubmit) executes it. An unexplained
 * position (REFUSED) is reported, never adopted.
 */
export async function runBrokerOrphanRecovery(deps: OrphanRecoveryDependencies): Promise<OrphanRecoveryReport> {
  if (deps.mode === 'OFF') return { mode: 'OFF', items: [], blockingCode: null, published: 0 };
  const items: OrphanRecoveryItem[] = [];
  let published = 0;
  for (const candidate of await deps.loadCandidates()) {
    // Unexplained exposure is not adopted, but it must remain visible as a
    // refusal in management as well as broker reconciliation.
    const classified = classifyBrokerConfirmedOrphan(candidate.position, candidate.lineages);
    if (classified.state === 'RECONCILING') {
      items.push({ symbol: candidate.position.symbol, state: 'RECONCILING', reasons: [classified.reason, ...classified.missing], chainId: null });
      continue;
    }
    if (classified.state === 'REFUSED') {
      // Already lifecycle-owned is the normal case, not an orphan. An in-flight order (e.g. an earlier orphan close) keeps the single owner.
      if (classified.reason === 'ORPHAN_ORDER_IN_FLIGHT') {
        items.push({ symbol: candidate.position.symbol, state: 'ORPHAN_CLOSE_BLOCKED', reasons: ['MANAGEMENT_EQUIVALENT_ORDER_IN_FLIGHT'], chainId: null });
      } else if (classified.reason !== 'ORPHAN_ALREADY_LIFECYCLE_OWNED') {
        items.push({ symbol: candidate.position.symbol, state: 'REFUSED', reasons: [classified.reason], chainId: null });
      }
      continue;
    }
    const rep = classified.representation;
    if (deps.mode === 'OBSERVE') {
      items.push({ symbol: rep.symbol, state: 'OBSERVED', reasons: [brokerConfirmedPositionLifecycleRegistrationBlocked], chainId: rep.chainId });
      continue;
    }
    const market = await deps.readMarket(rep.symbol, rep.expiration, rep.strike, rep.underlying);
    const decision = decideOrphanRiskAction(rep, market, deps.policy);
    if (candidate.fusionSnapshotId === null) {
      items.push({ symbol: rep.symbol, state: 'ORPHAN_CLOSE_BLOCKED', reasons: ['MANAGEMENT_FUSION_SNAPSHOT_MISSING', ...decision.reasons], chainId: rep.chainId });
      continue;
    }
    const authority = buildOrphanManagementAuthority({ representation: rep, decision, market, policy: deps.policy,
      reconciliationSnapshotId: deps.reconciliation.snapshotId, fusionSnapshotId: candidate.fusionSnapshotId,
      observedAt: deps.reconciliation.observedAt });
    const persisted = await deps.persistAuthority(authority);
    if (decision.action === 'HOLD' || deps.policy === null) {
      items.push({ symbol: rep.symbol, state: 'ORPHAN_HOLD', reasons: [...decision.reasons], chainId: rep.chainId });
      continue;
    }
    // One owner: any in-flight plan or order on the chain (including an earlier orphan close) blocks a second one.
    const inFlight = await deps.readChainInFlight(rep.chainId);
    if (inFlight.state !== 'KNOWN' || inFlight.entries.length > 0) {
      items.push({ symbol: rep.symbol, state: 'ORPHAN_CLOSE_BLOCKED', chainId: rep.chainId,
        reasons: [inFlight.state === 'KNOWN' ? 'MANAGEMENT_EQUIVALENT_ORDER_IN_FLIGHT' : 'MANAGEMENT_CHAIN_IN_FLIGHT_STATE_UNKNOWN'] });
      continue;
    }
    const now = deps.reconciliation.observedAt;
    const built = buildOrphanRiskClosePlan({ representation: rep, directive: decision.directive,
      executionAccountId: deps.executionAccountId ?? '', strategyVersion: candidate.strategyVersion ?? '',
      managementInputSnapshotId: persisted.managementInputSnapshotId, managementActionFrontierId: persisted.managementActionFrontierId,
      optionsCapabilityVerified: deps.optionsCapabilityVerified, accountActive: deps.reconciliation.accountStatus === 'ACTIVE',
      killSwitchActive: deps.killSwitchActive, now, decisionExpiresAt: new Date(Date.parse(now) + deps.decisionWindowMs).toISOString() });
    if (built.state !== 'READY') {
      items.push({ symbol: rep.symbol, state: 'ORPHAN_CLOSE_BLOCKED', reasons: [...built.blockers], chainId: rep.chainId });
      continue;
    }
    const draft = buildOrphanManagementDecisionDraft({ plan: built.plan, authority, decision, policy: deps.policy, decidedAt: now });
    published += await deps.publishManagementPlans(draft, [built.plan], now);
    items.push({ symbol: rep.symbol, state: 'ORPHAN_CLOSE_PUBLISHED', reasons: [...decision.reasons], chainId: rep.chainId });
  }
  const orphaned = items.some((item) => item.state !== 'RECONCILING' && item.state !== 'REFUSED');
  return { mode: deps.mode, items, published,
    blockingCode: orphaned ? brokerConfirmedPositionLifecycleRegistrationBlocked
      : items.some((item) => item.state === 'RECONCILING' || item.state === 'REFUSED') ? orphanLineageIncomplete : null };
}

/**
 * READ-ONLY market evidence for one orphan: the exact contract's quote (bounded snapshot read of one strike/expiry) and the
 * underlying IEX midpoint. Any failed or partial read is null (HOLD with a typed reason), never a price.
 */
export async function readOrphanMarketEvidence(alpaca: AlpacaProviderConfig, input: {
  readonly symbol: string; readonly expiration: string; readonly strike: number; readonly underlying: string;
}, now: () => string = () => new Date().toISOString()): Promise<OrphanMarketEvidence> {
  const snapshots = await fetchOptionSnapshots(alpaca, { underlyingSymbol: input.underlying, feed: 'indicative', optionType: 'put',
    expirationDateGte: input.expiration, expirationDateLte: input.expiration, strikePriceGte: input.strike, strikePriceLte: input.strike,
    limit: 100, maxPages: 1 }).catch(() => null);
  const quote = snapshots !== null && snapshots.complete ? snapshots.snapshots.get(input.symbol) : undefined;
  const stock = await fetchLatestStockQuote(alpaca, input.underlying, 'iex').catch(() => null);
  const spot = stock !== null && stock.bid !== null && stock.ask !== null && stock.bid > 0 && stock.ask >= stock.bid
    ? (stock.bid + stock.ask) / 2 : null;
  return { bid: quote?.bid ?? null, ask: quote?.ask ?? null, quoteTimestamp: quote?.quoteTimestamp ?? null, spot, now: now() };
}
