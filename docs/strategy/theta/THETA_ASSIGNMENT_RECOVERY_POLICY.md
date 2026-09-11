# Assignment and recovery policy

Assignment is accepted only with broker-confirmed activity, matching stock-position change, known multiplier, ownership suitability, and funded capacity. Moneyness or a disappeared option position is insufficient evidence.

After assignment, RECOVERY_WAIT, SELL_STOCK, and SELL_CC compete. Recovery considers whole-chain basis, stock mark-to-market, tail and concentration risk, capital days, event state, execution, and redeployment value. Missing values stay UNKNOWN. The system never sells a covered call automatically after every assignment.
