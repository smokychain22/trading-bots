# Copy THETA Setup Flow

Specification for the customer-facing wizard (R3C/R4 UI, not yet implemented — see
priority order in the product-correction instruction: runtime R1-R4 first, UI wiring
after). Extends the existing fail-closed copy-setup contract this takeover's earlier
phases already specified (`JOIN_EXISTING = OFF`, `START_NEW_TRADES_ONLY = ON` by
default, per `docs/quant/phase2/` and earlier phase docs).

## Five steps

1. **Connect Alpaca Paper Account** — per
   `docs/product/ALPACA_OAUTH_ARCHITECTURE.md`. Until implemented, this step must
   truthfully read "Paper connection coming online," never a fake "Connected" state.
2. **Choose allocation** — plain-language inputs only:
   - Amount to allocate (dollar figure)
   - Maximum bot allocation (percentage preset: 10/25/50/custom)
   - Maximum contracts (optional, advanced/collapsed by default)
   - Maximum daily loss (optional, advanced/collapsed by default)
   - Join existing positions (toggle, **OFF by default** — starting a follower
     mid-Wheel-lifecycle is never the default per R4A)
   No delta/DTE/IV/strike/Greeks/regime/expert-parameter inputs are ever exposed here —
   THETA chooses those; that's the entire value proposition of a managed bot.
3. **Risk preferences** — the same essential set as step 2's advanced fields,
   surfaced explicitly if the user wants to set them before review rather than after.
4. **Review** — a plain-language summary of every choice made, plus the customer-
   visible strategy explanation from `docs/product/CUSTOMER_VS_ADMIN_INFORMATION_
   BOUNDARY.md` ("THETA sells premium. Assignment may occur. Assigned stock remains
   part of P&L...").
5. **Activate Paper Copy** — the terminal action. **This button is only enabled once
   the real backend readiness state machine
   (`NOT_CONNECTED → BROKER_CONNECTED → ACCOUNT_READ → OPTIONS_APPROVED → DATA_READY →
   POLICY_READY → RISK_READY → PAPER_COPY_READY`, already specified in earlier phase
   docs) genuinely reports `PAPER_COPY_READY`.** Until then it reads "Copy setup not
   ready" — never a clickable button that silently does nothing or fakes activation.

## Runtime behavior once active (restated, not new)

`MASTER DECISION → FOLLOWER ACCOUNT SNAPSHOT → FOLLOWER AEGIS → FOLLOWER SIZING →
FOLLOWER EXECUTABLE QUOTE → FOLLOWER ORDER → FOLLOWER RECONCILIATION → FOLLOWER P&L`
(R4, already specified). The wizard's job is only to collect the inputs this pipeline
needs — it does not itself decide follower quantity, which is never a blind clone of
master quantity and may legitimately be zero.

## Post-activation surfaces (My Bots / Activity / Positions / Trades)

Covered by `docs/product/CUSTOMER_COPY_UX.md` — this document ends at activation.

## Status

SPECIFIED. No UI or wizard code implemented yet — this is the design contract for when
R3/R4 backend readiness genuinely supports it.
