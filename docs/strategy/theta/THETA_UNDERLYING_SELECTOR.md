# Underlying selector

The CSP ownership question is whether THETA would intentionally accept the stock at the post-premium economic basis. Premium size alone cannot answer that question.

`underlying-selector-contract.ts` accepts normalized 0 to 1 scores for liquidity, ownership, recovery, trend and momentum, realized-volatility suitability, event safety, sector and correlation diversification, portfolio capacity, and fundamental quality. Scores must come from versioned upstream models. The selector uses Pareto dominance and deterministic symbol ordering, so no unsupported weight is hidden in the runtime. UNKNOWN dimensions remain visible and cannot be treated as zero.

Mechanical blockers exclude a symbol. A symbol with an UNKNOWN score stays explicitly unrankable rather than appearing on the Pareto frontier. Soft values rank or widen uncertainty. A learned or weighted ranker remains blocked until point-in-time data and an ablation demonstrate value.
