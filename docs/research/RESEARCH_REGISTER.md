# Offline Research Corpus Register

TRD §14/§53 treat the user's historical profitable-trader corpus and the blueprint
revision history as **offline research priors and failure-DNA evidence** — not runtime
dependencies, and not copied into this repo's application code as secret rules.

## Blueprint lineage (not copied into this repo)

The TRD cites "Independent AI Options Bots Blueprint v5.5 (latest)" as its canonical
blueprint basis, with v5.4 as attached lineage. At the time this repo was created, the
following versions were found in the user's `~/Downloads` — **v5.5 itself was not
found** and should be requested from the user before relying on anything attributed to
it beyond what TRD v1.1 FINAL already restates:

- `Independent_AI_Options_Bots_Blueprint_v2_Senior_Revision.pdf`
- `Independent_AI_Options_Bots_Blueprint_v3_4_COMPLETE_CANONICAL_FINAL.pdf` / `.docx`
- `Independent_AI_Options_Bots_Blueprint_v3_FINAL_Audited.pdf`
- `Independent_AI_Options_Bots_Blueprint_v5_0_PROFITABLE_TRADER_BACKEND_MAJOR_UPDATE.pdf`
- `Independent_AI_Options_Bots_Blueprint_v5_1_QUANTWHEEL_POSITION_ALERT_INTELLIGENCE_UPDATE.pdf`
- `Independent_AI_Options_Bots_Blueprint_v5_2_PREMIUM_CAPTURE_POSITION_ECONOMICS_UPDATE.pdf`
- `Independent_AI_Options_Bots_Blueprint_v5_4_COMPLETE_PROFESSIONAL_CANONICAL_FINAL.pdf`
- `Independent_AI_Options_Bots_Professional_Blueprint_v1.0.pdf`

These are **evidence and failure-DNA research, not build authority** (TRD §0.2 "Audit
result" framing) — per the TRD's own handoff contract, they do not license adding
QuantWheel, copy trading, extra vendors, fixed DTE/delta thresholds, or performance
promises to THETA v1. They were left in the user's `~/Downloads` rather than copied
into this repo to keep the initial commit focused; if a future quant task needs to mine
them directly (e.g. reconstructing an expert's transferability score), pull the
specific version from that path rather than guessing its content from the version
name, and consider then archiving the needed excerpt under this directory.

## Expert Strategy DNA source register

The per-expert prior table (Orange Cat, IWM Hold the Strike, Hendo_67, Ivan Orehovec,
Ivan - Small Account, Alex, Wheeling to Freedom, David Romic, Lick Neeson, SQQQ
Hold-the-Strike, Fearless Value) is reproduced in TRD §14 and §53 and is the
authoritative version — do not reconstruct it from the blueprint PDFs above without
cross-checking against the TRD, which is the frozen source.

## Tier-0 / engineering reference repositories

TRD §52 lists external repositories (QuantLib, QuantConnect LEAN, and several
Alpaca/options-focused community repos) as **implementation-pattern references only —
never proof of profitability, and never a production dependency solely because a
README claims profitable results** (REPO-001). Verify identity, commit/version, license,
and security posture before reusing any code from them (REPO-002).
