import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnvironment } from '../src/config/environment.js';
import { designateConnectedPaperMaster, resolveAuthenticatedMasterCandidate } from '../src/customer/paper-account-role.js';
import type { FollowerVerification } from '../src/customer/alpaca-paper-verification.js';
import { paperCopyReadiness } from '../src/customer/paper-copy.js';
import type { FollowerRecord } from '../src/customer/customer-store.js';

const verified: FollowerVerification = {
  account: { id: 'synthetic-paper-account', status: 'ACTIVE' },
  ready: true, positions: [], openOrders: [], marketOpen: false, reason: null,
};

test('role designation verifies before persistence and never exposes identity or credentials', async () => {
  const sequence: string[] = [];
  const result = await designateConnectedPaperMaster(loadEnvironment({}), 'synthetic-customer', {
    promote: async (customerId, accountId) => {
      sequence.push('persist');
      assert.equal(customerId, 'synthetic-customer');
      assert.equal(accountId, verified.account.id);
    },
  }, async () => { sequence.push('verify'); return verified; });
  assert.deepEqual(sequence, ['verify', 'persist']);
  assert.equal(result.account_role, 'MASTER_THETA_PAPER');
  assert.equal(result.order_submission, 'LOCKED');
  assert.equal(result.orders_submitted, 0);
  assert.equal(JSON.stringify(result).includes(verified.account.id), false);
});

test('failed broker verification never promotes a master', async () => {
  let writes = 0;
  await assert.rejects(designateConnectedPaperMaster(loadEnvironment({}), 'synthetic-customer', {
    promote: async () => { writes++; },
  }, async () => ({ ...verified, ready: false })), /MASTER_ACCOUNT_NOT_READY/);
  assert.equal(writes, 0);
});

test('persistence failure cannot return a successful role receipt', async () => {
  await assert.rejects(designateConnectedPaperMaster(loadEnvironment({}), 'synthetic-customer', {
    promote: async () => { throw new Error('DATABASE_UNAVAILABLE'); },
  }, async () => verified), /DATABASE_UNAVAILABLE/);
});

test('master account cannot activate follower setup', () => {
  const master: FollowerRecord = {
    customerId: 'synthetic-customer', followerAccountId: 'synthetic-connection',
    accountRole: 'MASTER_THETA_PAPER', maskedAccount: 'masked',
    connectionMethod: 'PAPER_API_KEY_PRIVATE_BETA', accountStatus: 'ACTIVE',
    equity: 10000, cash: 10000, buyingPower: 10000, optionsBuyingPower: 10000,
    optionsApprovedLevel: 1, optionsTradingLevel: 1, accountReady: true,
    connectionStatus: 'CONNECTED', lastBrokerSyncAt: null, openPositionCount: 0,
    openOrderCount: 0, marketIsOpen: false, participation: 'BLOCKED', allocationUsd: null,
  };
  const result = paperCopyReadiness({}, master, true);
  assert.equal(result.activation_allowed, false);
  assert.match(result.reason, /cannot copy itself/);
});

test('master candidate resolution requires one authenticated connected customer', () => {
  assert.equal(resolveAuthenticatedMasterCandidate(['customer-a', 'customer-a']), 'customer-a');
  assert.throws(() => resolveAuthenticatedMasterCandidate([]), /NOT_FOUND/);
  assert.throws(() => resolveAuthenticatedMasterCandidate(['customer-a', 'customer-b']), /AMBIGUOUS/);
});
