import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canonicalJson } from '../src/market/fusion-snapshot.js';
import { instrumentClassificationPolicyVersion,
  paperInstrumentClassificationManifest } from '../src/theta/paper-entry-safety-policy.js';

const proposalPath='docs/operations/THETA_FIRST_PAPER_INSTRUMENT_PROPOSAL_2026-09-24.json';
const approvalPath='docs/operations/THETA_FIRST_PAPER_INSTRUMENT_APPROVAL_2026-09-24.json';

test('official first-Paper proposal remains immutable while the exact owner-approved manifest entry is active',()=>{
  const proposal=JSON.parse(readFileSync(proposalPath,'utf8')) as Record<string,unknown>;
  const source=proposal.source as Record<string,unknown>;
  const proposedEntry=proposal.proposedManifestEntry as Record<string,unknown>;
  const approval=JSON.parse(readFileSync(approvalPath,'utf8')) as Record<string,unknown>;
  const approvalSource=approval.source as Record<string,unknown>;
  const approvedEntry=approval.manifestEntry as Record<string,unknown>;
  assert.equal(proposal.policyVersion,instrumentClassificationPolicyVersion);
  assert.equal(proposal.symbol,'SPY');
  assert.equal(proposal.instrumentClass,'NON_COMPANY_FUND');
  assert.equal(proposal.paperBootstrapApproved,false);
  assert.equal(proposedEntry.paperBootstrapApproved,false);
  assert.equal(proposedEntry.reviewedAt,null);
  assert.match(String(source.url),/^https:\/\/www\.ssga\.com\//);
  assert.equal(createHash('sha256').update(canonicalJson(source.evidenceHashBasis as never)).digest('hex'),
    source.evidenceHash);
  assert.equal(approval.approvalAuthority,'OWNER_EXPLICIT_CHAT_APPROVAL');
  assert.equal(approval.paperBootstrapApproved,true);
  assert.equal(approvalSource.url,source.url);
  assert.equal(approvalSource.evidenceHash,source.evidenceHash);
  assert.equal(paperInstrumentClassificationManifest.entries.length,1);
  assert.deepEqual(paperInstrumentClassificationManifest.entries[0],{
    symbol:'SPY',instrumentClass:'NON_COMPANY_FUND',paperBootstrapApproved:true,
    authorityRef:`official-issuer:state-street:spy:${String(source.evidenceHash)}`,
    effectiveAt:String(source.observedAt),reviewedAt:'2026-09-23T19:54:51.183Z',
  });
  assert.deepEqual(approvedEntry,paperInstrumentClassificationManifest.entries[0]);
});
