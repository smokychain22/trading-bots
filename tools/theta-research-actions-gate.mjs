#!/usr/bin/env node
/**
 * Public-repository, research-only admission gate for the bounded THETA
 * workflow. This file deliberately has no dependency on broker, database,
 * provider, execution, or deployment modules.
 */
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_VERSION = 'theta-zero-cost-actions-policy-v1';
const CALENDAR_VERSION = 'cboe-us-options-rth-calendar-v1';
const MANIFEST_VERSION = 'theta-public-research-evidence-manifest-v1';
const SAFE_OUTPUT = /^[A-Za-z0-9_.:-]+$/;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ALLOWED_EVIDENCE_CLASSES = new Set([
  'REAL_MARKET_EVIDENCE',
  'SYNTHETIC_TEST',
  'DETERMINISTIC_SCENARIO_COMPARISON',
]);

export function parseArguments(argv) {
  const parsed = {};
  for (const argument of argv) {
    if (!argument.startsWith('--')) throw new Error('UNEXPECTED_POSITIONAL_ARGUMENT');
    const body = argument.slice(2);
    const split = body.indexOf('=');
    if (split === -1) parsed[body] = true;
    else parsed[body.slice(0, split)] = body.slice(split + 1);
  }
  return parsed;
}

export function readJsonFile(path, maximumBytes = 1_048_576) {
  const size = statSync(path).size;
  if (size > maximumBytes) throw new Error('JSON_FILE_EXCEEDS_BOUND:' + basename(path));
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function requireString(value, name, errors) {
  if (typeof value !== 'string' || value.length === 0) errors.push(name + '_REQUIRED');
}

export function validatePolicy(policy) {
  const errors = [];
  if (policy?.contractVersion !== POLICY_VERSION) errors.push('POLICY_VERSION_INVALID');
  if (policy?.expectedRepository !== 'smokychain22/trading-bots') errors.push('POLICY_REPOSITORY_INVALID');
  if (policy?.requiredVisibility !== 'public') errors.push('POLICY_VISIBILITY_INVALID');
  if (policy?.requiredRunnerLabel !== 'ubuntu-24.04') errors.push('POLICY_RUNNER_INVALID');
  if (policy?.timezone !== 'America/New_York') errors.push('POLICY_TIMEZONE_INVALID');
  if (!Array.isArray(policy?.allowedEvents) || !policy.allowedEvents.includes('schedule')
    || !policy.allowedEvents.includes('workflow_dispatch')) errors.push('POLICY_EVENTS_INVALID');
  if (!Array.isArray(policy?.allowedModes)
    || ['research', 'shadow', 'daily-report'].some((mode) => !policy.allowedModes.includes(mode))) {
    errors.push('POLICY_MODES_INVALID');
  }
  if (policy?.deterministicScenarioPath !== 'config/research/deterministic-scenarios.json') {
    errors.push('POLICY_DETERMINISTIC_SCENARIO_PATH_INVALID');
  }
  const limits = policy?.limits ?? {};
  const exactLimits = {
    workflowTimeoutMinutes: 12,
    pipelineDeadlineSeconds: 470,
    maximumTotalInputBytes: 33_554_432,
    maximumInputFileBytes: 16_777_216,
    maximumSymbols: 5,
    maximumRows: 20_000,
    maximumCompleteEpisodes: 200,
    maximumPreregisteredComparisons: 12,
    maximumPreregisteredResamples: 500,
    maximumDiagnosticBytes: 262_144,
    maximumSummaryBytes: 65_536,
  };
  for (const [name, expected] of Object.entries(exactLimits)) {
    if (limits[name] !== expected) errors.push('POLICY_LIMIT_INVALID:' + name);
  }
  if (!Array.isArray(policy?.sourceReuseContracts) || policy.sourceReuseContracts.length === 0) {
    errors.push('POLICY_SOURCE_REUSE_EMPTY');
  }
  if (!Array.isArray(policy?.prohibitedEnvironmentVariables)) {
    errors.push('POLICY_PROHIBITED_ENV_INVALID');
  }
  return errors;
}

export function validateCalendar(calendar) {
  const errors = [];
  if (calendar?.contractVersion !== CALENDAR_VERSION) errors.push('CALENDAR_VERSION_INVALID');
  if (calendar?.productClass !== 'CBOE_US_OPTIONS') errors.push('CALENDAR_PRODUCT_INVALID');
  if (calendar?.timezone !== 'America/New_York') errors.push('CALENDAR_TIMEZONE_INVALID');
  requireString(calendar?.sourceUrl, 'CALENDAR_SOURCE_URL', errors);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendar?.validFrom ?? '')) errors.push('CALENDAR_VALID_FROM_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendar?.validThrough ?? '')) errors.push('CALENDAR_VALID_THROUGH_INVALID');
  if (!/^\d{2}:\d{2}$/.test(calendar?.regularSession?.open ?? '')) errors.push('CALENDAR_OPEN_INVALID');
  if (!/^\d{2}:\d{2}$/.test(calendar?.regularSession?.close ?? '')) errors.push('CALENDAR_CLOSE_INVALID');
  if (!Array.isArray(calendar?.closedDates)) errors.push('CALENDAR_CLOSED_DATES_INVALID');
  if (calendar?.earlyCloseDates === null || typeof calendar?.earlyCloseDates !== 'object') {
    errors.push('CALENDAR_EARLY_CLOSE_INVALID');
  }
  return errors;
}

