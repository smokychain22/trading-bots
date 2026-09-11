# Strategy router

The existing Python router remains authoritative for per-cycle applicability. The business mapping is Q to CONVENTIONAL, H to HOLD_STRIKE, A to RECOVERY, C to CC, and D to DEFINED_RISK. R describes management of the active lifecycle branch and does not create a sixth product strategy.

Routing asks which validated branches may compete in the current lifecycle, account, ownership, event, liquidity, regime, and risk state. It does not select the branch with the highest historical win rate. A research-only branch cannot become executable because another branch found no candidate.

Current gaps are graded trend and volatility regime inputs, sector and correlation context, and empirical branch-promotion evidence. Until those inputs exist, the router must expose UNKNOWN or retain the current narrower applicability result.
