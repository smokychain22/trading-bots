# THETA Unsafe Pattern Registry

Durability artifact. Registers rejected patterns — generalized architectural
anti-patterns to guard against, not attributed to any specific unverified repository
(see `GITHUB_METHOD_CORPUS.md`'s provenance note). Each is cross-referenced to the
existing rule or guard in this repository that already prohibits it, where one exists.

| Anti-pattern | Why it's rejected | Existing guard in this repo |
|---|---|---|
| Arbitrary single-delta rules | Always trading one fixed delta (e.g. "always 0.20 delta") regardless of context, treating it as a universal law rather than one point in a lattice to be tested against alternatives | `LatticeConfig` enforces ≥2 delta bands at construction (`test_single_delta_band_is_rejected_at_construction`); `BQ-2` benchmark exists specifically as the counterfactual this rejects |
| Self-reported WR as proof | Treating a trader's or repository's own claimed win rate as validated evidence without independent verification or OOS confirmation | `evidence_class_enum`'s `D_EXPERT_DNA` ceiling — no expert entry in this repo is treated as level A/B/C proof; `F_MARKETING` tier exists precisely to flag unverified self-reported claims |
| Marketing profitability claims | A claim framed to sell a product/service/signal rather than to honestly report validated results | Same `F_MARKETING` evidence-class ceiling |
| Opaque uncalibrated scores | A single blended number presented as a decision signal without component transparency or calibration evidence | TRD CAND-003 ("opaque scalar score alone is insufficient"); every score in `theta_q_baseline.py`/`ownership_v0.py` is an explicit, reason-coded, auditable formula |
| Automatic Kelly sizing | Applying a Kelly-criterion-derived size directly from a model's estimated edge without confidence/calibration discounting, risking oversized bets on a miscalibrated edge estimate | `AEGIS_SIZING_EXECUTION_CONTRACT.md` §3 — every size is `min()` of independently versioned caps, never a formula-derived multiplier applied without a hard ceiling |
| Today's chain substituted for historical chain | Backtesting against the current, present-day option chain structure/liquidity as a stand-in for how the chain actually looked historically | `DATASET_AND_LABEL_CONTRACT.md` §3's universe/survivorship discipline; the point-in-time `as_of <= decision_timestamp` invariant |
| Hidden midpoint-fill assumptions | Assuming every backtested order fills at the quoted bid/ask midpoint, inflating apparent edge | Charter non-negotiable rule; `AEGIS_SIZING_EXECUTION_CONTRACT.md` §4's conservative-fill requirement |
| Engineering quality mistaken for strategy evidence | Treating a well-tested, well-architected codebase as evidence that the strategy it implements is itself profitable | `evidence_class_enum`'s explicit `E_ENGINEERING` tier, kept structurally distinct from any evidence of actual edge |

## Discipline

Every anti-pattern above is registered as a **rejection**, not merely a caution — none
of these should appear in any future THETA implementation, and any code review finding
one of these patterns in Codex's or Claude's own work should treat it as a defect, not
a style preference. This registry exists so that judgment isn't re-derived from
scratch at each review.

## Status

Taxonomy only, generalized from patterns rather than specific repositories, per
`GITHUB_METHOD_CORPUS.md`'s provenance note.
