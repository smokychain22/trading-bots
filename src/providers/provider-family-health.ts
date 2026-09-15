export const optionomicsVegaFamilies=['CHAIN','CHAIN_QUOTES','GREEKS','IV','IV_RANK','IV_PERCENTILE','SKEW','TERM_STRUCTURE',
  'VOL_SURFACE','FLOW','NET_FLOW','UOA','SWEEPS','BLOCKS','GEX','DEX','VANNA','CHARM','GAMMA_FLIP','CALL_WALL','PUT_WALL',
  'OTHER_WALLS','EVENTS','EARNINGS','HISTORICAL_CHAIN','HISTORICAL_ANALYTICS','BACKTESTING_DATA','ALERTS','WEBHOOKS','MCP_AVAILABLE'] as const;
export type OptionomicsVegaFamily=typeof optionomicsVegaFamilies[number];
export type ProviderFailureCode='EMPTY_RESPONSE'|'PARTIAL_PAYLOAD'|'STALE_PAYLOAD'|'MISSING_PROVIDER_TIMESTAMP'|
  'MISSING_CONTRACT_IDENTITY'|'UNEXPECTED_SCHEMA_CHANGE'|'DUPLICATE_PAGE'|'PAGINATION_LOOP'|'HTTP_401'|'HTTP_403'|'HTTP_429'|
  'HTTP_5XX'|'TIMEOUT'|'NETWORK_ERROR'|'MALFORMED_RESPONSE'|'WRONG_CONTENT_TYPE';
export interface ProviderFamilyHealth {readonly family:OptionomicsVegaFamily;readonly documented:boolean;readonly endpointVerified:boolean;
  readonly implemented:boolean;readonly authBlocked:boolean;readonly realPayloadCaptured:boolean;readonly schemaConfirmed:boolean;
  readonly qualified:boolean;readonly lastSuccessAt:string|null;readonly lastFailureAt:string|null;readonly lastSchemaChangeAt:string|null;
  readonly lastFreshAt:string|null;readonly sampleCount:number;readonly missingFieldCount:number;readonly staleCount:number;
  readonly status:'GOOD'|'DEGRADED'|'STALE'|'UNKNOWN'|'INVALID'|'NOT_ENTITLED';readonly failures:readonly ProviderFailureCode[];}
export function assessProviderPayload(input:{family:OptionomicsVegaFamily;documented:boolean;endpointVerified:boolean;implemented:boolean;
  authBlocked:boolean;httpStatus:number|null;contentType:string|null;payload:unknown;requiredFields:readonly string[];
  providerTimestamp:string|null;receivedAt:string;maximumAgeMs:number;pageIds?:readonly string[]}):ProviderFamilyHealth{
  const failures:ProviderFailureCode[]=[];
  if(input.httpStatus===401)failures.push('HTTP_401'); else if(input.httpStatus===403)failures.push('HTTP_403');
  else if(input.httpStatus===429)failures.push('HTTP_429'); else if(input.httpStatus!==null&&input.httpStatus>=500)failures.push('HTTP_5XX');
  if(input.contentType!==null&&!input.contentType.toLowerCase().includes('json'))failures.push('WRONG_CONTENT_TYPE');
  if(input.payload===null||input.payload===undefined||input.payload===''||(Array.isArray(input.payload)&&input.payload.length===0))failures.push('EMPTY_RESPONSE');
  const object=input.payload!==null&&typeof input.payload==='object'&&!Array.isArray(input.payload)?input.payload as Record<string,unknown>:null;
  const missing=input.requiredFields.filter((field)=>object===null||!(field in object));
  if(missing.length>0&&input.payload!==null&&input.payload!==undefined)failures.push('PARTIAL_PAYLOAD');
  if(input.providerTimestamp===null)failures.push('MISSING_PROVIDER_TIMESTAMP');
  const received=Date.parse(input.receivedAt),provider=Date.parse(input.providerTimestamp??'');
  const stale=Number.isFinite(received)&&Number.isFinite(provider)&&received-provider>input.maximumAgeMs;
  if(stale)failures.push('STALE_PAYLOAD');
  if(input.pageIds!==undefined){const duplicate=new Set(input.pageIds).size!==input.pageIds.length;if(duplicate)failures.push('DUPLICATE_PAGE');
    if(input.pageIds.length>1&&input.pageIds.at(-1)===input.pageIds.at(-2))failures.push('PAGINATION_LOOP');}
  const unique=[...new Set(failures)];
  const successful=input.httpStatus!==null&&input.httpStatus>=200&&input.httpStatus<300&&unique.length===0;
  const status:ProviderFamilyHealth['status']=input.httpStatus===403?'NOT_ENTITLED':stale?'STALE':successful?'GOOD':
    input.authBlocked||input.httpStatus===401?'INVALID':unique.length>0?'DEGRADED':'UNKNOWN';
  return {family:input.family,documented:input.documented,endpointVerified:input.endpointVerified,implemented:input.implemented,
    authBlocked:input.authBlocked,realPayloadCaptured:input.payload!==null&&input.payload!==undefined,schemaConfirmed:missing.length===0,
    qualified:successful,lastSuccessAt:successful?input.receivedAt:null,lastFailureAt:successful?null:input.receivedAt,
    lastSchemaChangeAt:null,lastFreshAt:successful?input.providerTimestamp:null,sampleCount:input.payload===null||input.payload===undefined?0:1,
    missingFieldCount:missing.length,staleCount:stale?1:0,status,failures:unique};
}
