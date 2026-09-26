import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAssignmentLabel } from '../src/research/assignment-label-builder.js';

const CUTOFF = '2026-09-25T21:00:00Z';

test('CORE CLAIM: a definitively closed, unassigned position is a FACTUAL negative, not censored', () => {
  const result = buildAssignmentLabel({
    positionEpisodeId: 'p1', legRole: 'Q_SHORT_PUT', assignmentNoticeAt: null, assignmentWasAtExpiration: null,
    reachedTerminalLifecycleState: true, observationCutoffAt: CUTOFF, longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'NO_ASSIGNMENT');
});

test('CORE CLAIM: an open position with unresolved assignment risk at cutoff is RIGHT_CENSORED, never NO_ASSIGNMENT', () => {
  const result = buildAssignmentLabel({
    positionEpisodeId: 'p2', legRole: 'Q_SHORT_PUT', assignmentNoticeAt: null, assignmentWasAtExpiration: null,
    reachedTerminalLifecycleState: false, observationCutoffAt: CUTOFF, longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'RIGHT_CENSORED');
});

test('an assignment at expiration is labeled EXPIRATION_ASSIGNMENT', () => {
  const result = buildAssignmentLabel({
    positionEpisodeId: 'p3', legRole: 'Q_SHORT_PUT', assignmentNoticeAt: CUTOFF, assignmentWasAtExpiration: true,
    reachedTerminalLifecycleState: true, observationCutoffAt: CUTOFF, longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'EXPIRATION_ASSIGNMENT');
});

test('an early assignment is labeled EARLY_ASSIGNMENT', () => {
  const result = buildAssignmentLabel({
    positionEpisodeId: 'p4', legRole: 'CC_SHORT_CALL', assignmentNoticeAt: CUTOFF, assignmentWasAtExpiration: false,
    reachedTerminalLifecycleState: true, observationCutoffAt: CUTOFF, longProtectionStillOpen: null,
  });
  assert.equal(result.label, 'EARLY_ASSIGNMENT');
});

test('D short-leg assignment with long protection remaining is tracked distinctly from Q', () => {
  const result = buildAssignmentLabel({
    positionEpisodeId: 'p5', legRole: 'D_SHORT_LEG_WITH_LONG_PROTECTION', assignmentNoticeAt: CUTOFF, assignmentWasAtExpiration: false,
    reachedTerminalLifecycleState: true, observationCutoffAt: CUTOFF, longProtectionStillOpen: true,
  });
  assert.equal(result.longProtectionRemainingAtAssignment, true);
});
