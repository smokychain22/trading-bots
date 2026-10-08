import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Pool } from 'pg';
import type { Environment } from '../src/config/environment.js';
import { MasterEncryptedStoreBrokerCredentialProvider } from '../src/customer/broker-credential-provider.js';
import { customerStoreFromPool, readOnlyMasterCredentialStoreFromPool } from '../src/customer/customer-store.js';
import { encryptSecret } from '../src/customer/customer-security.js';

const key=Buffer.alloc(32,9).toString('base64');
const encrypted=encryptSecret(JSON.stringify({apiKeyId:'SYNTHETIC_MASTER',apiSecret:'SYNTHETIC_SECRET'}),key,'synthetic-customer');
const row={...encrypted,customer_id:'synthetic-customer',provider_account_ref:'synthetic-account',key_ref:'synthetic-key-ref',
  ciphertext:encrypted.ciphertext,iv:encrypted.iv,auth_tag:encrypted.authTag,connection_method:'PAPER_API_KEY_PRIVATE_BETA'};
const environment={PAPER_COPY_TOKEN_KEY_REF:'synthetic-key-ref',PAPER_COPY_TOKEN_ENCRYPTION_KEY:key,
  ALPACA_API_KEY:'WRONG_AMBIENT_KEY',ALPACA_SECRET_KEY:'WRONG_AMBIENT_SECRET'} as Environment;

test('read-only master diagnostics reuse encrypted canonical identity with SELECT and no credential touch',async()=>{
  const queries:string[]=[];
  const pool={query:async(sql:string)=>{queries.push(sql);return {rows:[row],rowCount:1};}} as unknown as Pool;
  const store=readOnlyMasterCredentialStoreFromPool(pool);
  assert.deepEqual(Object.keys(store),['getMasterCredential']);
  const result=await new MasterEncryptedStoreBrokerCredentialProvider(store,environment).getAuthentication();
  assert.equal(result?.providerAccountRef,'synthetic-account');
  assert.equal(result?.authentication.apiKey,'SYNTHETIC_MASTER');
  assert.equal(queries.length,1);
  const read=queries[0];assert.ok(read);
  assert.match(read,/^SELECT /);
  assert.doesNotMatch(read,/\b(UPDATE|INSERT|DELETE|last_used_at)\b/i);
  await customerStoreFromPool(pool).getMasterCredential();
  const touched=queries[1];assert.ok(touched);
  assert.match(touched,/UPDATE copy\.alpaca_oauth_token t SET last_used_at=now\(\)/);
  assert.ok(touched.includes(`WITH eligible AS (${read})`),'read and runtime share one eligibility authority');
});

test('missing, ambiguous, wrong-key and unavailable stored credentials never fall back to local keys',async()=>{
  for(const count of [0,2]) {
    const pool={query:async()=>({rows:count?[row,row]:[],rowCount:count})} as unknown as Pool;
    const provider=new MasterEncryptedStoreBrokerCredentialProvider(readOnlyMasterCredentialStoreFromPool(pool),environment);
    if(count===0)assert.equal(await provider.getAuthentication(),null);
    else await assert.rejects(provider.getAuthentication(),/MASTER_CREDENTIAL_AMBIGUOUS/);
  }
  const failure=Object.assign(Error('synthetic database unavailable'),{code:'EAI_AGAIN'});
  const pool={query:async()=>{throw failure;}} as unknown as Pool;
  await assert.rejects(new MasterEncryptedStoreBrokerCredentialProvider(readOnlyMasterCredentialStoreFromPool(pool),environment)
    .getAuthentication(),e=>e===failure);
  const valid={query:async()=>({rows:[row],rowCount:1})} as unknown as Pool;
  await assert.rejects(new MasterEncryptedStoreBrokerCredentialProvider(readOnlyMasterCredentialStoreFromPool(valid),
    {...environment,PAPER_COPY_TOKEN_KEY_REF:'wrong'}).getAuthentication(),/MASTER_CREDENTIAL_KEY_VERSION_MISMATCH/);
});

test('runtime truth authenticates the stored master and pins provider identity, without ambient broker-key fallback',()=>{
  const source=readFileSync(new URL('../tools/theta-runtime-truth.ts',import.meta.url),'utf8');
  assert.match(source,/readOnlyMasterCredentialStoreFromPool\(pool\)/);
  assert.doesNotMatch(source,/environment\.ALPACA_(API_KEY|SECRET_KEY)/);
  assert.match(source,/accountBody\?\.id === masterCredential\.providerAccountRef/);
  assert.match(source,/accountMatches && Array\.isArray\(positions\.body\)/);
});
