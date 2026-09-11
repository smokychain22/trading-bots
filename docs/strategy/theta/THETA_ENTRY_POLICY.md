# Entry policy

The canonical sequence is candidate generation, structural feasibility, ownership economics, complete-cycle economics, portfolio fit, uncertainty, ranking, AEGIS, sizing, fresh Alpaca BBO, and execution preflight.

Hard blockers are unsupported session, invalid contract, unknown multiplier, stale broker or selected BBO state, insufficient collateral or assignment capacity, portfolio breach, lifecycle ambiguity, AEGIS veto, and invalid or zero quantity. Soft features affect rank, uncertainty, size, or structure.

An OPEN candidate now requires known positive after-cost EV and known positive return per capital day. Since the empirical EV model is not ready, this gate intentionally prevents Paper submission. The runtime cannot substitute a rule score, delta, midpoint, or zero for missing economics.
