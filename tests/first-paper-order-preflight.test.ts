import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFirstPaperOrderDryRun } from '../src/theta/first-paper-order-preflight.js';
import type { Evidence,FirstPaperOrderReadinessInput } from '../src/theta/first-paper-order-readiness.js';

const now='2026-09-12T14:30:00.000Z';
const good=<T>(value:T,source='TEST'):Evidence<T>=>({state:'GOOD',value,source,asOf:now});
const unknown=<T>():Evidence<T>=>({state:'UNKNOWN',value:null,source:'RESEARCH',asOf:now});
const input=():FirstPaperOrderReadinessInput=>({asOf:now,broker:{role:good('MASTER_THETA_PAPER'),host:good('https://paper-api.alpaca.markets'),
  accountStatus:good('ACTIVE'),identityVerified:good(true),optionsApprovalLevel:good(3),optionsTradingLevel:good(3),
  equity:good(100000),cash:good(100000),buyingPower:good(400000),optionsBuyingPower:good(100000),positionCount:good(0),openOrderCount:good(0)},
  market:{clockOpen:good(true),calendarSessionConfirmed:good(true)},selection:{strategyBranch:good('THETA_CONVENTIONAL'),strategyVersion:good('s1'),
  candidateSetId:good('set-1'),candidateId:good('candidate-1'),symbol:good('AAPL'),occContract:good('AAPL261016P00150000'),optionType:good('PUT'),
  strike:good(150),expiration:good('2026-10-16'),dte:good(34),multiplier:good(100),positionIntent:good('SELL_TO_OPEN'),quantity:good(1),
  quantityDerivation:good('min(capacities)=1'),collateral:good(15000),userAllocation:good(20000),assignmentCapacity:good(true),ownershipQuality:good('ACCEPTABLE'),eventState:good('CLEAR')},
  quote:{bid:good(1.2,'ALPACA'),ask:good(1.3,'ALPACA'),midpoint:good(1.25,'ALPACA'),proposedLimit:good(1.24),pricingPolicy:good('PASSIVE_LIMIT_V1'),
  ageSeconds:good(2),maximumAgeSeconds:10,spreadProtectionPassed:good(true)},economics:{empiricalState:good('EV_MODEL_NOT_EMPIRICALLY_READY'),
  empiricalModelVersion:unknown(),expectedAfterCost:unknown(),downsideTailEvidence:unknown(),returnPerCapitalDay:unknown(),uncertainty:unknown(),
  calibrationCohort:unknown(),promotionEvidence:good('NOT_READY')},aegis:{result:good('ALLOW_FULL'),finalQuantity:good(1)},identity:{fusionSnapshotId:good('fusion-1'),
  fusionSnapshotHash:good('hash-1'),decisionId:good('decision-1'),orderIntentId:good('intent-1'),clientOrderId:good('theta-first-1')},operations:{
  idempotencyReserved:good(true),persistenceDurable:good(true),schedulerHealthy:good(true),reconciliationHealthy:good(true),workerOnline:good(true),
  workerBuildSha:good('sha-1'),marketSession:good('OPEN'),leaseHealthy:good(true),providerHealth:good('GOOD'),executionBoundary:good('LOCKED_BEFORE_FIRST_POST'),
  workerMode:'LOCAL_LAPTOP',ownerAuthorization:'NOT_GRANTED'}});

test('dry run constructs the exact limit request without any broker network capability',()=>{
  const result=buildFirstPaperOrderDryRun(input());
  assert.equal(result.receipt.readyForFirstPaperOrder,'NO');
  assert.equal(result.networkSubmission,'NOT_ATTEMPTED');
  assert.equal(result.executionAuthorized,false);
  assert.deepEqual(result.request,{symbol:'AAPL261016P00150000',qty:1,side:'sell',type:'limit',time_in_force:'day',
    limit_price:'1.24',client_order_id:'theta-first-1',position_intent:'sell_to_open'});
  assert.match(result.requestPayloadHash??'',/^[0-9a-f]{64}$/);
  assert.ok(result.receipt.blockers.includes('EXPECTED_AFTER_COST_UNKNOWN'));
});