function safeRelativePath(path, root) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.includes('\\')) return false;
  const normalizedRoot = root.endsWith('/') ? root : root + '/';
  return path.startsWith(normalizedRoot) && !path.split('/').includes('..');
}

export function classifyQuoteEvidenceAdmission(evidence = {}) {
  const feed = String(evidence.feed ?? 'UNKNOWN').toUpperCase();
  const evidenceClass = evidence.evidenceClass ?? 'REAL_MARKET_EVIDENCE';
  const reasons = [];
  let diagnosticStatus = 'QUOTE_DIAGNOSTIC_NOT_ADMITTED';
  if (feed === 'INDICATIVE') {
    diagnosticStatus = 'INDICATIVE_DIAGNOSTIC_ALLOWED';
    reasons.push('INDICATIVE_FEED_NOT_OPRA_EXECUTION_QUALITY');
  } else if (feed === 'OPRA') {
    diagnosticStatus = 'OPRA_LABELED_DIAGNOSTIC_ALLOWED';
  } else {
    reasons.push('QUOTE_FEED_UNKNOWN');
  }
  if (evidenceClass !== 'REAL_MARKET_EVIDENCE') reasons.push('NON_REAL_EVIDENCE_CLASS');
  if (evidence.historicalBboCoverage !== 'VERIFIED') reasons.push('HISTORICAL_BBO_COVERAGE_UNVERIFIED');
  if (evidence.entitlementStatus !== 'VERIFIED') reasons.push('HISTORICAL_ENTITLEMENT_UNVERIFIED');
  const bid = evidence.bid;
  const ask = evidence.ask;
  if (bid === null || bid === undefined || ask === null || ask === undefined) {
    reasons.push('BBO_MISSING');
  } else if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
    reasons.push('BBO_NON_FINITE');
  } else if (bid < 0 || ask < 0) {
    reasons.push('BBO_NEGATIVE');
  } else if (bid > ask) {
    reasons.push('BBO_CROSSED');
  }
  const quoteTimestamp = evidence.quoteTimestamp;
  const decisionTimestamp = evidence.decisionTimestamp ?? evidence.decisionAsOf;
  const quoteMs = typeof quoteTimestamp === 'string' ? Date.parse(quoteTimestamp) : Number.NaN;
  const decisionMs = typeof decisionTimestamp === 'string' ? Date.parse(decisionTimestamp) : Number.NaN;
  if (!Number.isFinite(quoteMs)) reasons.push('BBO_TIMESTAMP_MISSING_OR_INVALID');
  if (!Number.isFinite(decisionMs)) reasons.push('DECISION_TIMESTAMP_MISSING_OR_INVALID');
  if (!Number.isFinite(evidence.maximumQuoteAgeMs) || evidence.maximumQuoteAgeMs < 0) {
    reasons.push('BBO_AGE_POLICY_MISSING');
  } else if (Number.isFinite(quoteMs) && Number.isFinite(decisionMs)) {
    const age = decisionMs - quoteMs;
    if (age < 0) reasons.push('BBO_FUTURE_TIMESTAMP');
    else if (age > evidence.maximumQuoteAgeMs) reasons.push('BBO_STALE');
  }
  if (!SHA40.test(evidence.sourceSha ?? '') || !SHA40.test(evidence.expectedSourceSha ?? '')) {
    reasons.push('BBO_SOURCE_SHA_MISSING');
  } else if (evidence.sourceSha !== evidence.expectedSourceSha) {
    reasons.push('BBO_SOURCE_SHA_MISMATCH');
  }
  if (typeof evidence.optionSymbol !== 'string' || typeof evidence.expectedOptionSymbol !== 'string') {
    reasons.push('BBO_OPTION_SYMBOL_MISSING');
  } else if (evidence.optionSymbol !== evidence.expectedOptionSymbol) {
    reasons.push('BBO_OPTION_SYMBOL_MISMATCH');
  }
  if (evidence.feedDocumentationStatus !== 'VERIFIED'
    || typeof evidence.feedDocumentationUrl !== 'string'
    || !evidence.feedDocumentationUrl.startsWith('https://')) {
    reasons.push('BBO_FEED_UNDOCUMENTED');
  }
  if (!Number.isInteger(evidence.expectedLegCount) || evidence.expectedLegCount <= 0
    || evidence.observedLegCount !== evidence.expectedLegCount) {
    reasons.push('OPTION_LEGS_INCOMPLETE');
  }
  if (evidence.pairedProtectivePutPresent !== true) reasons.push('PAIRED_PROTECTIVE_PUT_MISSING');
  if (evidence.completeExitPathPresent !== true) reasons.push('COMPLETE_EXIT_PATH_MISSING');
  const admitted = feed === 'OPRA' && evidenceClass === 'REAL_MARKET_EVIDENCE'
    && reasons.length === 0;
  return {
    diagnosticStatus,
    opraExecutionQualityReplay: admitted ? 'ADMITTED' : 'NOT_ADMITTED',
    claimedExecutable: evidence.executable === true,
    claimedDataQuality: typeof evidence.dataQuality === 'string' ? evidence.dataQuality : 'UNKNOWN',
    reasons: [...new Set(reasons)].sort(),
  };
}

