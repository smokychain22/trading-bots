# THETA Optionomics Current/Live Data Semantics Audit

Author: Claude (research/audit lane, `claude/theta-r1-real-state`). Read-only
audit against canonical `origin/main`, inspected via an isolated detached
`git worktree` (never merged into this branch, removed after inspection).
No Production mutation, no broker order, no execution-gate change, no
credential use.

`CURRENT_MAIN_SHA` at audit time: `e2130819c387d8750df0e13d7fbf974d84d2373c`.

## Method

Every claim below traces to one of: (a) code actually present in the
`origin/main` tree at the SHA above (`git show`/file read inside the
worktree), (b) Codex's own dated capability-census documents already
committed to `origin/main` (`docs/research/THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`,
`docs/research/THETA_OPTIONOMICS_DATA_MAP.md`), which record real,
authenticated Production probe results (HTTP status, sampled element counts,
schema fingerprints) -- not this branch's own live sampling, since this
branch has no Optionomics credentials. Where a claim comes only from a unit
test's mocked fixture rather than a real observed response, that distinction
is stated explicitly and never blurred into "observed."

## Key finding, stated precisely (do not generalize)

Current main's hardcoded rejection --
`quoteSemantics: 'SESSION_RECORDED_RESEARCH'`, `executionQuoteAuthority: 'REJECTED'`,
`freshTrustedTwoSidedOptionQuoteReady: false` -- lives in exactly one function,
`proveOptionomicsExecutionQuoteContract` (`src/theta/optionomics-quote-proof.ts`),
whose own return type names `operationAlias: 'OPTION_CHAIN'` explicitly. The
function's only caller path (`optionomics-quote-qualification.ts` ->
`optionomics-quote-qualification-runtime.ts`) only ever calls
`fetchOptionomicsOptionChain` -- never Flow, never MCP, never a webhook. The
qualification report's `blockers` array unconditionally appends
`'PROVIDER_DOCUMENTS_SESSION_INGESTION_NOT_EXECUTION_FEED'` regardless of what
is empirically observed (even a fully fresh, two-sided, sized, timestamped
sample would still be rejected) -- this is a **documentation-based** rejection
of the OPTION_CHAIN operation specifically, not an empirically-derived one and
not a platform-wide one by the code's own scoping.

