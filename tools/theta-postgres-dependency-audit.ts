import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  classifyDependencyCallsite, relationReferenceMode, type PostgresDependencyCallsite,
  type PostgresDependencyClass,
} from '../src/storage/postgres-dependency-audit.js';
import type { AuditedRelation } from '../src/storage/postgres-storage-audit.js';

const auditArgument = process.argv.find((argument) => argument.startsWith('--storage-audit='))?.slice('--storage-audit='.length);
if (auditArgument === undefined) throw new Error('STORAGE_AUDIT_PATH_REQUIRED');
const auditPath = resolve(auditArgument);
const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { readonly observedAt: string; readonly relations: readonly AuditedRelation[] };
if (!Array.isArray(audit.relations) || audit.relations.length === 0) throw new Error('STORAGE_AUDIT_RELATIONS_MISSING');

const roots = ['src', 'tools', 'bots'].map((root) => resolve(root));
const sourceExtensions = /\.(?:ts|mjs|js|py|ps1)$/i;
const excluded = /(?:^|[\\/])(?:node_modules|dist|migrations|tests|__pycache__)(?:[\\/]|$)/i;
const files = (await Promise.all(roots.map(async (root) => (await readdir(root, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => resolve(entry.parentPath, entry.name)))))
  .flat().filter((file) => sourceExtensions.test(file) && !excluded.test(file));

const callsites: PostgresDependencyCallsite[] = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const relation of audit.relations) {
    const mode = relationReferenceMode(source, relation.qualifiedName);
    if (mode === null) continue;
    const normalizedFile = relative(resolve('.'), file).replaceAll('\\', '/');
    callsites.push({
      file: normalizedFile, relation: relation.qualifiedName, mode,
      dependencyClass: classifyDependencyCallsite(normalizedFile, mode, relation.classification),
    });
  }
}

const classes: readonly PostgresDependencyClass[] = [
  'SAFETY_REQUIRED', 'CANONICAL_STATE_REQUIRED', 'PERSISTENCE_ONLY', 'RESEARCH_ONLY', 'ACCIDENTAL_COUPLING',
];
const counts = Object.fromEntries(classes.map((dependencyClass) => [dependencyClass,
  callsites.filter((callsite) => callsite.dependencyClass === dependencyClass).length]));
const byRelation = Object.fromEntries(audit.relations.map((relation) => [relation.qualifiedName, {
  classification: relation.classification,
  writers: callsites.filter((callsite) => callsite.relation === relation.qualifiedName && callsite.mode !== 'READ'),
  readers: callsites.filter((callsite) => callsite.relation === relation.qualifiedName && callsite.mode !== 'WRITE'),
}]));
const report = {
  auditVersion: 'theta-postgres-dependency-audit-v1', generatedAt: new Date().toISOString(),
  storageAuditObservedAt: audit.observedAt, storageAuditPathHashExcluded: true,
  semantics: 'UNIQUE_FILE_RELATION_OPERATION_REFERENCES_DISCOVERED_BY_STATIC_SQL_IDENTIFIER_SCAN',
  filesScanned: files.length, totalPostgresDependencies: callsites.length, counts, callsites, byRelation,
};
const outputRoot = resolve('.theta-local-worker', 'storage-audits');
await mkdir(outputRoot, { recursive: true });
const outputPath = resolve(outputRoot, `${String(audit.observedAt).replaceAll(':', '').replaceAll('.', '')}.dependencies.json`);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ state: 'PASS', outputPath, filesScanned: files.length,
  totalPostgresDependencies: callsites.length, counts })}\n`);
