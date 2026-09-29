# Historical R6 export hash verdict, 2026-09-29

This is a read-only forensic finding on the local `research_exports` copy. It
does not edit an archive, reissue a dataset hash, authorize a model, or certify
the backup chain.

## Producer contract and root cause

The archived v1 files were produced by `buildDatasetExport` in
`src/research/point-in-time-evidence.ts`. The v1 exporter selected PostgreSQL
timestamp columns as JavaScript `Date` values. Before commit `e213081`,
`canonicalize` treated a `Date` as an ordinary object with zero enumerable
properties. The producer hash therefore included `{}` for each top-level
PostgreSQL timestamp. The separate `JSON.stringify(artifact)` write serialized
those same `Date` values as ISO timestamp strings. Rehashing the saved JSON
with the documented modern formula cannot reproduce the original hash.

Commit `e213081` added explicit `Date` serialization to the canonicalizer.
Some later v1 exports therefore use date-aware hashes. The earlier v1 identity
also changed its treatment of `exportedAt`. The forensic verifier tests both
historical identity scopes and both date behaviors. It does not relax the
current Production loader's hash gate.

## Real local evidence

The local export directory has 109 distinct SHA-named dataset directories.
Read-only inspection found 106 v1 exports and one each at v3, v5, and v6.
The original producer hash was reproduced for 104 v1 files using the
date-elision, `exportedAt`-excluded variant. The other two v1 files match the
date-aware, `exportedAt`-excluded variant. All three later-version files match
the current date-aware identity formula. No file needed a rewritten hash.

One representative v1 archive, declared hash
`00480c2cb00d33ccdbabcefb6b70baf28e74ceb208826c93901a3ec71d7bc24e`,
reproduced that exact hash after 7,123 selected timestamp fields were
represented as the original producer's `{}` value. The modern hash of the
saved JSON did not match. Across the 104 date-elision exports, the verifier
encountered 307,953 selected timestamp fields. The newer v1 variants were
checked separately against the unmodified saved timestamp strings.

## Integrity limit

For the 104 date-elision exports, the declared dataset hash did not protect
the selected timestamp values. A changed timestamp can retain the same legacy
hash. The verifier's regression test demonstrates this explicitly. Matching
the historical producer hash proves the mismatch mechanism and consistency
with that producer. It does not prove that the timestamp text in a copied file
is unchanged from the original database observation. Manifest and backup byte
hashes, where available, need separate verification. The three newer exports
and two later v1 exports have date-aware dataset hashes, but hash matching
alone still does not grant empirical promotion.

The recovered population remains 7,550 unique candidates, 302 decisions,
zero selected candidates, and zero resolved outcomes in the previously
deduplicated research audit. No profitability, fill, assignment, or
feature-ablation promotion follows from this hash finding.

The isolated integration branch contains
`src/research/legacy-v1-export-hash.ts` and focused tests. The verifier is
forensic and returns `promotionGrade=false` for every result. It is not a
second Production dataset loader.
