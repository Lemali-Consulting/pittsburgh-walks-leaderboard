/**
 * October 2026 survey competition: date windows, prize table, and top-N ranking.
 *
 * Pure logic with no DOM access, so it runs in the browser (window.Competition)
 * and under `node --test`. All dates are Eastern time; October 2026 is entirely
 * EDT (-04:00), and DST ends at 2am on Nov 1, after the month window closes.
 */
(function(root) {
  var PHASE = Object.freeze({ upcoming: 'upcoming', live: 'live', final: 'final' });
  var BOARD = Object.freeze({ week: 'week', month: 'month' });

  // End instants are exclusive: a survey counts if start <= timestamp < end.
  var WINDOWS = Object.freeze({
    weekWithoutDriving: Object.freeze({
      start: Date.parse('2026-10-01T00:00:00-04:00'),
      end: Date.parse('2026-10-09T00:00:00-04:00')
    }),
    october: Object.freeze({
      start: Date.parse('2026-10-01T00:00:00-04:00'),
      end: Date.parse('2026-11-01T00:00:00-04:00')
    })
  });

  // Client asked for the Week Without Driving tab to disappear after Oct 12.
  var WEEK_TAB_SUNSET = Date.parse('2026-10-13T00:00:00-04:00');

  // Keep final October standings up for two weeks so winners can be seen,
  // then drop the view and its entry link from the main leaderboard.
  var COMPETITION_VIEW_RETIRES = Date.parse('2026-11-15T00:00:00-05:00');

  var PRIZE = Object.freeze({
    visa50: '$50 VISA',
    visa20: '$20 VISA',
    iceCream: "MILLIE'S"
  });

  // Index 0 = rank 1.
  var PRIZES_BY_RANK = Object.freeze({
    week: [PRIZE.visa50, PRIZE.visa50],
    month: [PRIZE.visa50, PRIZE.visa20, PRIZE.iceCream, PRIZE.iceCream, PRIZE.iceCream]
  });

  function inWindow(window, timestamp) {
    return timestamp >= window.start && timestamp < window.end;
  }

  function phaseOf(window, now) {
    if (now < window.start) return PHASE.upcoming;
    if (now < window.end) return PHASE.live;
    return PHASE.final;
  }

  function isWeekTabVisible(now) {
    return now < WEEK_TAB_SUNSET;
  }

  function isCompetitionViewVisible(now) {
    return now < COMPETITION_VIEW_RETIRES;
  }

  function surveyCount(opts) {
    return opts.records.filter(function(r) { return inWindow(opts.window, r.timestamp); }).length;
  }

  // Ranks use standard competition ranking (1, 2, 2, 4), and everyone whose
  // rank falls within the limit is kept — so a tie for 5th shows both people
  // rather than silently dropping one from prize contention.
  function topCollectors(opts) {
    var counts = {};
    opts.records.forEach(function(r) {
      if (inWindow(opts.window, r.timestamp)) counts[r.user] = (counts[r.user] || 0) + 1;
    });

    var sorted = Object.keys(counts)
      .map(function(user) { return { user: user, count: counts[user] }; })
      .sort(function(a, b) { return b.count - a.count; });

    var ranked = [];
    for (var i = 0; i < sorted.length; i++) {
      var rank = (i > 0 && sorted[i].count === sorted[i - 1].count) ? ranked[i - 1].rank : i + 1;
      if (rank > opts.limit) break;
      ranked.push({ rank: rank, user: sorted[i].user, count: sorted[i].count });
    }
    return ranked;
  }

  function prizeFor(opts) {
    return PRIZES_BY_RANK[opts.board][opts.rank - 1] || null;
  }

  var api = {
    PHASE: PHASE,
    BOARD: BOARD,
    WINDOWS: WINDOWS,
    PRIZE: PRIZE,
    inWindow: inWindow,
    phaseOf: phaseOf,
    isWeekTabVisible: isWeekTabVisible,
    isCompetitionViewVisible: isCompetitionViewVisible,
    surveyCount: surveyCount,
    topCollectors: topCollectors,
    prizeFor: prizeFor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Competition = api;
})(this);
