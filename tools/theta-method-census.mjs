#!/usr/bin/env node
// THETA method usage census generator (Wave 6 Batch 1). Research tooling,
// no Production side effects -- reads the repo, writes nothing, never
// touches the broker or the database. Reproduces
// docs/research/THETA_METHOD_USAGE_CENSUS.md's numbers from the actual
// source tree so future passes can re-run it instead of re-auditing by
// hand. See that doc for the full methodology writeup, caveats, and what
// this script deliberately does not attempt (semantic decision-relevance
// scoring beyond a name-keyword heuristic, Python-internal import graph
// within bots/theta/quant/models and quant/research).
//
// Usage: node tools/theta-method-census.mjs
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();

function gitFiles(pattern) {
  return execSync(`git ls-files "${pattern}"`, { cwd: root, maxBuffer: 1024 * 1024 * 50 })
    .toString().split('\n').filter(Boolean);
}

const allTsFiles = gitFiles('src/**/*.ts')
  .filter((f) => !f.endsWith('.test.ts') && !f.includes('/tests/'));

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  let p = path.normalize(path.join(path.dirname(fromFile), spec)).replace(/\\/g, '/');
  p = p.replace(/\.js$/, '.ts');
  if (!p.endsWith('.ts')) p += '.ts';
  return p;
}

const importRe = /from\s+['"]([^'"]+)['"]/g;
const graph = new Map();
const exportedSymbolCounts = new Map();
const DECISION_KEYWORDS = [
  'candidate', 'strategy', 'econom', 'risk', 'aegis', 'siz', 'management',
  'execut', 'reconcil', 'account', 'lifecycle', 'route', 'router', 'frontier',
  'assign', 'recovery', 'covered', 'call', 'wait', 'roll', 'assembly', 'orchestrat',
  'decision', 'evidence', 'quote', 'provider', 'shadow', 'aegis', 'outcome', 'pnl',
];

for (const f of allTsFiles) {
  const full = path.join(root, f);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, 'utf8');
  const deps = new Set();
  let m;
  importRe.lastIndex = 0;
  while ((m = importRe.exec(text))) {
    const resolved = resolveImport(f, m[1]);
    if (resolved && allTsFiles.includes(resolved)) deps.add(resolved);
  }
  graph.set(f, deps);

  const exportMatches = [...text.matchAll(/^export (?:async )?function (\w+)|^export class (\w+)|^export const (\w+)/gm)];
  const names = exportMatches.map((mm) => mm[1] ?? mm[2] ?? mm[3]).filter(Boolean);
  const decisionRelevant = names.filter((n) => DECISION_KEYWORDS.some((k) => n.toLowerCase().includes(k)));
  exportedSymbolCounts.set(f, { total: names.length, decisionRelevant: decisionRelevant.length });
}

const entryPoints = ['src/worker/index.ts', 'src/index.ts'].filter((f) => allTsFiles.includes(f));
const reachable = new Set();
const queue = [...entryPoints];
while (queue.length) {
  const cur = queue.shift();
  if (reachable.has(cur)) continue;
  reachable.add(cur);
  for (const dep of graph.get(cur) ?? []) queue.push(dep);
}

const reverseGraph = new Map();
for (const [f, deps] of graph) {
  for (const d of deps) {
    if (!reverseGraph.has(d)) reverseGraph.set(d, new Set());
    reverseGraph.get(d).add(f);
  }
}

const dirs = ['src/theta', 'src/research', 'src/execution', 'src/providers', 'src/customer'];
let totalFiles = 0, totalProd = 0, totalResearchShadow = 0, totalTestOnly = 0;
let totalDecisionSymbols = 0, totalDecisionSymbolsProd = 0;

