# Explicit option intent safety correction

OWNER: Codex

TASK: Correct the first-order readiness prerequisite introduced in migration 012.

FILES CHANGED: migration 013, PostgreSQL order store, database verifier, focused TypeScript and SQL regression tests, this handoff.

WHAT WAS IMPLEMENTED: PostgreSQL CHECK constraints accept NULL results. Migration 012 therefore did not require an option intent in practice. Migration 013 explicitly rejects NULL option intent and contradictory side/intent pairs, without guessing historical intent. Stock orders retain NULL option intent. The store now validates persisted intent before decoding or insertion and records SELL_STOCK as STOCK rather than OPTION.

TESTS RUN: lint, type check, full Node suite, production build, security scan, diff whitespace check.

TEST RESULTS: 440 passed, 1 database-dependent test skipped, 0 failed in the initial full local run. Two additional storage boundary tests then passed with lint and type checks. Build and static checks passed. Security scan reported zero findings. CI run 34603283752 passed, including browser, Python, all PostgreSQL migrations/invariants, and customer persistence tests.

KNOWN LIMITATIONS: This correction does not start a scheduler, reconcile broker activity, or complete decision persistence. No provider credentials were used and no orders were submitted for this milestone.

PRODUCTION VERIFICATION: Neon had zero order intents before migration. Migration 013 applied successfully, and the canonical verifier confirmed 13 migrations, one MASTER_THETA_PAPER role, self-copy protection, optional follower limits, explicit intent enforcement, locked execution, and zero recorded broker orders. This is database evidence, not a fresh broker-account/order-count reconciliation.

RISKS: Existing ambiguous intent rows deliberately prevent migration rather than being silently backfilled. Check production rows before migration. Newly supplied credentials in an attachment are exposed and must be rotated by the owner before their use. Do not print or reuse them.

WHAT THE OTHER AGENT SHOULD REVIEW: NULL truth semantics, side consistency, stock serialization, and preservation of all four option intents. Strategy methodology is unchanged.

NEXT RECOMMENDED TASK: Continue canonical decision persistence and durable reconciliation/scheduling. Keep first-order readiness NO until real runtime evidence satisfies every gate.

Reticle was skipped because this backend-only correction has no UI surface.
