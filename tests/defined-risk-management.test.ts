import assert from 'node:assert/strict';
import test from 'node:test';
import { assessDefinedRiskManagement, type DefinedRiskManagementInput } from '../src/execution/defined-risk-management.js';
import { buildDefinedRiskCloseCommand } from '../src/execution/defined-risk-close-command.js';
import type { DurableMultiLegOrderEvidence } from '../src/execution/paper-order-coordinator.js';

const NOW = '2026-10-15T15:00:00.000Z';
const SHORT = 'SPY261016P00650000', LONG = 'SPY261016P00645000';
const quote = (symbol: string, bid: number | null, ask: number | null, observedAt: string | null = NOW) => ({ symbol, bid, ask, observedAt });
const hedged = { shortOpen: 1, longOpen: 1, nakedShortContracts: 0, excessLongContracts: 0, hedgedSpreads: 1 };
const base: DefinedRiskManagementInput = { orderIntentId: 'open-1', chainId: 'chain-1', state: 'OPEN', exposure: hedged, shortSymbol: SHORT, longSymbol: LONG, shortStrike: 650, longStrike: 645,
  observedAt: NOW, brokerOpenContracts: { short: 1, long: 1 }, shortQuote: quote(SHORT, 1.9, 2.0), longQuote: quote(LONG, 0.8, 0.9), quoteFeed: 'INDICATIVE',
  spot: 670, dte: 10, marketOpen: true,
  closeOrderWorking: false, context: { eventState: 'CLEAR', aegisState: 'ALLOW_FULL', executionQuality: 'GOOD' }, pinBandPct: 0.002, maximumQuoteAgeSeconds: 30 };

