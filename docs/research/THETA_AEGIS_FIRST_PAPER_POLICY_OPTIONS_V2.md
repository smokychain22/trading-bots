# THETA AEGIS first-Paper policy options, v2

Status: Wave 4 item 5. Supersedes the framing (not the underlying producer
finding) of `THETA_AEGIS_FIRST_PAPER_POLICY_GAP.md` (built in an earlier
pass), which correctly identified the producer gap but, per this wave's
direct code trace, understated its severity (it framed the gap as "the
SYSTEM family stays unevaluated," when the real consequence is "AEGIS
unconditionally returns `HOLD_ONLY` for all new risk the moment a candidate
reaches it, via TWO independent families"). **Claude does not decide
Production policy. This document hands three real, scientifically coherent
options to Codex/owner -- it selects none of them.**

## The real problem, precisely stated

`stressIvShockDetected`/`stressSpreadWideningDetected` are always `null` in
Production. This forces `_liquidity()` and `_system()` (two SEPARATE AEGIS
risk families) to `HOLD_ONLY`, and `assess_aegis()`'s worst-family-wins fold
means `new_risk_state` would be `HOLD_ONLY` or worse for any candidate that
reaches AEGIS evaluation, permitting zero new-risk-opening actions
unconditionally. Real historical evidence exists (3,876/4,590/139 rows
across 3 known sessions) but has NOT been proven sufficient for a real
baseline, per `THETA_AEGIS_STRESS_BASELINE_MATURITY.md`.

## Option A: Keep both signals hard-required, pre-warm real baselines before Paper unlock

**Design**: Build real IV-shock (Optionomics IV history) and
spread-widening (Alpaca BBO history) detectors. Do not unlock Paper for
THETA_CONVENTIONAL until both reach `DETECTOR_READY` per a governed
`BaselineSufficiencyPolicy`.

| Dimension | Analysis |
| --- | --- |
| Safety consequence | Maximal -- no new risk is ever taken without both real stress signals genuinely evaluated. Matches the SYSTEM family's own original design intent most closely. |
| False-safe risk | None -- this option never converts `UNKNOWN` to a permissive value. |
| False-block risk | Real and potentially prolonged -- if baseline accumulation takes weeks (a real span-based requirement, not merely a raw-count one), first Paper is delayed by exactly that long, for a strategy (THETA_CONVENTIONAL) whose other required capabilities are otherwise close to real. |
| Required evidence | A real, governed `BaselineSufficiencyPolicy` (thresholds TBD by Codex/owner) plus two real detector implementations. |
| Cold-start behavior | `BASELINE_NOT_STARTED`/`BASELINE_ACCUMULATING` correctly blocks throughout accumulation -- honest, never fake. |
| Runtime semantics | No AEGIS code change required -- the current fail-closed behavior is already correct FOR this option; only the upstream detector needs building. |
| Paper suitability | Delays first Paper by the real time needed to accumulate a governed-sufficient baseline. |
| Future R8 migration path | Cleanest -- the eventual real detector becomes the permanent Production producer with no policy carve-out to later revisit. |

## Option B: Execution-quality/liquidity remain hard-required; historical stress detector becomes `REQUIRED_WHEN_BASELINE_MATURE`, explicitly `NOT_APPLICABLE` during a governed cold-start

**Design**: Introduce a new, EXPLICIT AEGIS input state distinct from the
current binary `null`/real: during a governed cold-start window (defined by
the SAME `BaselineSufficiencyPolicy` from Option A), the SYSTEM/LIQUIDITY
families would treat `stressIvShockDetected`/`stressSpreadWideningDetected`
as `NOT_APPLICABLE` (not "unknown," a real, resolved "does not apply during
governed cold-start" state) rather than folding them into the strictest-wins
comparison as `HOLD_ONLY`-forcing `None`. All OTHER hard-required-safety
gates (execution quality, per-trade liquidity, `stressGapDetected`,
concentration/capacity families) remain fully binding throughout.

| Dimension | Analysis |
| --- | --- |
| Safety consequence | Real risk IS taken during cold-start, gated by every OTHER real hard-required family (which, per this engagement's audit, are themselves real and correctly fail-closed). Not maximal safety, but not the "null becomes false" anti-pattern either -- a real, named, time-boxed governance state. |
| False-safe risk | The central risk of this option: a genuine IV shock or spread-widening event occurring DURING cold-start would not be caught by these two signals specifically (though `stressGapDetected` and every other real family would still apply). This is a REAL tradeoff, not eliminated by clever wording. |
| False-block risk | Eliminated for the cold-start window -- THETA can reach first Paper without waiting for baseline accumulation. |
| Required evidence | The SAME `BaselineSufficiencyPolicy` from Option A (to define exactly when cold-start ends), PLUS an explicit Codex/owner decision that this specific tradeoff (two families' extra protection deferred, all others remain live) is acceptable for THETA_CONVENTIONAL's real, comparatively bounded risk profile (cash-secured single-leg puts, known max loss at zero). |
| Cold-start behavior | Real, named, time-boxed -- never silent, never permanent by default (the moment `BASELINE_SUFFICIENT` is reached, the state machine already built in `aegis-stress-baseline-maturity.ts` naturally transitions out). |
| Runtime semantics | **Requires a real AEGIS code change** (Codex-owned): a new NOT_APPLICABLE-during-cold-start input state distinct from the current binary None/real, which this research branch does NOT build or propose as a patch -- only names as the shape of what would be needed. |
| Paper suitability | Fastest realistic path to first Paper among the three options that doesn't simply disable a real safety signal outright. |
| Future R8 migration path | Requires a real, explicit transition trigger (baseline maturity crossing `BASELINE_SUFFICIENT`) to flip the family back to hard-required -- must not be a one-way "we turned it off once, forgot to turn it back on" gap. |

## Option C: Build normalized cross-sectional/bootstrap stress baselines from existing PIT evidence before first Paper

**Design**: Rather than waiting for a genuine same-contract rolling history
to accumulate over calendar time (Option A's approach), construct a
cross-sectional baseline from the REAL PIT evidence that already exists
(3,876/4,590/139 rows across 3 sessions) using a bootstrap/resampling or
cross-symbol normalization method, explicitly documented as a DIFFERENT,
weaker evidentiary standard than a genuine same-contract rolling history.

| Dimension | Analysis |
| --- | --- |
| Safety consequence | Intermediate -- a real signal is produced, but from a methodologically different (and likely noisier/less temporally-representative) evidence base than Option A's genuine rolling history. |
| False-safe risk | Real and specific to this option: a bootstrap/cross-sectional baseline built from 3 known sessions could systematically misrepresent the TRUE distribution of IV shocks/spread widening if those 3 sessions are not representative (e.g. the 2026-09-21 session's own confirmed degraded/`HTTP_503` conditions could bias a naive bootstrap). This must be explicitly tested for and documented, not assumed away. |
| False-block risk | Lower than Option A (does not require waiting for calendar-time accumulation), but the resulting detector's real reliability is unproven until validated against genuinely held-out future sessions. |
| Required evidence | A real, documented bootstrap/normalization methodology; explicit disclosure that this is NOT the same evidentiary standard as a true rolling baseline; and ideally a real OOS check once enough NEW real sessions accumulate to validate the bootstrap's predictions against them. |
| Cold-start behavior | A real boolean is produced immediately (no calendar-time wait), but its trustworthiness is itself an open empirical question this option does not resolve on day one. |
| Runtime semantics | Requires both a new detector implementation AND an explicit methodology validation step before Codex/owner should trust its output -- more research-engineering work than Option B, less waiting than Option A. |
| Paper suitability | Fastest to a REAL (non-null) boolean, but the boolean's trustworthiness is the least proven of the three options at the moment Paper would unlock. |
| Future R8 migration path | The bootstrap detector should be explicitly designed to be REPLACED by a genuine rolling-history detector (Option A's approach) once enough calendar time has passed -- this is a real methodology debt this option takes on deliberately, not a permanent substitute. |

## Comparison summary (no winner selected)

| | Option A | Option B | Option C |
| --- | --- | --- | --- |
| Requires new AEGIS Production code | No | Yes | Yes (new detector + AEGIS input semantics may also need updating) |
| Delays first Paper | Most (full baseline wait) | Least (cold-start carve-out) | Moderate (bootstrap built quickly, but trust must be earned via later validation) |
| Introduces a real safety tradeoff | No | Yes (explicit, time-boxed) | Yes (methodological, ongoing until validated) |
| Matches original SYSTEM family design intent | Most closely | Partially (via explicit carve-out) | Partially (via a substitute evidentiary standard) |

This research branch does not recommend one of these three. Each is a real,
internally coherent, scientifically honest option with a different
safety/speed tradeoff. The decision belongs to Codex/owner, informed by the
real evidence this and the companion baseline-maturity document provide.
