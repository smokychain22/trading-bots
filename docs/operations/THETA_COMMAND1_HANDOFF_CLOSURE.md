# THETA Command 1 Handoff Closure

Status: source verified. Runtime release proof remains separate from source completion.

## THETA-BRAIN-L7-CALLER-GAP

CLOSED. `profitability-brain-evidence-manifest.ts` is the canonical evidence-population boundary. L7 requires immutable evidence tied to the exact canonical and worker SHAs. L8 requires a linked dataset hash and out-of-sample receipt. L9 additionally requires a linked Paper approval receipt. Broken linkage or a source/worker mismatch leaves the method at L6. `theta-profitability-brain-reality.ts` loads only an explicitly named manifest and never infers proof from files or environment flags.

## THETA-MGMT-REDEPLOY-DEAD-ACTION

CLOSED / INTENTIONAL. REDEPLOY is a broker-confirmed lifecycle marker, not an executable management order. `PostgresLifecycleApplicationStore` closes or expires the old option leg, finalizes its realized economics, and transitions the chain to REDEPLOY. `runtime-state.ts` then permits REDEPLOY to return to WAIT for a fresh new-risk cycle. `management-paper-plan-assembly.ts` blocks REDEPLOY inside an unresolved management cycle so it cannot bypass close confirmation, accounting, reconciliation, or fresh candidate evaluation.

## THETA-AEGIS-COMPOUND-STRESS-UNVERSIONED

CLOSED. The unchanged threshold of 2 is now `aegis.compoundStressHoldCount` in the versioned Paper-bootstrap policy. The Python risk authority reads the caller-supplied value. The response carries the value and a canonical policy-configuration hash. The setting is classified as HARD_SAFETY under PAPER_BOOTSTRAP_ENGINEERING and BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL.

## THETA-OPPFRONTIER-CAPABILITY-ORPHANED

CLOSED. `selection-authority-boundary.ts` records the active `STRUCTURAL_SAFE_FALLBACK`, non-authoritative `EMPIRICAL_SHADOW`, and unavailable `EMPIRICAL_PROMOTED` modes. The canonical decision authority remains sovereign. Research opportunity-frontier evidence cannot select a candidate, action, quantity, or broker mutation. Even a complete promotion-review package cannot activate a second selector in this release. A future activation requires a separate reviewed Production change and owner authorization.

## Safety result

- Production selection behavior is unchanged.
- The compound-stress numeric threshold is unchanged.
- Pipeline B remains quarantined.
- ORDER_SUBMISSIONS remains 0.
- BROKER_MUTATIONS remains 0.
- Followers remain locked.
- Live money remains unauthorized.
