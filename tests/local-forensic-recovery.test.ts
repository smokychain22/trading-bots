import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeLocalForensicChunkHash,
  LOCAL_FORENSIC_METHOD_VERSION,
  localForensicChunkSchema,
  matchesLocalForensicConfirmation,
} from '../src/database/local-forensic-recovery.js';

test('local forensic recovery requires exact confirmation and a hash-bound chunk',()=>{
  assert.equal(matchesLocalForensicConfirmation('AIVEN_LOCAL_FORENSIC_RECOVERY_053'),true);
  assert.equal(matchesLocalForensicConfirmation('AIVEN_LEGACY_RECONSTRUCT_052'),false);
  const unsigned={schemaVersion:'theta-local-forensic-chunk-v1' as const,
    forensicSweepId:'00000000-0000-4000-8000-000000000053',generatedAt:'2026-09-17T12:00:00.000Z',
    sourceCodeSha:'a'.repeat(40),methodVersion:LOCAL_FORENSIC_METHOD_VERSION,rootManifestHash:'b'.repeat(64),
    chunkIndex:0,chunkCount:1,expectedSourceCount:0,expectedVariantCount:0,expectedMissingSearchCount:0,
    summary:{executionAuthorized:false},sources:[],variants:[],missingSearches:[]};
  const chunk={...unsigned,chunkHash:computeLocalForensicChunkHash(unsigned)};
  assert.equal(localForensicChunkSchema.parse(chunk).chunkHash,chunk.chunkHash);
  assert.equal(localForensicChunkSchema.safeParse({...chunk,sources:[{
    sourceId:'00000000-0000-4000-8000-000000000054',sourceScope:'OTHER',
    sourceLocator:'postgres://user:secret@example.test/db',contentHash:'c'.repeat(64),byteSize:1,modifiedAt:null,
    exactMissingKeyMatches:0,thetaFingerprintMatches:0,evidenceClass:'UNKNOWN',disposition:'CATALOG_ONLY',metadata:{},
  }]}).success,false);
});

test('missing search cannot claim recovery without an explicit state',()=>{
  const unsigned={schemaVersion:'theta-local-forensic-chunk-v1' as const,
    forensicSweepId:'00000000-0000-4000-8000-000000000053',generatedAt:'2026-09-17T12:00:00.000Z',
    sourceCodeSha:'a'.repeat(40),methodVersion:LOCAL_FORENSIC_METHOD_VERSION,rootManifestHash:'b'.repeat(64),
    chunkIndex:0,chunkCount:1,expectedSourceCount:0,expectedVariantCount:0,expectedMissingSearchCount:1,
    summary:{executionAuthorized:false},sources:[],variants:[],missingSearches:[{
      searchId:'00000000-0000-4000-8000-000000000055',targetTable:'trade.decision',
      missingRecordKey:'00000000-0000-4000-8000-000000000056',referenceMatchCount:2,completeRecordMatchCount:0,
      matchedSourceCount:1,searchedScopes:['RESEARCH_EXPORT'],recoveryState:'REFERENCE_ONLY',
      evidence:{noSyntheticParentCreated:true},
    }]};
  const chunk={...unsigned,chunkHash:computeLocalForensicChunkHash(unsigned)};
  assert.equal(localForensicChunkSchema.parse(chunk).missingSearches[0]?.recoveryState,'REFERENCE_ONLY');
});
