import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFirstPaperOrderDryRun } from '../src/theta/first-paper-order-preflight.js';
import { buildR7PhaseStatus } from '../src/theta/r7-phase-status.js';
import type { FirstPaperOrderReadinessInput } from '../src/theta/first-paper-order-readiness.js';

const args=process.argv.slice(2),index=args.indexOf('--input');
const path=index>=0?args[index+1]:null;
if(!path) throw new Error('PREFLIGHT_INPUT_FILE_REQUIRED');
const input=JSON.parse(await readFile(resolve(path),'utf8')) as FirstPaperOrderReadinessInput;
const result=buildFirstPaperOrderDryRun(input);
process.stdout.write(`${JSON.stringify({dryRun:result,phaseStatus:buildR7PhaseStatus(result)},null,2)}\n`);
