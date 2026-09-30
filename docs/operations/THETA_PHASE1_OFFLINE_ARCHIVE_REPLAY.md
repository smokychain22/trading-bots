# Phase 1 complete-cycle offline replay

The persisted `trade.fusion_snapshot.evidence_archive_gzip` is the complete
cycle evidence tier. It includes the exact canonical frontier input and the
historical frontier. The optional SQLite `T0_REPLAY_BUNDLE` has a 4 MiB raw
payload limit and cannot represent the September 29, 2026 SPY T0, which is
about 36.7 MiB before archive packing. Keep that local-spool limit intact.

When Aiven read-only access is healthy, capture a specific historical cycle:

```powershell
node --import tsx tools/theta-capture-cycle-archive.ts --cycle-id=<fusion_snapshot_id>
```

Capture uses one PostgreSQL client in a read-only transaction. It verifies the
decoded archive against the stored `evidence_archive_hash`, writes a
content-addressed binary and manifest under ignored
`.theta-local-worker/replay-corpus`, and never calls a broker mutation surface.
If database DNS or admission fails, keep the error typed. Do not replace it
with an empty replay or strategy WAIT.

Replay the saved manifest offline, with no database or provider connection:

```powershell
node --import tsx tools/theta-replay-cycle-archive.ts --manifest=<manifest.json>
```

For a historical same-source replay, use the preserved, clean immutable release
at `.theta-local-worker/releases/<original-source-sha>`:

```powershell
node --import tsx tools/theta-replay-cycle-archive.ts --historical --manifest=<manifest.json>
```

`SAME_SOURCE_REPRODUCED` requires a clean immutable original release and a
matching full frontier hash. `SAME_SOURCE_MISMATCH` is a replay defect. The
current-policy command requires a clean current checkout. When the source SHA
differs, `CROSS_SOURCE_SAME_RESULT` and `CROSS_SOURCE_CHANGED_RESULT` are
counterfactual classifications. They do not rewrite the historical action or
prove that the current release ran in the old session. The report includes
action, candidate identity, both hashes, and source identities. Missing T0,
missing frontier, altered bytes, and altered decoded content fail closed.
The receipt also projects the archived method-input provenance through the
existing real-input filter. `realInputEligibleMethodIds` means those executed
methods had real decisive inputs in that historical cycle. It does not grant
current-worker L7. A missing legacy provenance array remains
`MISSING_LEGACY` with no eligible methods. Duplicate, malformed or
contradictory `REAL` provenance fails closed.

The first September 30 read-only capture failed with Aiven DNS `EAI_AGAIN`.
After DNS recovered, the exact September 29 archive was captured with its
stored database hash verified. The original source
`aa1798621037462862d121883c85626d135d8a7d` replayed all 2,601 contracts
from the complete archive, without provider fetch or broker mutation. Its
frontier hash reproduced exactly as
`52e5ed441da1eae7cff69fc26232c12bea729f5b8ebf461ddaca16d92bcdf57a`.
The historical action was `GLOBAL_WAIT`. This is foundation replay evidence,
not proof that the current release produced that historical decision. Phase 7
separately owns current-release supported-session proof.

The verified archived provenance has six executed methods. Only
`AEGIS_RISK_PERMISSION` and `CONSTRAINED_QUANTITY_SIZING` qualify as real-input
methods. `CURRENT_DECISION_STATE` and `STRATEGY_APPLICABILITY_ROUTER` were
manual-input, while `CONVENTIONAL_CANDIDATE_ENUMERATION` and
`CANONICAL_ENTRY_SELECTION` were partial-real. Hold-Strike and Defined Risk
enumeration did not execute in this cycle. None of those historical method
labels are promoted to current-release L7 or empirical profitability.
