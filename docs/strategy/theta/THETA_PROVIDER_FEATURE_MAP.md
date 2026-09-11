# Provider and feature map

| Input | Runtime owner | Strategy use | Missing behavior |
|---|---|---|---|
| Account, buying power, positions, orders, activities | Alpaca | Hard capacity, lifecycle, reconciliation | UNKNOWN or hard hold |
| Stock and option BBO, contracts, multiplier, clock/calendar | Alpaca | Executability and identity | Non-executable |
| Broker Greeks when present | Alpaca | Soft feature or risk input | UNKNOWN |
| IV history, skew, term, surface | Optionomics | Soft economics, regime and uncertainty | UNKNOWN |
| Flow and unusual activity | Optionomics | Soft contextual evidence | UNKNOWN, never inferred |
| Events and historical option context | Optionomics | Soft penalty, uncertainty, structure routing | UNKNOWN |

Every FusionSnapshot field carries source, as-of time, retrieval time, version, and null semantics. Optionomics never supplies an executable price or sends an order. No third runtime vendor is introduced by this package.