export function validateEvidenceManifest(manifest, policy) {
  const errors = [];
  if (manifest?.contractVersion !== MANIFEST_VERSION) errors.push('MANIFEST_VERSION_INVALID');
  requireString(manifest?.manifestId, 'MANIFEST_ID', errors);
  if (manifest?.approvedForPublicActions !== true) errors.push('MANIFEST_PUBLIC_APPROVAL_MISSING');
  if (manifest?.immutableEntries !== true) errors.push('MANIFEST_IMMUTABILITY_MISSING');
  if (manifest?.dataAvailability !== 'UNKNOWN' && manifest?.dataAvailability !== 'VERIFIED') {
    errors.push('MANIFEST_DATA_AVAILABILITY_INVALID');
  }
  if (manifest?.historicalReplayStatus !== 'HISTORICAL_REPLAY_NOT_RUN'
    && manifest?.historicalReplayStatus !== 'HISTORICAL_REPLAY_READY') {
    errors.push('MANIFEST_REPLAY_STATUS_INVALID');
  }
  if (!Array.isArray(manifest?.entries)) return [...errors, 'MANIFEST_ENTRIES_INVALID'];
  let declaredBytes = 0;
  let declaredRows = 0;
  let declaredEpisodes = 0;
  let declaredComparisons = 0;
  let declaredResamples = 0;
  const symbols = new Set();
  for (const [index, entry] of manifest.entries.entries()) {
    const prefix = 'MANIFEST_ENTRY_' + index + ':';
    if (entry?.kind !== 'OBSERVATION_BUNDLE') errors.push(prefix + 'KIND_INVALID');
    if (!safeRelativePath(entry?.path, policy.allowedManifestRoot)) errors.push(prefix + 'PATH_INVALID');
    if (!SHA256.test(entry?.sha256 ?? '')) errors.push(prefix + 'SHA256_INVALID');
    if (!isPositiveInteger(entry?.bytes) || entry.bytes > policy.limits.maximumInputFileBytes) {
      errors.push(prefix + 'BYTES_INVALID');
    }
    if (!ALLOWED_EVIDENCE_CLASSES.has(entry?.evidenceClass)) errors.push(prefix + 'EVIDENCE_CLASS_INVALID');
    if (typeof entry?.symbol !== 'string' || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(entry.symbol)) {
      errors.push(prefix + 'SYMBOL_INVALID');
    } else {
      symbols.add(entry.symbol);
    }
    for (const [field, cap] of [
      ['rowCount', policy.limits.maximumRows],
      ['completeEpisodeCount', policy.limits.maximumCompleteEpisodes],
      ['comparisonCount', policy.limits.maximumPreregisteredComparisons],
      ['resampleCount', policy.limits.maximumPreregisteredResamples],
    ]) {
      const value = entry?.[field] ?? 0;
      if (!Number.isInteger(value) || value < 0 || value > cap) errors.push(prefix + field.toUpperCase() + '_INVALID');
    }
    declaredBytes += Number(entry?.bytes ?? 0);
    declaredRows += Number(entry?.rowCount ?? 0);
    declaredEpisodes += Number(entry?.completeEpisodeCount ?? 0);
    declaredComparisons += Number(entry?.comparisonCount ?? 0);
    declaredResamples += Number(entry?.resampleCount ?? 0);
    if (entry?.quoteEvidence !== undefined) classifyQuoteEvidenceAdmission({
      ...entry.quoteEvidence,
      evidenceClass: entry.evidenceClass,
    });
  }
  if (declaredBytes > policy.limits.maximumTotalInputBytes) errors.push('MANIFEST_TOTAL_BYTES_EXCEEDED');
  if (declaredRows > policy.limits.maximumRows) errors.push('MANIFEST_TOTAL_ROWS_EXCEEDED');
  if (declaredEpisodes > policy.limits.maximumCompleteEpisodes) errors.push('MANIFEST_TOTAL_EPISODES_EXCEEDED');
  if (declaredComparisons > policy.limits.maximumPreregisteredComparisons) {
    errors.push('MANIFEST_TOTAL_COMPARISONS_EXCEEDED');
  }
  if (declaredResamples > policy.limits.maximumPreregisteredResamples) {
    errors.push('MANIFEST_TOTAL_RESAMPLES_EXCEEDED');
  }
  if (symbols.size > policy.limits.maximumSymbols) errors.push('MANIFEST_TOTAL_SYMBOLS_EXCEEDED');
  return errors;
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const result = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    date: result.year + '-' + result.month + '-' + result.day,
    time: result.hour + ':' + result.minute,
    minutes: Number(result.hour) * 60 + Number(result.minute),
  };
}

function hmMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function weekday(date) {
  return new Date(date + 'T12:00:00Z').getUTCDay();
}

export function sessionForDate(date, calendar) {
  if (date < calendar.validFrom || date > calendar.validThrough) {
    return { state: 'CALENDAR_STALE', open: null, close: null };
  }
  if (weekday(date) === 0 || weekday(date) === 6 || calendar.closedDates.includes(date)) {
    return { state: 'MARKET_CLOSED', open: null, close: null };
  }
  return {
    state: 'OPEN_SESSION',
    open: calendar.regularSession.open,
    close: calendar.earlyCloseDates[date] ?? calendar.regularSession.close,
  };
}

export function decideRun(input) {
  const policyErrors = validatePolicy(input.policy);
  const calendarErrors = validateCalendar(input.calendar);
  const manifestErrors = validateEvidenceManifest(input.manifest, input.policy);
  const errors = [...policyErrors, ...calendarErrors, ...manifestErrors];
  if (errors.length > 0) throw new Error('GATE_CONFIGURATION_INVALID:' + errors.join(','));
  if (!input.policy.allowedEvents.includes(input.eventName)) {
    return { run: false, mode: null, targetDate: null, slotId: null, reasons: ['EVENT_NOT_ALLOWED'] };
  }
  const mode = input.eventName === 'schedule'
    ? input.policy.schedules[input.schedule ?? '']
    : input.requestedMode;
  if (!input.policy.allowedModes.includes(mode)) {
    return { run: false, mode: null, targetDate: null, slotId: null, reasons: ['MODE_NOT_ALLOWED'] };
  }
  const local = zonedParts(input.now, input.policy.timezone);
  if (mode === 'research') {
    if (input.eventName === 'schedule' && weekday(local.date) !== 6) {
      return { run: false, mode, targetDate: local.date, slotId: null, reasons: ['OFFLINE_RESEARCH_NOT_SATURDAY'] };
    }
    return { run: true, mode, targetDate: local.date, slotId: 'research-' + local.date, reasons: [] };
  }
  const session = sessionForDate(local.date, input.calendar);
  if (session.state !== 'OPEN_SESSION') {
    return { run: false, mode, targetDate: local.date, slotId: null, reasons: [session.state] };
  }
  const openMinutes = hmMinutes(session.open);
  const closeMinutes = hmMinutes(session.close);
  if (mode === 'shadow') {
    if (local.minutes < openMinutes || local.minutes > closeMinutes) {
      return { run: false, mode, targetDate: local.date, slotId: null, reasons: ['OUTSIDE_OPTIONS_SESSION'] };
    }
    if (input.eventName === 'schedule') {
      const matching = input.policy.shadowLocalTimes
        .map((time) => ({ time, minutes: hmMinutes(time) }))
        .find((slot) => local.minutes >= slot.minutes
          && local.minutes <= slot.minutes + input.policy.shadowMaximumStartDelayMinutes);
      if (matching === undefined) {
        return { run: false, mode, targetDate: local.date, slotId: null, reasons: ['SHADOW_START_DELAY_EXCEEDED'] };
      }
      if (matching.minutes > closeMinutes) {
        return { run: false, mode, targetDate: local.date, slotId: null, reasons: ['SLOT_AFTER_EARLY_CLOSE'] };
      }
      return {
        run: true,
        mode,
        targetDate: local.date,
        slotId: 'shadow-' + local.date + '-' + matching.time.replace(':', ''),
        reasons: [],
      };
    }
    return {
      run: true,
      mode,
      targetDate: local.date,
      slotId: 'shadow-manual-' + local.date + '-' + local.time.replace(':', ''),
      reasons: [],
    };
  }
  if (local.minutes < closeMinutes + input.policy.dailyReportMinimumMinutesAfterClose) {
    return { run: false, mode, targetDate: local.date, slotId: null, reasons: ['REPORT_BEFORE_AFTER_CLOSE_WINDOW'] };
  }
  return { run: true, mode, targetDate: local.date, slotId: 'daily-report-' + local.date, reasons: [] };
}

