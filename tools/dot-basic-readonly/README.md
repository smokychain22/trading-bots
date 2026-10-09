# dot Basic read-only verification

## Review state and authority

This is a source-only, manual-run preparation for `smokychain22/trading-bots`, dedicated branch `codex/dot-basic-readonly-v1`. It is not a deployment, a persistent observer, an order manager, or authorization to trade. No actual API connection or GitHub Actions execution is established by the local tests.

The owner reports that GitHub Environment `dot-basic-readonly` exists. Its settings, protections, secret provenance, billing allowance, and current approved branch SHA must be checked separately. Nothing here modifies an Environment or creates credentials.

**Default-branch blocker:** GitHub must discover a `workflow_dispatch` workflow on the default branch before manual dispatch is available. Publishing this preparation only to the dedicated branch does not remove that blocker. A minimal default-branch launcher requires separate approval and review; this bundle neither supplies nor authorizes a main-branch write. Do not change the branch gate, add another trigger, merge to main, or use a different execution route to bypass this boundary.

## Published subset and provenance

Only this directory and `.github/workflows/dot-basic-readonly.yml` belong to this preparation. No trading application, repository package install, strategy, manager, storage journal, or other repository test is used in the protected job.

The unchanged `__init__.py`, `observations.py`, and `providers.py` are from accepted lab revision `8dce93563b8cb1a20a8635fddfb8e086750a1745`. The newly reviewed `verify_readonly.py` uses that existing GET-only provider. `SOURCE_SHA256SUMS` records the four module digests; the same values are embedded directly in the workflow. Replacing any module requires a newly reviewed hash set and commit. The manifest is a convenient local record, not an external trust root.

The workflow file uses JSON syntax, a subset of YAML. This lets its full structure be parsed using Python's standard library, without a package installation or a permissive custom YAML parser.

## Workflow boundaries

- The only event is `workflow_dispatch`; there is no schedule, push, pull-request, callable, or workflow-run trigger.
- Required input `reviewed_sha` must be exactly 40 lowercase hexadecimal characters, match the dispatch's `github.sha` byte for byte, and be on the exact dedicated repository/ref. A pre-checkout guard repeats these checks case-sensitively. GitHub job expressions alone compare strings case-insensitively.
- Only first attempts are accepted. A GitHub rerun is refused. Any new dispatch needs its own appropriate authorization.
- Both jobs use standard `ubuntu-24.04` runners and `contents: read` token permission. The secretless test job has a one-minute timeout; the protected verification job has a two-minute timeout. These limits are not proof of free usage or a guarantee of the billed total.
- One constant concurrency group prevents concurrent verification runs without cancelling a run already in progress.
- The only external action is official `actions/checkout` v4.2.2, pinned to verified commit `11bd71901bbe5b1630ceea73d27597364c9af683`. Credentials are not persisted; submodules, LFS, caches, services, containers, artifacts and dependency installation are absent.
- The source-test job is separate, has no GitHub Environment and references no secrets. Tests run with an empty inherited environment except a fixed system executable path, using synthetic data and transports.
- The protected job runs only after tests succeed. Its Environment is literally `dot-basic-readonly`. Before the secret-bearing step, it verifies the checkout's exact commit, rejects symlinked source paths, and checks the inline hashes. It then copies exactly the four approved modules into a new temporary directory; no repository tests, extra modules, or startup hook files are copied.
- Only the last step maps the three named secrets to process environment variables. No values are put in arguments or output. Python runs with `-E -s -S -B` to ignore Python environment overrides and site startup hooks, in the isolated source directory. The supervisor repeats those flags for its child.

A reviewed SHA entered by the dispatcher is an integrity selector, not an attestation that an independent reviewer approved it. Workflow code is itself part of the reviewed commit. The environment marker likewise cannot attest GitHub protection settings or secret origin.

## Protected values

The owner must personally enter the following values as secrets in the intended GitHub Environment:

