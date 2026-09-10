import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// R1I: the controlled Python <-> TypeScript bridge, per
// docs/quant/phase6_router/PYTHON_TS_BRIDGE_ARCHITECTURE.md.
//
// Python owns quantitative/policy calculations; this module owns
// invocation, validation, and fail-closed packaging only -- it never
// interprets or recomputes what a Python script returns. No shell is ever
// invoked (spawn() with a fixed argv array, never a concatenated command
// string) and only allowlisted script paths may be run, so there is no
// shell-injection surface and no way to invoke an arbitrary script.
//
// A Python timeout or malformed response NEVER silently becomes WAIT or
// OPEN -- it becomes one of the explicit failure codes below, which the
// caller (decision-assembly.ts / management-assembly.ts style composition)
// must treat as "cannot confirm a positive decision," i.e. fail closed,
// exactly as those modules already do for a missing/invalid response.

export interface PythonBridgeConfig {
  readonly pythonExecutablePath: string;
  readonly scriptAllowlist: ReadonlyMap<string, string>; // model family name -> absolute script path
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export type PythonBridgeFailureCode =
  | 'UNKNOWN_MODEL_FAMILY'
  | 'TIMEOUT'
  | 'PROCESS_ERROR'
  | 'NON_ZERO_EXIT'
  | 'OUTPUT_TOO_LARGE'
  | 'EMPTY_OUTPUT'
  | 'MALFORMED_JSON';

export type ValidationFailureCode = 'SCHEMA_VALIDATION_FAILED' | 'VERSION_MISMATCH' | 'SNAPSHOT_MISMATCH';

interface BridgeSuccess {
  readonly ok: true;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly stdout: string;
}

interface BridgeFailure {
  readonly ok: false;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly failureCode: PythonBridgeFailureCode;
  readonly detail: string;
}

export type PythonBridgeResult = BridgeSuccess | BridgeFailure;

export interface ValidatedSuccess<T> {
  readonly ok: true;
  readonly data: T;
  readonly correlationId: string;
  readonly durationMs: number;
}

export interface ValidatedFailure {
  readonly ok: false;
  readonly correlationId: string;
  readonly durationMs: number;
  readonly failureCode: PythonBridgeFailureCode | ValidationFailureCode;
  readonly detail: string;
}

export type ValidatedBridgeResult<T> = ValidatedSuccess<T> | ValidatedFailure;

export interface VersionExpectation {
  readonly expectedSnapshotHash?: string;
  readonly expectedPolicyVersion?: string;
  readonly expectedModelVersions?: Readonly<Record<string, string>>;
}

// Redacts anything shaped like a credential (key/secret/token/password
// followed by a long alphanumeric value) from process error output before
// it is ever logged or returned -- mirrors the heuristic
// tools/security-scan.mjs already applies to source files, applied here to
// live stderr content instead.
const SECRET_SHAPED_PATTERN = /(api[_-]?key|secret|token|password)(\s*[:=]\s*)['"]?[A-Za-z0-9_-]{8,}['"]?/gi;

export function redactSecretShapedContent(text: string): string {
  return text.replace(SECRET_SHAPED_PATTERN, '$1$2<redacted>');
}

/**
 * Invokes one allowlisted Python model script with a JSON payload on stdin
 * and returns its raw stdout (still unparsed/unvalidated) or an explicit
 * failure. Never throws -- every failure path resolves to `ok: false`.
 */
export function invokePythonModel(
  config: PythonBridgeConfig,
  modelFamily: string,
  requestPayload: unknown,
): Promise<PythonBridgeResult> {
  const correlationId = randomUUID();
  const startedAt = Date.now();

  const scriptPath = config.scriptAllowlist.get(modelFamily);
  if (scriptPath === undefined) {
    return Promise.resolve({
      ok: false, correlationId, durationMs: 0, failureCode: 'UNKNOWN_MODEL_FAMILY',
      detail: `No allowlisted script for model family: ${modelFamily}`,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(config.pythonExecutablePath, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: PythonBridgeResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false, correlationId, durationMs: Date.now() - startedAt, failureCode: 'TIMEOUT',
        detail: `Python process exceeded ${config.timeoutMs}ms timeout.`,
      });
    }, config.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > config.maxOutputBytes) {
        finish({
          ok: false, correlationId, durationMs: Date.now() - startedAt, failureCode: 'OUTPUT_TOO_LARGE',
          detail: `stdout exceeded the ${config.maxOutputBytes}-byte limit.`,
        });
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      finish({
        ok: false, correlationId, durationMs: Date.now() - startedAt, failureCode: 'PROCESS_ERROR',
        detail: redactSecretShapedContent(error.message),
      });
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      const durationMs = Date.now() - startedAt;
      if (exitCode !== 0) {
        finish({
          ok: false, correlationId, durationMs, failureCode: 'NON_ZERO_EXIT',
          detail: redactSecretShapedContent(stderr.trim().length > 0 ? stderr : `exit code ${String(exitCode)}`),
        });
        return;
      }
      if (stdout.trim().length === 0) {
        finish({ ok: false, correlationId, durationMs, failureCode: 'EMPTY_OUTPUT', detail: 'Python process produced no stdout.' });
        return;
      }
      finish({ ok: true, correlationId, durationMs, stdout });
    });

    child.stdin.write(JSON.stringify(requestPayload));
    child.stdin.end();
  });
}

