# Master Paper account role milestone

OWNER: Codex

TASK: Owner roadmap items 1-2, explicit master role and self-copy prevention.

FILES CHANGED: migration/test 010, paper-account-role service, customer store/API/readiness, unit and authorization tests.

WHAT WAS IMPLEMENTED: Additive persisted account role, global broker-identity uniqueness across customer workspaces, single-master uniqueness, immutable master identity, copy-policy/event/participation guards, and execution-account identity guard. Owner-only GET/POST `/api/v1/operator/master-account` lists masked connections or verifies a selected connection against Alpaca Paper before transactional promotion. Promotion never enables execution. Existing follower history or execution mapping blocks promotion pending reconciliation. Credential replacement preserves a designated master role and cannot silently replace its broker identity. The generic connection getter remains compatible before migration 010 through JSON field access.

TESTS RUN: 416 Node tests passed, type check, lint, build, and security scan passed. SQL invariants are included for CI's disposable PostgreSQL. Local Docker startup was attempted but the engine was unavailable. Do not claim local PostgreSQL tests ran.

KNOWN LIMITATIONS: Production migration and owner designation are pending secure owner/database access. The browser session observed cannot access the canonical Vercel project and local environment values are redacted. No account selection is guessed. Runtime master credential routing and full execution integration remain later work. This milestone does not complete steps 3-10.

RISKS: Migration fails on pre-existing duplicate broker identities rather than deleting data. Promoting a connection with follower history needs an explicit reconciliation procedure. This is deliberate, not an instruction to remove history. New migration must pass schema tests before promotion.

WHAT THE OTHER AGENT SHOULD REVIEW: Preserve the production customer/account surface while continuing isolated R1 work. Master role is independent of connection method. No quant files are changed.

NEXT RECOMMENDED TASK: Apply 010 through the existing secure database integration after owner access is restored, verify the specific owner's account and persist its role, then complete optional follower-limit storage and UX. Orders remain locked.
