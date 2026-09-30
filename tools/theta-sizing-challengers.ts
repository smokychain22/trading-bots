import { readFileSync, statSync } from 'node:fs';
import { replaySizingChallengers } from '../src/research/sizing-challenger-replay.js';

// Local experiment consumer only. No environment loader or provider client.
const inputPath = process.argv[2];
if (!inputPath || process.argv.length !== 3) throw new Error('SIZING_CHALLENGER_INPUT_FILE_REQUIRED');
if (statSync(inputPath).size > 1024 * 1024) throw new Error('SIZING_CHALLENGER_INPUT_SIZE_LIMIT');
process.stdout.write(JSON.stringify(replaySizingChallengers(JSON.parse(readFileSync(inputPath, 'utf8')))) + '\n');
