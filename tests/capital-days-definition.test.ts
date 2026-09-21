import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capitalDaysFromDailySeries, capitalDaysConstant, returnPerCapitalDay,
  type DailyCapitalObservation,
} from '../src/research/capital-days-definition.js';

test('capitalDaysFromDailySeries sums real daily committed capital, including zero-capital idle days', () => {
  const series: DailyCapitalObservation[] = [
    { date: '2026-09-01', capitalCommitted: 19000 },
    { date: '2026-09-02', capitalCommitted: 19000 },
    { date: '2026-09-03', capitalCommitted: 0 }, // idle day between chains -- included, contributes 0
    { date: '2026-09-04', capitalCommitted: 19000 },
  ];
  assert.equal(capitalDaysFromDailySeries(series), 57000);
});

test('capitalDaysFromDailySeries on an empty series is 0, not null or an error', () => {
  assert.equal(capitalDaysFromDailySeries([]), 0);
});

test('capitalDaysFromDailySeries throws on a negative committed-capital observation rather than silently accepting it', () => {
  assert.throws(
    () => capitalDaysFromDailySeries([{ date: '2026-09-01', capitalCommitted: -100 }]),
    /CAPITAL_DAYS_INVALID_DAILY_OBSERVATION/,
  );
});

test('capitalDaysFromDailySeries throws on a non-finite committed-capital observation', () => {
  assert.throws(
    () => capitalDaysFromDailySeries([{ date: '2026-09-01', capitalCommitted: NaN }]),
    /CAPITAL_DAYS_INVALID_DAILY_OBSERVATION/,
  );
});

test('capitalDaysConstant matches capitalDaysFromDailySeries exactly for a genuinely constant-capital series (the special case coincides with the general case)', () => {
  const constantSeries: DailyCapitalObservation[] = Array.from({ length: 5 }, (_, i) => ({
    date: `2026-09-0${i + 1}`, capitalCommitted: 19000,
  }));
  assert.equal(capitalDaysConstant(19000, 5), capitalDaysFromDailySeries(constantSeries));
});

test('capitalDaysConstant throws on negative capital or negative day count', () => {
  assert.throws(() => capitalDaysConstant(-1, 5), /CAPITAL_DAYS_INVALID_CAPITAL_COMMITTED/);
  assert.throws(() => capitalDaysConstant(19000, -1), /CAPITAL_DAYS_INVALID_DAY_COUNT/);
});

test('returnPerCapitalDay divides NetPnL by CapitalDays for a real positive CapitalDays figure', () => {
  assert.equal(returnPerCapitalDay(570, 57000), 0.01);
});

test('REPAIR-CLASS: returnPerCapitalDay returns null (UNKNOWN), never Infinity or 0, when CapitalDays is exactly zero', () => {
  assert.equal(returnPerCapitalDay(0, 0), null);
  assert.equal(returnPerCapitalDay(500, 0), null);
});

test('returnPerCapitalDay handles a real negative NetPnL correctly against positive CapitalDays', () => {
  assert.equal(returnPerCapitalDay(-570, 57000), -0.01);
});
