# Production Neon and master designation

OWNER: Codex

TASK: Verify production Neon, enforce migrations 010/011, and designate the authenticated connected Alpaca Paper account without guessing identity.

FILES CHANGED: Production database verifier, authenticated-candidate resolver, master designation command, tests, package script.

WHAT WAS IMPLEMENTED: The database verifier now requires all 11 migrations, account-role and optional-limit schema, self-copy protections, and a locked execution gate. The designation command resolves exactly one active customer with an unexpired session, connected private-beta account, and active encrypted credential. It performs read-only broker reverification before promotion and aborts on zero or multiple candidates.

TESTS RUN: Type check, lint, Node tests, security scan, real production database verification.

TEST RESULTS: Production Neon connected with 11 migrations and zero broker orders. Local suite passed 420 tests with one disposable-database test skipped. Secret scan found zero findings. The designation attempt stopped before a write because the pulled encryption key is not a valid 32-byte key.

KNOWN LIMITATIONS: The Vercel private-beta flag and encryption-key values are invalid placeholders. The existing credential cannot be decrypted with the configured key, so broker identity is not yet reverified and the role remains FOLLOWER_THETA_PAPER.

RISKS: Rotating the encryption key makes the existing ciphertext permanently unreadable unless the original key is recovered. The customer must reconnect their Alpaca Paper credential after a rotation. No order path was enabled or called.

WHAT THE OTHER AGENT SHOULD REVIEW: None in the quant branch. Keep quant work isolated.

NEXT RECOMMENDED TASK: Recover the original encryption key from a secure owner store, or rotate it and reconnect the owner Paper credential. Then rerun the designation command and production verification.
