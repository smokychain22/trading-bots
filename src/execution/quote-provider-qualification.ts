import {createHash,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {qualifyExecutionOptionQuote,type ExecutionOptionQuote,type QuoteEntitlementState} from './execution-option-quote.js';
export interface QuoteProviderQualificationReceipt {readonly qualificationRunId:string;readonly provider:string;readonly source:string;
  readonly entitlementState:QuoteEntitlementState;readonly attemptedAt:string;readonly exactContractId:string|null;
  readonly semantics:ExecutionOptionQuote['sourceSemantics'];readonly qualified:boolean;readonly blockers:readonly string[];
  readonly evidenceHash:string;readonly executionAuthorized:false;}
const stable=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x!==null&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b))):x);
export function qualifyQuoteProvider(input:{quote:ExecutionOptionQuote;expectedContractId:string;attemptedAt:string;maximumAgeMs:number;marketOpen:boolean}):QuoteProviderQualificationReceipt{
  const assessment=qualifyExecutionOptionQuote({quote:input.quote,expectedContractId:input.expectedContractId,nowUtc:input.attemptedAt,maximumAgeMs:input.maximumAgeMs,marketOpen:input.marketOpen,usage:'MASTER_PAPER'});
  const entitlementState:QuoteEntitlementState=assessment.qualified?'QUALIFIED':assessment.blockers.includes('QUOTE_STALE')?'STALE':
    input.quote.sourceSemantics==='INDICATIVE'?'INDICATIVE_ONLY':input.quote.entitlementState??'ENTITLED_UNVERIFIED';
  const unsigned={provider:input.quote.provider,source:input.quote.source??'UNKNOWN',entitlementState,attemptedAt:input.attemptedAt,
    exactContractId:input.quote.contractId||null,semantics:input.quote.sourceSemantics,qualified:assessment.qualified,blockers:assessment.blockers,executionAuthorized:false as const};
  return {qualificationRunId:randomUUID(),...unsigned,evidenceHash:createHash('sha256').update(stable(unsigned)).digest('hex')};
}
export async function persistQuoteProviderQualification(pool:Pool,receipt:QuoteProviderQualificationReceipt):Promise<void>{
  await pool.query(`INSERT INTO research.quote_provider_qualification_receipt(qualification_run_id,provider,source,entitlement_state,
    attempted_at,exact_contract_id,semantics,qualified,evidence_json,evidence_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
    ON CONFLICT(evidence_hash) DO NOTHING`,[receipt.qualificationRunId,receipt.provider,receipt.source,receipt.entitlementState,
    receipt.attemptedAt,receipt.exactContractId,receipt.semantics,receipt.qualified,JSON.stringify({blockers:receipt.blockers}),receipt.evidenceHash]);
}
