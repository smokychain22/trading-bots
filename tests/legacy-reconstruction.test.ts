import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeResearchExportUnion } from '../src/database/legacy-reconstruction-analysis.js';
import {
  computeLegacyReconstructionManifestHash,
  legacyReconstructionManifestSchema,
  matchesLegacyReconstructionConfirmation,
} from '../src/database/legacy-reconstruction-registry.js';

test('research export union finds older-only rows, duplicates, and conflicting identities',()=>{
  const old={candidateId:'00000000-0000-4000-8000-000000000001',value:1};
  const changed={...old,value:2};
  const olderOnly={candidateId:'00000000-0000-4000-8000-000000000002',value:3};
  const receipt=analyzeResearchExportUnion([
    {datasetHash:'a'.repeat(64),exportedAt:'2026-09-14T00:00:00.000Z',rows:{candidates:[old,olderOnly]}},
    {datasetHash:'b'.repeat(64),exportedAt:'2026-09-15T00:00:00.000Z',rows:{candidates:[changed]}},
  ]);
  assert.deepEqual(receipt.families.candidates,{latestRows:1,uniqueRowsAcrossAllExports:2,
    additionalRowsFromOlderExports:1,duplicateOccurrences:0,conflictingIdentities:1,uniqueContentVariants:3});
});

test('legacy reconstruction requires exact confirmation and rejects secret-bearing locators',()=>{
  assert.equal(matchesLegacyReconstructionConfirmation('AIVEN_LEGACY_RECONSTRUCT_052'),true);
  assert.equal(matchesLegacyReconstructionConfirmation('AIVEN_LEGACY_PROMOTE_051'),false);
  const base={schemaVersion:'theta-legacy-reconstruction-manifest-v1' as const,
    reconstructionSweepId:'00000000-0000-4000-8000-000000000010',generatedAt:'2026-09-17T00:00:00.000Z',
    sourceCodeSha:'a'.repeat(40),methodVersion:'theta-legacy-reconstruction-v1' as const,sources:[],families:[],summary:{}};
  const manifest={...base,manifestHash:computeLegacyReconstructionManifestHash(base)};
  assert.equal(legacyReconstructionManifestSchema.parse(manifest).manifestHash,manifest.manifestHash);
  assert.equal(legacyReconstructionManifestSchema.safeParse({...manifest,sources:[{
    reconstructionSourceId:'00000000-0000-4000-8000-000000000011',sourceType:'OTHER',sourceSystem:'unsafe',
    sourceLocator:'postgres://user:password@example/db',sourceProject:null,sourceBranch:null,sourceSha:null,
    sourceTimestamp:null,contentHash:'b'.repeat(64),reconstructionMethod:'read',confidenceClass:'E',
    pitEligibility:'UNKNOWN',evidenceClass:'METADATA_ONLY',recordCount:0,metadata:{},
  }]}).success,false);
});
