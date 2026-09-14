import assert from 'node:assert/strict';
import test from 'node:test';
import { safeRuntimeFailure } from '../src/theta/autonomous-runtime.js';
import { AlpacaProviderError } from '../src/theta/alpaca-provider.js';
import { OptionomicsProviderError } from '../src/theta/optionomics-provider.js';

test('runtime diagnostics preserve provider class and status without provider messages',()=>{
  const alpaca=safeRuntimeFailure(new AlpacaProviderError('RATE_LIMITED',429,'private response body'));
  const optionomics=safeRuntimeFailure(new OptionomicsProviderError('AUTHENTICATION_FAILED',401,'private response body'));
  assert.deepEqual(alpaca,{code:'ALPACA_PROVIDER_RATE_LIMITED_HTTP_429',
    detail:'Alpaca PAPER data operation failed with RATE_LIMITED and HTTP_429.'});
  assert.deepEqual(optionomics,{code:'OPTIONOMICS_PROVIDER_AUTHENTICATION_FAILED_HTTP_401',
    detail:'Optionomics operation failed with AUTHENTICATION_FAILED and HTTP_401.'});
  assert.doesNotMatch(JSON.stringify({alpaca,optionomics}),/private response body/);
});

test('runtime diagnostics expose only SQLSTATE and sanitized constraint identity',()=>{
  const result=safeRuntimeFailure({code:'23514',constraint:'candidate unsafe; secret=value'});
  assert.equal(result.code,'POSTGRES_23514');
  assert.doesNotMatch(result.detail,/secret=value/);
});
