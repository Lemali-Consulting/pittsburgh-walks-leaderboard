/**
 * Main leaderboard: which surveys each tab covers, and the headline totals.
 *
 * Pure logic with no DOM access, so it runs in the browser (window.Leaderboard)
 * and under `node --test`.
 */
(function(root) {
  var TAB = Object.freeze({ overall: 'overall', month: 'month' });

  var DAY_MS = 24 * 60 * 60 * 1000;
  var MONTH_TAB_DAYS = 30;

  function recordsForTab(opts) {
    if (opts.tab !== TAB.month) return opts.records;
    var cutoff = opts.now - MONTH_TAB_DAYS * DAY_MS;
    return opts.records.filter(function(r) { return r.timestamp >= cutoff; });
  }

  // Group-account surveys count toward the survey total, matching DOMI's
  // dashboard, but a shared account isn't a player, so it stays out of that count.
  function statTotals(opts) {
    var ranked = recordsForTab({ records: opts.rankedRecords, tab: opts.tab, now: opts.now });
    var group = recordsForTab({ records: opts.groupRecords, tab: opts.tab, now: opts.now });
    var players = {};
    ranked.forEach(function(r) { players[r.user] = true; });
    return { surveys: ranked.length + group.length, players: Object.keys(players).length };
  }

  var api = {
    TAB: TAB,
    recordsForTab: recordsForTab,
    statTotals: statTotals
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Leaderboard = api;
})(this);
