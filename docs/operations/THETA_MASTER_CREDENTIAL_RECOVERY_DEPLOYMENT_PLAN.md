# Recovery-only deployment, conditional owner authority

State: TESTED_SOURCE_ONLY. The consolidated owner mission supplied 2026-10-09
conditionally authorizes minimum durable no-submit controls, protected standalone
recovery deployment and one credential-only replacement after all prerequisites
pass. This document grants no authority by itself. No broker action, new-risk
resumption, migration 071 or broad runtime replacement is authorized. The normal
application has no new credential-write route.

## Source and evidence

The owner-approved checkpoint 148d37d16eaa7a4efc5b3c5229fa055746ba45b6
was safely pushed to codex/theta-v4-integration. Exact CI 37832598196 failed
the Phase-3 source-byte binding assertion. Lint and typecheck passed. Later jobs,
including build, browser, Python and database integration, were skipped.
Do not call that run certified. The preceding failure 37827936349 remains
historical evidence, not overwritten by the new test execution.

Phase-3 reviewed tests were reexecuted, 264 passed, zero failed or skipped, before
regenerating its receipt. The recovery implementation requires a new local commit
and its own exact-SHA CI. The latest mission permits safe corrective review-branch
pushes within this recovery scope. Checkpoint f98f0ffb2c9a3f0f31a2585a54dad5dc132fba96
was pushed without force, with run 37837291258 started. Subsequent fixes require
their own exact-SHA certification. Execution must bind certified source and
artifact hash, not a branch name or this plan's contents.

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

The recovery must refuse the write in this state. Raw environment flags must be
explicit known booleans, with followers disabled. Durable controls must prove
master disabled, followers disabled and new orders paused. The deployed runtime
ANDs environment and durable master authority, so the durable full lock blocks
both entry and management without changing Sensitive environment variables. The
durable row is rechecked and share-locked inside the credential transaction.
No controls are modified by the recovery endpoint.

The deployed runtime caches controls per invocation. Before restoring credentials,
prove pre-lock invocations have drained, no mutation is in flight, no ambiguous
submission is unresolved and fresh runtime observations use the full lock. The
latest owner mission conditionally permits this minimal durable lock but does
not authorize resumption. Automatic protective closes are disabled during a full
lock. Monitoring, evidence collection and quote qualification remain separate.

## Exact database scope for approval

Credential row is selected by the existing active MASTER_THETA_PAPER / PAPER
designation and its existing token linkage. Private approval evidence records the
exact token and physical account identities outside Git. Only ciphertext, iv and
auth_tag in copy.alpaca_oauth_token change. Existing customer, key_ref, roles,
account identity, scope, positions, orders and policy remain unchanged.

One additional copy.operator_audit_event row consumes the recovery permit under
the existing master advisory transaction lock. This is disclosed auxiliary
Production mutation included in the consolidated conditional mission. It contains only
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
requires read-only diagnosis and a new governed authorization before another
credential-write attempt. Do not infer automatic retry authority.

After success, verify canonical encrypted-provider authentication, original account
identity, account restrictions, current positions and open orders. Subsequent
read-only canonical ledger reconciliation and natural worker evidence are separate
from source certification. Do not close, roll or modify a position.

## Shutdown and cost

Consumed permit and expiry disable further invocation at application level.
The consolidated mission permits removal of only the recovery deployment after
verified success or expiry. Verify its URL no longer serves recovery. Preserve receipts and the
protected rollback. Never delete or promote the active Production deployment.

The existing team reports Hobby. No new service, paid plan or new project is
proposed. Build/function/transfer usage consumes existing limits. Zero incremental
cost is not guaranteed without current quota confirmation. Stop at a paid-provider
boundary rather than purchase or upgrade anything.

Official supporting authorities:
[staged deployment](https://vercel.com/docs/cli/deploying-from-cli),
[protected CLI requests](https://vercel.com/docs/cli/curl),
[Sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).

Raw-body integration is checked against Vercel's Node
[restoreBody implementation](https://github.com/vercel/vercel/blob/main/packages/node/src/serverless-functions/helpers.ts).
It restores event reads while the original stream can remain ended. The handler
therefore reads bounded raw data/end events, never parsed JSON reserialization.
Synthetic restored-stream, oversized-chunk and aborted-request tests cover this.

The deploy child must use `recoveryDeploymentInvocation` and set its actual cwd
to the private standalone artifact. Pass explicit `--local-config` as well as
`--cwd`. Vercel loads its initial config before applying the latter override.
Starting the child in the repository can import the normal trading deployment
config despite --cwd, as reproduced by the preserved unused_function incident.
The invocation planner rejects a broader config or extra API function.
See [CLI global options](https://vercel.com/docs/cli/global-options).
Preserve bounded private failure diagnostics, identify and remove only the owned
failed recovery deployment, and re-prove all gates after correcting tooling.
Never infer that staging success authorizes a credential-request replay.

Operationally verified limitation: --skip-domain disables custom-domain
promotion, but still assigned the system staging alias in this project. Strict
preservation of every pre-existing alias therefore cannot be claimed. The
CLI invocation planner rejects PRESENT or UNKNOWN system-alias state. The
2026-10-08 temporary mapping was rolled back to its exact prior destination and
the isolated recovery deployment removed before any credential invocation.
Do not use this path again without a supported alias-preserving mechanism or
an explicit owner exception permitting that narrow temporary reassignment and
compensating rollback. Never broaden this to normal Production promotion.
Official [staged-deployment scope](https://vercel.com/docs/cli/alias) specifically
describes skipping custom domain assignment.

Reticle is skipped because these are backend, private packaging and CLI changes
with no deployed UI surface. This is not deployed endpoint verification.
