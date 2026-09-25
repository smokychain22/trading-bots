import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { buildV18FinalAcceptanceReceipt } from '../src/operations/v18-final-acceptance.js';

const sourceChecks: readonly { readonly forbidden: RegExp; readonly field: string }[] = [
  { forbidden: /\b(?:minDte|dteMin)\s*:\s*25\b/, field: 'conventional.minimumDte' },
  { forbidden: /\bmaxDte\s*:\s*60\b/, field: 'conventional.maximumDte' },
  { forbidden: /\bmaxSpreadPct\s*:\s*0\.15\b/, field: 'conventional.maximumSpreadPct' },
  { forbidden: /\bmaxQuoteAgeSeconds\s*:\s*30\b/, field: 'quote.candidateMaximumSeconds' },
  { forbidden: /\bmaximumAgeMs\s*:\s*45_?000\b/, field: 'quote.preSubmitMaximumMilliseconds' },
  { forbidden: /\bearningsExclusionDays\s*:\s*5\b/, field: 'conventional.earningsExclusionDays' },
  { forbidden: /\briskBudgetQtyCap\s*:\s*4\b/, field: 'sizing.riskBudgetQuantityCap' },
  { forbidden: /\bcollateralQtyCap\s*:\s*3\b/, field: 'sizing.collateralQuantityCap' },
  { forbidden: /\bconcentrationQtyCap\s*:\s*5\b/, field: 'sizing.concentrationQuantityCap' },
  { forbidden: /\bassignmentCapacityQtyCap\s*:\s*6\b/, field: 'sizing.assignmentCapacityQuantityCap' },
  { forbidden: /\btailRiskQtyCap\s*:\s*3\b/, field: 'sizing.tailRiskQuantityCap' },
  { forbidden: /\bcorrelationQtyCap\s*:\s*3\b/, field: 'sizing.correlationQuantityCap' },
  { forbidden: /\bliquidityQtyCap\s*:\s*3\b/, field: 'sizing.liquidityQuantityCap' },
  { forbidden: /\breducedStateMultiplier\s*:\s*0\.5\b/, field: 'sizing.reducedStateMultiplier' },
  { forbidden: /\bhardCapMultiplier\s*:\s*1\.5\b/, field: 'aegis.hardCapMultiplier' },
  { forbidden: /\bmaxTickerConcentrationPct\s*:\s*0\.15\b/, field: 'aegis.maximumTickerConcentrationPct' },
  { forbidden: /\bmaxSectorConcentrationPct\s*:\s*0\.3\b/, field: 'aegis.maximumSectorConcentrationPct' },
  { forbidden: /\bmaxCorrelationClusterPct\s*:\s*0\.3\b/, field: 'aegis.maximumCorrelationClusterPct' },
  { forbidden: /\bmaxPortfolioCapitalAtRiskPct\s*:\s*0\.5\b/, field: 'aegis.maximumPortfolioCapitalAtRiskPct' },
  { forbidden: /\bmaxInventoryCapacityPct\s*:\s*0\.5\b/, field: 'aegis.maximumInventoryCapacityPct' },
  { forbidden: /\bmaxAssignmentCapacityPct\s*:\s*0\.5\b/, field: 'aegis.maximumAssignmentCapacityPct' },
  { forbidden: /\bmaxRecoveryCapacityPct\s*:\s*0\.3\b/, field: 'aegis.maximumRecoveryCapacityPct' },
];

const sourceFiles = readdirSync('src', { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
  .map((entry) => path.join(entry.parentPath, entry.name).replaceAll('\\', '/'))
  .filter((file) => file !== 'src/theta/paper-bootstrap-runtime-policy.ts');
const conflicts = sourceFiles.flatMap((file) => {
  const content = readFileSync(file, 'utf8');
  return sourceChecks.filter((item) => item.forbidden.test(content)).map((item) => `${item.field}@${file}`);
});
const receipt = buildV18FinalAcceptanceReceipt({ conflictingConfigValues: conflicts });
process.stdout.write(`${JSON.stringify({ ...receipt, CONFIG_SOURCE_FILES_SCANNED: sourceFiles.length })}\n`);
if (receipt.PRESESSION_ZERO_WEAKNESS_CERTIFICATION !== 'PASS') process.exitCode = 1;