- `THETA_ALPACA_PAPER_KEY_ID`
- `THETA_ALPACA_PAPER_SECRET_KEY`
- `THETA_ALPACA_PAPER_ACCOUNT_NUMBER`

Do not put values in this repository, chat, command arguments, logs or artifacts. Do not use Production credentials. The runtime compares the whole returned Paper account number with the protected expected value, and also checks the frozen required suffix; a suffix match alone is insufficient.

Before any authorized dispatch, confirm all three intended Environment secrets exist, the required reviewer/deployment-branch rules apply, and the runner has the intended quota/billing controls. GitHub may resolve a same-named repository or organization secret when an Environment secret is absent. Source code cannot attest which secret level supplied a value. Do not treat the Environment name or the non-secret `THETA_GITHUB_ENVIRONMENT` marker as that proof.

The read-only GitHub token does not make broker credentials read-only. The reviewed provider and verifier enforce the GET-only request boundary. Credential storage and actual network use each remain subject to the owner's authorization.

## Verification behavior

The fixed command, executed only in the protected step, is:

    /usr/bin/python3 -E -s -S -B -m theta_basic_lab.verify_readonly --enable-api-read --require-github-environment dot-basic-readonly

The CLI refuses missing opt-in, missing configuration, and an incorrect required GitHub marker/context. It returns one compact, schema-validated JSON object. Only fixed status/stage/evidence/failure-code strings, boolean checks, bounded counts, and fixed limitations are emitted. Account identifiers, amounts, holdings/symbols, raw responses, headers, exception text, timestamps, and credentials are excluded.

The supervisor enforces a 45-second process wall deadline plus at most two seconds to reap a terminated child, including a stalled DNS resolver. The API phase has a shared 40-second deadline, at most nine GET requests, at most four seconds per request, and at most 256 KiB per response. The Linux worker additionally limits CPU, address space, open descriptors and output size. There are no automatic retries.

The fixed read set checks exact Paper account identity and selected capabilities, authenticated market clock, positions, open orders, one IEX stock bar and trade, bounded SPY option metadata, and one indicative option quote and snapshot. It never sends an order mutation, cancel, replace, exercise, or assignment action. Existing provider capability to read other endpoints is not used by this verifier.

Exit 0 requires a `PASSED` report. `REFUSED`, `FAILED`, `INCOMPLETE`, and `TIMEOUT` return exit 2. A closed market, malformed or stale evidence, incomplete broker listing, failed authorization, or missing expected data cannot be reported as a successful full check. A successful bounded metadata probe still does not establish a complete option chain.

Even an eventual authenticated pass is only a bounded prerequisite check. IEX is not consolidated SIP; indicative option observations are not executable OPRA BBO. The check cannot establish atomic broker state, forward observation history, actual fill evidence, qualified publication times, unattended hosting, or trading/risk approval.

## Local checks

From this directory, with Python 3.12+ and no added packages:

    env -i PATH=/usr/bin:/bin /usr/bin/python3 -E -s -S -B -m unittest discover -s tests -v

The focused suite tests new synthetic verifier and process-bound behavior, independent verifier regressions, and complete workflow structure. Previously accepted provider/observation suites are not repeated in this publication subset. It also executes the dispatch guard against invalid inputs and exercises immutable staging against tampering, symlinks, missing modules and wrong checked-out commits. No test needs a broker credential or actual API response.

The structural staging tests create isolated, temporary Git repositories solely as local test fixtures. They do not use remotes, write the target branch or contact GitHub.

## Source references

- [Official checkout v4.2.2 release](https://github.com/actions/checkout/releases/tag/v4.2.2)
- [Pinned official checkout commit](https://github.com/actions/checkout/commit/11bd71901bbe5b1630ceea73d27597364c9af683)
- [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Manual workflow discovery and default-branch requirement](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
- [GitHub Environment settings](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub secret scope precedence](https://docs.github.com/en/actions/reference/security/secrets)