/**
 * Invokes a model, parses stdout as JSON, validates it through the
 * caller-supplied schema parser, and verifies snapshot/version consistency.
 * `parse` should throw on invalid input (e.g. a Zod schema's `.parse`) --
 * this function converts that throw into a `SCHEMA_VALIDATION_FAILED`
 * result rather than propagating an exception, so a caller never needs a
 * try/catch of its own around this call.
 */
export async function invokeAndValidate<T>(
  config: PythonBridgeConfig,
  modelFamily: string,
  requestPayload: unknown,
  parse: (payload: unknown) => T,
  expectations: VersionExpectation = {},
): Promise<ValidatedBridgeResult<T>> {
  const raw = await invokePythonModel(config, modelFamily, requestPayload);
  if (!raw.ok) {
    return raw;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.stdout);
  } catch {
    return { ok: false, correlationId: raw.correlationId, durationMs: raw.durationMs, failureCode: 'MALFORMED_JSON', detail: 'stdout was not valid JSON.' };
  }

  let data: T;
  try {
    data = parse(parsedJson);
  } catch (error) {
    return {
      ok: false, correlationId: raw.correlationId, durationMs: raw.durationMs, failureCode: 'SCHEMA_VALIDATION_FAILED',
      detail: error instanceof Error ? error.message : 'Schema validation failed.',
    };
  }

  const record = data as unknown as Record<string, unknown>;

  if (expectations.expectedSnapshotHash !== undefined && record.fusionSnapshotHash !== expectations.expectedSnapshotHash) {
    return { ok: false, correlationId: raw.correlationId, durationMs: raw.durationMs, failureCode: 'SNAPSHOT_MISMATCH', detail: 'Response fusionSnapshotHash does not match the expected snapshot.' };
  }
  if (expectations.expectedPolicyVersion !== undefined && record.policyVersion !== expectations.expectedPolicyVersion) {
    return { ok: false, correlationId: raw.correlationId, durationMs: raw.durationMs, failureCode: 'VERSION_MISMATCH', detail: 'Response policyVersion does not match the expected policy version.' };
  }
  if (expectations.expectedModelVersions !== undefined) {
    const actualModelVersions = record.modelVersions as Record<string, string> | undefined;
    for (const [name, expected] of Object.entries(expectations.expectedModelVersions)) {
      if (actualModelVersions?.[name] !== expected) {
        return { ok: false, correlationId: raw.correlationId, durationMs: raw.durationMs, failureCode: 'VERSION_MISMATCH', detail: `modelVersions.${name} mismatch.` };
      }
    }
  }

  return { ok: true, data, correlationId: raw.correlationId, durationMs: raw.durationMs };
}