async function verifyLiveRepository(policy, environment) {
  if (environment.GITHUB_ACTIONS !== 'true') return [];
  const token = environment.GH_TOKEN;
  if (typeof token !== 'string' || token.length === 0) return ['LIVE_REPOSITORY_TOKEN_UNAVAILABLE'];
  let response;
  try {
    response = await fetch('https://api.github.com/repos/' + policy.expectedRepository, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return ['LIVE_REPOSITORY_METADATA_UNAVAILABLE'];
  }
  if (!response.ok) return ['LIVE_REPOSITORY_METADATA_UNAVAILABLE'];
  const metadata = await response.json();
  const reasons = [];
  if (metadata.full_name !== policy.expectedRepository) reasons.push('LIVE_REPOSITORY_IDENTITY_MISMATCH');
  if (metadata.visibility !== 'public' || metadata.private !== false) reasons.push('LIVE_REPOSITORY_NOT_PUBLIC');
  if (environment.RESEARCH_CURRENT_REF !== 'refs/heads/' + metadata.default_branch) {
    reasons.push('NOT_DEFAULT_BRANCH');
  }
  return reasons;
}

function validateEnvironment(policy, environment) {
  const errors = [];
  if (environment.RESEARCH_EXPECTED_REPOSITORY !== policy.expectedRepository) {
    errors.push('EXPECTED_REPOSITORY_MISMATCH');
  }
  if (environment.RESEARCH_EXPECTED_RUNNER_LABEL !== policy.requiredRunnerLabel) {
    errors.push('EXPECTED_RUNNER_MISMATCH');
  }
  if (environment.RESEARCH_SOURCE_SHA !== undefined && !SHA40.test(environment.RESEARCH_SOURCE_SHA)) {
    errors.push('SOURCE_SHA_INVALID');
  }
  for (const name of policy.prohibitedEnvironmentVariables) {
    if (typeof environment[name] === 'string' && environment[name].length > 0) {
      errors.push('PROHIBITED_ENV_PRESENT:' + name);
    }
  }
  return errors;
}

function writeOutputs(path, decision) {
  const values = {
    run: decision.run ? 'true' : 'false',
    mode: decision.mode ?? 'none',
    target_date: decision.targetDate ?? 'none',
    slot_id: decision.slotId ?? 'none',
  };
  for (const [name, value] of Object.entries(values)) {
    if (!SAFE_OUTPUT.test(value)) throw new Error('UNSAFE_GITHUB_OUTPUT:' + name);
    appendFileSync(path, name + '=' + value + '\n', 'utf8');
  }
}

function appendGateSummary(path, decision) {
  const lines = [
    '## THETA bounded research gate',
    '',
    '- Run: ' + (decision.run ? 'admitted' : 'skipped'),
    '- Mode: ' + (decision.mode ?? 'none'),
    '- Target date: ' + (decision.targetDate ?? 'none'),
    '- Slot: ' + (decision.slotId ?? 'none'),
    '- Reasons: ' + (decision.reasons.length === 0 ? 'none' : decision.reasons.join(', ')),
    '',
    'This gate grants research admission only. Broker authority remains false.',
    '',
  ];
  appendFileSync(path, lines.join('\n'), 'utf8');
}

export function validateWorkflowText(text) {
  const errors = [];
  const required = [
    'permissions:\n  contents: read',
    'runs-on: ubuntu-24.04',
    'timeout-minutes: 12',
    'persist-credentials: false',
    'vars.THETA_RESEARCH_ACTIONS_ENABLED',
    "timezone: America/New_York",
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
  ];
  for (const value of required) if (!text.includes(value)) errors.push('WORKFLOW_REQUIRED_TEXT_MISSING:' + value);
  const uses = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
  if (uses.length !== 2) errors.push('WORKFLOW_ACTION_COUNT_INVALID');
  if (uses.some((use) => !/@[0-9a-f]{40}$/.test(use))) errors.push('WORKFLOW_ACTION_NOT_SHA_PINNED');
  for (const [pattern, reason] of [
    [/^\s*pull_request_target:/m, 'PULL_REQUEST_TARGET_FORBIDDEN'],
    [/^\s*pull_request:/m, 'PULL_REQUEST_TRIGGER_FORBIDDEN'],
    [/^\s*push:/m, 'PUSH_TRIGGER_FORBIDDEN'],
    [/secrets\./, 'SECRET_CONTEXT_FORBIDDEN'],
    [/actions\/upload-artifact@/, 'ARTIFACT_UPLOAD_FORBIDDEN'],
    [/actions\/cache@/, 'CACHE_ACTION_FORBIDDEN'],
    [/self-hosted/, 'SELF_HOSTED_RUNNER_FORBIDDEN'],
    [/theta:shadow:once/, 'BROKER_SHADOW_SCRIPT_FORBIDDEN'],
    [/export-historical-replay/, 'DATABASE_EXPORT_SCRIPT_FORBIDDEN'],
    [/DATABASE_URL/, 'DATABASE_ENV_FORBIDDEN'],
    [/ALPACA_/i, 'BROKER_ENV_FORBIDDEN'],
  ]) {
    if (pattern.test(text)) errors.push('WORKFLOW_' + reason);
  }
  return errors;
}

export function hasSensitiveText(text) {
  return /(gh[opsu]_[A-Za-z0-9]{20,}|api[_ -]?secret|api[_ -]?key|database_url|account[_ -]?id|brokerage[_ -]?account)/i.test(text);
}

export function validatePublicReceipt(receipt) {
  const allowedKeys = new Set([
    'contractVersion', 'runId', 'mode', 'targetDate', 'slotId', 'generatedAt',
    'sourceSha', 'overallStatus', 'historicalReplayStatus', 'manifest',
    'limitsObserved', 'stages', 'recommendations', 'authority',
  ]);
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) return ['RECEIPT_OBJECT_REQUIRED'];
  const errors = Object.keys(receipt).filter((key) => !allowedKeys.has(key)).map((key) => 'RECEIPT_KEY_FORBIDDEN:' + key);
  if (receipt.contractVersion !== 'theta-zero-cost-research-receipt-v1') errors.push('RECEIPT_VERSION_INVALID');
  if (!['DATA_GAP', 'SOURCE_GAP', 'EMPIRICAL_GAP', 'COMPLETE'].includes(receipt.overallStatus)) {
    errors.push('RECEIPT_STATUS_INVALID');
  }
  if (receipt.authority?.brokerAuthority !== false || receipt.authority?.orderSubmissionAvailable !== false
    || receipt.authority?.productionMutationAvailable !== false) errors.push('RECEIPT_AUTHORITY_INVALID');
  if (!Array.isArray(receipt.stages) || !Array.isArray(receipt.recommendations)) errors.push('RECEIPT_ARRAYS_INVALID');
  return errors;
}

