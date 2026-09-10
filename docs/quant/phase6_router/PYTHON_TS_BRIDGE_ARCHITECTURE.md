# Python ↔ TypeScript Bridge — Architecture Specification

Durability artifact. **SPECIFIED, not implemented** — this is the single most
consequential remaining R1 gap flagged across this engagement's last several handoffs,
and this document exists so the design is settled before implementation, not
discovered ad hoc.

## Principle

Python quant (`bots/theta/quant/`) is mathematical/policy truth. TypeScript
(`src/theta/`) orchestrates: validates, type-checks, sequences, and packages Python's
output — it never recomputes a formula Python already owns. Every existing TS contract
in this repository (`theta-q-contract.ts`, `management-contract.ts`, `aegis-contract.ts`,
`sizing-contract.ts`, `execution-quality-contract.ts`, `ownership-contract.ts`,
`regime-contract.ts`, `strategy-router-contract.ts`) already assumes *something*
produces a JSON payload matching its schema — none of them yet specify *what* that
something is. This document does.

## Design

- **Invocation mechanism:** a child process (`node:child_process.spawn`, not `exec`, to
  avoid shell interpretation and injection risk) running a fixed, versioned Python
  entrypoint script per model family (e.g. `bots/theta/quant/runtime/
  management_action_value_cli.py`, mirroring the existing
  `bots/theta/quant/runtime/theta_q_contract.py` pattern already in this repo).
  Arguments passed as a single JSON blob on stdin, never as command-line arguments
  (avoids argument-length limits and any shell-escaping question entirely) — this also
  means there is no string-concatenated command to construct, eliminating the
  shell-injection surface this task explicitly names as a requirement.
- **Output:** JSON on stdout only; the Python process must write nothing else to
  stdout. Diagnostic/error detail goes to stderr, captured separately and **scanned
  for secret-shaped content before logging** (reusing this repo's existing
  `tools/security-scan.mjs` patterns as the reference for what "secret-shaped" means)
  — never logged raw.
- **Timeout:** a hard wall-clock timeout per invocation (value TBD per model family —
  a management-decision call should be fast; this is a policy decision for whoever
  implements it, not invented here). On timeout, the TS caller treats the result as
  `UNKNOWN` and fails closed exactly like `decision-assembly.ts`/`management-assembly.ts`
  already do for a missing/invalid response — no special-casing needed, since those
  modules already accept "the expected response never arrived" as a first-class case.
- **Process failure (non-zero exit):** same fail-closed treatment as timeout.
- **Schema validation:** the existing Zod schemas (`*-contract.ts`) are the validation
  layer — stdout is parsed as JSON, then validated through the matching
  `parse*Response` function. A schema violation is treated identically to a process
  failure (fail closed), never partially trusted.
- **Policy/model version verification:** every contract already carries
  `policyVersion`/`modelVersions` fields for this reason — the TS caller compares the
  response's versions against what it expected (exactly what
  `decision-assembly.ts`/`management-assembly.ts` already do internally) and fails
  closed on mismatch. The bridge itself doesn't need separate version-checking logic;
  it needs to make sure the Python process reports its actual running version
  faithfully (read from the same source `models/common.py`-adjacent version constants
  would define — not yet named, a small addition needed at implementation time).
- **Snapshot hash:** every request includes the calling `FusionSnapshot`'s content
  hash; every response that references a snapshot must echo it back, and the TS side
  rejects a mismatch (`theta-q-contract.ts`'s `parseThetaQResponse` already does
  exactly this — the pattern generalizes to every other model family without
  modification).
- **Deterministic test fixtures:** given identical stdin JSON and identical model/
  policy versions, the Python side must produce byte-identical stdout (true today for
  every existing model, since all are deterministic transparent baselines, not fitted
  models with any randomness) — this makes integration tests straightforward once
  written: fixed input → fixed expected output, no mocking needed beyond the process
  boundary itself.
- **Observability:** log (without secrets) invocation start/end timestamps, model
  family, policy/model version, exit code, duration, and whether the result was
  used or fell back to fail-closed — correlated by the same `decisionId`/`snapshotId`
  identifiers already threaded through every contract.

## What's already built that this connects to

Nothing in this bridge needs to change any existing contract file — every one of them
already expects exactly this shape of input (a validated JSON payload) and produces
exactly this shape of output (a validated JSON payload). The bridge is purely the
missing "how does the JSON actually get from the Python process to the TS caller"
piece connecting already-built endpoints.

## Status

SPECIFIED. No process-spawning code exists yet. This is the concrete next
implementation task once a session has the budget to build it carefully (it is
genuinely security-relevant — process invocation, secret-scrubbing, and injection
avoidance all need real care, not a rushed first pass).
