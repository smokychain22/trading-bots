// Vercel runtime requests are bounded at 300 seconds. The Windows evidence
// client times out at 290 seconds. Keep ownership beyond that entire request
// so another host cannot take the master lease while the first is still active.
export const maximumRuntimeRequestDurationMs = 300_000;
export const runtimeRequestLeaseDurationMs = 360_000;

export function runtimeRequestLeaseExpiresAt(startedAt: Date): string {
  if (!Number.isFinite(startedAt.getTime())) throw new Error('RUNTIME_LEASE_START_INVALID');
  return new Date(startedAt.getTime() + runtimeRequestLeaseDurationMs).toISOString();
}
