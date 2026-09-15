import assert from 'node:assert/strict';
import test from 'node:test';
import {assessProviderPayload,optionomicsVegaFamilies} from '../src/providers/provider-family-health.js';
test('Vega family catalog is complete and each family can remain independently unknown',()=>{
  assert.equal(optionomicsVegaFamilies.length,30);assert.ok(optionomicsVegaFamilies.includes('MCP_AVAILABLE'));
});
test('empty, partial, stale, missing timestamp and pagination failures remain explicit',()=>{
  const empty=assessProviderPayload({family:'CHAIN',documented:true,endpointVerified:true,implemented:true,authBlocked:false,
    httpStatus:200,contentType:'application/json',payload:[],requiredFields:['contracts'],providerTimestamp:null,
    receivedAt:'2026-09-16T15:00:00Z',maximumAgeMs:1000,pageIds:['page-a','page-a']});
  for(const code of ['EMPTY_RESPONSE','PARTIAL_PAYLOAD','MISSING_PROVIDER_TIMESTAMP','DUPLICATE_PAGE','PAGINATION_LOOP'] as const)
    assert.ok(empty.failures.includes(code));
  const stale=assessProviderPayload({family:'FLOW',documented:true,endpointVerified:true,implemented:true,authBlocked:false,
    httpStatus:200,contentType:'application/json',payload:{prints:[]},requiredFields:['prints'],providerTimestamp:'2026-09-16T14:00:00Z',
    receivedAt:'2026-09-16T15:00:00Z',maximumAgeMs:1000});
  assert.equal(stale.status,'STALE');assert.ok(stale.failures.includes('STALE_PAYLOAD'));
});
test('one authenticated family can qualify without making an unentitled family healthy',()=>{
  const good=assessProviderPayload({family:'CHAIN',documented:true,endpointVerified:true,implemented:true,authBlocked:false,
    httpStatus:200,contentType:'application/json',payload:{contracts:[1]},requiredFields:['contracts'],providerTimestamp:'2026-09-16T14:59:59Z',
    receivedAt:'2026-09-16T15:00:00Z',maximumAgeMs:2000});
  const denied=assessProviderPayload({family:'GEX',documented:true,endpointVerified:true,implemented:true,authBlocked:false,
    httpStatus:403,contentType:'application/json',payload:{error:'forbidden'},requiredFields:['data'],providerTimestamp:null,
    receivedAt:'2026-09-16T15:00:00Z',maximumAgeMs:2000});
  assert.equal(good.status,'GOOD');assert.equal(good.qualified,true);assert.equal(denied.status,'NOT_ENTITLED');assert.equal(denied.qualified,false);
});