console.log('=== THETA method census (file-level, static-import BFS from src/worker/index.ts) ===\n');
for (const dir of dirs) {
  const files = allTsFiles.filter((f) => f.startsWith(`${dir}/`));
  let prod = 0, researchShadow = 0, testOnly = 0;
  let decisionSymbols = 0, decisionSymbolsProd = 0;
  for (const f of files) {
    const counts = exportedSymbolCounts.get(f) ?? { total: 0, decisionRelevant: 0 };
    decisionSymbols += counts.decisionRelevant;
    if (reachable.has(f)) { prod++; decisionSymbolsProd += counts.decisionRelevant; }
    else if ((reverseGraph.get(f) ?? new Set()).size > 0) researchShadow++;
    else testOnly++;
  }
  totalFiles += files.length; totalProd += prod; totalResearchShadow += researchShadow; totalTestOnly += testOnly;
  totalDecisionSymbols += decisionSymbols; totalDecisionSymbolsProd += decisionSymbolsProd;
  console.log(`${dir}: files=${files.length} production=${prod} research_shadow=${researchShadow} test_only=${testOnly} decision_relevant_exported_symbols=${decisionSymbols} (of which production_reachable=${decisionSymbolsProd})`);
}
console.log(`\nTOTAL: files=${totalFiles} production=${totalProd} research_shadow=${totalResearchShadow} test_only=${totalTestOnly}`);
console.log(`TOTAL decision-relevant exported symbols (name-keyword heuristic) = ${totalDecisionSymbols} (production_reachable = ${totalDecisionSymbolsProd})`);

// Python runtime bridge wiring census -- real, not heuristic: which
// bots/theta/quant/runtime/*.py contract scripts are actually referenced
// by the TS-side Python bridge allowlist (production-shadow-runtime.ts /
// theta-shadow-once.ts), vs. which exist but are never wired at all.
console.log('\n=== Python bridge wiring census (bots/theta/quant/runtime/*.py) ===');
const runtimeScripts = gitFiles('bots/theta/quant/runtime/*.py').filter((f) => !f.includes('__pycache__'));
const bridgeWiringFiles = ['src/theta/theta-shadow-once.ts', 'src/research/production-shadow-runtime.ts'];
const wiredScripts = new Set();
for (const wf of bridgeWiringFiles) {
  const full = path.join(root, wf);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, 'utf8');
  for (const rs of runtimeScripts) {
    if (text.includes(path.basename(rs))) wiredScripts.add(rs);
  }
}
console.log(`runtime contract scripts total=${runtimeScripts.length} wired_into_bridge=${wiredScripts.size} unwired=${runtimeScripts.length - wiredScripts.size}`);
for (const rs of runtimeScripts) if (!wiredScripts.has(rs)) console.log(`  UNWIRED: ${rs}`);

const pyDirs = ['bots/theta/quant/models', 'bots/theta/quant/research', 'bots/theta/quant/expert_priors', 'bots/theta/quant/calibration', 'bots/theta/quant/features'];
console.log('\n=== Python file counts by directory (import graph NOT traced -- see doc for caveat) ===');
let pyTotal = 0;
for (const d of pyDirs) {
  const files = gitFiles(`${d}/*.py`).filter((f) => !f.includes('__pycache__') && !f.includes('__init__'));
  pyTotal += files.length;
  console.log(`${d}: ${files.length}`);
}
console.log(`Python files (models/research/expert_priors/calibration/features, excluding runtime/ and tests/) = ${pyTotal}`);

// DEAD check: files with zero importers found even including this
// session's own quick raw-text scan of tests/ (not part of allTsFiles'
// graph, which excludes test files by design) -- a real, cheap
// additional pass so DEAD isn't left unresolved for 4 of 5 directories.
console.log('\n=== DEAD check (zero importers anywhere, including test files) ===');
const allFilesInclTests = [...gitFiles('src/**/*.ts'), ...gitFiles('tests/**/*.ts')];
let deadTotal = 0;
for (const dir of dirs) {
  const files = allTsFiles.filter((f) => f.startsWith(`${dir}/`));
  let dead = 0;
  for (const f of files) {
    const base = path.basename(f, '.ts');
    const importedAnywhere = allFilesInclTests.some((other) => {
      if (other === f) return false;
      const full = path.join(root, other);
      if (!existsSync(full)) return false;
      const text = readFileSync(full, 'utf8');
      return new RegExp(`['"][^'"]*/${base}(\.js)?['"]`).test(text);
    });
    if (!importedAnywhere) dead++;
  }
  deadTotal += dead;
  console.log(`${dir}: DEAD (zero importers anywhere) = ${dead}`);
}
console.log(`TOTAL DEAD (zero importers anywhere, TS only) = ${deadTotal}`);
