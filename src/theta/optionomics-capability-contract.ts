import { createHash } from 'node:crypto';

export const optionomicsCapabilityContractVersion='theta-optionomics-capability-v1' as const;
function canonicalJson(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.entries(value as Record<string,unknown>)
    .sort(([left],[right])=>left.localeCompare(right))
    .map(([key,item])=>`${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export type OptionomicsAuthState='PASS'|'401_UNAUTHORIZED'|'EMAIL_NOT_VERIFIED'|'KEY_REVOKED'|
  'WRONG_AUTH_SCHEME'|'PLAN_RESTRICTION'|'UNKNOWN';
export type OptionomicsCapabilityFamily='CHAIN'|'CONTRACT'|'QUOTE_LIKE'|'GREEKS'|'VOLATILITY'|
  'IV_RANK'|'IV_PERCENTILE'|'SKEW'|'TERM_STRUCTURE'|'VOLATILITY_SURFACE'|'EXPECTED_MOVE'|
  'GEX'|'DEX'|'VANNA'|'CHARM'|'GAMMA_FLIP'|'PUT_CALL_WALLS'|'EXPOSURE_HEATMAPS'|'NET_GREEKS'|
  'VOLUME'|'OPEN_INTEREST'|'PREMIUM_DISTRIBUTION'|'FLOW'|'NET_FLOW'|'UOA'|'SWEEPS'|'BLOCKS'|
  'ISO'|'EXECUTION_SIDE'|'FLOW_CONFIDENCE'|'FLOW_PACE'|'DELTA_TRADED'|'MARKET_OVERVIEW'|
  'PUT_CALL_RATIOS'|'SENTIMENT'|'MOMENTUM'|'VIX_METRICS'|'EVENTS'|'EARNINGS'|'NEWS'|
  'HISTORICAL_CHAINS'|'HISTORICAL_METRICS'|'BACKTEST';
export type CapabilityAvailability='SUPPORTED'|'NOT_ENTITLED'|'UI_ONLY'|'MCP_ONLY'|'UNAVAILABLE_API'|'UNKNOWN';
export interface OptionomicsCapabilityObservation {
  readonly family:OptionomicsCapabilityFamily; readonly operationAlias:string;
  readonly documentationReference:string; readonly availability:CapabilityAvailability;
  readonly httpStatus:number|null; readonly schemaKeys:readonly string[];
  readonly timestampField:string|null; readonly units:Readonly<Record<string,string>>;
  readonly nullableFields:readonly string[]; readonly rateLimit:Readonly<Record<string,string|null>>;
  readonly historical:boolean|null; readonly runtimeClass:'RUNTIME_INTELLIGENCE'|'RESEARCH'|'BOTH';
}
export interface OptionomicsRawObservationEnvelope {
  readonly contractVersion:typeof optionomicsCapabilityContractVersion; readonly endpoint:string;
  readonly requestParameters:Readonly<Record<string,string>>; readonly requestedAt:string; readonly receivedAt:string;
  readonly providerTimestamp:string|null; readonly sessionDate:string|null; readonly httpStatus:number;
  readonly rateLimit:Readonly<Record<string,string|null>>; readonly payloadHash:string; readonly schemaVersion:string;
  readonly credentialIdentityRefHash:string; readonly rawPayloadReference:string|null;
}
export interface NormalizedProviderFact<T> {
  readonly family:OptionomicsCapabilityFamily; readonly key:string; readonly value:T|null;
  readonly state:'KNOWN'|'UNKNOWN'|'INVALID'; readonly missingReason:string|null;
  readonly providerTimestamp:string|null; readonly receivedAt:string; readonly asOf:string;
  readonly provenance:'OPTIONOMICS_OBSERVED'|'THETA_DERIVED'|'REPLAY_FIXTURE'; readonly units:string|null;
}
export interface OptionomicsQualificationReceipt {
  readonly version:typeof optionomicsCapabilityContractVersion; readonly auth:OptionomicsAuthState;
  readonly capabilities:readonly OptionomicsCapabilityObservation[];
  readonly quoteIntelligenceReady:boolean; readonly executionQuoteStatus:'QUALIFIED_DIRECT'|'QUALIFIED_COMPOSITE'|'NOT_QUALIFIED';
  readonly blockers:readonly string[]; readonly executionAuthorized:false;
}

const sensitive=/(?:authorization|api[_-]?key|secret|token|email|credential)/i;
export function sanitizeOptionomicsPayload(value:unknown):unknown{
  if(Array.isArray(value))return value.map(sanitizeOptionomicsPayload);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>)
    .map(([key,item])=>[key,sensitive.test(key)?'[REDACTED]':sanitizeOptionomicsPayload(item)]));
  return value;
}
export function buildRawOptionomicsEnvelope(input:Omit<OptionomicsRawObservationEnvelope,'contractVersion'|'payloadHash'>&{rawPayload:unknown}):OptionomicsRawObservationEnvelope{
  const sanitized=sanitizeOptionomicsPayload(input.rawPayload);
  return {contractVersion:optionomicsCapabilityContractVersion,endpoint:input.endpoint,
    requestParameters:Object.fromEntries(Object.entries(input.requestParameters).filter(([key])=>!sensitive.test(key))),
    requestedAt:input.requestedAt,receivedAt:input.receivedAt,providerTimestamp:input.providerTimestamp,
    sessionDate:input.sessionDate,httpStatus:input.httpStatus,rateLimit:input.rateLimit,
    payloadHash:createHash('sha256').update(canonicalJson(sanitized)).digest('hex'),schemaVersion:input.schemaVersion,
    credentialIdentityRefHash:input.credentialIdentityRefHash,rawPayloadReference:input.rawPayloadReference};
}

/** Qualifies only observed, documented capabilities. Empty evidence is never healthy. */
export function qualifyOptionomicsCapabilities(input:{auth:OptionomicsAuthState;
  capabilities:readonly OptionomicsCapabilityObservation[]}):OptionomicsQualificationReceipt{
  const blockers:string[]=[];
  if(input.auth!=='PASS')blockers.push(`AUTH_${input.auth}`);
  if(input.capabilities.length===0)blockers.push('CAPABILITY_EVIDENCE_EMPTY');
  const supported=input.capabilities.filter((item)=>item.availability==='SUPPORTED'&&item.httpStatus!==null&&item.httpStatus>=200&&item.httpStatus<300);
  const chain=supported.some((item)=>item.family==='CHAIN'||item.family==='CONTRACT');
  const quote=supported.some((item)=>item.family==='QUOTE_LIKE'&&item.timestampField!==null&&item.schemaKeys.includes('bid')&&item.schemaKeys.includes('ask'));
  if(!chain)blockers.push('CHAIN_CAPABILITY_NOT_PROVEN');
  if(!quote)blockers.push('FRESH_TWO_SIDED_QUOTE_NOT_PROVEN');
  return {version:optionomicsCapabilityContractVersion,auth:input.auth,capabilities:[...input.capabilities],
    quoteIntelligenceReady:input.auth==='PASS'&&chain,
    executionQuoteStatus:'NOT_QUALIFIED',blockers:[...new Set(blockers)].sort(),executionAuthorized:false};
}
