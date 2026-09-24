import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawOptionomicsEnvelope,qualifyOptionomicsCapabilities,sanitizeOptionomicsPayload } from '../src/theta/optionomics-capability-contract.js';

test('empty Optionomics capability evidence is never considered healthy',()=>{
  const result=qualifyOptionomicsCapabilities({auth:'PASS',capabilities:[]});
  assert.equal(result.quoteIntelligenceReady,false);assert.ok(result.blockers.includes('CAPABILITY_EVIDENCE_EMPTY'));
  assert.equal(result.executionQuoteStatus,'NOT_QUALIFIED');
});

test('documented chain evidence can qualify intelligence but cannot self-promote execution quotes',()=>{
  const result=qualifyOptionomicsCapabilities({auth:'PASS',capabilities:[{family:'CHAIN',operationAlias:'chain',
    documentationReference:'https://optionomics.ai/docs/api',availability:'SUPPORTED',httpStatus:200,schemaKeys:['contracts'],
    timestampField:'as_of',units:{},nullableFields:[],rateLimit:{remaining:'9'},historical:true,runtimeClass:'BOTH'},
    {family:'QUOTE_LIKE',operationAlias:'chain',documentationReference:'https://optionomics.ai/docs/api',availability:'SUPPORTED',
      httpStatus:200,schemaKeys:['bid','ask'],timestampField:'as_of',units:{bid:'USD_PER_SHARE',ask:'USD_PER_SHARE'},nullableFields:[],
      rateLimit:{remaining:'8'},historical:true,runtimeClass:'RUNTIME_INTELLIGENCE'}]});
  assert.equal(result.quoteIntelligenceReady,true);assert.equal(result.executionQuoteStatus,'NOT_QUALIFIED');
});

test('raw observation metadata hashes a redacted payload and never carries credential parameters',()=>{
  assert.deepEqual(sanitizeOptionomicsPayload({token:'secret',nested:{email:'owner@example.com'},bid:1}),
    {token:'[REDACTED]',nested:{email:'[REDACTED]'},bid:1});
  const result=buildRawOptionomicsEnvelope({endpoint:'/api/v1/test',requestParameters:{symbol:'SPY',api_key:'secret'},
    requestedAt:'2026-09-15T14:00:00Z',receivedAt:'2026-09-15T14:00:01Z',providerTimestamp:null,sessionDate:null,
    httpStatus:200,rateLimit:{remaining:'1'},schemaVersion:'observed-v1',credentialIdentityRefHash:'hash',
    rawPayloadReference:null,rawPayload:{token:'secret',bid:1}});
  assert.deepEqual(result.requestParameters,{symbol:'SPY'});assert.match(result.payloadHash,/^[0-9a-f]{64}$/);
});

test('raw observation hash is stable across equivalent object key order',()=>{
  const common={endpoint:'/api/v1/test',requestParameters:{symbol:'SPY'},requestedAt:'2026-09-15T14:00:00Z',
    receivedAt:'2026-09-15T14:00:01Z',providerTimestamp:null,sessionDate:null,httpStatus:200,
    rateLimit:{remaining:'1'},schemaVersion:'observed-v1',credentialIdentityRefHash:'hash',rawPayloadReference:null};
  const left=buildRawOptionomicsEnvelope({...common,rawPayload:{b:2,a:{y:2,x:1}}});
  const right=buildRawOptionomicsEnvelope({...common,rawPayload:{a:{x:1,y:2},b:2}});
  assert.equal(left.payloadHash,right.payloadHash);
});
