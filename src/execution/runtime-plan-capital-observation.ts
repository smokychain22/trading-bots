import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { fetchMasterAccountEvidence, fetchOpenOrders, fetchOptionContract, fetchPositions,
  type AlpacaProviderConfig } from '../theta/alpaca-provider.js';
import type { BrokerReconciliationResult } from './broker-reconciliation-worker.js';
import type { ApprovedMasterPaperActionPlan } from './master-paper-action-handoff.js';
import { parseOccOptionSymbol } from '../theta/account-exposure.js';
import { paperBootstrapRuntimePolicy } from '../theta/paper-bootstrap-runtime-policy.js';
import { accountCapitalInputSchema, accountCapitalPolicyHash, deriveQualifiedAccountEnvelope } from './qualified-account-capital.js';
import { capitalContentHash } from './portfolio-capital-reservation.js';
import type { PlanCapitalObservation } from './plan-capital-binding.js';

export type RuntimePlanCapitalResult = { state: 'READY'; observation: PlanCapitalObservation }
  | { state: 'BLOCKED'; reasons: readonly string[] };

const reads={account:fetchMasterAccountEvidence,positions:fetchPositions,orders:fetchOpenOrders,contract:fetchOptionContract};

/** Fresh GET-only, bounded account observation. No checked-out DB client is
 * held over a provider wait. Commitments are NOT caller input: the existing
 * reservation store reloads them under its physical-account transaction lock.
 * Native held inventory and multi-name group gaps remain explicit refusals. */
