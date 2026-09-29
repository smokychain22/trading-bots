import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  databaseRelationInventoryFromNames, deepSystemInventory, summarizeDeepSystemInventory, validateDeepSystemInventory,
} from '../src/theta/deep-system-inventory.js';
import {
  decisionCriticalEvidenceFields, decisionCriticalEvidenceRegistryVersion, validateDecisionCriticalEvidenceRegistry,
} from '../src/theta/decision-critical-evidence-registry.js';

const git = (...args: string[]): string => execFileSync('git', args, {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 60_000, windowsHide: true,
}).trim();

const sourceHead = git('rev-parse', 'HEAD');
const originMain = git('rev-parse', 'origin/main');
const status = git('status', '--porcelain');

const migrationFiles = readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort();
const relationPattern = /\bCREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?[A-Za-z0-9_]+"?\.)?"?[A-Za-z0-9_]+"?)/gi;
const databaseRelations = new Set<string>();
for (const migration of migrationFiles) {
  const source = readFileSync(join('migrations', migration), 'utf8');
  for (const match of source.matchAll(relationPattern)) {
    const relation = (match[1] ?? '').replaceAll('"', '');
    if (relation !== 'IF') databaseRelations.add(relation);
  }
}

const decisionCriticalTerms = /TODO|FIXME|placeholder|dummy|mock|fixture-only|hardcoded|unknown|not implemented|research only|shadow only|unwired|fallback|default|temporary|assume/ig;
const auditRoots = ['src/theta', 'src/execution', 'src/market', 'src/research', 'bots/theta/quant'];
const auditExtensions = new Set(['.ts', '.py']);
const walk = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
  const path = join(root, entry.name);
  if (entry.isDirectory()) return walk(path);
  return [...auditExtensions].some((extension) => entry.name.endsWith(extension)) ? [path] : [];
});
const dispositionMatches = auditRoots.flatMap(walk).flatMap((file) => {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  return lines.flatMap((line, index) => {
    const terms = [...line.matchAll(decisionCriticalTerms)].map((match) => match[0].toUpperCase());
    return terms.length === 0 ? [] : [{ file: relative('.', file).replaceAll('\\', '/'), line: index + 1, terms: [...new Set(terms)] }];
  });
});

const missingSourceFiles = [...new Set(deepSystemInventory.flatMap((row) => row.sourceFiles))]
  .filter((file) => !existsSync(file) && file !== 'migrations' && !file.includes(' + ') && !file.endsWith('tests/quant'));
const issues = [...validateDeepSystemInventory()];
if (missingSourceFiles.length > 0) issues.push(...missingSourceFiles.map((file) => `SOURCE_FILE_MISSING:${file}`));
const databaseRelationInventory = databaseRelationInventoryFromNames([...databaseRelations]);
const unknownDatabaseRelations = databaseRelationInventory.filter((row) => row.currentAuthority === 'NONE');
if (unknownDatabaseRelations.length > 0) {
  issues.push(...unknownDatabaseRelations.map((row) => `DATABASE_RELATION_UNCLASSIFIED:${row.id}`));
}
const authoritativeRows = [...deepSystemInventory, ...databaseRelationInventory];
const decisionCriticalRegistry = validateDecisionCriticalEvidenceRegistry();
const databaseRelationsByClassification = Object.fromEntries([...new Set(databaseRelationInventory.map((row) => row.inputTruthClass))]
  .sort().map((classification) => [classification,
    databaseRelationInventory.filter((row) => row.inputTruthClass === classification).length]));

const receipt = {
  ...summarizeDeepSystemInventory(), sourceHead, originMain, worktreeClean: status.length === 0,
  deploymentState: 'NOT_OBSERVED_BY_SOURCE_AUDIT', databaseRelationCount: databaseRelations.size,
  authoritativeRowCount: authoritativeRows.length, databaseRelationsByClassification,
  databaseRelations: process.argv.includes('--full') ? databaseRelationInventory : undefined,
  unknownDatabaseRelationCount: unknownDatabaseRelations.length, migrationHead: migrationFiles.at(-1)?.slice(0, 3) ?? null,
  decisionCriticalEvidenceRegistry: {
    state: decisionCriticalRegistry.coverage,
    version: decisionCriticalEvidenceRegistryVersion,
    fieldCount: decisionCriticalEvidenceFields.length,
    meaning: 'AUTHORITATIVE_DECISION_CRITICAL_DENOMINATOR',
  },
  decisionCriticalSearch: {
    state: 'DISCOVERY_INDEX_ONLY', matchCount: dispositionMatches.length,
    note: 'Broad text matches are not blocker counts. The typed evidence registry and governed UNKNOWN audit are authoritative.',
    matches: process.argv.includes('--full') ? dispositionMatches : [],
  },
  missingSourceFiles, issues,
  authority: { orderSubmissions: 0, brokerMutations: 0, followerSubmissions: 0, liveAuthorization: 'NOT_GRANTED' },
  rows: process.argv.includes('--full') ? authoritativeRows : undefined,
};

console.log(JSON.stringify(receipt, null, 2));
if (issues.length > 0) process.exitCode = 1;
