#!/usr/bin/env -S npx tsx
/**
 * OVERNIGHT WAVE §19/§46: the runnable research dataset-build CLI.
 * RESEARCH-ONLY -- imports exclusively from `src/research/`, never
 * `src/theta/`, `src/execution/`, or any Production runtime module.
 * `brokerAuthority: false` throughout; this tool has no path to a
 * Production write of any kind.
 *
 * Usage: npx tsx tools/theta-research-dataset-cli.ts <bundle.json>
 *
 * Pipeline: load bundle -> validate schema -> validate PIT -> build
 * dataset -> unknown audit -> emit hashes/counts -> session report.
 * Works today against a fixture/synthetic bundle; when Codex's first real
 * observation bundle arrives in this exact shape, this same command
 * consumes it with zero new code (the real-data-arrival-harness
 * guarantee this CLI is a thin wrapper around).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  runRealDataArrivalPipeline, type ObservationBundle,
} from '../src/research/real-data-arrival-harness.js';

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const bundlePath = process.argv[2];
if (bundlePath === undefined) fail('Usage: theta-research-dataset-cli.ts <bundle.json>');

let raw: string;
try {
  raw = readFileSync(bundlePath as string, 'utf8');
} catch (error) {
  fail(`CLI_MISSING_FILE: ${bundlePath}: ${error instanceof Error ? error.message : String(error)}`);
}

let bundle: ObservationBundle;
try {
  bundle = JSON.parse(raw as string) as ObservationBundle;
} catch (error) {
  fail(`CLI_MALFORMED_JSON: ${error instanceof Error ? error.message : String(error)}`);
}

if (typeof bundle !== 'object' || bundle === null || !Array.isArray(bundle.rows)) {
  fail('CLI_UNSUPPORTED_BUNDLE_SHAPE: expected an ObservationBundle with a rows array');
}

const result = runRealDataArrivalPipeline(bundle);

if (!result.schemaValid) {
  process.stdout.write(JSON.stringify({ status: 'SCHEMA_INVALID', schemaFailures: result.schemaFailures }, null, 2));
  process.exit(1);
}
if (!result.pitValid) {
  process.stdout.write(JSON.stringify({ status: 'PIT_INVALID', pitFailures: result.pitFailures }, null, 2));
  process.exit(1);
}

const bundleHash = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');

process.stdout.write(JSON.stringify({
  status: 'OK',
  bundleId: bundle.bundleId,
  bundleHash,
  rowCount: bundle.rows.length,
  identifiabilityStatus: result.dataset?.identifiabilityStatus ?? null,
  unknownCount: result.unknownAudit.length,
  unknownAudit: result.unknownAudit,
  sessionReportCycleCount: result.sessionReportCycleCount,
}, null, 2));
