import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { fetchOptionomicsOptionChain, type OptionomicsProviderConfig } from '../theta/optionomics-provider.js';

export const optionomicsQualificationVersion = 'theta-optionomics-provider-qualification-v1' as const;
export type OptionomicsQualificationMode = 'SYNTHETIC' | 'REPLAY' | 'REAL_AUTHENTICATED';
export type OptionomicsFamily = 'CHAIN'|'FLOW'|'NET_FLOW'|'UOA'|'GEX'|'GAMMA_FLIP'|'WALLS'|'DEX'|'VANNA'|'CHARM'|'EVENTS'|'HISTORICAL'|'VOLATILITY';
export type FamilyQualificationState = 'QUALIFIED'|'PARTIAL'|'BLOCKED'|'UNSUPPORTED'|'INVALID'|'UNKNOWN';
export type OptionomicsSecretState = 'NOT_CONFIGURED'|'CONFIGURED_UNVERIFIED'|'AUTH_VALID'|'AUTH_INVALID'|'RATE_LIMITED'|'TEMPORARILY_UNAVAILABLE'|'PROVIDER_ERROR';

export interface OptionomicsFamilyContract {
  readonly family: OptionomicsFamily;
  readonly operationAlias: string;
  readonly endpointPath: string | null;
  readonly endpointState: 'DOCUMENTED'|'ENDPOINT_UNVERIFIED';
  readonly executionQuoteEligible: false;
}

export const optionomicsFamilyContracts: readonly OptionomicsFamilyContract[] = Object.freeze([
  {family:'CHAIN',operationAlias:'opt.get_option_chain',endpointPath:'/api/v1/stocks/{symbol}/options',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'NET_FLOW',operationAlias:'opt.get_flow_net',endpointPath:'/api/v1/flow/net',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'FLOW',operationAlias:'opt.get_flow_aggregates',endpointPath:'/api/v1/flow/aggregates',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'GEX',operationAlias:'opt.get_gamma_exposure_heatmap',endpointPath:'/api/v1/stocks/{symbol}/heatmap?metric=gamma_exposure',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'VANNA',operationAlias:'opt.get_vanna_exposure_heatmap',endpointPath:'/api/v1/stocks/{symbol}/heatmap?metric=vanna_exposure',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'CHARM',operationAlias:'opt.get_charm_exposure_heatmap',endpointPath:'/api/v1/stocks/{symbol}/heatmap?metric=charm_exposure',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'EVENTS',operationAlias:'opt.list_events',endpointPath:'/api/v1/events',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'VOLATILITY',operationAlias:'opt.get_symbol_metrics',endpointPath:'/api/v1/stocks/{symbol}/metrics',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'HISTORICAL',operationAlias:'opt.get_option_chain_history',endpointPath:'/api/v1/stocks/{symbol}/options?date={date}',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'DEX',operationAlias:'opt.get_option_chain_delta_exposure',endpointPath:'/api/v1/stocks/{symbol}/options',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  ...(['UOA','GAMMA_FLIP','WALLS'] as const).map((family)=>({family,operationAlias:`optionomics.${family.toLowerCase()}`,
    endpointPath:null,endpointState:'ENDPOINT_UNVERIFIED' as const,executionQuoteEligible:false as const})),
]);

export interface OptionomicsFamilyQualification {
  readonly family: OptionomicsFamily;
  readonly state: FamilyQualificationState;
  readonly documented: boolean;
  readonly implemented: boolean;
  readonly authenticated: boolean;
  readonly payloadCaptured: boolean;
  readonly schemaConfirmed: boolean;
  readonly identityConfirmed: boolean;
  readonly timestampConfirmed: boolean;
  readonly freshnessConfirmed: boolean;
  readonly unitsConfirmed: boolean;
  readonly signConventionConfirmed: boolean;
  readonly researchQualified: boolean;
  readonly productionIntelligenceQualified: boolean;
  readonly executionQuoteQualified: false;
  readonly blockers: readonly string[];
}

export interface OptionomicsQualificationReceipt {
  readonly qualificationRunId: string;
  readonly version: typeof optionomicsQualificationVersion;
  readonly mode: OptionomicsQualificationMode;
  readonly attemptedAt: string;
  readonly credentialIdentityRefHash: string | null;
  readonly secretState: OptionomicsSecretState;
  readonly families: readonly OptionomicsFamilyQualification[];
  readonly realPayloadCount: number;
  readonly staleCapabilityCount: number;
  readonly executionAuthorized: false;
  readonly receiptHash: string;
}

const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item!==null&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))):item);

