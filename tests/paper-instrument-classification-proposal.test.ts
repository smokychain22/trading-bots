import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalJson } from '../src/market/fusion-snapshot.js';
import { instrumentClassificationPolicyVersion,
  paperInstrumentClassificationManifest } from '../src/theta/paper-entry-safety-policy.js';

const proposalPath='docs/operations/THETA_FIRST_PAPER_INSTRUMENT_PROPOSAL_2026-09-24.json';

test('official first-Paper instrument proposal is reproducible and cannot approve itself',()=>{
  const proposal=JSON.parse(readFileSync(proposalPath,'utf8')) as Record<string,unknown>;
  const source=proposal.source as Record<string,unknown>;
  const proposedEntry=proposal.proposedManifestEntry as Record<string,unknown>;
  assert.equal(proposal.policyVersion,instrumentClassificationPolicyVersion);
  assert.equal(proposal.symbol,'SPY');
  assert.equal(proposal.instrumentClass,'NON_COMPANY_FUND');
  assert.equal(proposal.paperBootstrapApproved,false);
  assert.equal(proposedEntry.paperBootstrapApproved,false);
  assert.equal(proposedEntry.reviewedAt,null);
  assert.match(String(source.url),/^https:\/\/www\.ssga\.com\//);
  assert.equal(createHash('sha256').update(canonicalJson(source.evidenceHashBasis as never)).digest('hex'),
    source.evidenceHash);
  assert.equal(paperInstrumentClassificationManifest.entries.length,0,
    'A proposal must never mutate the Production approval manifest before exact owner approval.');
});