export async function produceRuntimePlanCapitalObservation(input: {
  pool: Pick<Pool,'query'>; alpaca: AlpacaProviderConfig; plan: ApprovedMasterPaperActionPlan;
  reconciliation: BrokerReconciliationResult; now: () => string;
}, providers=reads): Promise<RuntimePlanCapitalResult> {
  const blocked=(...reasons:string[]):RuntimePlanCapitalResult=>({state:'BLOCKED',reasons});
  const r=input.reconciliation;
  if(r.dataQuality!=='GOOD'||r.localOnlyIntentCount!==0
    ||r.brokerFactImpactSummary.currentReconciliationDefectCount!==0
    ||r.brokerFactImpactSummary.unknownCurrentImpactCount!==0) return blocked('CAPITAL_RECONCILIATION_UNQUALIFIED');
  const identity=await input.pool.query(`SELECT ea.provider_account_ref_hash AS account_hash
    FROM trade.execution_account ea
    JOIN trade.broker_reconciliation_snapshot brs ON brs.reconciliation_snapshot_id=$2
    JOIN copy.follower_account master ON master.follower_account_id=brs.connection_id
      AND encode(digest(master.provider_account_ref,'sha256'),'hex')=ea.provider_account_ref_hash
    WHERE ea.execution_account_id=$1 AND ea.account_kind='MASTER_API_KEY' AND ea.account_ready=true
      AND ea.environment='PAPER' AND master.account_role='MASTER_THETA_PAPER'
      AND master.environment='PAPER' AND master.disconnected_at IS NULL
      AND master.connection_status='CONNECTED' AND master.account_ready=true
      AND brs.data_quality='GOOD'`,[input.plan.executionAccountId,r.snapshotId]);
  if(identity.rows.length!==1||typeof identity.rows[0]?.account_hash!=='string')
    return blocked('CAPITAL_ACCOUNT_RECONCILIATION_IDENTITY_UNQUALIFIED');
  const evidence=await providers.account(input.alpaca,input.now);
  const accountHash=createHash('sha256').update(evidence.providerAccountId).digest('hex');
  if(accountHash!==identity.rows[0].account_hash) return blocked('CAPITAL_ACCOUNT_IDENTITY_CONFLICT');
  if(evidence.snapshot.accountStatus!=='ACTIVE'||evidence.snapshot.tradingBlocked!==false||evidence.accountBlocked!==false)
    return blocked('CAPITAL_ACCOUNT_CONTROL_UNQUALIFIED');
  const snapshotId=randomUUID();
  const stamp=(requestedAt:string,receivedAt:string,content:unknown)=>({accountHash,snapshotId,requestedAt,receivedAt,
    contentHash:capitalContentHash(content)});
  const positionRequestedAt=input.now();
  const positions=await providers.positions(input.alpaca,positionRequestedAt);
  const positionReceivedAt=input.now();
  const orderRequestedAt=input.now();
  // The canonical adapter rejects incomplete pagination, never [] on failure.
  const orders=await providers.orders(input.alpaca,orderRequestedAt,{maxPages:4});
  const orderReceivedAt=input.now();
  const symbols=[...new Set([...positions.map(p=>p.symbol),...orders.map(o=>o.symbol),
    ...(input.plan.definedRisk?.legs.map(l=>l.occSymbol)??[input.plan.symbol])])];
  if(symbols.some(s=>typeof s!=='string'||parseOccOptionSymbol(s)===null)) return blocked('CAPITAL_INVENTORY_CONTRACT_UNQUALIFIED');
  // A bounded identity lookup, not a historical scan or full-chain export.
  if(symbols.length>32) return blocked('CAPITAL_CONTRACT_LOOKUP_BOUND_EXCEEDED');
  const contracts:PlanCapitalObservation['contracts']=[];
  for(const symbol of symbols as string[]) {
    // The parent package identity is not an OCC symbol and is never queried.
    const c=await providers.contract(input.alpaca,symbol);
    const occ=parseOccOptionSymbol(symbol);
    const d=c.deliverables;
    if(!occ||c.symbol!==symbol||c.optionType!=='PUT'||occ.optionType!=='PUT'||c.strikePrice!==occ.strike
      ||c.expirationDate!==occ.expiration||c.multiplier===null||!Number.isSafeInteger(c.multiplier)||c.multiplier<=0
      ||c.underlyingSymbol!==occ.underlying||c.rootSymbol!==occ.underlying||d?.length!==1
      ||d[0]?.type.toLowerCase()!=='equity'||d[0]?.symbol!==occ.underlying
      ||d[0]?.amount!==c.multiplier||d[0]?.allocationPercentage!==100)
      return blocked('CAPITAL_CONTRACT_OR_NATIVE_STRUCTURE_UNQUALIFIED');
    contracts.push({symbol,strike:String(c.strikePrice),multiplier:c.multiplier,deliverable:'STANDARD',evidenceHash:capitalContentHash(c)});
  }
  const account={...stamp(evidence.requestedAt,evidence.snapshot.receivedAt,evidence.capitalDecimals),
    ...evidence.capitalDecimals,status:evidence.snapshot.accountStatus,tradingBlocked:evidence.snapshot.tradingBlocked};
  const positionRows=positions.map(p=>({symbol:p.symbol,quantity:p.quantity,side:p.side,assetClass:p.assetClass}));
  const orderRows=orders.map(o=>({orderId:o.orderId,clientOrderId:o.clientOrderId,symbol:o.symbol,quantity:o.quantity,
    filledQuantity:o.filledQuantity,positionIntent:o.positionIntent,status:o.status}));
  const now=input.now();
  const parsed=accountCapitalInputSchema.safeParse({envelopeId:randomUUID(),executionAccountId:input.plan.executionAccountId,
    accountHash,now,policyVersion:paperBootstrapRuntimePolicy.policyVersion,policyHash:accountCapitalPolicyHash,
    reconciliation:'GOOD',account,positions:{...stamp(positionRequestedAt,positionReceivedAt,positionRows),rows:positionRows,complete:true},
    orders:{...stamp(orderRequestedAt,orderReceivedAt,orderRows),rows:orderRows,complete:true},contracts,
    underlyings:[...new Set(contracts.map(c=>parseOccOptionSymbol(c.symbol)?.underlying))],
    // Existing Production has no qualified multi-name classification producer.
    // Do not promote research correlations or invent a risk group here.
    groups:null,commitments:[]});
  if(!parsed.success)return blocked('CAPITAL_REQUIRED_EVIDENCE_INVALID',...parsed.error.issues.map(i=>i.path.join('.')));
  const qualified=deriveQualifiedAccountEnvelope(parsed.data);
  if(qualified.state==='BLOCKED')return qualified;
  const {now:_,commitments:__,...observation}=parsed.data;
  void _;void __;
  return {state:'READY',observation};
}
