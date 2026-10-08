# Original master credential recovery dependency checklist

Owner authority: consolidated recovery mission supplied 2026-10-09. Conditional
scope includes minimum durable no-submit controls, a protected recovery-only
Production-target deployment without aliases, one account-pinned credential write,
read-only verification and recovery deployment cleanup. It excludes broker
mutations, new-risk resumption, broad runtime deployment and migration 071.

| Dependency | Status | Evidence or remaining prerequisite |
| --- | --- | --- |
| Source certification | IN_PROGRESS | Exact f98f0ffb run 37837291258, dcd9290d run 37839358537, ccd3c7da run 37839789005 and a4ecfff3 run 37842023307 passed. Final stdout parsing and system-alias fail-closed guards need their own exact-SHA CI. |
| No-submit safety | IN_PROGRESS | Canonical full-submit lock verified at 2026-10-08T20:21:35Z. Existing authorization history preserved. Subsequent same-release cycle used LOCKED authority, with no ambiguous/working intents or active claims observed. Final pre-write drainage must be freshly rechecked. |
| Protected recovery runtime | BLOCKED | Corrected build succeeded, but --skip-domain changed a pre-existing generated staging alias. This conflicts with strict alias-preservation authority. Its prior mapping was restored and the recovery deployment removed. No credential invocation occurred. CLI staging now fails closed for PRESENT or UNKNOWN system-alias state. |
| Credential replacement | NOT_STARTED | Existing ciphertext and protected rollback retained. Requires the preceding gates and fresh account verification. |
| Canonical broker verification | NOT_STARTED | Replacement-key read-only authentication is separate from installed canonical-provider recovery. |
| Worker recovery | NOT_STARTED | Same-release natural reload must be observed. Online supervisor alone is not health proof. |
| XLE reconciliation | IN_PROGRESS | Fresh replacement-key read-only observation matched original canonical and protected identity. Current broker-state receipt remains private. This does not certify full lineage or executable closing economics. |
| Management certification | BLOCKED | Requires current broker position, canonical lineage, executable quotes and qualified exit evidence. |
| Controlled resumption | BLOCKED | New-risk resumption and broker orders are outside this mission. |
| V4 integration | IN_PROGRESS | Review branch source work remains separate from deployed bc7ffbd5 runtime. Schema 071 is not deployed. |

## No-submit findings

The deployed bc7ffbd5 runtime reads the durable control once at cycle start.
`resolveEffectivePaperExecutionControl` ANDs the environment master flag with
the durable master flag. A durable full lock disables new-risk and management
submission, with followers disabled, even if known environment flags remain enabled.
This avoids changing Sensitive Production configuration for recovery.

An already-running cycle retains its original control snapshot. A control write
alone does not prove immediate quiescence. Before credential restoration, prove
pre-lock invocation drainage, no submission in flight, no unresolved ambiguous
broker mutation and subsequent locked runtime observations. Do not equate the
supervisor's LOCKED display or broker authentication failure with durable no-submit.

If full-submit locking is needed, automatic protective closing is also disabled.
Monitoring and qualification remain distinct. Until management is certified, the
owner can review the original Paper position directly in Alpaca. No automatic
close, cancel or roll is authorized by this mission.

Reticle is skipped for these backend safeguards and operational documentation.
Unit tests and browser tests are not deployed endpoint or current-worker proof.

## Corrective source checkpoint

- Recovery no-submit guard now accepts unchanged explicit environment flags only
  when the durable full lock is proven. Unknown flags, active durable controls,
  unpaused entries and follower authority remain rejected.
- Raw-body reader handles the Node platform's restored event stream. Original
  async iteration was deterministically reproduced yielding zero bytes after
  platform consumption. Signed bytes are never reconstructed from parsed JSON.
- Focused control and credential tests passed, 25 tests. Restored-body focused
  tests passed, 10 tests. Final combined validation is tracked separately.
- Dedicated PostgreSQL recovery/concurrency test passed. Its first local attempt
  failed ECONNREFUSED because the disposable test server started on its default
  port rather than the intended port. The owned test server was stopped and
  started on the explicit bounded test port before the successful run. This was
  local fixture setup, not Production evidence. The test database was dropped and
  the owned test server stopped after testing.
- Final combined focused tests passed, 29 tests. An unused-variable lint failure
  in the restored-stream fixture was corrected without changing test semantics.
