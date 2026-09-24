/**
 * October challenge view: swaps between the main leaderboard and the
 * competition page in place (hash #october, no reload) and renders the
 * top-5 boards. Depends on competition.js (window.Competition).
 *
 * For previewing other dates, append ?now=<ISO date> to the URL, e.g.
 * ?now=2026-10-05T12:00:00-04:00
 */
(function() {
  var C = window.Competition;

  var VIEW_HASH = '#october';
  var TOP_N = 5;
  var NOW_OVERRIDE_PARAM = 'now';

  var BOARDS = {
    week: {
      board: C.BOARD.week,
      window: C.WINDOWS.weekWithoutDriving,
      title: 'WEEK WITHOUT DRIVING',
      dates: 'OCT 1 – 8'
    },
    month: {
      board: C.BOARD.month,
      window: C.WINDOWS.october,
      title: 'OCTOBER',
      dates: 'MONTH TO DATE'
    }
  };

  var STATUS_TEXT = {};
  STATUS_TEXT[C.PHASE.upcoming] = 'STARTS OCT 1';
  STATUS_TEXT[C.PHASE.live] = 'LIVE';
  STATUS_TEXT[C.PHASE.final] = 'FINAL';

  var records = [];
  var colors = [];
  var activeBoard = null;

  function now() {
    var override = new URLSearchParams(window.location.search).get(NOW_OVERRIDE_PARAM);
    var parsed = override ? Date.parse(override) : NaN;
    return isNaN(parsed) ? Date.now() : parsed;
  }

  function init(opts) {
    records = opts.records;
    colors = opts.colors;

    if (!C.isCompetitionViewVisible(now())) return;

    document.getElementById('promo-banner').hidden = false;
    configureBoardTabs();
    renderMonthStats();

    window.addEventListener('hashchange', syncViewToHash);
    syncViewToHash();
  }

  function configureBoardTabs() {
    var weekVisible = C.isWeekTabVisible(now());
    var weekBtn = document.querySelector('.comp-tab[data-board="week"]');
    weekBtn.hidden = !weekVisible;

    document.querySelectorAll('.comp-tab').forEach(function(btn) {
      btn.addEventListener('click', function() { selectBoard(this.getAttribute('data-board')); });
    });

    selectBoard(weekVisible ? 'week' : 'month');
  }

  function syncViewToHash() {
    var showCompetition = window.location.hash === VIEW_HASH;
    document.getElementById('main-view').hidden = showCompetition;
    document.getElementById('competition-view').hidden = !showCompetition;
    if (window.self === window.top) window.scrollTo(0, 0);
  }

  function selectBoard(key) {
    activeBoard = key;
    document.querySelectorAll('.comp-tab').forEach(function(btn) {
      var isActive = btn.getAttribute('data-board') === key;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
    renderBoard(BOARDS[key]);
  }

  function renderMonthStats() {
    var octoberRecords = records.filter(function(r) { return C.inWindow(C.WINDOWS.october, r.timestamp); });
    var players = {};
    octoberRecords.forEach(function(r) { players[r.user] = true; });
    document.getElementById('comp-stat-surveys').textContent = octoberRecords.length.toLocaleString();
    document.getElementById('comp-stat-players').textContent = Object.keys(players).length.toLocaleString();
  }

  function renderBoard(cfg) {
    var phase = C.phaseOf(cfg.window, now());
    var top = C.topCollectors({ records: records, window: cfg.window, limit: TOP_N });

    document.getElementById('comp-board-title').textContent = cfg.title;
    document.getElementById('comp-board-dates').textContent = cfg.dates;
    var status = document.getElementById('comp-board-status');
    status.textContent = STATUS_TEXT[phase];
    status.className = 'comp-status comp-status-' + phase;

    var body = document.getElementById('comp-board-body');
    if (!top.length) {
      body.innerHTML = '<tr class="comp-empty"><td colspan="4">'
        + (phase === C.PHASE.upcoming ? 'GET READY — LACE UP YOUR SHOES!' : 'NO SURVEYS YET — BE THE FIRST!')
        + '</td></tr>';
      return;
    }
    body.innerHTML = top.map(function(entry, idx) { return boardRow(cfg, entry, idx); }).join('');
  }

  function boardRow(cfg, entry, idx) {
    var prize = C.prizeFor({ board: cfg.board, rank: entry.rank });
    var classes = entry.rank <= 3 ? 'top-rank top-rank-' + entry.rank : '';
    return '<tr class="' + classes + '" style="color:' + colors[idx % colors.length]
      + '; animation-delay:' + (0.1 + idx * 0.06) + 's">'
      + '<td>' + entry.rank + '</td>'
      + '<td>' + escapeHtml(entry.user) + '</td>'
      + '<td>' + entry.count + '</td>'
      + '<td class="comp-prize">' + (prize ? escapeHtml(prize) : '&ndash;') + '</td>'
      + '</tr>';
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  window.CompetitionView = { init: init };
})();
