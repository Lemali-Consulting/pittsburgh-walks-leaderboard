// Run with: node --test js/leaderboard.test.js
const test = require('node:test');
const assert = require('node:assert');
const L = require('./leaderboard.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-01T12:00:00-04:00');

function record(user, daysAgo) {
  return { user: user, timestamp: NOW - daysAgo * DAY_MS };
}

test('last-30-days tab keeps only surveys from the past 30 days', () => {
  const records = [record('a', 1), record('b', 29), record('c', 31), { user: 'd', timestamp: 0 }];
  const kept = L.recordsForTab({ records: records, tab: L.TAB.month, now: NOW });
  assert.deepStrictEqual(kept.map((r) => r.user), ['a', 'b']);
});

test('all-time tab keeps every survey, including undated legacy rows', () => {
  const records = [record('a', 1), record('c', 400), { user: 'd', timestamp: 0 }];
  assert.strictEqual(L.recordsForTab({ records: records, tab: L.TAB.overall, now: NOW }).length, 3);
});

test('survey total includes group-account surveys, but player count does not', () => {
  const rankedRecords = [record('alice', 1), record('alice', 2), record('bob', 3)];
  const groupRecords = [record('s-411sb', 1), record('s-822ng', 2)];
  const totals = L.statTotals({ rankedRecords: rankedRecords, groupRecords: groupRecords, tab: L.TAB.overall, now: NOW });
  assert.deepStrictEqual(totals, { surveys: 5, players: 2 });
});

test('group surveys in the survey total follow the tab window too', () => {
  const rankedRecords = [record('alice', 1)];
  const groupRecords = [record('s-411sb', 1), record('s-411sb', 45)];
  const totals = L.statTotals({ rankedRecords: rankedRecords, groupRecords: groupRecords, tab: L.TAB.month, now: NOW });
  assert.deepStrictEqual(totals, { surveys: 2, players: 1 });
});