async function publishSummary(args) {
  const policy = readJsonFile(args.policy);
  const policyErrors = validatePolicy(policy);
  if (policyErrors.length > 0) throw new Error('POLICY_INVALID:' + policyErrors.join(','));
  const outputDir = resolve(args['output-dir']);
  const receiptPath = resolve(outputDir, 'research-receipt.json');
  const summaryPath = resolve(outputDir, 'research-summary.md');
  if (!existsSync(receiptPath) || !existsSync(summaryPath)) {
    appendFileSync(args['github-summary'], '## THETA bounded research\n\nSafe report unavailable.\n', 'utf8');
    return { published: false, reason: 'OUTPUT_MISSING' };
  }
  if (statSync(receiptPath).size > policy.limits.maximumDiagnosticBytes
    || statSync(summaryPath).size > policy.limits.maximumSummaryBytes) {
    appendFileSync(args['github-summary'], '## THETA bounded research\n\nSafe report exceeded a fixed size cap.\n', 'utf8');
    return { published: false, reason: 'OUTPUT_SIZE_CAP' };
  }
  const receiptText = readFileSync(receiptPath, 'utf8');
  const summaryText = readFileSync(summaryPath, 'utf8');
  let receipt;
  try {
    receipt = JSON.parse(receiptText);
  } catch {
    appendFileSync(args['github-summary'], '## THETA bounded research\n\nSafe receipt was invalid JSON.\n', 'utf8');
    return { published: false, reason: 'RECEIPT_INVALID_JSON' };
  }
  const receiptErrors = validatePublicReceipt(receipt);
  if (receiptErrors.length > 0 || hasSensitiveText(receiptText) || hasSensitiveText(summaryText)) {
    appendFileSync(args['github-summary'], '## THETA bounded research\n\nSafe report validation failed.\n', 'utf8');
    return { published: false, reason: 'OUTPUT_NOT_PUBLIC_SAFE' };
  }
  appendFileSync(args['github-summary'], summaryText.endsWith('\n') ? summaryText : summaryText + '\n', 'utf8');
  return { published: true, reason: null };
}

