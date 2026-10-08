# Dot proposal exchange

This folder is the non-sensitive GitHub interface between Dot's cloud research and Codex engineering. It contains configuration, hypotheses and synthetic examples only. It never contains accounts, observations, fills, private receipts, credentials or databases.

The five examples use the existing THETA canonical strategy registry. They are disabled research drafts, not approved trading versions. Dot can copy an example and propose a new version, lattice, soft feature families, research-only filter bounds, planned holding period or profit-taking comparison. Use an existing parent proposal hash for revisions after the parent has been imported into the private lab.

Codex validates each proposal with:

```
node --import tsx tools/validate-dot-proposals.ts research/dot-proposals/examples/theta-conventional.json
```

The validator requires an exact canonical baseline, preserves hard rules and risk/cost/execution references, and rejects execution activation, new actions, duplicate local versions and known secret/account markers. A marker scan cannot prove arbitrary prose contains no secret. Every GitHub submission still needs human/engineering diff review.

Validated drafts can be imported through the isolated lab's proposer-scoped `/v1/proposals` route. GitHub ingestion is deliberate, not a webhook that activates code. The read-only MCP tools cannot submit proposals or orders. Validation does not merge, deploy, migrate, reserve trading capital or grant Paper authority.

## Handoff fields

Use a pull request or engineering handoff containing proposal file, baseline hash, parent proposal hash, hypothesis, intended evidence, paired baseline/challenger comparison, unavailable inputs, required consumer changes, tests and exact source SHA. Codex remains the integration authority. Never paste credentials or account records into the handoff.

Actual Dot access to this repository requires its existing GitHub connection to include this repository. A file committed locally is not proof that Dot can read it. Push approval and a real Dot repository read are separate gates.
