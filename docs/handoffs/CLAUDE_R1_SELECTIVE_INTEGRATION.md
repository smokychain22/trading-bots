# Claude R1 selective integration

OWNER: Codex

TASK: Review each commit on `claude/theta-r1-real-state` independently and port only work that is compatible with canonical production behavior.

FILES CHANGED: Temporal-consistency policy and tests, THETA shadow-cycle observation timing, AEGIS derivation and tests, this handoff.

WHAT WAS IMPLEMENTED:

- `2c97fde` was accepted and ported as `3955f14`. The versioned new-risk and management temporal-consistency policy now checks per-class freshness and cross-observation skew. The integration preserves one canonical decision timestamp while recording each provider read time separately.
- `636f688` was accepted and ported as `28bdff3`, then corrected. AEGIS receives more real derived inputs, but an empty capability set can never become `OK`, and missing quote evidence can never become an observed execution failure.
- `de0be4a` was rejected as superseded. Canonical main already has a stricter seven-day clock/calendar session confirmation path.
- `c67f7f8` was rejected. It relies on unverified corporate-action request and response assumptions, which conflicts with the documented-operation-only provider rule.
- `4fc13cd` and `98eedfb` were rejected pending explicit position-intent wiring. Inferring risk-opening sells from unmatched positions is unsafe for collateral and assignment-capacity calculations.
- `971aaa9` was not integrated. The isolated Cboe research layer is outside the current execution-readiness slice and has no demonstrated missing runtime field.
- `9e07688` and `d6b73cf` were rejected. The premium-to-collateral calculation omits the premium contract multiplier, and the routing rule selects by a raw proxy instead of after-cost expectancy, inventory risk, and assignment capacity.

TESTS RUN: Targeted temporal-consistency, shadow-cycle, and AEGIS derivation tests, followed by the repository type, lint, test, build, security, and browser checks.

TEST RESULTS: See the integration commit and CI run. No Paper or live order path was invoked.

KNOWN LIMITATIONS: Explicit option position intents, pending-capital reservations, and assignment-capacity integration remain incomplete. The rejected Claude work can be reconsidered after those prerequisites exist.

RISKS: Temporal observation timestamps are local request timestamps because Alpaca account, position, and order responses do not provide a common exchange observation timestamp. The policy therefore detects slow local acquisition and cross-read skew, but cannot manufacture provider timestamps that do not exist.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should validate the corrected multiplier treatment and provide explicit intent-aware pending-capital inputs before proposing the collateral work again.

NEXT RECOMMENDED TASK: Complete durable decision/FusionSnapshot persistence and explicit option intents before adding pending-order capital or assignment-capacity calculations.
