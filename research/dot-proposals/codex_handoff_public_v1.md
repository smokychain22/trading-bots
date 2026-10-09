# V4 source compatibility handoff

Frozen audit: 34b630e5814ce179cf958a0e3d70f5ee28da71b3, observed 2026-10-08 19:08 UTC. Later drift is unreviewed.

Keep the existing dot-h-dte3-5-v1 proposal bytes, version and hashes. Audited changes do not require a semantic rebase. Refresh integration evidence for any newer merge; historical synthetic and CI results retain their original source boundaries. No tests were rerun by this audit.

Reuse src/lab/canonical-proposal-consumer.ts for Q/A/C research rather than building another consumer. The private PROPOSER endpoint is POST /v1/research/canonical. It requires an integrity-checked sealed T0 replay, exact baseline/version/hash and qualified PIT evidence; A/C additionally needs matching qualified account/snapshot-bound stock inventory with known committedShortCallContracts. H/D explicitly remain on evaluateDotShadowProposal. Filtering retains canonical economics/ranks/quantities and cannot invent a new selector; recovery lattice must match exactly. Q remains 25–60 DTE and D 7–60. Planned holding days and profit-taking challengers are not consumed by the entry consumers.

Canonical normalized DTE uses Math.round((expirationDate - asOfDate) / 86_400_000), with YYYY-MM-DD input dates: src/theta/option-contract.ts lines 211–212 and 261; option-chain-ingestion.ts lines 138–148. It is calendar-date duration, not trading days. Friday-to-Monday dates produce 3, so 3–5 DTE alone does not exclude weekend exposure. The research H generator accepts supplied numeric DTE without independently checking calendar consistency.

The latest source repair normalizes valid PostgreSQL Date values to UTC ISO in management-input-state.ts and invalid dates to null; existing stale-evidence gates remain. Do not infer fresh runtime qualification, deployment, Paper authority or profitability from this source audit.

See compatibility_receipt_public_v1.json for exact source URLs, hashes, comparison boundaries and preserved CI-context distinctions.