async function gate(args, environment) {
  const policy = readJsonFile(args.policy);
  const calendar = readJsonFile(args.calendar);
  const manifest = readJsonFile(args.manifest);
  const staticEnvironmentErrors = validateEnvironment(policy, environment);
  if (staticEnvironmentErrors.length > 0) throw new Error('GATE_ENVIRONMENT_INVALID:' + staticEnvironmentErrors.join(','));
  const liveReasons = await verifyLiveRepository(policy, environment);
  if (liveReasons.length > 0) {
    const decision = { run: false, mode: null, targetDate: null, slotId: null, reasons: liveReasons };
    writeOutputs(args['github-output'], decision);
    appendGateSummary(args['github-summary'], decision);
    return decision;
  }
  const decision = decideRun({
    policy,
    calendar,
    manifest,
    eventName: environment.RESEARCH_EVENT_NAME,
    schedule: environment.RESEARCH_EVENT_SCHEDULE,
    requestedMode: environment.RESEARCH_REQUEST_MODE,
    now: args.now === undefined ? new Date() : new Date(args.now),
  });
  writeOutputs(args['github-output'], decision);
  appendGateSummary(args['github-summary'], decision);
  return decision;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args['validate-workflow'] !== undefined) {
    const text = readFileSync(args['validate-workflow'], 'utf8');
    const errors = validateWorkflowText(text);
    process.stdout.write(JSON.stringify({ valid: errors.length === 0, errors }) + '\n');
    if (errors.length > 0) process.exitCode = 1;
    return;
  }
  if (args['publish-summary'] === true) {
    for (const required of ['policy', 'output-dir', 'github-summary']) if (typeof args[required] !== 'string') {
      throw new Error('MISSING_ARGUMENT:' + required);
    }
    const result = await publishSummary(args);
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  for (const required of ['policy', 'calendar', 'manifest', 'github-output', 'github-summary']) {
    if (typeof args[required] !== 'string') throw new Error('MISSING_ARGUMENT:' + required);
  }
  const decision = await gate(args, process.env);
  process.stdout.write(JSON.stringify({
    run: decision.run,
    mode: decision.mode,
    targetDate: decision.targetDate,
    slotId: decision.slotId,
    reasons: decision.reasons,
  }) + '\n');
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write('THETA_RESEARCH_GATE_FAILED:' + (error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
