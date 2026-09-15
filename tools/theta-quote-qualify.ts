import {executionOptionQuoteContractVersion,type ExecutionOptionQuote} from '../src/execution/execution-option-quote.js';
import {qualifyQuoteProvider} from '../src/execution/quote-provider-qualification.js';
const now=new Date().toISOString();
const quote:ExecutionOptionQuote={contractVersion:executionOptionQuoteContractVersion,contractId:'SYNTHETIC000000000',providerContractId:'SYNTHETIC000000000',
  bid:1,ask:1.1,bidSize:1,askSize:1,providerTimestamp:now,receivedAtUtc:now,receivedAtMonotonic:0,sequence:1,provider:'SYNTHETIC_REPLAY',
  source:'SESSION_RECORDED_RESEARCH',entitlementState:'ENTITLED_UNVERIFIED',sourceSemantics:'SESSION_RECORDED_RESEARCH',connectionState:'CONNECTED',subscriptionState:'ACTIVE',
  provenance:{authenticated:false,exactContractMapping:true,documentedForOrderPricing:false}};
const receipt=qualifyQuoteProvider({quote,expectedContractId:quote.contractId,attemptedAt:now,maximumAgeMs:5000,marketOpen:true});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