test('a healthy hedged spread far from expiry is HELD with a persisted review deadline and no invented profit/loss rule', () => {
  const decision = assessDefinedRiskManagement(base);
  assert.equal(decision.action, 'HOLD');
  assert.deepEqual(decision.reasons, ['NO_D_SAFETY_TRIGGER']);
  assert.equal(decision.closeRequired, false);
  assert.ok(Date.parse(decision.reviewDeadline) > Date.parse(NOW) && Date.parse(decision.reviewDeadline) <= Date.parse(NOW) + 15 * 60_000);
  assert.match(decision.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(assessDefinedRiskManagement(base).contentHash, decision.contentHash, 'deterministic');
});

test('every safety trigger closes BOTH legs as one package for the exact hedged quantity', () => {
  const near = { ...base, dte: 1 };
  for (const [name, input] of Object.entries({
    expiry: near, event: { ...base, context: { ...base.context, eventState: 'PRESENT' as const } },
    aegis: { ...base, context: { ...base.context, aegisState: 'EMERGENCY_EXIT_ONLY' } }, liquidity: { ...base, context: { ...base.context, executionQuality: 'DEGRADED' as const } },
    pin: { ...base, dte: 1, spot: 650.4 }, itm: { ...base, dte: 1, spot: 647 },
  })) {
    const decision = assessDefinedRiskManagement({ ...input, exposure: { ...hedged, shortOpen: 3, longOpen: 3, hedgedSpreads: 3 }, brokerOpenContracts: { short: 3, long: 3 } });
    assert.equal(decision.action, 'CLOSE_FULL', name);
    assert.equal(decision.closeQuantity, 3, name);
    assert.equal(decision.closeRequired, true, name);
  }
});

test('a required close with a stale / missing / crossed / wrong-symbol leg quote is NOT executed and never prices from one leg', () => {
  const stale = quote(LONG, 0.8, 0.9, '2026-10-15T14:58:00.000Z');
  for (const [name, patch] of Object.entries({ stale: { longQuote: stale }, missingLeg: { longQuote: null }, crossed: { shortQuote: quote(SHORT, 2.1, 2.0) },
    nullBid: { shortQuote: quote(SHORT, null, 2.0) }, wrongSymbol: { longQuote: quote('SPY261016P00600000', 0.8, 0.9) } })) {
    const decision = assessDefinedRiskManagement({ ...base, dte: 1, ...patch });
    assert.equal(decision.action, 'HOLD', name);
    assert.equal(decision.closeRequired, true, name);
    assert.equal(decision.quotesExecutable, false, name);
    assert.ok(decision.reasons.includes('CLOSE_REQUIRED_QUOTES_NOT_EXECUTABLE'), name);
    assert.equal(decision.escalate, true, `${name}: a required close that can not execute at DTE<=1 is escalated`);
  }
});

test('broker leg truth wins: unknown broker legs are UNKNOWN (wait), a missing hedge is an unhedged-short emergency, never normal state', () => {
  const unknown = assessDefinedRiskManagement({ ...base, brokerOpenContracts: { short: null, long: 1 } });
  assert.equal(unknown.action, 'WAIT_FOR_BROKER_TRUTH');
  assert.deepEqual(unknown.reasons, ['BROKER_LEG_QUANTITY_UNKNOWN']);
  const hedgeGone = assessDefinedRiskManagement({ ...base, brokerOpenContracts: { short: 1, long: 0 } });
  assert.equal(hedgeGone.action, 'EMERGENCY_UNHEDGED_SHORT');
  assert.equal(hedgeGone.escalate, true);
  assert.equal(hedgeGone.closeQuantity, 0, 'an emergency never auto-submits a spread close');
  const shortGone = assessDefinedRiskManagement({ ...base, brokerOpenContracts: { short: 0, long: 1 } });
  assert.equal(shortGone.action, 'WAIT_FOR_BROKER_TRUTH');
  assert.equal(shortGone.escalate, true);
});

test('state gating: terminal does nothing, pending open waits, a close in flight is never doubled, asymmetric is held loudly, emergency states escalate', () => {
  assert.equal(assessDefinedRiskManagement({ ...base, state: 'CLOSED' }).action, 'NO_ACTION_TERMINAL');
  assert.equal(assessDefinedRiskManagement({ ...base, state: 'PENDING_OPEN' }).action, 'WAIT_FOR_BROKER_TRUTH');
  const inFlight = assessDefinedRiskManagement({ ...base, dte: 1, state: 'CLOSE_PENDING', closeOrderWorking: true });
  assert.equal(inFlight.action, 'HOLD');
  assert.deepEqual(inFlight.reasons, ['CLOSE_ORDER_IN_FLIGHT']);
  const asymmetric = assessDefinedRiskManagement({ ...base, state: 'ASYMMETRIC_OPEN', exposure: { ...hedged, shortOpen: 0, longOpen: 1, excessLongContracts: 1, hedgedSpreads: 0 }, brokerOpenContracts: { short: 0, long: 1 } });
  assert.equal(asymmetric.action, 'HOLD');
  assert.equal(asymmetric.escalate, true);
  const naked = assessDefinedRiskManagement({ ...base, state: 'DIVERGED_EMERGENCY', exposure: { ...hedged, longOpen: 0, nakedShortContracts: 1, hedgedSpreads: 0 }, brokerOpenContracts: { short: 1, long: 0 } });
  assert.equal(naked.action, 'EMERGENCY_UNHEDGED_SHORT');
  const shortStock = assessDefinedRiskManagement({ ...base, state: 'DIVERGED_EMERGENCY', exposure: { shortOpen: 0, longOpen: 0, nakedShortContracts: 0, excessLongContracts: 0, hedgedSpreads: 0 }, brokerOpenContracts: { short: 0, long: 0 } });
  assert.equal(shortStock.action, 'EMERGENCY_UNRESOLVABLE');
});

test('unknown spot or DTE close to expiry is UNKNOWN + escalated, never a quiet HOLD that looks healthy', () => {
  const noSpot = assessDefinedRiskManagement({ ...base, spot: null, dte: 1 });
  assert.equal(noSpot.expiryState, 'UNKNOWN');
  assert.equal(noSpot.action, 'HOLD');
  assert.equal(noSpot.escalate, true);
  assert.ok(noSpot.reasons.includes('EXPIRY_STATE_UNKNOWN_NEAR_EXPIRY'));
  assert.equal(assessDefinedRiskManagement({ ...base, dte: null }).escalate, true);
});

const evidence: DurableMultiLegOrderEvidence = { orderClass: 'mleg', creditDebitDirection: 'CREDIT', packageIdentity: 'MLEG:open', legs: [
  { legIndex: 1, optionContractId: 'c-short', providerContractId: 'p-short', occSymbol: SHORT, optionType: 'PUT', positionIntent: 'sell_to_open', ratioQuantity: 1, expiration: '2026-10-16', strike: 650, multiplier: 100, deliverableIdentity: 'STANDARD:SPY:100' },
  { legIndex: 2, optionContractId: 'c-long', providerContractId: 'p-long', occSymbol: LONG, optionType: 'PUT', positionIntent: 'buy_to_open', ratioQuantity: 1, expiration: '2026-10-16', strike: 645, multiplier: 100, deliverableIdentity: 'STANDARD:SPY:100' }] };
const closeDecision = assessDefinedRiskManagement({ ...base, dte: 1 });
const closeInput = { openIntentId: 'open-1', openEvidence: evidence, chainId: 'chain-1', underlyingId: 'u-1', executionAccountId: 'acct-1', decisionId: 'decision-1', decision: closeDecision,
  shortQuote: { symbol: SHORT, bid: 1.9, ask: 2.0, observedAt: NOW }, longQuote: { symbol: LONG, bid: 0.8, ask: 0.9, observedAt: NOW }, now: NOW,
  decisionExpiresAt: '2026-10-15T15:01:00.000Z', maximumQuoteAgeSeconds: 30, attempt: 1,
  quoteFeed: 'INDICATIVE' as const, accountVerified: true, optionsCapabilityVerified: true, aegisState: 'ALLOW_FULL' as const };

test('close command: one native mleg package, buy_to_close short + sell_to_close long, marketable POSITIVE debit rounded up, identities from the durable open legs', () => {
  const command = buildDefinedRiskCloseCommand(closeInput);
  assert.equal(command.action, 'CLOSE_DEFINED_RISK');
  assert.equal(command.request.order_class, 'mleg');
  assert.equal(command.request.side, 'buy');
  assert.equal(command.request.limit_price, '1.20', 'short ask 2.00 - long bid 0.80');
  assert.deepEqual(command.request.legs?.map((leg) => [leg.symbol, leg.side, leg.position_intent]), [[SHORT, 'buy', 'buy_to_close'], [LONG, 'sell', 'sell_to_close']]);
  assert.deepEqual(command.multiLegEvidence?.legs.map((leg) => [leg.optionContractId, leg.positionIntent]), [['c-short', 'buy_to_close'], ['c-long', 'sell_to_close']]);
  assert.equal(command.multiLegEvidence?.creditDebitDirection, 'DEBIT');
  assert.equal(command.gate.isNewEntry, false);
  assert.equal(command.optionContractId, null);
  assert.equal(command.executionEvidence?.quoteFeed, 'INDICATIVE');
  assert.equal(command.executionEvidence?.quoteSemantics, 'PAPER_INDICATIVE_REFERENCE');
  // deterministic identities: a replay produces the same intent and client order id; a new attempt produces new ones
  assert.equal(buildDefinedRiskCloseCommand(closeInput).orderIntentId, command.orderIntentId);
  assert.equal(buildDefinedRiskCloseCommand(closeInput).request.client_order_id, command.request.client_order_id);
  assert.notEqual(buildDefinedRiskCloseCommand({ ...closeInput, attempt: 2 }).request.client_order_id, command.request.client_order_id);
  // rounding is UP (stays marketable) and capped at the width (never pays more than the spread can be worth)
  assert.equal(buildDefinedRiskCloseCommand({ ...closeInput, shortQuote: { ...closeInput.shortQuote, ask: 2.004 } }).request.limit_price, '1.21');
  assert.equal(buildDefinedRiskCloseCommand({ ...closeInput, shortQuote: { symbol: SHORT, bid: 9.5, ask: 9.9, observedAt: NOW }, longQuote: { symbol: LONG, bid: 0.1, ask: 0.2, observedAt: NOW } }).request.limit_price, '5.00');
});

test('close command refuses: wrong decision, non-executable quotes, wrong leg identity, stale quote, expired window, quantity zero', () => {
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, decision: { ...closeDecision, action: 'HOLD' } }), /MATCHING_CLOSE_DECISION/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, decision: { ...closeDecision, orderIntentId: 'other' } }), /MATCHING_CLOSE_DECISION/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, decision: { ...closeDecision, quotesExecutable: false } }), /QUOTES_NOT_EXECUTABLE/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, decision: { ...closeDecision, closeQuantity: 0 } }), /QUANTITY_INVALID/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, longQuote: { ...closeInput.longQuote, symbol: 'SPY261016P00600000' } }), /IDENTITY_MISMATCH/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, shortQuote: { ...closeInput.shortQuote, observedAt: '2026-10-15T14:00:00.000Z' } }), /QUOTE_NOT_EXECUTABLE/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, decisionExpiresAt: NOW }), /DECISION_EXPIRED/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, openEvidence: { ...evidence, legs: [evidence.legs[1] as never, evidence.legs[0] as never] } }), /STRUCTURE_INVALID/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, quoteFeed: null as never }), /QUOTE_PROVENANCE_UNKNOWN/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, accountVerified: false }), /ACCOUNT_NOT_VERIFIED/);
  assert.throws(() => buildDefinedRiskCloseCommand({ ...closeInput, optionsCapabilityVerified: false }), /OPTIONS_CAPABILITY_NOT_VERIFIED/);
});

test('a required close with unknown feed is persisted as HOLD with provenance failure even when both leg prices are fresh', () => {
  const decision = assessDefinedRiskManagement({ ...base, dte: 1, quoteFeed: null });
  assert.equal(decision.action, 'HOLD');
  assert.equal(decision.closeRequired, true);
  assert.equal(decision.quotesExecutable, false);
  assert.ok(decision.reasons.includes('CLOSE_QUOTE_PROVENANCE_UNKNOWN'));
  assert.equal(decision.closeQuantity, 0);
  assert.equal(decision.escalate, true);
});
