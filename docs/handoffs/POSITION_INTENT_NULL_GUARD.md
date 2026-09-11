# Explicit option intent safety correction

OWNER: Codex

TASK: Correct the first-order readiness prerequisite introduced in migration 012.

FILES CHANGED: migration 013, PostgreSQL order store, database verifier, focused TypeScript and SQL regression tests, this handoff.

WHAT WAS IMPLEMENTED: PostgreSQL CHECK constraints accept NULL results. Migration 012 therefore did not require an option intent in practice. Migration 013 explicitly rejects NULL option intent and contradictory side/intent pairs, without guessing historical intent. Stock orders retain NULL option intent. The store now validates persisted intent before decoding or insertion and records SELL_STOCK as STOCK rather than OPTION.

TESTS RUN: lint, type check, full Node suite, production build, security scan, diff whitespace check.

TEST RESULTS: 440 passed, 1 database-dependent test skipped, 0 failed. Build and static checks passed. Security scan reported zero findings. PostgreSQL regression execution is pending CI because the local Docker Linux engine is unavailable.

KNOWN LIMITATIONS: This correction does not start a scheduler, reconcile broker activity, or complete decision persistence. Production migration 013 has not been applied at the time of this commit. No provider credentials were used and no orders were submitted for this milestone.

RISKS: Existing ambiguous intent rows deliberately prevent migration rather than being silently backfilled. Check production rows before migration. Newly supplied credentials in an attachment are exposed and must be rotated by the owner before their use. Do not print or reuse them.

WHAT THE OTHER AGENT SHOULD REVIEW: NULL truth semantics, side consistency, stock serialization, and preservation of all four option intents. Strategy methodology is unchanged.

NEXT RECOMMENDED TASK: Verify disposable PostgreSQL CI, apply migration 013 after a clean preflight, then continue canonical decision persistence and durable reconciliation/scheduling. Keep first-order readiness NO until real runtime evidence satisfies every gate.

Reticle was skipped because this backend-only correction has no UI surface.
