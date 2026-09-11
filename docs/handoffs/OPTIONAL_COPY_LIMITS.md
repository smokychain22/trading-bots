# Optional follower limits

OWNER: Codex

TASK: Preserve recommended, null, zero and custom follower limits without enabling orders.

FILES CHANGED: Customer policy schema/store/API/view models, copy form, migration 011, browser/unit/database tests and CI.

WHAT WAS IMPLEMENTED: Recommended settings persist as null user overlays. Custom caps, including zero, round-trip through the API and database. Mandatory platform controls remain required. Saved policy versions link to participation. The master account cannot enter the copy form.

TESTS RUN: Type check, lint, build, security scan, Node tests, browser tests.

TEST RESULTS: 419 Node tests passed with the disposable database test skipped locally. All 22 browser tests passed, including desktop/tablet/mobile copy-limit flows and accessibility assertions. Secret scan found zero findings. CI runs the new persistence test against disposable PostgreSQL after all migrations. Reticle gate returned no_flows, not a pass.

KNOWN LIMITATIONS: Production migrations 010 and 011 and owner master-role designation remain unverified while production access is unavailable. This change must not deploy before migration 011. Browser account responses are explicit test fixtures, not proof of production connectivity.

RISKS: Null removes only the user overlay, never platform risk controls. Runtime integration must resolve mandatory policy before execution. No order submission is enabled by this milestone.

WHAT THE OTHER AGENT SHOULD REVIEW: Policy null semantics and platform/user cap composition at the runtime integration boundary.

NEXT RECOMMENDED TASK: Verify CI database results, apply production migrations using restored secure access, designate the verified owner account, then continue runtime integration. Stop before any first broker order.
