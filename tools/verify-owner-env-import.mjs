import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) throw new Error('SOURCE_AND_TARGET_REQUIRED');

const source = new Map();
for (const line of readFileSync(sourcePath, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = line.match(/^\s*([^:=]+?)\s*[:=]\s*(.*?)\s*$/);
  if (!match) throw new Error('UNPARSEABLE_SOURCE_LINE');
  const key = match[1].trim().toLowerCase();
  const values = source.get(key) ?? [];
  values.push(match[2].trim());
  source.set(key, values);
}

const target = parse(readFileSync(targetPath));
const direct = {
  apiKey: target.ALPACA_API_KEY === source.get('alpaca api key')?.[0],
  secretKey: target.ALPACA_SECRET_KEY === source.get('alpaca secret')?.[0],
};
const swapped = {
  apiKey: target.ALPACA_API_KEY === source.get('alpaca secret')?.[0],
  secretKey: target.ALPACA_SECRET_KEY === source.get('alpaca api key')?.[0],
};

console.info(JSON.stringify({
  direct,
  swapped,
  targetLengths: {
    apiKey: target.ALPACA_API_KEY?.length ?? null,
    secretKey: target.ALPACA_SECRET_KEY?.length ?? null,
  },
  sourceLengths: {
    labelledApiKey: source.get('alpaca api key')?.[0]?.length ?? null,
    labelledSecret: source.get('alpaca secret')?.[0]?.length ?? null,
  },
  safety: {
    masterPaperExecutionEnabled: target.MASTER_PAPER_EXECUTION_ENABLED,
    followerPaperExecutionEnabled: target.FOLLOWER_PAPER_EXECUTION_ENABLED,
    paperPauseNewOrders: target.PAPER_PAUSE_NEW_ORDERS,
  },
}));
