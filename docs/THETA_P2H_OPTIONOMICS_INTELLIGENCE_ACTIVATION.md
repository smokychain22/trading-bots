# THETA P2H Optionomics intelligence activation

P2H extends the accepted P2G baseline. It does not alter the execution quote gate, management-policy promotion, follower lock, or live-money prohibition.

## P2G self-acceptance

The bounded P2G acceptance suite passed 25 of 25 tests on canonical SHA `9c5e4e974d40b531e1843031271b86a1d0082c94`. Operational first-Paper readiness remains separate from empirical-policy readiness and management-policy promotion. P2G is closed unless a later reproducible defect is found.

## Real Production provider evidence

One sanitized Production qualification ran through the authenticated local-worker endpoint on 2026-09-16. Credential values were neither returned nor logged.

- `OPTIONOMICS_PRODUCTION_AUTH = PASS`
- REST header-pair authentication returned HTTP 200.
- REST bearer authentication returned HTTP 200.
- MCP header-pair and MCP bearer initialization returned HTTP 200.
- The MCP server returned 23 real read-only tools.
- Sampled `options_chain` evidence contained exact option symbols plus bid and ask fields.
- The sampled chain's IV and Greeks were null. Discovery does not convert null fields into supported populated evidence.
- Optionomics remains research, screening, and intelligence authority. Its documented REST surface is session-oriented and is not execution-price authority.

## Canonical contract

`src/theta/optionomics-intelligence-contract.ts` is the typed P2H contract. It provides:

- a pinned public REST, MCP, and webhook surface registry;
- a reproducible endpoint-registry hash;
- a reproducible authenticated MCP tool-catalog hash;
- cadence classification;
- the five provenance classes;
- runtime, research, discovery-trigger, and read-only-tooling roles;
- strategy-specific required and optional family matrices;
- explicit semantic failures for schema drift, missing contract identity, date fallback, impossible spot zero, exposure zero sentinels, and heatmap metric mismatch;
- point-in-time news `knownAt` selection using the latest of publication, analysis, and receipt time.

The provider qualification report now discovers all 23 real MCP tools, classifies each independently, and probes 14 documented REST capability paths with only sanitized HTTP/schema metadata. A discovered endpoint is not automatically qualified, populated, fresh, or usable by a strategy.

## Provider semantics

The current canonical cadence classes are:

- `LIVE_TAPE_EVENT`
- `EVENT_DRIVEN_ALERT`
- `INTRADAY_AGGREGATE`
- `MINUTE_CACHED_LEVEL`
- `SESSION_CHAIN`
- `SESSION_METRICS`
- `DAILY_FINAL_SCREEN`
- `HISTORICAL_RESEARCH`
- `PROVIDER_MODELED_RESEARCH_OUTPUT`
- `UNKNOWN`

The current provenance classes are:

- `RAW_PROVIDER_OBSERVATION`
- `PROVIDER_DERIVED_ANALYTIC`
- `PROVIDER_CLASSIFICATION`
- `PROVIDER_MODELED_OUTPUT`
- `THETA_DERIVED`

Optionomics ideas, commentary, trend analysis, sentiment, earnings analyses, and assessments remain modeled research outputs. They cannot become strategy or execution authority without independent THETA evidence.

## Webhooks

The documented alert webhook is a discovery and invalidation trigger only:

`provider event -> dedup/replay protection -> decision invalidation -> normal THETA refresh pipeline`

It must never submit an order directly. The public documentation says the alert form displays the current payload contract, but it does not publish a signature header or verification algorithm. A Production receiver is therefore not claimed complete. Implementing an invented signature scheme would weaken security.

Exact blocker: `OPTIONOMICS_WEBHOOK_SIGNATURE_CONTRACT_NOT_PUBLICLY_DOCUMENTED`.

## Production database blocker

Production Neon currently rejects connections with SQLSTATE `53000` and the provider message that the project exceeded its data-transfer quota. This blocks database reads, persistence, migrations, worker cycles, and deployment verification that depends on Neon. Runtime fails closed in `DEGRADED` state.

Exact owner action: increase or reset the Neon data-transfer allowance for the connected Production project. No database URL or credential value is needed in chat.

No migration 050 was created in this slice because the contract and sanitized qualification report do not require a new table. Webhook persistence will require a migration only after the provider's real payload and authentication contract are captured.

## Safety state

- `WORKER_MODE = MASTER_THETA_PAPER`
- `EXECUTION_GATE = EXTERNAL_QUOTE_BLOCKER`
- `PRODUCTION_MANAGEMENT_POLICY_PROVIDER = NOT_PROMOTED_UNAVAILABLE`
- `FOLLOWER_EXECUTION = LOCKED`
- `LIVE_MONEY_AUTHORIZED = NO`
- master Paper orders: 0
- follower Paper orders: 0
- live orders: 0