- Bounded full Node run completed with 4579 passed, 86 skipped, zero failed.
  Final focused tests cover the completed raw-body correction, which was added
  during the full run. Exact-SHA CI must certify the committed final tree.
- Original master environment variables, encryption material, worker release,
  roles and broker state were not changed by the durable control lock. The
  canonical lock updated only its existing control row. The protected prior
  control snapshot is retained outside Git, with no automatic resumption.
- Fresh Vercel metadata confirmed all_except_custom_domains protection, zero
  cron definitions and Hobby billing. Existing alias/deployment mapping is
  snapshotted outside Git. A first metadata attempt was unconfirmed, then the
  bounded metadata read succeeded. No runtime encryption key was read or pulled.
- Corrective checkpoint dcd9290d883b0fe2f3f6a598433abc358cf2729b was safely
  pushed for exact-SHA CI 37839358537. A subsequent receipt-only client correction
  preserves redacted failure phase, reason and possible-commit evidence instead
  of dropping them. Its 12 focused tests, lint, typecheck and build passed.
  This changes no database mutation or trading behavior and needs its own CI.

## Deployment incident and scoped correction

- The first recovery-only staging attempt failed at 2026-10-08T20:38:45Z.
  Vercel reported `unused_function` for the normal runtime function, which is
  deliberately absent from the isolated recovery artifact. Installed CLI source
  proves earlyGetConfig runs before the --cwd override is applied to client.cwd.
  The child process was started in the repository and inherited its config.
- No recovery credential request was sent, no permit was consumed and no
  credential update occurred. The durable full-submit lock remains in place.
- Invocation planning now pins actual child cwd and explicit --local-config to
  the standalone artifact. Exact config shape and sole recovery route are
  checked. Repository-contained output, invalid scope, added functions or
  routing/alias fields fail before any deployment. Focused tests reproduce
  caller config contamination without contacting Production.
- Cleanup initially stopped on an alias difference rather than ignoring it.
  Read-only provenance proved the sole difference was the independently built
  review-branch Preview deployment for ccd3c7da, created before the failed
  recovery deployment. Production/custom-domain mappings were unchanged.
  Only the exact owned ERROR recovery deployment was removed. Platform readback
  returned 404 at 2026-10-08T20:45:42Z. Private identifiers and detailed evidence
  remain outside Git.
- A staging/build failure does not authorize replay of a consumed credential
  permit. Here no credential invocation occurred. The consolidated mission
  covers correction of the deployment tooling followed by a newly gated staging
  operation, provided every original security prerequisite is proven again.
- Earlier failures and receipts remain preserved. No broker mutation, worker
  restart, broad deployment, migration or new-risk resumption occurred.

## System-alias safety incident

- Fresh gated re-entry initially stopped before Production work with EAI_AGAIN.
  A separate bounded installed-environment read measured successful Windows
  IPv4 resolution, TCP, TLS and PostgreSQL startup. The OS IPv6 lookup had no
  record, while direct DNS A/AAAA resolver operations returned ECONNREFUSED.
  No hosts-file override, resolver change or secret substitution was used.
- The subsequent gated isolated build succeeded at 2026-10-08T20:58:11Z.
  CLI stdout and stderr were incorrectly merged for URL selection, so the
  operator stopped before any credential request. Source parsing now accepts
  only the exact generated HTTPS URL on stdout and rejects mixed/ambiguous
  output, query strings, paths and foreign hosts.
- Read-only metadata then proved one pre-existing generated project staging
  alias pointed to the recovery deployment. --skip-domain sets
  autoAssignCustomDomains=false, not suppression of system staging aliases.
  The resident worker alias and custom domains did not move. This is a platform
  isolation prerequisite failure, not successful operational recovery.
- Compensating rollback restored only that exact alias to its snapshotted prior
  deployment. Readback verified restoration. Only the owned recovery deployment
  was removed, with platform 404 confirmed at 2026-10-08T21:01:29Z.
  Independent review-branch Preview updates were not rolled back.
- No recovery permit was claimed and the original encrypted credential remains
  unchanged. The CLI planner now requires verified absence of a pre-existing
  system alias. PRESENT or UNKNOWN fails before spawning. This project has a
  pre-existing alias, so the strict current authority cannot use that path.
- Do not stage another recovery deployment or invoke credential recovery until
  a supported alias-preserving method is proven, or the owner grants the narrow
  exception for temporary generated-alias reassignment and exact rollback.
  Do not weaken this gate based on successful source tests.
