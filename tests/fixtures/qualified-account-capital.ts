import { randomUUID } from 'node:crypto';
import { accountCapitalPolicyHash, type AccountCapitalInput } from '../../src/execution/qualified-account-capital.js';
import { paperBootstrapRuntimePolicy } from '../../src/theta/paper-bootstrap-runtime-policy.js';

export function capitalInput(): AccountCapitalInput {
  const stamp = { accountHash: 'a'.repeat(64), snapshotId: 'fixture-snapshot',
    requestedAt: '2026-10-08T13:30:00.000Z', receivedAt: '2026-10-08T13:30:01.000Z', contentHash: 'b'.repeat(64) };
  return { envelopeId: randomUUID(), executionAccountId: randomUUID(), accountHash: stamp.accountHash,
    now: '2026-10-08T13:30:02.000Z', policyVersion: paperBootstrapRuntimePolicy.policyVersion,
    policyHash: accountCapitalPolicyHash, reconciliation: 'GOOD',
    account: { ...stamp, equity: '100000', cash: '100028', optionsBuyingPower: '94328', status: 'ACTIVE', tradingBlocked: false },
    positions: { ...stamp, complete: true, rows: [{ symbol: 'XLE261120P00057000', quantity: -1, side: 'short', assetClass: 'us_option' }] },
    orders: { ...stamp, complete: true, rows: [] },
    contracts: [{ symbol: 'XLE261120P00057000', strike: '57', multiplier: 100, deliverable: 'STANDARD', evidenceHash: 'c'.repeat(64) }],
    underlyings: ['XLE'], groups: null, commitments: [] };
}
