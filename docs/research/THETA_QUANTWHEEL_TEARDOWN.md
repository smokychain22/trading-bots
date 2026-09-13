# THETA QuantWheel Teardown

Status date: 2026-09-13

QuantWheel is a mechanism and product benchmark. It is not a THETA runtime
dependency and its ratings or performance statements are not accepted as truth.

| Observed mechanism | Why it helps | Weakness to test | THETA response |
|---|---|---|---|
| Wheel and seller screeners | Narrows a large contract universe | Ranking may hide economics and selection bias | ADAPT into PIT candidate sets and gate-regret evidence |
| Earnings expected move | Makes event premium explicit | Expected move is not realized tail loss | TEST as a separate feature and event guard |
| GEX, walls, flip, heatmap | Makes positioning structure legible | Method and sign assumptions vary | TEST only with definition lineage |
| Vanna and Charm views | Adds nonlinear exposure context | May be unstable or redundant | TEST by DTE and event cohort |
| Roll Assistant | Compares strike, expiry, credit, and time | Positive credit can extend a bad trade | ADAPT to a HOLD/CLOSE/ROLL/ASSIGN/REDEPLOY frontier |
| Equity released and days extended | Shows capital tradeoff | Annualization can flatter small credits | ADOPT inputs, compare whole-chain after-cost utility |
| Cost-basis and Wheel journal | Preserves chain context | Product docs note adjusted-option limitations | ADAPT with broker events and immutable roll losses |
| Covered-call tools | Exposes break-even and premium tradeoffs | Premium can cap recovery at a poor strike | TEST against recovery wait and stock disposal |
| API and MCP | Makes research outputs accessible | Adds provider and licensing dependency | DEFER unless a canonical data gap is proven |

Official pages describe the Roll Assistant, Wheel tools, GEX, Vanna/Charm, flow,
API, MCP, and historical replay. They also state that the product supports the
user's research rather than placing trades. See [products](https://quantwheel.com/products),
[resources](https://www.quantwheel.com/resources), and
[roll guidance](https://quantwheel.com/how-to/roll-a-position).

No code, formula, or proprietary rating is copied. Any mechanism adopted by
THETA must have an independent implementation, explicit formula lineage, and
champion-versus-challenger evidence.
