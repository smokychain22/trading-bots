# THETA Expert Management-DNA Matrix

Extends `../phase3_strategy_dna/EXPERT_REGISTRY.md` with a management-decision-specific
view: for each of the 11 already-registered experts, what their `borrowed_prior`
implies specifically about HOLD/CLOSE/ROLL/EXPIRE/ACCEPT_ASSIGNMENT/RECOVERY_WAIT/
SELL_CC/CLOSE_STOCK/CALL_AWAY/REDEPLOY behavior — separated into observed action,
reconstructed action, inferred rule, and unknown rule, exactly as this task requires.
**No exact threshold is invented for any expert** — every entry either cites the
existing registry's own evidence-state label or states `UNKNOWN` explicitly.

| Expert | Evidence state (from registry) | Observed action | Reconstructed action | Inferred rule | Unknown |
|---|---|---|---|---|---|
| `orange_cat` | OBSERVED | Full CSP→stock→CC cycle carried through to resolution rather than exited early | HOLD preferred over CLOSE when the underlying remains ownership-acceptable | Patience is conditioned on ownership quality, not applied unconditionally (informs H-A-01, H-M-03) | Exact DTE/delta/roll thresholds; exact ownership-acceptability bar used |
| `iwm_hold_the_strike` | RECONSTRUCTED | Intentional assignment accepted as a normal outcome, not an error state | Recovery-wait step taken before considering CC (informs H-C-02, H-A-02) | A 2-5 DTE ATM entry regime implies a correspondingly short management horizon per cycle | Exact recovery-wait bound; whether the cohort's high closed-WR reflects genuine edge or the inventory-masking pattern H-H-02 warns about |
| `sqqq_hold_the_strike` | OBSERVED (as a **failure case**, per this task's framing) | High closed-trade WR with a similar assignment-heavy structure to `iwm_hold_the_strike` | The specific failure mechanism is Leg-WR masking open-inventory drawdown, not a flawed entry/management rule per se | The lesson is measurement discipline (H-H-02, H-A-03), not "avoid this trader's entry/management rule" — this is a caution about how to *evaluate* an assignment-heavy policy, not a rejected trading rule | Whether the underlying entry/management logic itself was flawed, or only the reporting of it — the registry's own `is_failure_dna: true` flag is about the WR-hides-drawdown pattern, not necessarily the policy's raw economics |
| `hendo_67` | OBSERVED | Active management across CSP/CC/Wheel positions (not simply hold-to-expiry) | Close/roll/assignment decisions made actively rather than passively (informs H-R-01, H-C-01) | Some form of profit-capture-triggered management exists, exact form unstated | Whether management timing is DTE-conditioned, ownership-conditioned, or regime-conditioned (H-M-02/03/04's open questions) |
| `alex` | RECONSTRUCTED | Rolling used as a recurring adjustment tool across the assignment lifecycle | Rolls treated as a deliberate choice among several (not an automatic reflex) | Every roll implicitly compared against not-rolling, consistent with H-R-03's alternatives-comparison requirement — but H-R-03's `rationale` explicitly notes this expert's evidence is RECONSTRUCTED, not a confirmed universal practice | Whether the alternatives-comparison was ever formalized/quantified by this expert or was informal judgment |
| `ivan_orehovec` | OBSERVED | Portfolio/structure routing across multiple position types | Meaningful (non-trivial) premium-capture thresholds used to trigger management action | Structure choice (CSP vs. spread vs. other) is itself a management-adjacent decision, informing THETA-D's gated scope rather than THETA-Q/H/R/C/A directly | Exact premium-capture trigger; whether this generalizes beyond the small-account context `ivan_small_account` is separately cataloged under |
| `ivan_small_account` | INFERRED | None directly observed | Defined-risk/small-account structuring — a different archetype (THETA-D) entirely | Small-account capital constraints may force structure choices (spreads over CSPs) that a larger account wouldn't need | Whether any management-timing lesson here transfers to THETA-Q/H/R/C/A at all — registry explicitly says do not assume so |
| `wheeling_to_freedom` | RECONSTRUCTED | Active inventory management (BUY_CLOSE actions observed/reconstructed) | Closing positions is a deliberate inventory-management tool, not only a profit-take mechanism | Some inventory-level (not just position-level) management logic exists | Exact close threshold — registry explicitly flags this as unknown |
| `david_romic` | INFERRED | None directly observed | A "conservative income process" implies more HOLD/less ROLL relative to a more active manager | Conservatism likely manifests as tighter ownership screening at entry (THETA-Q) rather than aggressive management-time intervention | Whether conservatism is primarily an entry-time or management-time behavior — registry's own evidence state (INFERRED) reflects this uncertainty |
| `lick_neeson` | INFERRED | None directly observed | Structure-routing hypothesis across CSP/CC/spreads/IC implies a management framework that differs by structure type | Different structures likely warrant different management rules, but no specific rule is stated | Everything about the actual management mechanism — registry explicitly frames this as "research prior only until evidence improves" |
| `fearless_value` | INFERRED | None directly observed | High-WR/value orientation with drawdown caution suggests a management style that trades some upside for tail protection | A CLOSE bias earlier than a pure patience-maximizing manager would use, to protect against drawdown | Whether this manifests as tighter stops, tighter ownership screening, smaller sizing, or some combination — registry does not distinguish |

## Avoidance / no-trade behavior (explicitly reconstructed, per this task's requirement)

None of the 11 registered experts has an explicit "no-trade" or "avoid" rule recorded
in `expert_sources.json` beyond what is already captured as `do_not_assume` fields (a
caution against over-generalizing their prior, not a trading rule itself). The
closest analogues already in this repository's registries:

- `sqqq_hold_the_strike`'s failure-DNA status is itself a no-trade *lesson* (avoid
  relying on Leg WR alone as a safety signal) rather than a no-trade *rule* about when
  not to enter/manage a position.
- H-D-01's gating condition (do not trade THETA-D until Level 3 + archetype
  graduation) is the only explicit, registry-level "no-trade until X" rule currently in
  this repository, and it is architectural, not expert-derived.

**No avoidance rule is invented for any expert beyond what the registry already
states.** If the legacy bot or a future data source specifies an actual avoidance rule
for one of these experts, it should be added to `expert_sources.json` directly (the
single source of truth), not duplicated here.

## Status

Narrative extension of `../phase3_strategy_dna/EXPERT_REGISTRY.md`. No new expert
added, no new evidence_state upgraded, no threshold invented.
