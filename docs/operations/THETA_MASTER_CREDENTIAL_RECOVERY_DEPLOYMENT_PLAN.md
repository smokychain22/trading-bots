# Recovery-only deployment, approval required

State: TESTED_SOURCE_ONLY. No recovery deployment, credential replacement,
execution-control change, migration, worker restart or broker action is authorized
by this document. The normal application has no new credential-write route.

## Source and evidence

The owner-approved checkpoint 148d37d16eaa7a4efc5b3c5229fa055746ba45b6
was safely pushed to codex/theta-v4-integration. Exact CI 37832598196 failed
the Phase-3 source-byte binding assertion. Lint and typecheck passed. Later jobs,
including build, browser, Python and database integration, were skipped.
Do not call that run certified. The preceding failure 37827936349 remains
historical evidence, not overwritten by the new test execution.

Phase-3 reviewed tests were reexecuted, 264 passed, zero failed or skipped, before
regenerating its receipt. The recovery implementation requires a new local commit
and its own exact-SHA CI. Approval to push the older checkpoint does not authorize
pushing a different SHA. The final approval request must bind the certified source
and artifact hash, not a branch name or this plan's contents.

## Proposed deployment scope

- Existing project skillswap7/trading-bots, Production target only.
- Generate a separate private artifact outside Git. Only /api/recover-master
  exists. Do not deploy the repository's full application as the recovery artifact.
- Staged Production deployment with --prod --skip-domain. Never promote it or
  assign an existing domain alias. Snapshot alias, cron and worker identity before
  and after. On 2026-10-08 project API metadata showed zero cron definitions.
- Production-only Sensitive encryption key and key reference remain inside the
  Vercel runtime. Do not pull, export, copy, rotate or transmit them. Existing AES
  decryption must succeed before encryption of the replacement is attempted.
- Vercel Authentication must protect the exact generated deployment URL. Actual
  metadata reported all_except_custom_domains. No custom domain is used. Prove
  an unauthenticated request is denied before sending any replacement key.
- Authenticated Vercel CLI curl supplies platform protection. Application-level
  CRON_SECRET and an Ed25519 owner signature are also required. Secret headers and
  replacement payload go through stdin, not command arguments or temporary logs.
- An immutable permit pins source SHA, original physical account hash, previous
  ciphertext fingerprint and hash of the protected rollback file. Maximum window
  is five minutes. Generate it only for the separately approved operation.
- Never substitute another master or lab account. No external account selector
  is accepted. All broker calls are fixed-host Paper GETs, redirects forbidden.

## Mandatory no-submit boundary

The fresh read at 2026-10-08T19:49:37.957Z found persisted master execution enabled
and new orders not paused. Followers were disabled. Original identity and old
ciphertext still matched the protected rollback. Authentication failure is not
an execution lock.

The proposed recovery must therefore refuse the write in this state. It requires
known explicit no-submit environment flags and durable controls, including master
disabled, followers disabled and new orders paused. The durable control row is
rechecked and share-locked inside the credential transaction. No controls are
modified by the recovery code. Establishing a temporary full no-submit state,
if needed, is an additional owner-approved scope boundary. Do not silently pause,
unlock, resume or restart the worker. No promise of zero indirect broker activity
is valid while an enabled worker can resume after credential restoration.

## Exact database scope for approval

Credential row is selected by the existing active MASTER_THETA_PAPER / PAPER
designation and its existing token linkage. Private approval evidence records the
exact token and physical account identities outside Git. Only ciphertext, iv and
auth_tag in copy.alpaca_oauth_token change. Existing customer, key_ref, roles,
account identity, scope, positions, orders and policy remain unchanged.

One additional copy.operator_audit_event row consumes the recovery permit under
the existing master advisory transaction lock. This is disclosed auxiliary
Production mutation and needs inclusion in the final approval. It contains only
permit identity and hashes. No migration is required. A committed claim survives
crashes and rejects replay across serverless instances, including failed attempts.

## Rollback and partial failure

The existing protected ciphertext-only rollback is retained outside Git with owner
and SYSTEM access. Its file hash, encrypted-bundle hash and original physical
identity are verified before artifact preparation and pinned again before write.
Encryption key and plaintext credentials are never part of that rollback artifact.

Mismatch, changed controls, expiry or database failure before commit rolls back the
credential transaction. Unknown COMMIT or post-write verification failure must be
treated as possibly committed. Stop and perform read-only fingerprint and
canonical-provider authentication checks. Never blindly replay, automatically
restore expired credentials or claim failure proves no write. A consumed permit
requires a new separately approved permit for any further write attempt.

After success, verify canonical encrypted-provider authentication, original account
identity, account restrictions, current positions and open orders. Subsequent
read-only canonical ledger reconciliation and natural worker evidence are separate
from source certification. Do not close, roll or modify a position.

## Shutdown and cost

Consumed permit and expiry disable further invocation at application level.
Explicitly approve removal of only the recovery deployment after verified success,
or expiry, and verify its URL no longer serves recovery. Preserve receipts and the
protected rollback. Never delete or promote the active Production deployment.

The existing team reports Hobby. No new service, paid plan or new project is
proposed. Build/function/transfer usage consumes existing limits. Zero incremental
cost is not guaranteed without current quota confirmation. Stop at a paid-provider
boundary rather than purchase or upgrade anything.

Official supporting authorities:
[staged deployment](https://vercel.com/docs/cli/deploying-from-cli),
[protected CLI requests](https://vercel.com/docs/cli/curl),
[Sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

Reticle is skipped because these are backend, private packaging and CLI changes
with no deployed UI surface. This is not deployed endpoint verification.
