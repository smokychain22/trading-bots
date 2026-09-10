# Method Corpus — Bot Relevance Map

Durability artifact. Cross-references `METHOD_EXTRACTION_REGISTRY.md`'s patterns
against which bot(s) in the platform they are relevant to, using the same routing
discipline as `../phase3_strategy_dna/FUTURE_BOT_ROUTING.md`. Most patterns here are
general engineering/validation discipline relevant to any bot; a few are THETA-specific
by construction.

| Pattern | THETA | PULSE | NEXUS | VEGA | EVENT | ATLAS |
|---|---|---|---|---|---|---|
| Alpaca lifecycle/reconciliation | Yes | Yes (any bot using Alpaca) | Yes | Yes | Yes | Yes |
| Preflight veto pipeline | Yes | Yes | Yes | Yes | Yes | Yes |
| Deterministic replay | Yes | Yes | Yes | Yes | Yes | Yes |
| VRP mechanism | Yes (premium-selling thesis) | No (0DTE timing, not a VRP thesis specifically) | Yes (also premium-selling) | Partial (vol-RV trades the surface itself, VRP is one lens on it) | No | No |
| Target-DTE fetching | Yes | N/A (0DTE by definition) | Yes | Possibly (term-structure trades) | Possibly | No |
| Schema-first features | Yes | Yes | Yes | Yes | Yes | Yes |
| Kill switch / ARM gate / exit supremacy | Yes | Yes | Yes | Yes | Yes | Yes |
| Future-poison leak testing | Yes | Yes | Yes | Yes | Yes | Yes |
| Honest failed-baseline retention | Yes | Yes | Yes | Yes | Yes | Yes |
| Hash-pinned provenance | Yes | Yes | Yes | Yes | Yes | Yes |
| Conservative fill models | Yes | Yes (especially — 0DTE liquidity is thinner) | Yes | Yes | Yes | Yes |
| Quote-aware replay | Yes (esp. THETA-H) | Yes (critical for 0DTE) | Yes | Yes | Yes | Yes |
| Composable risk checks | Yes | Yes | Yes | Yes | Yes | Yes |
| Probabilistic/soft regime modeling | Yes | Yes | Yes | Yes | Yes | Yes |

## Reading this table

The general engineering/validation patterns (preflight vetoes, deterministic replay,
leak testing, conservative fills, composable risk checks, regime modeling) are relevant
platform-wide and are recorded here so a future PULSE/NEXUS/VEGA/EVENT/ATLAS session
does not have to rediscover them — **this is not an instruction to build any of those
bots now.** Only THETA is in scope for v1 (`CLAUDE.md`). The two thesis-specific
patterns (VRP mechanism, target-DTE fetching) are marked "No"/"N/A" where they
genuinely don't apply to a bot's stated strategy shape (0DTE has no multi-day DTE
window to target; a pure directional swing thesis has no volatility-risk-premium
mechanism underlying it).

## Status

Reference map only. No bot beyond THETA is implemented, scaffolded, or specified in
code as a result of this file.
