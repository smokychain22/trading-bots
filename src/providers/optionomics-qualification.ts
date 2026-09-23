import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { fetchOptionomicsContextObservation, fetchOptionomicsNetFlowWindow,
  fetchOptionomicsOptionChain, type NormalizedOptionomicsContextObservation,
  type OptionomicsFetchOutcome, type OptionomicsProviderConfig } from '../theta/optionomics-provider.js';

export const optionomicsQualificationVersion = 'theta-optionomics-provider-qualification-v2' as const;
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
  {family:'UOA',operationAlias:'opt.get_flow_aggregates',endpointPath:'/api/v1/flow/aggregates',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'GAMMA_FLIP',operationAlias:'opt.get_symbol_metrics',endpointPath:'/api/v1/stocks/{symbol}/metrics',endpointState:'DOCUMENTED',executionQuoteEligible:false},
  {family:'WALLS',operationAlias:'opt.get_symbol_metrics',endpointPath:'/api/v1/stocks/{symbol}/metrics',endpointState:'DOCUMENTED',executionQuoteEligible:false},
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

const previousWeekday = (at: string): string => {
  const date = new Date(Date.parse(at) - 7 * 86_400_000);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const errorSecretState = (outcome: OptionomicsFetchOutcome<unknown>): OptionomicsSecretState =>
  outcome.kind !== 'REQUEST_ERROR' ? 'AUTH_VALID'
    : outcome.errorClass === 'AUTHENTICATION_FAILED' ? 'AUTH_INVALID'
      : outcome.errorClass === 'RATE_LIMITED' ? 'RATE_LIMITED'
        : ['PROVIDER_TIMEOUT','NETWORK_FAILURE'].includes(outcome.errorClass)
          ? 'TEMPORARILY_UNAVAILABLE' : 'PROVIDER_ERROR';

function failedOutcome(contract: OptionomicsFamilyContract, outcome: OptionomicsFetchOutcome<unknown>,
  authenticated: boolean): OptionomicsFamilyQualification {
  return blocked(contract, outcome.kind === 'REQUEST_ERROR' ? outcome.errorClass : 'SCHEMA_UNRECOGNIZED', authenticated);
}

const metricKnown = (observation: NormalizedOptionomicsContextObservation, field: string): boolean => {
  const value = observation.normalized[field];
  return value !== null && typeof value === 'object'
    && (value as { state?: unknown }).state === 'KNOWN';
};

function qualified(contract: OptionomicsFamilyContract, input: {
  identityConfirmed: boolean;
  temporalIdentityConfirmed: boolean;
  populated: boolean;
  researchQualified: boolean;
  unitsConfirmed?: boolean;
  signConventionConfirmed?: boolean;
  blockers?: readonly string[];
}): OptionomicsFamilyQualification {
  const blockers = [...(input.blockers ?? []),
    ...(input.temporalIdentityConfirmed ? [] : ['PROVIDER_TEMPORAL_IDENTITY_NOT_CONFIRMED']),
    ...(input.unitsConfirmed === true ? [] : ['PROVIDER_UNITS_NOT_FULLY_CONFIRMED']),
    ...(input.signConventionConfirmed === true ? [] : ['SIGN_CONVENTION_NOT_FULLY_CONFIRMED']),
    'EXECUTION_SEMANTICS_SESSION_RECORDED_RESEARCH'];
  return {
    family: contract.family,
    state: input.researchQualified ? 'QUALIFIED' : input.populated ? 'PARTIAL' : 'PARTIAL',
    documented: true, implemented: true, authenticated: true, payloadCaptured: true,
    schemaConfirmed: true, identityConfirmed: input.identityConfirmed,
    timestampConfirmed: input.temporalIdentityConfirmed, freshnessConfirmed: false,
    unitsConfirmed: input.unitsConfirmed === true,
    signConventionConfirmed: input.signConventionConfirmed === true,
    researchQualified: input.researchQualified,
    productionIntelligenceQualified: false,
    executionQuoteQualified: false,
    blockers,
  };
}

function contextFamily(contract: OptionomicsFamilyContract,
  outcome: OptionomicsFetchOutcome<NormalizedOptionomicsContextObservation>,
  fieldRequirement?: (observation: NormalizedOptionomicsContextObservation) => boolean,
  missingFieldBlocker = 'REQUIRED_PROVIDER_FIELD_NOT_OBSERVED'):
  OptionomicsFamilyQualification {
  if (outcome.kind !== 'VALUE_PRESENT') return failedOutcome(contract, outcome, true);
  const observation = outcome.value;
  const temporal = observation.providerTimestamp !== null || observation.sessionDate !== null
    || (observation.family === 'EVENTS' && typeof observation.requestParameters.from === 'string'
      && typeof observation.requestParameters.to === 'string');
  const fieldReady = fieldRequirement?.(observation) ?? true;
  const coverageReady = observation.populated || observation.paginationComplete === true;
  return qualified(contract, {
    identityConfirmed: observation.underlying === null
      || observation.underlying.toUpperCase() === 'SPY',
    temporalIdentityConfirmed: temporal,
    populated: observation.populated,
    researchQualified: coverageReady && temporal && fieldReady,
    blockers: [
      ...(coverageReady ? [] : [observation.informationState]),
      ...(fieldReady ? [] : [missingFieldBlocker]),
    ],
  });
}

export async function qualifyOptionomicsProvider(input:{mode:OptionomicsQualificationMode;at:string;symbol:string;
  config:OptionomicsProviderConfig|null}):Promise<OptionomicsQualificationReceipt>{
  let secretState:OptionomicsSecretState=input.config===null?'NOT_CONFIGURED':'CONFIGURED_UNVERIFIED';
  const familyEvidence = new Map<OptionomicsFamily, OptionomicsFamilyQualification>();
  if(input.mode==='REAL_AUTHENTICATED'&&input.config!==null){
    const contract = (family: OptionomicsFamily): OptionomicsFamilyContract => {
      const found = optionomicsFamilyContracts.find((item) => item.family === family);
      if (found === undefined) throw new Error(`${family}_CONTRACT_MISSING`);
      return found;
    };
    const historicalDate = previousWeekday(input.at);
    const eventFrom = input.at.slice(0, 10);
    const eventToDate = new Date(Date.parse(`${eventFrom}T00:00:00.000Z`) + 45 * 86_400_000)
      .toISOString().slice(0, 10);
    const [chain, historicalChain, netFlow, metrics, gex, vanna, charm, flow, events] = await Promise.all([
      fetchOptionomicsOptionChain(input.config,input.symbol),
      fetchOptionomicsOptionChain(input.config,input.symbol,{sessionDate:historicalDate}),
      fetchOptionomicsNetFlowWindow(input.config,input.symbol,24,input.at),
      fetchOptionomicsContextObservation(input.config,'METRICS',input.symbol),
      fetchOptionomicsContextObservation(input.config,'EXPOSURE_HEATMAP',input.symbol),
      fetchOptionomicsContextObservation(input.config,'VANNA_EXPOSURE_HEATMAP',input.symbol),
      fetchOptionomicsContextObservation(input.config,'CHARM_EXPOSURE_HEATMAP',input.symbol),
      fetchOptionomicsContextObservation(input.config,'FLOW_AGGREGATES',input.symbol),
      fetchOptionomicsContextObservation(input.config,'EVENTS',input.symbol,
        {from:eventFrom,to:eventToDate,perPage:50,page:1,kinds:['macro','fed','filing']}),
    ]);
    secretState=errorSecretState(chain);
    if(chain.kind==='VALUE_PRESENT'){
      const entries=chain.value.entries;
      const identity=entries.length>0&&entries.every((entry)=>entry.rawSymbol!==null&&entry.underlying!==null
        &&entry.expiration!==null&&entry.optionType!==null&&entry.strike!==null);
      const temporal=chain.value.sessionDate!==null||(entries.length>0&&entries.every((entry)=>entry.asOf!==null));
      familyEvidence.set('CHAIN',qualified(contract('CHAIN'),{identityConfirmed:identity,
        temporalIdentityConfirmed:temporal,populated:entries.length>0,researchQualified:identity&&temporal,
        blockers:[...(identity?[]:['EXACT_IDENTITY_NOT_CONFIRMED']),...(entries.length>0?[]:['EMPTY_CHAIN'])]}));
      const dexPresent=entries.some((entry)=>entry.deltaExposure!==null);
      familyEvidence.set('DEX',qualified(contract('DEX'),{identityConfirmed:identity,
        temporalIdentityConfirmed:temporal,populated:entries.length>0,researchQualified:identity&&temporal&&dexPresent,
        blockers:dexPresent?[]:['DELTA_EXPOSURE_NOT_OBSERVED']}));
    }else{
      familyEvidence.set('CHAIN',failedOutcome(contract('CHAIN'),chain,false));
      familyEvidence.set('DEX',failedOutcome(contract('DEX'),chain,false));
    }
    if(historicalChain.kind==='VALUE_PRESENT'){
      const entries=historicalChain.value.entries;
      const exactSession=historicalChain.value.sessionDate===historicalDate;
      familyEvidence.set('HISTORICAL',qualified(contract('HISTORICAL'),{identityConfirmed:entries.length===0
        ||entries.every((entry)=>entry.underlying===input.symbol),temporalIdentityConfirmed:exactSession,
        populated:entries.length>0,researchQualified:exactSession&&entries.length>0,
        blockers:entries.length>0?[]:['NO_ROWS_FOR_REQUESTED_HISTORICAL_SESSION']}));
    }else familyEvidence.set('HISTORICAL',failedOutcome(contract('HISTORICAL'),historicalChain,true));
    if(netFlow.kind==='VALUE_PRESENT') familyEvidence.set('NET_FLOW',qualified(contract('NET_FLOW'),{
      identityConfirmed:netFlow.value.underlying===input.symbol,temporalIdentityConfirmed:true,
      populated:netFlow.value.netCalls.length+netFlow.value.netPuts.length>0,researchQualified:true,
      blockers:netFlow.value.netCalls.length+netFlow.value.netPuts.length>0?[]:['EMPTY_FLOW_WINDOW']}));
    else familyEvidence.set('NET_FLOW',failedOutcome(contract('NET_FLOW'),netFlow,true));
    familyEvidence.set('FLOW',contextFamily(contract('FLOW'),flow));
    familyEvidence.set('GEX',contextFamily(contract('GEX'),gex));
    familyEvidence.set('VANNA',contextFamily(contract('VANNA'),vanna));
    familyEvidence.set('CHARM',contextFamily(contract('CHARM'),charm));
    familyEvidence.set('EVENTS',contextFamily(contract('EVENTS'),events));
    familyEvidence.set('VOLATILITY',contextFamily(contract('VOLATILITY'),metrics,
      (observation)=>metricKnown(observation,'atmIv'),'ATM_IV_NOT_OBSERVED'));
    familyEvidence.set('UOA',contextFamily(contract('UOA'),flow,
      ()=>false,'DEDICATED_UOA_SEMANTICS_NOT_DOCUMENTED'));
    familyEvidence.set('GAMMA_FLIP',contextFamily(contract('GAMMA_FLIP'),metrics,
      (observation)=>metricKnown(observation,'gammaFlipStrike'),'GAMMA_FLIP_NOT_OBSERVED'));
    familyEvidence.set('WALLS',contextFamily(contract('WALLS'),metrics,
      (observation)=>metricKnown(observation,'putWall')||metricKnown(observation,'callWall'),'WALLS_NOT_OBSERVED'));
  }
  const families=optionomicsFamilyContracts.map((contract)=>familyEvidence.get(contract.family)??
    blocked(contract,contract.endpointState==='ENDPOINT_UNVERIFIED'?'ENDPOINT_UNVERIFIED':input.mode==='REAL_AUTHENTICATED'?'CAPABILITY_NOT_PROBED':'MODE_HAS_NO_REAL_PROVIDER_EVIDENCE',secretState==='AUTH_VALID'));
  const unsigned={version:optionomicsQualificationVersion,mode:input.mode,attemptedAt:input.at,
    credentialIdentityRefHash:input.config===null?null:createHash('sha256').update(input.config.email).digest('hex'),secretState,families,
    realPayloadCount:families.filter((family)=>family.payloadCaptured).length,staleCapabilityCount:0,executionAuthorized:false as const};
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
