import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {PaperOrderPreviewReceipt} from '../execution/paper-order-preview.js';
import type {ProviderFamilyHealth} from '../providers/provider-family-health.js';
import type {SyntheticLifecycleReceipt} from '../theta/p2g-lifecycle-simulator.js';
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))):item);
const hash=(value:unknown)=>createHash('sha256').update(stable(value)).digest('hex');
type Db=Pool|PoolClient;
export async function persistSyntheticLifecycleReceipt(db:Db,receipt:SyntheticLifecycleReceipt,simulatedAt:string):Promise<void>{
  await db.query(`INSERT INTO research.theta_synthetic_lifecycle_receipt(simulation_receipt_id,scenario_id,simulation_version,
    simulated_at,terminal_state,whole_chain_net_pnl,capital_days,receipt_json,content_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),receipt.scenarioId,
    receipt.version,simulatedAt,receipt.terminalState,receipt.wholeChainNetPnl,receipt.capitalDays,JSON.stringify(receipt),receipt.contentHash]);
}
export async function persistPaperOrderPreview(db:Db,receipt:PaperOrderPreviewReceipt):Promise<void>{
  await db.query(`INSERT INTO research.theta_paper_order_preview_receipt(preview_receipt_id,preview_id,preview_version,previewed_at,
    result,blocker_codes,receipt_json,receipt_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(receipt_hash) DO NOTHING`,
  [randomUUID(),receipt.previewId,receipt.version,receipt.asOf,receipt.result,receipt.blockers,JSON.stringify(receipt),receipt.receiptHash]);
}
export async function persistProviderFamilyHealth(db:Db,health:ProviderFamilyHealth,observedAt:string):Promise<void>{
  const contentHash=hash({health,observedAt});
  await db.query(`INSERT INTO research.optionomics_family_health_observation(family_health_id,family,observed_at,status,documented,
    endpoint_verified,implemented,auth_blocked,real_payload_captured,schema_confirmed,qualified,sample_count,missing_field_count,
    stale_count,failure_codes,observation_json,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
    ON CONFLICT(content_hash) DO NOTHING`,[randomUUID(),health.family,observedAt,health.status,health.documented,health.endpointVerified,
    health.implemented,health.authBlocked,health.realPayloadCaptured,health.schemaConfirmed,health.qualified,health.sampleCount,
    health.missingFieldCount,health.staleCount,health.failures,JSON.stringify(health),contentHash]);
}
