# THETA Alertsify Competitor Map

Status date: 2026-09-13

Alertsify is a public execution and copy-safety benchmark. THETA does not depend
on it and does not accept its marketing metrics as independently verified facts.

| Observed UX or mechanism | Why it works | Weakness or risk | THETA response |
|---|---|---|---|
| Leader broker fill triggers follower evaluation | Anchors the event to broker truth | Followers can receive different fills | ADOPT master-fill-first sequencing |
| Follower-specific sizing and risk rules | Respects each account's capacity | Too many blunt gates can destroy opportunity | ADAPT with skip evidence and gate-regret review |
| Slippage guard | Avoids chasing a moved option market | Can create asymmetric missed exits | ADOPT with cashflow-direction-aware rules |
| Duplicate-copy protection | Prevents repeated tickets | Needs durable restart-safe identity | ADOPT with deterministic lineage IDs |
| Visible skip reason | Makes non-execution explainable | Reason may omit counterfactual cost | ADOPT and retain exact follower state |
| Pause and kill controls | Gives immediate risk control | Must not block risk-reducing exits | ADOPT with entry versus management semantics |
| Broker-fill performance | Reduces screenshot and cherry-pick risk | Fill truth alone can still omit open inventory | ADAPT to whole-chain economics including MTM |
| User-specific replay | Explains what one account could experience | Historical fills cannot be assumed identical | BUILD with realistic fill or explicit no-fill |

Alertsify's official material describes broker-fill-first copying, per-user caps,
slippage guards, duplicate prevention, visible skips, and broker-derived records.
See [How Copy Trading Works](https://alertsify.com/how-it-works),
[risk controls](https://alertsify.com/blog/copy-trading-risk-controls), and
[About Alertsify](https://alertsify.com/about).

R4 remains non-executable until tenant isolation, follower quote and capacity,
chain participation, lifecycle reconciliation, partial fills, and per-follower
accounting all pass. Master returns must never be presented as follower returns.
