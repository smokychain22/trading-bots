import { MutationFenceLostError, type MutationFence } from './paper-order-coordinator.js';

/**
 * Broker mutations are allowed only in the early part of a runtime request. The Windows supervisor stops waiting for a request after
 * 180 s while the platform lets the invocation run to 300 s, and the next cycle (a new minute bucket) can start meanwhile. A
 * mutation begun after this window could belong to an invocation the supervisor has already abandoned.
 */
export const requestMutationWindowMs = 150_000;

export function requestWindowFence(startedAtMs: number, nowMs: () => number = Date.now, windowMs: number = requestMutationWindowMs): MutationFence {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(windowMs) || windowMs <= 0) throw new Error('MUTATION_WINDOW_POLICY_INVALID');
  return async () => {
    const elapsed = nowMs() - startedAtMs;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > windowMs) throw new MutationFenceLostError('REQUEST_MUTATION_WINDOW_EXPIRED');
  };
}

/** Runs every fence in order; the first refusal wins and later fences are not consulted. */
export function allFences(...fences: readonly MutationFence[]): MutationFence {
  return async (operation, orderIntentId) => {
    for (const fence of fences) await fence(operation, orderIntentId);
  };
}
