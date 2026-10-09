# Bounded read-only integration publication

Date: 2026-10-09. Repository public status verified in GitHub UI.
Research branch: codex/dot-basic-readonly-v1.
Base main commit: 356aaf742117e962fdecdbb107240a93edc35ac3.
Accepted GET-only source origin: 8dce93563b8cb1a20a8635fddfb8e086750a1745.

## Cost boundary
GitHub documents standard hosted runners as free for public repositories. Larger runners are chargeable. Artifact storage is pooled with Packages; cache has separate included allowance. Logs/job summaries do not count against artifact storage. No billing settings were inspected or changed; existing accrued charges are not represented as zero.
Source: https://docs.github.com/en/billing/concepts/product-billing/github-actions (read 2026-10-09).

New workflow: standard ubuntu-24.04 only, one manual dispatch, no schedule, no cache, artifact upload, packages, container, dependency install or custom image. Existing CI: on this research branch only, npm caching and both artifact uploads suppressed. All existing test/security steps retained. Main and V4 conditions unchanged.

Vercel automatic deployment disabled for this exact research branch by git.deploymentEnabled false; no other existing configuration changes. Source: https://vercel.com/docs/project-configuration/git-configuration .

Intermediate browser commits use [skip ci] while assembling the source. This is not passing CI evidence. Final checkpoint will use normal source CI; protected GET verification still requires separate owner approval and cannot run from push.

## Dispatch boundary
A newly introduced workflow_dispatch workflow must exist on the default branch to be registered for manual dispatch. Research-only publication is not runnable by itself. No default-branch write, merge or dispatch has been authorized/performed.
Source: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow .

Environment dot-basic-readonly and all three expected secret names were verified read-only in UI. Values never opened. At 17:13 UTC required reviewers were off and deployment branches unrestricted; owner notified. Recheck actual protections and exact approved SHA immediately before a future authorized run.

## Runtime limitation
No authenticated API probe, actual data observation or order submission is established by synthetic tests or source publication. This job tests prerequisite connectivity only, with private responses held ephemerally and only a fixed sanitized status schema emitted. No always-on hosting, persistent market observation, executable OPRA pricing, order transport or position-management certification is implied. Original strategy/manager prototypes remain unchanged.
