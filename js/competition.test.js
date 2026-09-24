// Run with: node --test js/competition.test.js
const test = require('node:test');
const assert = require('node:assert');
const C = require('./competition.js');

// Eastern-time instants, written the way the client states the dates.
const at = (isoEastern) => Date.parse(isoEastern);

function record(user, isoEastern) {
  return { user: user, timestamp: at(isoEastern) };
}

test('week window covers Oct 1 through Oct 8 inclusive, Eastern time', () => {
  const w = C.WINDOWS.weekWithoutDriving;
  assert.ok(C.inWindow(w, at('2026-10-01T00:00:00-04:00')));
  assert.ok(C.inWindow(w, at('2026-10-08T23:59:59-04:00')));
  assert.ok(!C.inWindow(w, at('2026-09-30T23:59:59-04:00')));
  assert.ok(!C.inWindow(w, at('2026-10-09T00:00:00-04:00')));
});

test('month window covers all of October, Eastern time', () => {
  const w = C.WINDOWS.october;
  assert.ok(C.inWindow(w, at('2026-10-31T23:59:59-04:00')));
  assert.ok(!C.inWindow(w, at('2026-11-01T00:00:00-04:00')));
  // 11pm Sep 30 Eastern is already Oct 1 in UTC — must not count.
  assert.ok(!C.inWindow(w, at('2026-09-30T23:00:00-04:00')));
});

test('week tab is shown through Oct 12 and gone from Oct 13', () => {
  assert.ok(C.isWeekTabVisible(at('2026-09-24T12:00:00-04:00')));
  assert.ok(C.isWeekTabVisible(at('2026-10-12T23:59:59-04:00')));
  assert.ok(!C.isWeekTabVisible(at('2026-10-13T00:00:00-04:00')));
});

test('phase is upcoming before a window, live during, final after', () => {
  const w = C.WINDOWS.weekWithoutDriving;
  assert.strictEqual(C.phaseOf(w, at('2026-09-30T12:00:00-04:00')), C.PHASE.upcoming);
  assert.strictEqual(C.phaseOf(w, at('2026-10-04T12:00:00-04:00')), C.PHASE.live);
  assert.strictEqual(C.phaseOf(w, at('2026-10-10T12:00:00-04:00')), C.PHASE.final);
});

test('topCollectors counts only surveys inside the window', () => {
  const records = [
    record('alice', '2026-09-30T20:00:00-04:00'), // before
    record('alice', '2026-10-02T10:00:00-04:00'),
    record('bob', '2026-10-03T10:00:00-04:00'),
    record('bob', '2026-10-04T10:00:00-04:00'),
    record('bob', '2026-10-09T10:00:00-04:00'), // after the week
  ];
  const top = C.topCollectors({ records: records, window: C.WINDOWS.weekWithoutDriving, limit: 5 });
  assert.deepStrictEqual(top, [
    { rank: 1, user: 'bob', count: 2 },
    { rank: 2, user: 'alice', count: 1 },
  ]);
});

test('topCollectors limits to N and keeps everyone tied at the cutoff', () => {
  const day = '2026-10-05T12:00:00-04:00';
  const records = [];
  const counts = { a: 6, b: 5, c: 4, d: 3, e: 2, f: 2, g: 1 };
  Object.keys(counts).forEach((u) => {
    for (let i = 0; i < counts[u]; i++) records.push(record(u, day));
  });
  const top = C.topCollectors({ records: records, window: C.WINDOWS.october, limit: 5 });
  assert.deepStrictEqual(top.map((r) => [r.rank, r.user]), [
    [1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e'], [5, 'f'],
  ]);
});

test('tied collectors share a rank', () => {
  const day = '2026-10-05T12:00:00-04:00';
  const records = [record('x', day), record('y', day), record('z', day), record('z', day)];
  const top = C.topCollectors({ records: records, window: C.WINDOWS.october, limit: 5 });
  assert.deepStrictEqual(top.map((r) => r.rank), [1, 2, 2]);
});

test('prizeFor maps ranks to the advertised prizes', () => {
  assert.strictEqual(C.prizeFor({ board: C.BOARD.week, rank: 1 }), C.PRIZE.visa50);
  assert.strictEqual(C.prizeFor({ board: C.BOARD.week, rank: 2 }), C.PRIZE.visa50);
  assert.strictEqual(C.prizeFor({ board: C.BOARD.week, rank: 3 }), null);
  assert.strictEqual(C.prizeFor({ board: C.BOARD.month, rank: 1 }), C.PRIZE.visa50);
  assert.strictEqual(C.prizeFor({ board: C.BOARD.month, rank: 2 }), C.PRIZE.visa20);
  assert.strictEqual(C.prizeFor({ board: C.BOARD.month, rank: 5 }), C.PRIZE.iceCream);
  assert.strictEqual(C.prizeFor({ board: C.BOARD.month, rank: 6 }), null);
});

test('surveyCount totals surveys inside a window', () => {
  const records = [
    record('a', '2026-10-01T09:00:00-04:00'),
    record('b', '2026-10-20T09:00:00-04:00'),
    record('c', '2026-11-02T09:00:00-05:00'),
  ];
  assert.strictEqual(C.surveyCount({ records: records, window: C.WINDOWS.october }), 2);
});

test('competition view stays up through final results, then retires', () => {
  assert.ok(C.isCompetitionViewVisible(at('2026-09-24T12:00:00-04:00')));
  assert.ok(C.isCompetitionViewVisible(at('2026-11-14T23:59:59-05:00')));
  assert.ok(!C.isCompetitionViewVisible(at('2026-11-15T00:00:00-05:00')));
});
