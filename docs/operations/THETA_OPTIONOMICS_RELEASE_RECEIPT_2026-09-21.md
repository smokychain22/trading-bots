# Optionomics Vega data-plane release boundary, 2026-09-21

This is a source and isolated Production-environment qualification receipt. It is not a worker-cutover or first-order authorization receipt.

| Boundary | Observed state |
|---|---|
| Canonical main at qualification | `f452299a8dea6b8e1de593fb55cb32ecc9f647bd` |
| Isolated source branch | `codex/optionomics-vega-data-plane` |
| Tested code SHA | `d2d989e7c6f3af716497076c7a89e9aa24bb4e15` |
| Final isolated deployment | `dpl_DyN4wAusCHH4ke27xW2qHkDZrNoV`, READY, Production environment, canonical domain unassigned |
| Canonical public-domain deployment | `dpl_E8hsgkgropZWfPy1UhEZQtxT9mmP`, unchanged at qualification |
| Existing worker | `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a`, ONLINE, `MASTER_THETA_PAPER`, ACTIVE execution gate, not restarted |
| Follower execution | Locked |
| Live money | Forbidden |

Migration `063_optionomics_event_first_observation` was applied to Aiven through the protected database-target operation. The post-migration validation reported 63 applied migrations, migration head 063, 156 tables, zero invalid indexes and zero unvalidated constraints. It checked the schema but did not show a natural positive event being written by the pinned worker.

The final isolated deployment ran the protected read-only Optionomics qualification against the actual Vega account. REST and MCP authenticated. All 18 sampled REST operations returned HTTP 200. Historical SPY options and metrics returned the exact requested `2026-09-18` session. The price-history series included that trading date. Gamma, Vanna and Charm heatmaps each echoed their requested metric. The bounded historical event request echoed its window and complete pagination but returned no events. An empty event result does not establish negative prospective event or earnings coverage. The sanitized immutable capability receipt hash is `3914b5f5bab67ca3077aa498f1448d83b4f76758705e8c5f9a15cc19c51c4f7e`.

Verified code checks for `d2d989e` were green in [CI run 35606536572](https://github.com/smokychain22/trading-bots/actions/runs/35606536572), including Node, Python, TypeScript, lint, build, security, browser, disposable PostgreSQL migration/invariants and persistence integration. The later changes through this receipt are documentation-only. A local check after the probe passed 1,398 Node tests with 11 skips, 564 Python tests plus five subtests, 23 browser tests, typecheck, lint, build and security scan with zero findings.

Release decision: do not restart the worker or promote the branch to canonical Production yet. The positive event producer has no natural runtime observation, bounded negative event/earnings coverage remains unproven, Alpaca corporate-action negative coverage is separate and unresolved, and no real Claude research exports were generated. These gaps leave the safety-critical entry UNKNOWNs open. The provider and database probes submitted no broker order. Master, follower and live order counts were not queried in this qualification and are intentionally not asserted here.

Next work: validate a naturally observed positive event revision end to end, establish explicit event-family and earnings coverage, finish the Alpaca corporate-action producer, build governed historical backfill and authority-typed PIT exports, then run a release/no-submit canary before deciding on canonical deployment and worker cutover.