function blocked(contract:OptionomicsFamilyContract, reason:string, authenticated=false):OptionomicsFamilyQualification {
  return {family:contract.family,state:'BLOCKED',documented:contract.endpointState==='DOCUMENTED',implemented:contract.endpointPath!==null,
    authenticated,payloadCaptured:false,schemaConfirmed:false,identityConfirmed:false,timestampConfirmed:false,freshnessConfirmed:false,
    unitsConfirmed:false,signConventionConfirmed:false,researchQualified:false,productionIntelligenceQualified:false,
    executionQuoteQualified:false,blockers:[reason]};
}

export async function qualifyOptionomicsProvider(input:{mode:OptionomicsQualificationMode;at:string;symbol:string;
  config:OptionomicsProviderConfig|null}):Promise<OptionomicsQualificationReceipt>{
  let secretState:OptionomicsSecretState=input.config===null?'NOT_CONFIGURED':'CONFIGURED_UNVERIFIED';
  let chain:OptionomicsFamilyQualification|null=null;
  if(input.mode==='REAL_AUTHENTICATED'&&input.config!==null){
    const result=await fetchOptionomicsOptionChain(input.config,input.symbol);
    if(result.kind==='VALUE_PRESENT'){
      secretState='AUTH_VALID';
      const identity=result.value.entries.length>0&&result.value.entries.every((entry)=>entry.rawSymbol!==null&&entry.underlying!==null&&entry.expiration!==null&&entry.optionType!==null&&entry.strike!==null);
      const timestamps=result.value.entries.length>0&&result.value.entries.every((entry)=>entry.asOf!==null);
      chain={family:'CHAIN',state:identity&&timestamps?'QUALIFIED':'PARTIAL',documented:true,implemented:true,authenticated:true,
        payloadCaptured:true,schemaConfirmed:true,identityConfirmed:identity,timestampConfirmed:timestamps,freshnessConfirmed:false,
        unitsConfirmed:false,signConventionConfirmed:false,researchQualified:identity&&timestamps,
        productionIntelligenceQualified:false,executionQuoteQualified:false,
        blockers:[...(identity?[]:['EXACT_IDENTITY_NOT_CONFIRMED']),...(timestamps?[]:['PROVIDER_TIMESTAMP_NOT_CONFIRMED']),'EXECUTION_SEMANTICS_SESSION_RECORDED_RESEARCH']};
    }else{
      secretState=result.kind==='REQUEST_ERROR'&&result.errorClass==='AUTHENTICATION_FAILED'?'AUTH_INVALID':
        result.kind==='REQUEST_ERROR'&&result.errorClass==='RATE_LIMITED'?'RATE_LIMITED':
        result.kind==='REQUEST_ERROR'&&['PROVIDER_TIMEOUT','NETWORK_FAILURE'].includes(result.errorClass)?'TEMPORARILY_UNAVAILABLE':'PROVIDER_ERROR';
      const chainContract=optionomicsFamilyContracts.find((item)=>item.family==='CHAIN');
      if(chainContract===undefined)throw new Error('CHAIN_CONTRACT_MISSING');
      chain=blocked(chainContract,result.kind==='REQUEST_ERROR'?result.errorClass:'SCHEMA_UNRECOGNIZED');
    }
  }
  const families=optionomicsFamilyContracts.map((contract)=>contract.family==='CHAIN'&&chain!==null?chain:
    blocked(contract,contract.endpointState==='ENDPOINT_UNVERIFIED'?'ENDPOINT_UNVERIFIED':input.mode==='REAL_AUTHENTICATED'?'CAPABILITY_NOT_PROBED':'MODE_HAS_NO_REAL_PROVIDER_EVIDENCE',secretState==='AUTH_VALID'));
  const unsigned={version:optionomicsQualificationVersion,mode:input.mode,attemptedAt:input.at,
    credentialIdentityRefHash:input.config===null?null:createHash('sha256').update(input.config.email).digest('hex'),secretState,families,
    realPayloadCount:chain?.payloadCaptured===true?1:0,staleCapabilityCount:0,executionAuthorized:false as const};
  return {qualificationRunId:randomUUID(),...unsigned,receiptHash:createHash('sha256').update(canonical(unsigned)).digest('hex')};
}

export async function persistOptionomicsQualification(pool:Pool,receipt:OptionomicsQualificationReceipt):Promise<void>{
  await pool.query(`INSERT INTO research.optionomics_provider_qualification_receipt(
    qualification_run_id,qualification_version,mode,attempted_at,credential_identity_ref_hash,secret_state,
    families_json,real_payload_count,stale_capability_count,evidence_hash,execution_authorized)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,false) ON CONFLICT(evidence_hash) DO NOTHING`,
  [receipt.qualificationRunId,receipt.version,receipt.mode,receipt.attemptedAt,receipt.credentialIdentityRefHash,
    receipt.secretState,JSON.stringify(receipt.families),receipt.realPayloadCount,receipt.staleCapabilityCount,receipt.receiptHash]);
}