However, Codex's own prose documentation (`THETA_OPTIONOMICS_DATA_MAP.md`,
`THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`) states the rejection more
broadly in places ("Optionomics session-recorded quotes stay
`SESSION_RECORDED_RESEARCH`", "the provider excludes real-time quote and
execution-feed use") without always naming OPTION_CHAIN specifically. **No
document or code path in `origin/main` records an actual authenticated attempt
to qualify Flow, MCP, or a webhook surface as an execution-quote source** --
the census evidence for those surfaces is about content/schema/reachability,
not about testing them against the same execution-quote proof the OPTION_CHAIN
operation was tested against. This is the real gap this directive asks about:
it is not that Codex wrongly rejected Flow/MCP/webhooks -- it is that **no
surface other than OPTION_CHAIN has actually been run through that proof at
all.**

## Surface matrix

| SURFACE | PLAN/TIER | PROGRAMMATIC? | CURRENT/LIVE? | EXACT CONTRACT? | BID? | ASK? | BID SIZE? | ASK SIZE? | TRADE PRICE? | PROVIDER/EVENT TIMESTAMP? | UPDATE CADENCE? | DOCUMENTED PROVENANCE? | INTELLIGENCE_ELIGIBLE? | ORDER_PRICING_ELIGIBLE? | SEMANTIC CLASS | EVIDENCE | UNKNOWN/BLOCKER |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| REST `/api/v1/stocks/{symbol}/options` (OPTION_CHAIN) | Authenticated (`X-USER-EMAIL`+`X-USER-TOKEN`), tier UNKNOWN (not documented in cited sources) | YES | Ambiguous -- see note below | YES (OCC-equivalent: underlying+expiry+strike+type; exact-match logic in `optionomics-provider.ts`) | YES (field present) | YES (field present) | YES (field present) | YES (field present) | Recorded/theoretical price field present, not a confirmed print | YES (`asOf`/provider timestamp field populated in normalized entries) | `PARTIAL` per Codex's own capability census -- "Current Production cadence by family remains PARTIAL until authenticated headers and observed update rates are recorded" | Provider's own API docs describe session-ingested research data, not a streaming feed (per Codex's repeated citation of `optionomics.ai/docs/api`) | YES (research context) | **NO -- code-enforced, unconditional** | SESSION_RECORDED_RESEARCH | `optionomics-quote-proof.ts`, `optionomics-quote-qualification.ts`, `THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md` (HTTP 200, 12,838-element current SPY chain in one run) | See "current/live ambiguity" note below |
| REST `/flow/aggregates`, `/bullish`, `/bearish`, `/top_calls`, `/top_puts`, `/net` (aggregate flow) | Authenticated, tier UNKNOWN | YES | Current net series populated per census; 8h/24h/48h *historical* windows returned zero points in the same run | NO -- aggregate/bucketed, not per-contract (`NormalizedOptionomicsFlowWindow.netCalls`/`netPuts` typed `readonly unknown[]`, never parsed to individual trades) | NO | NO | NO | NO (no per-print size; aggregate premium/count fields only) | Window/series timestamps only, not a per-event timestamp | UNKNOWN -- not measured | No documented print-level (sweep/block/ISO/aggressor) schema found in the sampled contract per Codex's own census: "No print-level sweep, block, ISO, paid-up or hit-bid schema appeared in the documented flow responses sampled" | PARTIAL (aggregate directional context only; code marks `evidenceClass: 'RESEARCH_CONTEXT_ONLY'`, `executableTruth: false`) | **NO** | CURRENT_INTELLIGENCE_ONLY | `optionomics-provider.ts` (`NormalizedOptionomicsFlowWindow`), capability census Flow row | Per-print classifications (Inside/Above Ask/At Ask/Mid/At Bid/Below Bid) named in this directive are **not present in the documented contract at all** -- not observed, not rejected, simply absent from what Codex's census found |
| MCP (`https://optionomics.ai/mcp`) | Authenticated (Base64 Bearer or header-pair per `optionomics-mcp-qualification.ts`), tier UNKNOWN | Code exists (`qualifyOptionomicsProductionSurfaces`) and is unit-tested | **UNKNOWN -- not run against the live server in any committed evidence** | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | The only tool names/fields (`unusual_activity`, `options_flow`, `options_chain`, `net_flow`, sample `bid`/`ask`/`timestamp` fields) come from `tests/optionomics-mcp-qualification.test.ts`'s **mocked `fetch` fixture**, not a real MCP response. No HANDOFF.md/DECISIONS.md entry records an actual authenticated MCP probe result | Do not treat the test fixture's tool names/fields as real MCP schema evidence -- they are a plausible test shape only, explicitly labeled as such here |
| Webhooks / Alerts | Documented product feature (per `THETA_OPTIONOMICS_DATA_MAP.md`'s Alerts row: "Documented product feature, integration not built") | NO integration exists | UNKNOWN | N/A | N/A | N/A | N/A | N/A | N/A (delivery-time field would exist per marketing copy, not confirmed in developer reference) | UNKNOWN | Marketing page (`optionomics.ai/features/api`) advertises delivery; the developer API reference states no webhook functionality is described for Option Alerts/Options Flow (per this branch's own prior-session WebFetch finding, unchanged) | NO (nothing built) | NO | UNKNOWN | `THETA_OPTIONOMICS_DATA_MAP.md` Alerts row; this branch's prior-session `optionomics_flow_event.py`/`optionomics_webhook_validation.py`/`optionomics_flow_chain_fusion.py` (schema-agnostic, built ahead of any real payload) | Same as before: transport documented, payload schema undocumented, integration not built |
| REST Exposure heatmap (`/heatmap?metric=gamma_exposure\|vanna_exposure\|charm_exposure`) | Authenticated | YES | Current, per census (693/669/669 sampled elements, HTTP 200) | Grid keyed by strike/expiration, not a per-order-quote | N/A | N/A | N/A | N/A | Grid `date` field, not a live event timestamp | UNKNOWN | Provider-reported units/sign convention explicitly unverified per Codex's own adapter comments | YES (structure/context only, never directional) | N/A -- not a quote surface at all | CURRENT_INTELLIGENCE_ONLY | `optionomics_exposure_heatmap.py` (this branch), capability census Metrics/exposure row | Units/sign convention UNKNOWN |
| REST Metrics (`/metrics`, `/levels`) | Authenticated | YES | Current + historical schemas share a fingerprint per census | Underlying-scoped, not per-contract | N/A | N/A | N/A | N/A | N/A | UNKNOWN | 83 named metric values observed in one dated run; current-vs-historical freshness of any single field not separately re-verified this pass | YES | N/A | CURRENT_INTELLIGENCE_ONLY | `optionomics_context_metrics.py` (this branch), capability census | Horizon/unit contracts for IV/RV comparisons remain blocked per census's own `OPTIONOMICS_VOLATILITY: PARTIAL` line |
| Underlying quote (`/stocks/{symbol}/quote`) | Authenticated | YES | Ambiguous -- census states "Current quote payload contained an explicit null, so it is research context only" | Underlying only, not an option contract | N/A | N/A | N/A | N/A | N/A | UNKNOWN | Explicit null observed in at least one real authenticated run | PARTIAL (context only) | NO | INDICATIVE at best, more likely UNKNOWN | `THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`, Underlying row | The null observation itself is the evidence of unreliability -- not inferred |

### The "current/live ambiguity" for OPTION_CHAIN, spelled out

Two of Codex's own dated documents disagree on the SAME family across two
different runs on the same date:

- `THETA_OPTIONOMICS_DATA_MAP.md`: "The 2026-09-14 authenticated Production
  census persisted 35 capability results... **Current SPY chain and metrics
  were empty/null**, historical chain and metrics were populated."
- `THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md` (a later rerun, "37
  capability results" at `2026-09-14T12:19Z`): "**The earlier current SPY
  chain was populated** and contained 12,838 sampled array elements."

Read together, the honest conclusion is: **current-chain population is
inconsistent across runs on the same day** -- sometimes populated, sometimes
empty/null. This is real, load-bearing evidence in its own right: it means
even if the session/documentation rejection were lifted, the OPTION_CHAIN
operation has not been shown to reliably return current data on demand, which
independently supports (from a different angle than the documentation-based
blocker) treating it as not yet fit for `ORDER_PRICING_ELIGIBLE` use. I did
not average or pick one of these two Codex statements -- both are quoted
above so a future reader can verify neither is silently discarded.

## Ten/eleven-question breakdown (not collapsed into one yes/no)

1. **PLATFORM HAS LIVE DATA**: Plausible/likely (marketing copy claims
   "every trade, as it happens"; the platform's UI is not something this
   audit can inspect without credentials) -- not independently confirmed by
   this audit.
2. **LIVE DATA IN UI**: Not inspected (no UI access in this environment).
3. **LIVE DATA PROGRAMMATICALLY**: YES for OPTION_CHAIN and current net-flow
   series (per census evidence above), inconsistently (see ambiguity note).
   UNKNOWN for MCP (never actually probed). NO integration for
   webhooks/alerts (nothing built to receive them).
4. **EXACT CONTRACT IDENTITY**: YES for OPTION_CHAIN (OCC-equivalent
   underlying+expiry+strike+type, exact-match only, per
   `matchOptionomicsContractIdentity`). NO for aggregate Flow (bucketed, not
   per-contract).
5. **TWO-SIDED BID/ASK**: YES, fields present and populated in OPTION_CHAIN
   per census. NOT APPLICABLE to aggregate Flow/Metrics/Heatmap.
6. **SIZES**: YES for OPTION_CHAIN (bid/ask size fields documented and
   normalized). NOT APPLICABLE elsewhere.
7. **PROVIDER/EVENT TIMESTAMP**: YES for OPTION_CHAIN (`asOf`/provider
   timestamp populated). Window-level only for Flow (not per-event). UNKNOWN
   for MCP/webhooks.
8. **FRESH ENOUGH FOR STRATEGY INTELLIGENCE**: YES WITH LIMITS -- this is
   Codex's own stated conclusion (`OPTIONOMICS_QUOTE_INTELLIGENCE_READY:
   YES_WITH_LIMITS`), which this audit did not find reason to dispute.
9. **FRESH ENOUGH FOR ORDER PRICING**: NOT PROVEN. No repeated-observation
   staleness/age measurement across a market-hours session exists in any
   committed evidence this audit found (the qualification runtime samples 2x
   per symbol per run, not a sustained session-long freshness study), and the
   code's own `blockers` list would reject it regardless of what such a study
   found (documentation-based rejection, described above).
10. **DOCUMENTED SEMANTICS SUFFICIENT FOR `TRUSTED_TWO_SIDED_ORDER_PRICING`**:
    NO. `TRUSTED_TWO_SIDED_ORDER_PRICING` is Alpaca's semantic class in
    `execution-option-quote.ts` (`sourceSemantics` enum), used elsewhere in
    the codebase for Alpaca IEX stock-exit quotes, not for any Optionomics
    surface. No document or code in `origin/main` assigns this semantic to
    any Optionomics surface, and this audit found no evidentiary basis to
    assign it either -- the provider's own documentation, per Codex's
    repeated citation, describes session-ingested data explicitly, which is
    a documented DISQUALIFIER from this class, not silence about it.
11. **PROVENANCE SUFFICIENT FOR `CONSOLIDATED_NBBO`/OPRA**: NO. Optionomics
    is never OPRA (OPRA is Alpaca's own consolidated feed, separately
    NOT_ENTITLED per the standing account-entitlement finding, unrelated to
    Optionomics). No claim of NBBO-equivalence for any Optionomics surface
    exists anywhere in the reviewed evidence.

## Secondary check: active-management execution path (read-only, not fixed)

Checked `git diff --stat de93613..e2130819` (the delta since my prior
integration audit) restricted to `src/execution/master-paper-plan-assembly.ts`,
`src/theta/canonical-strategy-frontier.ts`, `src/theta/management-action-frontier.ts`:
**zero lines changed in this delta.** `master-paper-plan-assembly.ts`
(`assembleMasterPaperEvidencePlan`) is unchanged since my prior review and
still contains, verbatim:

```
if (frontier.primaryAction !== 'OPEN_CSP') blockers.push(`ACTION_NOT_YET_CONNECTED:${frontier.primaryAction}`);
```

This is the only assemble -> enqueue -> quote -> submit path that exists.
`CLOSE_CSP`, `ROLL_CSP_CLOSE`, `ROLL_CSP_OPEN`, `OPEN_CC`, `CLOSE_CC`,
`ROLL_CC_CLOSE`, `ROLL_CC_OPEN`, and `SELL_STOCK` all fall through this same
unconditional blocker and cannot reach `enqueue()` -- confirmed unchanged from
the prior audit round, not re-derived from scratch, and not fixed by this
branch (this is explicitly a read-only acceptance check per this directive's
own instruction, since Codex may be actively working in this area).

## What is required to actually promote any Optionomics surface (not yet supplied)

Per this directive's own list, none of the following exist in any committed
evidence this audit found, for any surface:

- A named authenticated operation run specifically through the SAME proof
  function used for OPTION_CHAIN (or an equivalent), for Flow, MCP, or a
  webhook.
- Exact contract-identity mapping demonstrated for a non-OPTION_CHAIN surface.
- Repeated observations of the SAME contract during confirmed market-open
  hours, timestamped, with a measured age between provider timestamp and
  retrieval -- this audit did not fabricate a latency number because none is
  recorded anywhere in the reviewed evidence.
- Spread-validity checks (bid <= ask, non-crossed) sustained across repeated
  samples rather than a single snapshot.
- Provider documentation stating any surface is *intended* for pricing use
  (the opposite is what's actually documented for OPTION_CHAIN).

## Receipt

```
CURRENT_MAIN_SHA: e2130819c387d8750df0e13d7fbf974d84d2373c
CURRENT_CLAUDE_SHA: c10b65d46856785b709ac06ab165077736e851cc

OPTIONOMICS_PLATFORM_LIVE_DATA: PLAUSIBLE_UNCONFIRMED (marketing claims only; not independently verified by this audit)
OPTIONOMICS_PROGRAMMATIC_CURRENT_DATA: PARTIAL (OPTION_CHAIN + current net-flow series populated in at least one real authenticated run each; inconsistent across runs for OPTION_CHAIN; MCP never actually probed; no webhook integration exists)
OPTIONOMICS_INTELLIGENCE_READY: PARTIAL (Codex's own YES_WITH_LIMITS for OPTION_CHAIN/Metrics/Heatmap/aggregate-Flow; UNKNOWN for MCP)
OPTIONOMICS_ORDER_PRICING_READY: NO
OPTIONOMICS_NBBO_PROVEN: NO
FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_READY: NO (for OPTION_CHAIN, by explicit code-level and documentation-level rejection) / REQUIRES_AUTHENTICATED_MARKET_HOURS_TEST (for every other surface, since none has been tested against this proof at all)

OPTION_CHAIN_SEMANTICS: SESSION_RECORDED_RESEARCH (documentation-based rejection, scoped in code to this one operationAlias; current-data population itself observed as inconsistent across two same-day runs)
FLOW_SEMANTICS: CURRENT_INTELLIGENCE_ONLY (aggregate/bucketed only; no per-print contract identity, no bid/ask, no sizes; no sweep/block/ISO/aggressor schema found in the documented contract at all -- absent, not rejected)
WEBHOOK_SEMANTICS: UNKNOWN (transport documented on the marketing page; developer reference states no webhook functionality is described for these channels; zero integration built)
MCP_SEMANTICS: UNKNOWN (qualification code exists and is unit-tested against a MOCKED fixture only; no evidence of a real authenticated run against the live MCP server anywhere in origin/main's committed history)

HARDCODED_SESSION_RECORDED_REJECTION: CORRECT_ONLY_FOR_OPTION_CHAIN
  (the type/function/blocker are explicitly scoped to operationAlias 'OPTION_CHAIN'
  in code; broader prose statements in Codex's own docs generalize further than
  the code itself does, and no other surface has actually been tested against
  this proof to confirm or deny the same conclusion for it)

ACTIVE_MANAGEMENT_EXECUTION_PATH: NOT_CONNECTED
  (unchanged since prior audit; zero-line diff in the relevant files this round;
  every non-OPEN_CSP action still hits ACTION_NOT_YET_CONNECTED in
  master-paper-plan-assembly.ts)

REQUIRED_CODEX_CHANGE: none proven necessary by this audit. This audit found a
  documentation/evidence GAP (Flow/MCP/webhooks never run through the same
  execution-quote proof OPTION_CHAIN was), not a proven CODE DEFECT -- the
  correct next step is an authenticated empirical test of those surfaces
  during market hours (credentials this environment does not have), not a
  code change this branch can specify in advance of that evidence.

NO_CHANGE_REQUIRED:
  - OPTION_CHAIN's SESSION_RECORDED_RESEARCH / REJECTED / false triad --
    correctly scoped to that one operation, correctly conservative given the
    same-day current-vs-empty inconsistency independently found in this audit.
  - Aggregate Flow's RESEARCH_CONTEXT_ONLY / executableTruth:false marking --
    correct, since no per-print/per-contract data exists in the documented
    contract at all.
  - The active-management NOT_CONNECTED state -- explicitly not to be fixed
    per this directive; reported only.

MAIN_PUSHED = NO
PRODUCTION_CHANGED = NO
BROKER_ORDERS_BY_CLAUDE = 0
LIVE_OWNER_AUTHORIZATION = NOT_GRANTED
LIVE_ELIGIBLE = NO
```
