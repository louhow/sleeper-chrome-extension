// Fills Sleeper's empty NBA Team and Matchup tabs (sleeper.com/leagues/<id>/team
// and /matchup) with rosters, schedules, projections, lineup swaps and Lock-In.
// Falls back to a floating panel when the page has no placeholder to fill.
// On every page of an NBA league it also answers Sleeper's waiver and add
// buttons (see page-hook.js) with a bid dialog.
(() => {
  const { createApi, view, model, scoring, ui, waivers, optimize, card, nfl, whatif } = globalThis.SNP;
  const ROUTE = /^\/leagues\/(\d+)(?:\/([^/]+))?/;
  const PANEL_PAGES = new Set(['team', 'matchup', 'league']);
  const PLAYERS_PATH = '/v1/players/nba';
  const PLAYERS_KEY = 'players:nba:v4';
  const PLAYERS_TTL_MS = 12 * 3600e3;
  // Sleeper only allows trading picks this many seasons ahead; it isn't exposed per league.
  const PICK_SEASONS = 3;
  const FLOAT_AFTER_MS = 4000;
  const NOTICE_MS = 3000;
  const CLOCK_MS = 60e3;
  // Lock-In needs who was starting at each tip-off, and Sleeper keeps no lineup
  // history, so your leg is read once a few minutes after each tip-off time of
  // your players' games (while the tab is visible, or when it comes back during
  // the game): Sleeper won't move a player whose game is on, so that read settles it.
  const AFTER_TIP_MS = 5 * 60e3;
  // Never read the legs more often than this, whatever asks.
  const LEG_READ_GAP_MS = 60e3;
  // Career seasons fetched for the player card (one request each).
  const CAREER_SEASONS = 10;
  const CARD_SEASON_TABS = 6;
  const TRANSACTION_FIELDS = 'adds drops leg roster_ids settings status transaction_id type created creator';

  // The stylesheet is inlined into each shadow root, so nothing ever paints unstyled.
  const stylesheet = fetch(chrome.runtime.getURL('src/panel.css')).then((r) => r.text());

  let active = null;

  // Admin tools (what-if scoring: the Scoring control and the Players tab's
  // adminFPTS and adminDelta columns) are hidden unless turned on with
  // ?snp-admin=1 (off again with ?snp-admin=0). Sleeper's own navigation drops
  // the query string, between tabs and between leagues alike, so the choice is
  // saved for the whole browser the first time a URL carries it, and every
  // page, league, reload and tab follows the saved choice from then on.
  const ADMIN_PARAM = 'snp-admin';
  const ADMIN_STORE = 'admin';
  let admin = false;
  let adminFromUrl = false; // a URL decided it, so the saved choice loading late mustn't undo that
  function adminParam() {
    const value = new URLSearchParams(location.search).get(ADMIN_PARAM);
    return value == null ? null : !['0', 'off', 'false', 'no'].includes(value.toLowerCase());
  }
  function setAdmin(on) {
    if (on === admin) return;
    admin = on;
    active?.setAdmin(on);
  }
  chrome.storage.local.get(ADMIN_STORE).then((saved) => {
    if (!adminFromUrl) setAdmin(Boolean(saved[ADMIN_STORE]));
  });
  // Another tab turned it on or off.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ADMIN_STORE in changes) setAdmin(Boolean(changes[ADMIN_STORE].newValue));
  });

  // Sleeper is a single-page app, so route changes don't reload content scripts.
  // Polling also re-attaches the panel if React re-renders the tab.
  function sync() {
    const param = adminParam();
    if (param != null && (param !== admin || !adminFromUrl)) {
      adminFromUrl = true;
      chrome.storage.local.set({ [ADMIN_STORE]: param });
      setAdmin(param);
    }
    const [, leagueId = null, page = null] = location.pathname.match(ROUTE) ?? [];
    // One session per league, kept across its tabs; the panel only shows on Team and Matchup.
    if (leagueId !== (active?.leagueId ?? null)) {
      active?.destroy();
      active = leagueId ? mount(leagueId, page) : null;
    }
    active?.show(page);
    active?.attach();
  }

  function mount(leagueId, page) {
    const host = document.createElement('div');
    host.id = 'sleeper-nba-panel';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style></style><div class="root"></div>';
    const root = shadow.querySelector('.root');
    // Dialogs and Players-tab notices live in their own host over the whole page.
    const layer = document.createElement('div');
    layer.id = 'sleeper-nba-dialog';
    const layerShadow = layer.attachShadow({ mode: 'open' });
    layerShadow.innerHTML = '<style></style><div class="root"></div>';
    const layerRoot = layerShadow.querySelector('.root');
    // What-if scoring sits in the page's top-right corner, over dialogs too.
    const corner = document.createElement('div');
    corner.id = 'sleeper-nba-scoring';
    const cornerShadow = corner.attachShadow({ mode: 'open' });
    cornerShadow.innerHTML = '<style></style><div class="root"></div>';
    const cornerRoot = cornerShadow.querySelector('.root');
    let styled = false;
    stylesheet.then((css) => {
      shadow.querySelector('style').textContent = css;
      layerShadow.querySelector('style').textContent = css;
      cornerShadow.querySelector('style').textContent = css;
      styled = true;
      schedule();
    });
    let mountedAt = Date.now();
    let hidden = null; // Sleeper's placeholder, hidden while we fill its spot

    const state = {
      leagueId,
      page: PANEL_PAGES.has(page) ? page : 'team', // panel view: 'team' | 'matchup' | 'league'
      onPanel: PANEL_PAGES.has(page), // whether the URL is a tab the panel fills
      tab: 'page', // 'page' | 'api'
      now: Date.now(),
      error: null,
      league: null,
      usersById: null,
      rosters: null,
      players: null,
      rosterId: null,
      picks: null,
      week: null,
      currentWeek: null,
      minWeek: 1,
      maxWeek: Infinity,
      weeks: {},
      // week -> roster id -> lineups seen: [{ from, to, starters }] (see model.startedAt). Your own rosters only.
      lineupHistory: {},
      today: new Date().toLocaleDateString('en-CA'),
      openCalls: new Set(),
      me: null, // logged-in user id, when the page has a session
      swap: null, // lineup spot picked to swap, e.g. 's:2' or 'b:<player id>'
      saving: false,
      notice: null, // { kind: 'error' | 'ok', text }
      lockConfirm: null, // player id whose Lock-In is awaiting confirmation
      ready: false, // first league + week load finished; the panel stays blank until then
      // Sleeper turned down the page's login (see api.sessionExpired): show nothing but how to fix it,
      // since the logged-out fallbacks (public rosters, no Lock-In picks) would show wrong numbers.
      sessionExpired: false,
      claims: null, // the logged-in owner's pending waiver claims
      cards: {}, // player card data by player id, kept for the session
      // { kind: 'bid', playerId, status, bid, drops, errors, saving } | { kind: 'claims', errors, saving } | { kind: 'player', playerId, season }
      // | { kind: 'optimize', plan, noLock, ack, errors, saving, busy } (noLock: locks kept open; busy: 'all', 'row:<slot>' or 'lock:<player>' while it saves; done: what the last row saved); a player card can open over it (`back`).
      modal: null,
      // What-if scoring: values that differ from the league's, whether they're in use, and the editor's state.
      // `drafts` holds text being typed that isn't a number yet.
      // `enabled` mirrors the admin switch (?snp-admin); off, nothing what-if shows or applies.
      whatIf: { enabled: admin, overrides: {}, on: false, open: false, showAll: false, drafts: {} },
    };
    let destroyed = false;
    let lastPage = page; // the league tab shown, panel or not
    let nflSession = null; // set instead of the panel when the league is NFL
    let pendingCard = null; // player card asked for before the league finished loading
    let disabled = false;
    let frame = 0;
    const api = createApi(schedule);

    function attach() {
      nflSession?.attach();
      if (destroyed || disabled) return;
      if (!state.onPanel) return detach();
      // The League tab: on top of Sleeper's own content, which stays.
      if (state.page === 'league') {
        const container = document.querySelector('.league-tab-container');
        // Not there (yet): out of the way, and Sleeper's placeholder back.
        if (!container) return detach();
        restorePlaceholder();
        if (container.firstElementChild !== host) {
          host.classList.remove('floating');
          host.classList.add('on-league');
          container.prepend(host);
        }
        return;
      }
      host.classList.remove('on-league');
      const placeholder = document.querySelector('.postdraft-panel .empty-panel-container');
      const panel = placeholder?.closest('.postdraft-panel');
      if (panel) {
        const wrapper = [...panel.children].find((c) => c.contains(placeholder));
        if (hidden !== wrapper) {
          restorePlaceholder();
          hidden = wrapper;
          hidden.style.display = 'none';
        }
        if (host.parentElement !== panel || host.previousElementSibling !== wrapper) {
          host.classList.remove('floating');
          wrapper.after(host);
        }
      } else if (!host.isConnected && Date.now() - mountedAt > FLOAT_AFTER_MS) {
        host.classList.add('floating');
        document.documentElement.appendChild(host);
      }
    }

    function restorePlaceholder() {
      if (hidden) hidden.style.display = '';
      hidden = null;
    }

    function detach() {
      host.remove();
      restorePlaceholder();
      mountedAt = Date.now();
    }

    function schedule() {
      if (frame || destroyed) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (destroyed || !styled) return;
        state.now = Date.now();
        state.sessionExpired = api.sessionExpired();
        renderLayer();
        renderCorner();
        // Blank until everything for the first paint is in, like Sleeper's own tabs.
        if (!(state.ready || state.error || state.sessionExpired)) return;
        const scrollTop = root.querySelector('.body')?.scrollTop ?? 0;
        root.innerHTML = view.render(state, api.log);
        const body = root.querySelector('.body');
        if (body) body.scrollTop = scrollTop;
      });
    }

    // The open dialog, plus save notices when there's no panel (or it's covered by the dialog).
    function renderLayer() {
      const showNotice = Boolean(state.notice) && (!state.onPanel || state.modal);
      if (!state.modal && !showNotice) return layer.remove();
      if (!layer.isConnected) document.documentElement.appendChild(layer);
      // Scrolled areas keep their place across re-renders.
      const scrolls = [...layerRoot.querySelectorAll('.dialog-body, [data-scroll]')].map((el) => [el.dataset.scroll || 'dialog', el.scrollTop]);
      const focused = layerShadow.activeElement?.matches?.('[data-bid]');
      const kind = state.modal?.kind;
      const dialog = kind === 'player' ? card.render(state) : kind === 'optimize' ? optimize.render(state) : waivers.render(state);
      // A player card opened from the optimize dialog sits on top of it.
      const under = state.modal?.back?.kind === 'optimize' ? optimize.render(state, state.modal.back) : '';
      layerRoot.innerHTML = `<div class="page-layer${ui.whatIfOn(state) ? ' whatif' : ''}">${under}${dialog}${showNotice ? ui.notice(state) : ''}</div>`;
      for (const [key, top] of scrolls) {
        const el = key === 'dialog' ? layerRoot.querySelector('.dialog-body') : layerRoot.querySelector(`[data-scroll="${key}"]`);
        if (el) el.scrollTop = top;
      }
      const input = layerRoot.querySelector('[data-bid]');
      if (input && (focused || state.modal.focus)) {
        input.focus();
        state.modal.focus = false;
      }
    }

    // The what-if scoring control, wherever the extension shows fantasy points:
    // the Team and Matchup tabs, its dialogs, and the Players tab's adminFPTS
    // column. It's patched in place, so a field being typed in keeps its focus, caret and text.
    function renderCorner() {
      if (!(state.whatIf.enabled && state.ready && !state.error && (state.onPanel || state.modal || lastPage === 'players'))) {
        state.whatIf.open = false;
        return corner.remove();
      }
      if (!corner.isConnected) document.documentElement.appendChild(corner);
      const next = document.createElement('div');
      next.innerHTML = whatif.render(state);
      morph(cornerRoot, next, cornerShadow.activeElement);
    }

    // Makes `from` match `to`, keeping nodes that are already right. Children
    // pair up by position; an input keeps whatever is being typed into it.
    function morph(from, to, active) {
      const a = [...from.childNodes];
      const b = [...to.childNodes];
      b.forEach((node, i) => {
        const old = a[i];
        if (!old) return from.append(node);
        if (old.nodeName !== node.nodeName) return old.replaceWith(node);
        if (node.nodeType === Node.TEXT_NODE) {
          if (old.data !== node.data) old.data = node.data;
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        for (const { name } of [...old.attributes]) if (!node.hasAttribute(name)) old.removeAttribute(name);
        for (const { name, value } of [...node.attributes]) if (old.getAttribute(name) !== value) old.setAttribute(name, value);
        if (old.tagName === 'INPUT') {
          if (old !== active && old.value !== node.value) old.value = node.value;
          return;
        }
        morph(old, node, active);
      });
      a.slice(b.length).forEach((node) => node.remove());
    }

    // Changes what-if scoring, rescores every loaded week and remembers it for this league.
    function setWhatIf(changes) {
      const w = Object.assign(state.whatIf, changes);
      w.overrides = scoring.changedOnly(state.league?.scoring_settings || {}, w.overrides);
      chrome.storage.local.set({ [`whatif:${leagueId}`]: { overrides: w.overrides, on: w.on } });
      rescore();
      sendAdminScoring();
      schedule();
    }

    // The Players tab's adminFPTS column (page-hook.js) always shows the what-if
    // values, switched on or not. Each change is announced; page-hook then asks
    // for each player's difference from the league's scoring (adminDeltas).
    function sendAdminScoring() {
      document.dispatchEvent(new CustomEvent('snp:admin-scoring', {
        detail: JSON.stringify({ leagueId, enabled: state.whatIf.enabled, changed: Object.keys(state.whatIf.overrides).length > 0 }),
      }));
    }
    // For each player: points the changed settings add to Sleeper's FPTS, and
    // for the players in view, how many places that moves them (with its color).
    function adminDeltas(e) {
      const league = state.league?.scoring_settings || {};
      // Scoring with just the differences gives what they add on top of Sleeper's FPTS.
      const delta = Object.fromEntries(Object.entries(state.whatIf.overrides).map(([key, value]) => [key, value - (league[key] ?? 0)]));
      const { stats, view, base } = JSON.parse(e.detail);
      const points = Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, s ? scoring.scoreStats(delta, s) : 0]));
      const ids = view.filter((id) => stats[id]?.[base] != null);
      // Ranked per game, as the table shows every stat (a season's stats are totals).
      const games = (id) => (stats[id].gp > 0 ? stats[id].gp : 1);
      const was = model.ranks(ids, (id) => stats[id][base] / games(id));
      const now = model.ranks(ids, (id) => (stats[id][base] + points[id]) / games(id));
      const shifts = Object.fromEntries(ids.map((id) => [id, was[id] - now[id]]));
      const biggest = Math.max(0, ...Object.values(shifts).map(Math.abs));
      const tints = Object.fromEntries(ids.map((id) => [id, model.shiftTint(shifts[id], biggest)]));
      // Both places too, shown under the badge so a shift can be checked at a glance.
      const places = Object.fromEntries(ids.map((id) => [id, [was[id], now[id]]]));
      document.dispatchEvent(new CustomEvent('snp:admin-scores', { detail: JSON.stringify({ points, shifts, tints, places }) }));
    }
    document.addEventListener('snp:admin-score-request', adminDeltas);

    // The Players tab's week view (page-hook.js), from the week's per-game
    // stats: for Avg, how many games each player played ('played'); for Best
    // and Worst, each player's best or worst game by the league's scoring (as
    // Sleeper's FPTS is). Answers before dispatchEvent returns, or with null
    // while the week loads ('snp:week-games-ready' follows).
    const weekGames = {}; // `${season}|${week}` -> stat rows, or the load in flight
    // A week's per-game stat rows, once per page load; null while they load
    // (then 'snp:week-games-ready').
    function weekStatRows(season, week) {
      const key = `${season}|${week}`;
      if (!weekGames[key]) {
        const type = season === state.league?.season ? state.league.season_type || 'regular' : 'regular';
        weekGames[key] = api.get(`/stats/nba/${season}/${week}?season_type=${type}`)
          .then((rows) => { weekGames[key] = rows || []; })
          .catch(() => { weekGames[key] = []; })
          .finally(() => document.dispatchEvent(new CustomEvent('snp:week-games-ready')));
      }
      return Array.isArray(weekGames[key]) ? weekGames[key] : null;
    }

    function pickWeekGames(e) {
      const { season, week, mode } = JSON.parse(e.detail);
      const rows = weekStatRows(season, week);
      let games = null;
      if (rows) {
        const settings = state.league?.scoring_settings || {};
        const better = mode === 'worst' ? (a, b) => a < b : (a, b) => a > b;
        const best = {};
        const played = {};
        for (const { player_id: id, stats } of rows) {
          // Games a player sat out come back with no stats.
          if (!(stats?.sp > 0 || stats?.min > 0)) continue;
          played[id] = (played[id] || 0) + 1;
          const fpts = scoring.scoreStats(settings, stats);
          if (!best[id] || better(fpts, best[id].fpts)) best[id] = { ...stats, gp: 1, fpts };
        }
        games = mode === 'played' ? played : best;
      }
      document.dispatchEvent(new CustomEvent('snp:week-games', { detail: JSON.stringify(games) }));
    }
    document.addEventListener('snp:week-games-request', pickWeekGames);

    // A week's schedule for the Players tab's strip, per team and day: '' (no
    // game), 'done', 'live' or 'left', with each game (id, opponent, home, tip-off),
    // and each player's fantasy points and score tier per finished game (league scoring).
    // Null while it loads (then 'snp:week-games-ready'). Read from a loaded
    // week, else one scores query; the points come from the week's stat rows.
    const weekSchedules = {};
    function weekSchedule(e) {
      const { season, week } = JSON.parse(e.detail);
      const key = `${season}|${week}`;
      const loaded = season === state.league?.season && state.weeks[week];
      if (!loaded && !weekSchedules[key]) {
        const type = season === state.league?.season ? state.league.season_type || 'regular' : 'regular';
        weekSchedules[key] = api.graphql(`scores (week ${week})`, `query scores {
  scores(sport: "nba", season_type: ${JSON.stringify(type)}, season: ${JSON.stringify(String(season))}, week: ${Number(week)}) {
    date game_id metadata status start_time
  }
}`)
          .then((data) => { weekSchedules[key] = data?.scores || []; })
          .catch(() => { weekSchedules[key] = []; })
          .finally(() => document.dispatchEvent(new CustomEvent('snp:week-games-ready')));
      }
      const scores = loaded ? null : Array.isArray(weekSchedules[key]) ? weekSchedules[key] : undefined;
      let out = null;
      if (loaded || scores) {
        const days = loaded ? loaded.days : model.weekDays(scores);
        const byTeam = loaded ? loaded.gamesByTeam : model.gamesByTeam(scores);
        const now = Date.now();
        const stateOf = (g) => (!g ? '' : g.status === 'complete' ? 'done'
          : g.status === 'in_game' || (g.start != null && g.start <= now) ? 'live' : 'left');
        const teamOf = Object.fromEntries(Object.entries(state.players || {}).filter(([, pl]) => pl.team).map(([id, pl]) => [id, pl.team]));
        const settings = state.league?.scoring_settings || {};
        const points = {};
        const rows = weekStatRows(season, week);
        for (const { player_id: id, game_id: game, stats } of rows || []) {
          // A game sat out comes back with no stats.
          if (!(stats?.sp > 0 || stats?.min > 0)) continue;
          const fpts = scoring.scoreStats(settings, stats);
          // With its color, as the Team tab and game log show it.
          (points[id] ||= {})[game] = { fpts, tier: model.scoreTier(fpts) };
        }
        out = { days, teamOf, points, pointsReady: Boolean(rows),
          teams: Object.fromEntries(Object.entries(byTeam).map(([team, games]) => [team, days.map((d) => stateOf(games[d]))])),
          games: Object.fromEntries(Object.entries(byTeam).map(([team, games]) => [team, days.map((d) => {
            const g = games[d];
            return g ? { id: g.id, home: g.home === team, opponent: g.home === team ? g.away : g.home, start: g.start } : null;
          })])) };
      }
      document.dispatchEvent(new CustomEvent('snp:week-schedule', { detail: JSON.stringify(out) }));
    }
    document.addEventListener('snp:week-schedule-request', weekSchedule);

    // Every loaded week's fantasy points, with whichever scoring is in use.
    function rescore() {
      const settings = ui.scoringOf(state);
      for (const week of Object.values(state.weeks)) {
        week.proj = model.pointsByGame(week.projRows, settings, scoring.scoreStats);
        week.actual = model.pointsByGame(week.statRows, settings, scoring.scoreStats);
      }
    }

    function fail(err) {
      if (destroyed) return;
      console.error('[sleeper-nba-panel]', err);
      state.error = String(err.message || err);
      schedule();
    }

    async function loadPlayers(force) {
      if (!force) {
        const { [PLAYERS_KEY]: hit } = await chrome.storage.local.get(PLAYERS_KEY);
        if (hit && Date.now() - hit.savedAt < PLAYERS_TTL_MS) {
          api.cached(PLAYERS_PATH, hit.players, JSON.stringify(hit.players).length);
          return hit.players;
        }
      }
      const raw = await api.get(PLAYERS_PATH);
      const players = {};
      for (const [id, p] of Object.entries(raw)) {
        players[id] = {
          name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          first: p.first_name,
          last: p.last_name,
          team: p.team,
          position: p.position,
          positions: p.fantasy_positions || [],
          injury: p.injury_status,
          years_exp: p.years_exp,
        };
      }
      await chrome.storage.local.set({ [PLAYERS_KEY]: { savedAt: Date.now(), players } });
      return players;
    }

    async function loadLeague(force = false) {
      state.error = null;
      const league = await api.get(`/v1/league/${leagueId}`);
      if (league.sport !== 'nba') {
        disabled = true;
        teardown();
        // NFL leagues get only Optimize lineup on Sleeper's own Team tab.
        if (league.sport === 'nfl' && !destroyed) nflSession = mountNfl(leagueId, lastPage);
        else console.info('[sleeper-nba-panel] not an NBA league, staying hidden');
        return;
      }
      // Tells page-hook.js to route this league's waiver and add buttons here.
      document.documentElement.dataset.snpNbaLeague = leagueId;
      const rosterKey = `roster:${leagueId}`;
      const whatIfKey = `whatif:${leagueId}`;
      const [nbaState, users, rosters, bracket, traded, drafts, players, prefs, me] = await Promise.all([
        api.get('/v1/state/nba'),
        api.get(`/v1/league/${leagueId}/users`),
        loadRosters(),
        api.get(`/v1/league/${leagueId}/winners_bracket`),
        api.get(`/v1/league/${leagueId}/traded_picks`),
        api.get(`/v1/league/${leagueId}/drafts`),
        loadPlayers(force),
        chrome.storage.local.get([rosterKey, whatIfKey]),
        loadMe(),
      ]);
      const savedRoster = rosters.find((r) => r.roster_id === prefs[rosterKey]);
      // Saved what-if values that now match the league's (it changed its scoring) drop out.
      const savedWhatIf = prefs[whatIfKey] || {};
      Object.assign(state.whatIf, {
        overrides: scoring.changedOnly(league.scoring_settings || {}, savedWhatIf.overrides || {}),
        on: Boolean(savedWhatIf.on),
        drafts: {},
      });
      const myRoster = me && rosters.find((r) => r.owner_id === me || (r.co_owners || []).includes(me));
      Object.assign(state, {
        league,
        usersById: Object.fromEntries(users.map((u) => [u.user_id, u])),
        rosters,
        players,
        me,
        rosterId: (savedRoster || myRoster || rosters[0])?.roster_id ?? null,
        minWeek: league.settings?.start_week || 1,
        maxWeek: lastWeek(league, bracket || []),
        pickContext: { traded: traded || [], seasons: pickSeasons(league, drafts || []) },
        weeks: {},
      });
      updatePicks();
      const current = Number(nbaState.display_week || nbaState.week || state.minWeek);
      state.currentWeek = Math.min(Math.max(current, state.minWeek), state.maxWeek);
      state.seasonType = nbaState.season_type;
      if (state.week == null) state.week = state.currentWeek;
      // Lineups recorded for earlier weeks are no longer needed.
      const oldWeeks = Array.from({ length: Math.max(0, state.currentWeek - state.minWeek) }, (_, i) => `lineups:${leagueId}:${state.minWeek + i}`);
      if (oldWeeks.length) chrome.storage.local.remove(oldWeeks);
      await loadWeek(state.week);
      if (state.currentWeek !== state.week) loadWeek(state.currentWeek).catch(fail);
      state.ready = true;
      sendAdminScoring();
      schedule();
      loadClaims();
      if (pendingCard) openCard(pendingCard);
      pendingCard = null;
    }

    // The logged-in owner's pending waiver claims, as Sleeper's waiver list loads them.
    async function loadClaims() {
      const roster = waivers.myRoster(state);
      if (!roster || !api.loggedIn()) return;
      try {
        const data = await api.graphql('league_transactions_filtered (pending waivers)', `query league_transactions_filtered {
  league_transactions_filtered(league_id: ${JSON.stringify(leagueId)}, roster_id_filters: [${Number(roster.roster_id)}], type_filters: ["waiver"], leg_filters: [], status_filters: ["pending"]) {
    ${TRANSACTION_FIELDS}
  }
}`, { auth: true });
        state.claims = data?.league_transactions_filtered ?? [];
      } catch (err) {
        console.warn('[sleeper-nba-panel] pending waivers unavailable', err);
        state.claims ??= [];
      }
      schedule();
    }

    // Rosters straight from Sleeper when logged in. The public REST endpoint is
    // cached at the CDN for up to ~10 minutes, so it can lag a save the user just made.
    async function loadRosters() {
      if (api.loggedIn()) {
        try {
          const data = await api.graphql('league_rosters', `query league_rosters {
  league_rosters(league_id: ${JSON.stringify(leagueId)}) {
    roster_id owner_id co_owners players starters reserve taxi settings metadata
  }
}`, { auth: true });
          if (data?.league_rosters?.length) return data.league_rosters;
        } catch (err) {
          console.warn('[sleeper-nba-panel] league_rosters unavailable, using the public endpoint', err);
        }
      }
      return api.get(`/v1/league/${leagueId}/rosters`);
    }

    // Who is logged in, if anyone. Only used to decide which roster can be edited.
    async function loadMe() {
      if (!api.loggedIn()) return null;
      try {
        const data = await api.graphql('me', 'query me { me { user_id } }', { auth: true });
        return data?.me?.user_id ?? null;
      } catch (err) {
        console.warn('[sleeper-nba-panel] could not identify the logged-in user', err);
        return null;
      }
    }

    function updatePicks() {
      const { league, rosters, rosterId, pickContext } = state;
      state.picks = model.ownedPicks({
        rosterId,
        rosterIds: rosters.map((r) => r.roster_id),
        seasons: pickContext.seasons,
        rounds: league.settings?.draft_rounds || 0,
        traded: pickContext.traded,
      });
    }

    async function loadWeek(week) {
      schedule();
      if (state.weeks[week]) return;
      const { league } = state;
      const season = league.season;
      const seasonType = league.season_type || 'regular';
      const scoresQuery = `query scores {
  scores(sport: "nba", season_type: ${JSON.stringify(seasonType)}, season: ${JSON.stringify(season)}, week: ${Number(week)}) {
    date game_id metadata season season_type sport status start_time week
  }
}`;
      const standingsQuery = `query roster_standings {
  roster_standings(league_id: ${JSON.stringify(leagueId)}, round: ${Number(week)}) { roster_id rank }
}`;
      // Only the current week's lineups matter for Lock-In.
      const historyKey = week === state.currentWeek ? `lineups:${leagueId}:${week}` : null;
      const [matchups, projections, stats, scores, research, legs, standings, stored] = await Promise.all([
        api.get(`/v1/league/${leagueId}/matchups/${week}`),
        api.get(`/projections/nba/${season}/${week}?season_type=${seasonType}`),
        api.get(`/stats/nba/${season}/${week}?season_type=${seasonType}`),
        api.graphql(`scores (week ${week})`, scoresQuery),
        api.get(`/players/nba/research/${seasonType}/${season}/${week}?league_type=${league.settings?.type ?? 0}`),
        loadLegs(week),
        api.graphql(`roster_standings (week ${week})`, standingsQuery)
          .then((data) => data?.roster_standings ?? [])
          .catch(() => []),
        historyKey ? chrome.storage.local.get(historyKey) : {},
      ]);
      if (historyKey) state.lineupHistory[week] = stored[historyKey] || {};
      const games = scores?.scores || [];
      const scoringSettings = ui.scoringOf(state);
      state.weeks[week] = {
        matchups: matchups || [],
        days: model.weekDays(games),
        gamesByTeam: model.gamesByTeam(games),
        games: games.map((g) => ({ start: g.start_time, status: g.status })),
        // Raw rows stay so what-if scoring can rescore them.
        projRows: projections || [],
        statRows: stats || [],
        proj: model.pointsByGame(projections || [], scoringSettings, scoring.scoreStats),
        actual: model.pointsByGame(stats || [], scoringSettings, scoring.scoreStats),
        research: research || {},
        legs,
        ranks: model.standingsRanks(state.rosters, standings),
      };
      seeLineups(week, legs);
      if (week === state.currentWeek) planTipReads();
      schedule();
    }

    // Remembers your own lineups as read from the week's legs. Sleeper keeps no
    // lineup history, and a game can be locked only if the player was starting
    // when it tipped off, so this is how the extension knows.
    function seeLineups(week, legs) {
      if (!legs || !state.lineupHistory[week]) return;
      const at = Date.now();
      const history = state.lineupHistory[week];
      for (const leg of legs) {
        const roster = state.rosters.find((r) => r.roster_id === leg.roster_id);
        if (!roster || !ui.owns(state, roster) || !leg.starters) continue;
        history[leg.roster_id] = model.seeLineup(history[leg.roster_id], leg.starters, at);
      }
      chrome.storage.local.set({ [`lineups:${leagueId}:${week}`]: history });
    }

    // Reads the current week's legs again (lineups can change on Sleeper's apps too).
    async function readLegs() {
      const week = state.currentWeek;
      if (!state.weeks[week] || state.saving || state.modal?.saving || Date.now() - lastLegRead < LEG_READ_GAP_MS) return;
      const legs = await loadLegs(week);
      if (!legs || !state.weeks[week]) return;
      state.weeks[week].legs = legs;
      seeLineups(week, legs);
      schedule();
    }

    // Tip-off times of your players' games still to come this week, and the
    // read after the next one. A read missed while the tab was hidden happens
    // when it comes back, if that game is still on.
    let tipTimer = null;
    let missedTip = null;
    function planTipReads() {
      clearTimeout(tipTimer);
      const week = state.weeks[state.currentWeek];
      if (!week || !api.loggedIn()) return;
      const now = Date.now();
      const mine = state.rosters.filter((r) => ui.owns(state, r)).flatMap((r) => r.players || []);
      const starts = mine.flatMap((id) => model.playerDays(week, state.players[id]?.team, id)).map((d) => d.game?.start);
      const next = model.nextTipRead(starts, now, AFTER_TIP_MS, LEG_READ_GAP_MS);
      if (!next) return;
      tipTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') readLegs().catch(() => {});
        else missedTip = next.tip;
        planTipReads();
      }, next.at - now);
    }
    function onVisible() {
      if (document.visibilityState !== 'visible' || missedTip == null) return;
      if (Date.now() < missedTip + model.FROZEN_MS) readLegs().catch(() => {});
      missedTip = null;
    }

    // Lineups, Lock-In picks (starters_games) and server projections for a week.
    // Needs the logged-in session; null when logged out or refused.
    let lastLegRead = 0;
    async function loadLegs(week) {
      if (!api.loggedIn()) return null;
      const query = `query matchup_legs {
  matchup_legs(league_id: ${JSON.stringify(leagueId)}, round: ${Number(week)}) {
    leg matchup_id roster_id round starters points proj_points max_points custom_points starters_games subs
  }
}`;
      lastLegRead = Date.now();
      try {
        const data = await api.graphql(`matchup_legs (week ${week})`, query, { auth: true });
        return data?.matchup_legs ?? null;
      } catch (err) {
        console.warn('[sleeper-nba-panel] matchup_legs unavailable', err);
        return null;
      }
    }

    // Writes the week's matchup leg, as Sleeper's apps do in season. Lock-In
    // picks travel as a JSON-encoded player -> game map; omit them to leave
    // existing locks untouched.
    async function saveLeg(label, rosterId, starters, startersGames) {
      const { week } = state;
      const variables = startersGames ? { starters_games: JSON.stringify(startersGames) } : {};
      await api.graphql(`${label} (week ${week})`, `mutation update_matchup_leg($starters_games: Map) {
  update_matchup_leg(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, leg: ${Number(week)}, round: ${Number(week)}, starters: ${JSON.stringify(starters)}, starters_games: $starters_games) {
    leg roster_id round starters starters_games
  }
}`, { auth: true, variables });
      state.weeks[week].legs = await loadLegs(week);
      seeLineups(week, state.weeks[week].legs);
    }

    // Saves a lineup the way Sleeper's web app does: during the season starters
    // live on the week's matchup leg; outside it, on the roster itself.
    async function saveStarters(starters) {
      const { league, rosterId } = state;
      const list = JSON.stringify(starters);
      if (league.status === 'in_season') {
        await saveLeg('update_matchup_leg', rosterId, starters);
      } else {
        const data = await api.graphql('roster_update_starters', `mutation roster_update_starters {
  roster_update_starters(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, starters: ${list}) {
    roster_id starters players reserve taxi
  }
}`, { auth: true });
        const roster = state.rosters.find((r) => r.roster_id === rosterId);
        Object.assign(roster, data.roster_update_starters);
      }
    }

    // Runs one save at a time and reports how it went.
    async function save(work, okText, failText) {
      state.saving = true;
      state.notice = null;
      schedule();
      try {
        await work();
        flash(okText);
      } catch (err) {
        console.error('[sleeper-nba-panel] save failed', err);
        state.notice = { kind: 'error', text: `${failText}: ${err.message || err}` };
      } finally {
        state.saving = false;
        schedule();
      }
    }

    function flash(text) {
      const notice = { kind: 'ok', text };
      state.notice = notice;
      setTimeout(() => {
        if (state.notice !== notice) return;
        state.notice = null;
        schedule();
      }, NOTICE_MS);
    }

    // Opens Sleeper's add or waiver-bid dialog for a player (from page-hook.js).
    function openClaim({ playerId, status }) {
      state.modal = { kind: 'bid', playerId, status, bid: '', drops: [], errors: [], saving: false, focus: true };
      state.notice = null;
      schedule();
    }

    // Player card: each part loads on its own and renders as it arrives.
    // `back` is a dialog the card opens over, shown again when the card closes.
    function openCard(playerId, back = null) {
      if (!state.ready) {
        // Clicked from the Players or Trend tab before the league loaded: open once it has.
        pendingCard = playerId;
        return;
      }
      state.modal = { kind: 'player', playerId, season: null, back };
      state.notice = null;
      schedule();
      if (state.cards[playerId]) return;
      const c = (state.cards[playerId] = { logs: {} });
      const player = state.players[playerId] || {};
      const current = Number(state.league.season);
      const seasonsBack = Math.min(Math.max(Number(player.years_exp) || 0, 0), CAREER_SEASONS - 1);
      const years = Array.from({ length: seasonsBack + 1 }, (_, i) => current - i);
      c.careerYears = years.length;
      const id = encodeURIComponent(playerId);
      const part = (promise, apply, fallback) => promise
        .then(apply)
        .catch((err) => {
          console.warn('[sleeper-nba-panel] player card', err);
          fallback?.();
        })
        .finally(schedule);

      part(api.get(`/players/nba/${id}`), (bio) => { c.bio = bio; });
      part(Promise.all(years.map((season) => api.get(`/stats/nba/player/${id}?season_type=regular&season=${season}`)
        .then((row) => ({ season, team: row?.team, stats: row?.stats || null }))
        .catch(() => ({ season, stats: null })))), (rows) => {
        c.career = rows;
        c.seasons = [current, ...rows.filter((r) => r.season !== current && r.stats?.gp).map((r) => r.season)].slice(0, CARD_SEASON_TABS);
      }, () => { c.career = []; c.seasons = [current]; });
      loadCardLog(playerId, current);
      part(api.graphql('get_player_news', `query get_player_news {
  get_player_news(sport: "nba", player_id: ${JSON.stringify(playerId)}, limit: 10) { metadata player_id published source source_key sport }
}`), (data) => { c.news = data?.get_player_news ?? []; }, () => { c.news = []; });
      if (player.team) {
        part(api.get(`/players/nba/${encodeURIComponent(player.team)}/depth_chart`), (chart) => { c.depth = chart || {}; }, () => { c.depth = {}; });
      }
      if (api.loggedIn()) {
        part(api.graphql('league_transactions_by_player', `query league_transactions_by_player {
  league_transactions_by_player(league_id: ${JSON.stringify(leagueId)}, player_id: ${JSON.stringify(playerId)}) {
    ${TRANSACTION_FIELDS} metadata draft_picks
  }
}`, { auth: true }), (data) => { c.history = data?.league_transactions_by_player ?? []; }, () => { c.historyError = true; });
      } else {
        c.historyError = true;
      }
    }

    // One season of a player's game log: played games plus projections.
    function loadCardLog(playerId, season) {
      const c = state.cards[playerId];
      if (!c || c.logs[season] || c.pendingLogs?.has(season)) return;
      (c.pendingLogs ||= new Set()).add(season);
      const query = `?season_type=regular&season=${Number(season)}&grouping=week`;
      const id = encodeURIComponent(playerId);
      Promise.all([api.get(`/stats/nba/player/${id}${query}`), api.get(`/projections/nba/player/${id}${query}`).catch(() => null)])
        .then(([stats, proj]) => { c.logs[season] = { stats, proj }; })
        .catch((err) => {
          console.warn('[sleeper-nba-panel] game log', err);
          c.logs[season] = { stats: {}, proj: {} };
        })
        .finally(() => {
          c.pendingLogs.delete(season);
          schedule();
        });
    }

    function openClaims() {
      state.modal = { kind: 'claims', errors: [], saving: false };
      state.notice = null;
      schedule();
      loadClaims();
    }

    function closeModal() {
      if (state.modal?.saving) return;
      state.modal = state.modal?.back ?? null;
      schedule();
    }

    // Runs a dialog's save; errors stay in the dialog, success closes it (or keeps the claims list open).
    // `stay(m, okText)`: keeps the dialog open after a save and updates it (and says what saved).
    async function modalSave(work, okText, stay) {
      const m = state.modal;
      if (!m || m.saving) return;
      m.saving = true;
      m.errors = [];
      m.done = null;
      schedule();
      try {
        await work();
        if (state.modal === m) state.modal = stay ? (stay(m, okText), m) : m.kind === 'claims' ? { ...m, saving: false } : null;
        if (!stay) flash(okText);
      } catch (err) {
        console.error('[sleeper-nba-panel] save failed', err);
        m.errors = [String(err.message || err)];
      } finally {
        m.saving = false;
        m.busy = null;
        schedule();
      }
    }

    // Submits the open dialog: a waiver claim (with a FAAB bid) or a free-agent add, plus drops.
    function submitClaim() {
      const m = state.modal;
      const roster = waivers.myRoster(state);
      if (m?.kind !== 'bid' || m.saving || !roster || !state.ready) return;
      const waiver = m.status === 'waiver';
      const error = model.claimError({ league: state.league, roster, waiver, bid: m.bid, drops: m.drops });
      if (error) {
        m.errors = [error];
        return schedule();
      }
      const rid = Number(roster.roster_id);
      const variables = { k_adds: [m.playerId], v_adds: [rid], k_drops: m.drops, v_drops: m.drops.map(() => rid) };
      const bid = waiver && state.league.settings?.waiver_type === model.FAAB;
      if (bid) Object.assign(variables, { k_settings: ['waiver_bid'], v_settings: [Number(m.bid)] });
      const name = (id) => state.players[id]?.name || `Player #${id}`;
      const dropping = m.drops.length ? ` (dropping ${m.drops.map(name).join(', ')})` : '';
      const league = JSON.stringify(leagueId);
      const lists = '$k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int]';
      const args = 'k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops';
      return modalSave(async () => {
        if (waiver) {
          await api.graphql('submit_waiver_claim', `mutation submit_waiver_claim(${lists}${bid ? ', $k_settings: [String], $v_settings: [Int]' : ''}) {
  submit_waiver_claim(league_id: ${league}, ${args}${bid ? ', k_settings: $k_settings, v_settings: $v_settings' : ''}) {
    ${TRANSACTION_FIELDS}
  }
}`, { auth: true, variables });
          await loadClaims();
        } else {
          await api.graphql('league_create_transaction', `mutation league_create_transaction(${lists}) {
  league_create_transaction(league_id: ${league}, type: "free_agent", ${args}) {
    ${TRANSACTION_FIELDS}
  }
}`, { auth: true, variables });
          state.rosters = await loadRosters();
        }
      }, waiver
        ? `${bid ? `$${Number(m.bid)} bid` : 'Claim'} placed for ${name(m.playerId)}${dropping}`
        : `Added ${name(m.playerId)}${dropping}`);
    }

    function claimById(id) {
      return state.claims?.find((c) => c.transaction_id === id);
    }

    function updateClaimBid(id, value) {
      const claim = claimById(id);
      const roster = waivers.myRoster(state);
      if (!claim || !roster) return;
      // Validate like a new bid; the claim's own add needs no extra roster room.
      const error = model.claimError({ league: state.league, roster: { ...roster, players: [] }, waiver: true, bid: value, drops: [] });
      if (error) {
        state.modal.errors = [error];
        return schedule();
      }
      const settings = { ...claim.settings, waiver_bid: Number(value) };
      const variables = { k_settings: Object.keys(settings), v_settings: Object.values(settings).map(Number) };
      const name = state.players[Object.keys(claim.adds || {})[0]]?.name || 'claim';
      return modalSave(async () => {
        await api.graphql('update_waiver_claim', `mutation update_waiver_claim($k_settings: [String], $v_settings: [Int]) {
  update_waiver_claim(league_id: ${JSON.stringify(leagueId)}, transaction_id: ${JSON.stringify(id)}, leg: ${Number(claim.leg)}, k_settings: $k_settings, v_settings: $v_settings) {
    ${TRANSACTION_FIELDS}
  }
}`, { auth: true, variables });
        await loadClaims();
      }, `Bid for ${name} is now $${Number(value)}`);
    }

    function cancelClaim(id) {
      const claim = claimById(id);
      if (!claim) return;
      state.modal.confirmCancel = null;
      const name = state.players[Object.keys(claim.adds || {})[0]]?.name || 'claim';
      return modalSave(async () => {
        await api.graphql('cancel_waiver_claim', `mutation cancel_waiver_claim {
  cancel_waiver_claim(league_id: ${JSON.stringify(leagueId)}, leg: ${Number(claim.leg)}, transaction_id: ${JSON.stringify(id)}) {
    ${TRANSACTION_FIELDS}
  }
}`, { auth: true });
        await loadClaims();
      }, `Canceled the claim for ${name}`);
    }

    async function saveTaxi(rosterId, taxi) {
      const data = await api.graphql('roster_update_taxi', `mutation roster_update_taxi {
  roster_update_taxi(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, taxi: ${JSON.stringify(taxi)}) {
    roster_id starters players reserve taxi
  }
}`, { auth: true });
      Object.assign(state.rosters.find((r) => r.roster_id === rosterId), data.roster_update_taxi);
    }

    async function saveReserve(rosterId, reserve) {
      const data = await api.graphql('roster_update_reserve', `mutation roster_update_reserve {
  roster_update_reserve(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, reserve: ${JSON.stringify(reserve)}) {
    roster_id starters players reserve taxi
  }
}`, { auth: true });
      Object.assign(state.rosters.find((r) => r.roster_id === rosterId), data.roster_update_reserve);
    }

    // Moves players between two spots. Taxi saves first, like Sleeper's web app,
    // so a starter displaced by a taxi player lands on an up-to-date roster. IR
    // goes in three steps so no save ever has a player both starting and on IR:
    // starters going to IR leave the lineup, then IR saves, then the final lineup.
    function swap(fromRef, toRef) {
      const lineup = ui.lineup(state);
      const next = model.applyMove(fromRef, toRef, lineup);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const taxiChanged = !same(next.taxi, lineup.taxi);
      const reserveChanged = !same(next.reserve, lineup.reserve);
      const toReserve = new Set(next.reserve.filter((id) => !lineup.reserve.includes(id)));
      const benched = lineup.starters.map((id) => (toReserve.has(id) ? '0' : id));
      const startersChanged = !same(next.starters, lineup.starters);
      const moved = model.describeMove(lineup, next)
        .map(({ id, to }) => `${ui.shortName(state.players[id] || { name: `Player #${id}` })} to ${to}`)
        .join(', ');
      state.swap = null;
      return save(async () => {
        if (taxiChanged) await saveTaxi(lineup.roster.roster_id, next.taxi);
        if (reserveChanged && !same(benched, lineup.starters)) await saveStarters(benched);
        if (reserveChanged) await saveReserve(lineup.roster.roster_id, next.reserve);
        if (startersChanged && !(reserveChanged && same(benched, next.starters))) await saveStarters(next.starters);
      }, `Saved: ${moved}`, `Couldn't move ${moved}`);
    }

    // Locks a starter's most recent finished game. Final, so it's confirmed first.
    // `ref` is '<roster id>:<player id>', since either side of a matchup can be yours.
    function lockIn(ref) {
      const [rosterId, playerId] = [Number(ref.split(':')[0]), ref.split(':')[1]];
      const lineup = ui.lineup(state, rosterId);
      const player = state.players[playerId];
      state.lockConfirm = null;
      if (!lineup?.lockable || !lineup.starters.includes(playerId)) return;
      const days = model.playerDays(lineup.week, player?.team, playerId);
      const st = model.lockState(days, lineup.locks[playerId], Date.now(), lineup.started ? (game) => lineup.started(playerId, game) : null);
      // A game whose start the extension didn't see can still be locked; the cell said so.
      if (!st.lockable && !st.unsure) {
        state.notice = { kind: 'error', text: st.benched ? 'That game was played on your bench, so it can\'t be locked' : 'That game can no longer be locked' };
        return schedule();
      }
      const locks = { ...lineup.locks, [playerId]: st.current.game.id };
      const name = player?.name || `Player #${playerId}`;
      return save(
        () => saveLeg('lock_in', rosterId, lineup.starters, locks),
        `Locked ${name}: ${(st.current.actual ?? 0).toFixed(2)}`,
        `Couldn't lock ${name}`,
      );
    }

    // Proposes the best lineup for the shown week; nothing saves until it's applied.
    function openOptimize() {
      const lineup = ui.lineup(state);
      if (state.saving || !lineup?.editable || !lineup.week || ui.whatIfOn(state)) return;
      state.swap = null;
      state.lockConfirm = null;
      state.notice = null;
      state.modal = { kind: 'optimize', plan: model.bestLineup(lineup, Date.now()), noLock: [], ack: false, errors: [], saving: false, busy: null, done: null };
      schedule();
    }

    // Keeping a lock open, or taking it back, plans the lineup again around it.
    function toggleLock(playerId, on) {
      const m = state.modal;
      const lineup = ui.lineup(state);
      if (m?.kind !== 'optimize' || m.saving || !lineup) return;
      m.noLock = on ? m.noLock.filter((id) => id !== playerId) : [...new Set([...m.noLock, playerId])];
      m.plan = model.bestLineup(lineup, Date.now(), { noLock: m.noLock });
      m.ack = false;
      schedule();
    }

    // The optimize dialog's plan, worked out again right before a save. Games
    // can tip off while the dialog is open; if the plan changed, the dialog
    // shows the new one instead of saving something unseen. Null when it can't save.
    function freshPlan() {
      const m = state.modal;
      const lineup = ui.lineup(state);
      if (m?.kind !== 'optimize' || m.saving || !lineup?.editable) return null;
      // The plan was made with the league's scoring; what-if numbers would change it.
      if (ui.whatIfOn(state)) {
        m.errors = ['Switch what-if scoring off to apply. Optimize picks the lineup with your league\'s scoring.'];
        schedule();
        return null;
      }
      const plan = model.bestLineup(lineup, Date.now(), { noLock: m.noLock });
      if (JSON.stringify(plan.starters) !== JSON.stringify(m.plan.starters) ||
        JSON.stringify(plan.current) !== JSON.stringify(m.plan.current) ||
        JSON.stringify(plan.changes) !== JSON.stringify(m.plan.changes) ||
        JSON.stringify(plan.locks) !== JSON.stringify(m.plan.locks)) {
        m.plan = plan;
        m.ack = false;
        m.errors = ['Games have tipped off since this opened. Review the updated changes.'];
        schedule();
        return null;
      }
      return { m, lineup, plan };
    }

    // After one row saves, the dialog stays open on the plan from the new lineup.
    function replan(m, okText) {
      m.plan = model.bestLineup(ui.lineup(state), Date.now(), { noLock: m.noLock });
      m.ack = false;
      m.done = okText;
    }

    const shortOf = (id) => ui.shortName(state.players[id] || { name: `Player #${id}` });
    // Names a few moves; past that, just the count, so the notice stays one line.
    const movedText = (changes) => (changes.length > 3 ? `${changes.length} lineup changes` : changes
      .map(({ id, to }) => `${shortOf(id)} to ${to === 'BN' ? 'bench' : to}`)
      .join(', '));

    // Saves the proposed lineup and locks in one write (locks are final).
    function applyOptimize() {
      const fresh = freshPlan();
      if (!fresh) return;
      const { m, lineup, plan } = fresh;
      // Giving up a score that beat its projection takes the tick box.
      if (plan.changes.some((c) => c.goodScore) && !m.ack) return;
      const moved = movedText(plan.changes);
      const locks = lineup.lockable ? plan.locks.filter((k) => k.on) : [];
      m.busy = 'all';
      if (!locks.length) return plan.changes.length ? modalSave(() => saveStarters(plan.starters), `Saved: ${moved}`) : undefined;
      const lockedText = `Locked ${locks.map((k) => `${shortOf(k.id)} ${k.actual.toFixed(2)}`).join(', ')}`;
      const startersGames = { ...lineup.locks, ...Object.fromEntries(locks.map((k) => [k.id, k.game.game.id])) };
      return modalSave(() => saveLeg('lock_in', lineup.roster.roster_id, plan.starters, startersGames),
        plan.changes.length ? `${lockedText} · Saved: ${moved}` : lockedText);
    }

    // Applies one slot's change (and any slot tied to it); the dialog stays open.
    function applyOptimizeRow(i) {
      const fresh = freshPlan();
      if (!fresh) return;
      const { m, plan } = fresh;
      const { starters, slots } = model.applySlot(plan.current, plan.starters, i);
      if (!slots.length) return;
      if (plan.changes.some((c) => c.goodScore && !starters.includes(c.id)) && !m.ack) return;
      const ids = new Set(slots.flatMap((k) => [plan.current[k], plan.starters[k]]));
      const changes = plan.changes.filter((c) => ids.has(c.id));
      m.busy = `row:${i}`;
      return modalSave(() => saveStarters(starters), `Saved: ${movedText(changes)}`, replan);
    }

    // Locks one recommended game now, on the lineup as it stands; the dialog stays open.
    function lockOptimizeRow(id) {
      const fresh = freshPlan();
      if (!fresh) return;
      const { m, lineup, plan } = fresh;
      const k = plan.locks.find((x) => x.id === id && x.on);
      if (!k || !lineup.lockable) return;
      m.busy = `lock:${id}`;
      return modalSave(() => saveLeg('lock_in', lineup.roster.roster_id, lineup.starters, { ...lineup.locks, [id]: k.game.game.id }),
        `Locked ${shortOf(id)} ${k.actual.toFixed(2)}`, replan);
    }

    function pickSpot(ref) {
      if (state.saving) return;
      const lineup = ui.lineup(state);
      if (!lineup.editable) return;
      if (state.swap && state.swap !== ref && model.swapTargets(state.swap, lineup).includes(ref)) {
        swap(state.swap, ref);
        return;
      }
      state.swap = state.swap === ref ? null : ref;
      state.notice = null;
      schedule();
    }

    function setWeek(week) {
      state.week = week;
      state.swap = null;
      state.lockConfirm = null;
      state.notice = null;
      loadWeek(week).catch(fail);
    }

    root.addEventListener('click', (e) => {
      // A League tab matchup opens on the Matchup tab, through Sleeper's own tab (so its router follows).
      const match = e.target.closest('[data-open-matchup]');
      if (match) {
        state.rosterId = Number(match.dataset.openMatchup);
        state.tab = 'page';
        const tabs = [...document.querySelectorAll('.center-tab-selector .item-tab')];
        tabs.find((t) => /^matchup$/i.test(t.textContent.trim()))?.click();
        return schedule();
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) {
        state.tab = tab.dataset.tab;
        return schedule();
      }
      const spot = e.target.closest('[data-spot]');
      if (spot) return pickSpot(spot.dataset.spot);
      const player = e.target.closest('[data-player]');
      if (player) return openCard(player.dataset.player);
      const lock = e.target.closest('[data-lock]');
      if (lock && !state.saving) {
        state.lockConfirm = lock.dataset.lock;
        state.notice = null;
        return schedule();
      }
      const confirm = e.target.closest('[data-lock-confirm]');
      if (confirm && !state.saving) return lockIn(confirm.dataset.lockConfirm);
      if (e.target.closest('[data-lock-cancel]')) {
        state.lockConfirm = null;
        return schedule();
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'prev' && state.week > state.minWeek) setWeek(state.week - 1);
      if (action === 'next' && state.week < state.maxWeek) setWeek(state.week + 1);
      if (action === 'refresh') loadLeague(true).catch(fail);
      if (action === 'claims') openClaims();
      if (action === 'optimize') openOptimize();
      if (action === 'whatif-off') setWhatIf({ on: false });
    });
    root.addEventListener('change', (e) => {
      if (e.target.dataset.action !== 'roster') return;
      state.rosterId = Number(e.target.value);
      state.swap = null;
      state.lockConfirm = null;
      state.notice = null;
      chrome.storage.local.set({ [`roster:${leagueId}`]: state.rosterId });
      updatePicks();
      schedule();
    });
    // <details> toggle doesn't bubble, so listen in the capture phase.
    root.addEventListener('toggle', (e) => {
      const id = Number(e.target.dataset?.call);
      // Rendering a <details open> fires toggle too; only re-render on a real change.
      if (!id || e.target.open === state.openCalls.has(id)) return;
      if (e.target.open) state.openCalls.add(id);
      else state.openCalls.delete(id);
      schedule();
    }, true);
    // Hide headshots the CDN doesn't have. Image errors don't bubble either.
    root.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.classList.add('missing');
    }, true);

    layerRoot.addEventListener('click', (e) => {
      const drop = e.target.closest('[data-drop]');
      if (drop && state.modal?.kind === 'bid' && !state.modal.saving) {
        const id = drop.dataset.drop;
        const drops = state.modal.drops;
        state.modal.drops = drops.includes(id) ? drops.filter((d) => d !== id) : [...drops, id];
        state.modal.errors = [];
        return schedule();
      }
      const save = e.target.closest('[data-claim-save]');
      if (save) {
        const id = save.dataset.claimSave;
        const input = layerRoot.querySelector(`[data-claim-bid="${CSS.escape(id)}"]`);
        return updateClaimBid(id, input?.value ?? '');
      }
      // Canceling a claim asks first; only "Yes, cancel" removes it.
      const cancel = e.target.closest('[data-claim-cancel]');
      if (cancel && state.modal?.kind === 'claims' && !state.modal.saving) {
        state.modal.confirmCancel = cancel.dataset.claimCancel;
        state.modal.errors = [];
        return schedule();
      }
      if (e.target.closest('[data-claim-cancel-keep]') && state.modal) {
        state.modal.confirmCancel = null;
        return schedule();
      }
      const confirmed = e.target.closest('[data-claim-cancel-confirm]');
      if (confirmed) return cancelClaim(confirmed.dataset.claimCancelConfirm);
      const player = e.target.closest('[data-player]');
      if (player && state.modal?.kind === 'optimize' && !state.modal.saving) return openCard(player.dataset.player, state.modal);
      const season = e.target.closest('[data-card-season]');
      if (season && state.modal?.kind === 'player') {
        const c = state.cards[state.modal.playerId];
        const shown = state.modal.season ?? c?.seasons?.[0] ?? Number(state.league.season);
        // Keep showing the season on screen until the new one loads.
        if (c?.logs[shown]) state.modal.prevSeason = shown;
        state.modal.season = Number(season.dataset.cardSeason);
        loadCardLog(state.modal.playerId, state.modal.season);
        return schedule();
      }
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'close-modal') closeModal();
      if (action === 'submit-claim') submitClaim();
      if (action === 'apply-lineup') applyOptimize();
      const row = e.target.closest('[data-op-row]');
      if (row) return applyOptimizeRow(Number(row.dataset.opRow));
      const lockRow = e.target.closest('[data-op-lock-row]');
      if (lockRow) return lockOptimizeRow(lockRow.dataset.opLockRow);
      const keep = e.target.closest('[data-op-keep], [data-op-relock]');
      if (keep) return toggleLock(keep.dataset.opKeep ?? keep.dataset.opRelock, keep.dataset.opRelock != null);
      if (action === 'whatif-off') setWhatIf({ on: false });
    });
    layerRoot.addEventListener('change', (e) => {
      if (!e.target.matches('[data-op-ack]') || state.modal?.kind !== 'optimize') return;
      state.modal.ack = e.target.checked;
      schedule();
    });
    layerRoot.addEventListener('input', (e) => {
      // Kept without a re-render so typing never loses focus.
      if (e.target.matches('[data-bid]') && state.modal) state.modal.bid = e.target.value;
    });
    layerRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-bid]')) submitClaim();
    });
    layerRoot.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.classList.add('missing');
    }, true);

    cornerRoot.addEventListener('click', (e) => {
      const w = state.whatIf;
      const reset = e.target.closest('[data-wi-reset]');
      if (reset) {
        const { [reset.dataset.wiReset]: _, ...overrides } = w.overrides;
        delete w.drafts[reset.dataset.wiReset];
        return setWhatIf({ overrides });
      }
      const action = e.target.closest('[data-wi]')?.dataset.wi;
      if (action === 'toggle-open') w.open = !w.open;
      if (action === 'close') w.open = false;
      if (action === 'show-all') w.showAll = !w.showAll;
      if (action === 'league') return setWhatIf({ on: false });
      if (action === 'whatif') return setWhatIf({ on: true });
      if (action === 'reset') return setWhatIf({ overrides: {}, drafts: {}, on: false });
      schedule();
    });
    // Values apply as they're typed, and switch the page to what-if scoring.
    cornerRoot.addEventListener('input', (e) => {
      const key = e.target.dataset.wiKey;
      if (!key) return;
      const w = state.whatIf;
      w.drafts[key] = e.target.value;
      // A stat the league doesn't score stays listed while it's edited, even once it's back to 0.
      if (!state.league.scoring_settings?.[key]) w.showAll = true;
      const value = whatif.parse(e.target.value);
      if (value == null) return schedule();
      setWhatIf({ overrides: { ...w.overrides, [key]: value }, on: true });
    });
    // Leaving a field (or Enter) settles it: the value as a number, or back to what it was.
    function settle(input) {
      const key = input.dataset.wiKey;
      if (!key || !(key in state.whatIf.drafts)) return;
      delete state.whatIf.drafts[key];
      schedule();
    }
    cornerRoot.addEventListener('change', (e) => settle(e.target));
    cornerRoot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.dataset.wiKey) settle(e.target);
    });
    // Like a tooltip, the editor closes on a click anywhere else.
    function onOutsideClick(e) {
      if (!state.whatIf.open || e.composedPath().includes(corner)) return;
      state.whatIf.open = false;
      schedule();
    }
    document.addEventListener('click', onOutsideClick, true);
    function onPlayerAction(e) {
      try {
        openClaim(JSON.parse(e.detail));
      } catch (err) {
        console.error('[sleeper-nba-panel] bad player action', err);
      }
    }
    function onPlayerCard(e) {
      try {
        openCard(JSON.parse(e.detail).playerId);
      } catch (err) {
        console.error('[sleeper-nba-panel] bad player card event', err);
      }
    }
    document.addEventListener('snp:player-action', onPlayerAction);
    document.addEventListener('snp:player-card', onPlayerCard);

    function onKey(e) {
      if (e.key === 'Escape' && state.whatIf.open) {
        state.whatIf.open = false;
        return schedule();
      }
      if (e.key === 'Escape' && state.modal) return closeModal();
      if (e.key === 'Escape' && (state.swap || state.lockConfirm)) {
        state.swap = null;
        state.lockConfirm = null;
        schedule();
      }
    }
    document.addEventListener('keydown', onKey);
    // Lock windows and game states move with the clock.
    const clock = setInterval(schedule, CLOCK_MS);
    document.addEventListener('visibilitychange', onVisible);

    // Same league, other tab (Team <-> Matchup): keep the data, swap the view.
    function show(next) {
      if (next !== lastPage) schedule(); // the Scoring control follows the tab
      lastPage = next;
      nflSession?.show(next);
      const onPanel = PANEL_PAGES.has(next);
      if (onPanel === state.onPanel && (!onPanel || next === state.page)) return;
      state.onPanel = onPanel;
      if (onPanel) state.page = next;
      state.swap = null;
      state.lockConfirm = null;
      state.notice = null;
      schedule();
    }

    function teardown() {
      clearInterval(clock);
      clearTimeout(tipTimer);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onOutsideClick, true);
      document.removeEventListener('snp:admin-score-request', adminDeltas);
      document.removeEventListener('snp:week-games-request', pickWeekGames);
      document.removeEventListener('snp:week-schedule-request', weekSchedule);
      document.removeEventListener('snp:player-action', onPlayerAction);
      document.removeEventListener('snp:player-card', onPlayerCard);
      if (document.documentElement.dataset.snpNbaLeague === leagueId) delete document.documentElement.dataset.snpNbaLeague;
      cancelAnimationFrame(frame);
      host.remove();
      layer.remove();
      corner.remove();
      restorePlaceholder();
    }

    function destroy() {
      destroyed = true;
      nflSession?.destroy();
      teardown();
    }

    loadLeague().catch(fail);
    // The admin switch flipped: show or hide what-if scoring, and rescore either way.
    function setAdminTools(on) {
      state.whatIf.enabled = on;
      if (!on) state.whatIf.open = false;
      rescore();
      if (state.ready) sendAdminScoring();
      schedule();
    }

    return { leagueId, attach, show, destroy, setAdmin: setAdminTools };
  }

  // NFL leagues: Sleeper's web app runs the Team tab itself. This adds an
  // OPTIMIZE button beside its WAIVER and TRADE buttons, a confirm dialog, and
  // saves through Sleeper's own actions (page-hook.js reads and writes the lineup).
  function mountNfl(leagueId, page) {
    const BUTTON_ID = 'snp-optimize';
    const layer = document.createElement('div');
    layer.id = 'sleeper-nfl-dialog';
    const shadow = layer.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style></style><div class="root"></div>';
    const root = shadow.querySelector('.root');
    const state = { page, modal: null, notice: null };
    let destroyed = false;
    let styled = false;
    stylesheet.then((css) => {
      shadow.querySelector('style').textContent = css;
      styled = true;
      render();
    });

    // The Team tab's lineup from page-hook.js, which answers before dispatchEvent returns.
    function lineup(full) {
      let data = null;
      const take = (e) => {
        data = JSON.parse(e.detail);
      };
      document.addEventListener('snp:nfl-lineup', take);
      document.dispatchEvent(new CustomEvent('snp:nfl-lineup-request', { detail: JSON.stringify({ leagueId, full }) }));
      document.removeEventListener('snp:nfl-lineup', take);
      return data;
    }

    // Sleeper's projections, scored with the league's settings exactly as its Team tab shows them.
    function plan(l) {
      const proj = Object.fromEntries(Object.entries(l.projections).map(([id, p]) => [id, scoring.scoreStats(l.scoring || {}, p.stats)]));
      return model.bestNflLineup({ ...l, proj });
    }

    function render() {
      if (destroyed || !styled) return;
      if (!state.modal && !state.notice) return layer.remove();
      if (!layer.isConnected) document.documentElement.appendChild(layer);
      root.innerHTML = `<div class="page-layer">${nfl.render(state)}${ui.notice(state)}</div>`;
    }

    function flash(text) {
      const shown = { kind: 'ok', text };
      state.notice = shown;
      setTimeout(() => {
        if (state.notice !== shown) return;
        state.notice = null;
        render();
      }, NOTICE_MS);
    }

    function open() {
      const l = lineup(true);
      if (!l?.editable) return;
      state.modal = { lineup: l, plan: plan(l), errors: [], saving: false };
      state.notice = null;
      render();
    }

    function close() {
      if (state.modal?.saving) return;
      state.modal = null;
      render();
    }

    // Works the plan out again first: if a game kicked off while the dialog
    // was open, it shows the new plan instead of saving one you haven't seen.
    function apply() {
      const m = state.modal;
      if (!m || m.saving) return;
      const l = lineup(true);
      const fresh = l?.editable ? plan(l) : null;
      if (!fresh) {
        m.errors = ['The Team tab changed; open Optimize again.'];
        return render();
      }
      if (JSON.stringify(fresh.starters) !== JSON.stringify(m.plan.starters) ||
        JSON.stringify(fresh.changes) !== JSON.stringify(m.plan.changes)) {
        Object.assign(m, { lineup: l, plan: fresh, errors: ['Games have kicked off since this opened. Review the updated changes.'] });
        return render();
      }
      const name = (id) => l.players[id]?.name || `Player #${id}`;
      const moved = fresh.changes.length > 3 ? `${fresh.changes.length} lineup changes`
        : fresh.changes.map(({ id, to }) => `${name(id)} to ${to === 'BN' ? 'bench' : to}`).join(', ');
      m.saving = true;
      m.errors = [];
      render();
      const done = (e) => {
        document.removeEventListener('snp:nfl-lineup-saved', done);
        if (destroyed) return;
        const result = JSON.parse(e.detail);
        if (result.ok) {
          state.modal = null;
          flash(`Saved: ${moved}`);
        } else {
          m.saving = false;
          m.errors = [result.error];
        }
        render();
      };
      document.addEventListener('snp:nfl-lineup-saved', done);
      document.dispatchEvent(new CustomEvent('snp:nfl-lineup-save', {
        detail: JSON.stringify({ leagueId, rosterId: l.rosterId, round: l.round, starters: fresh.starters }),
      }));
    }

    // Sleeper re-renders its header now and then, so this runs on every page change.
    function attach() {
      if (destroyed) return;
      const actions = state.page === 'team' ? document.querySelector('.user-tab-menu .actions') : null;
      const button = document.getElementById(BUTTON_ID);
      if (!actions || !lineup(false)?.editable) return button?.remove();
      if (button && actions.firstElementChild === button) return;
      const el = button || Object.assign(document.createElement('div'), {
        id: BUTTON_ID,
        className: 'btn-container space',
        innerHTML: nfl.BUTTON,
        title: 'Propose the best starting lineup for this week',
        tabIndex: 0,
      });
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Optimize lineup');
      actions.prepend(el);
    }

    function show(next) {
      state.page = next;
      if (next !== 'team') close();
      attach();
    }

    function onClick(e) {
      if (e.target instanceof Element && e.target.closest(`#${BUTTON_ID}`)) open();
    }
    function onKey(e) {
      if (e.key === 'Escape' && state.modal) return close();
      if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.id === BUTTON_ID) {
        e.preventDefault();
        open();
      }
    }
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'close-modal') close();
      if (action === 'apply-lineup') apply();
    });
    root.addEventListener('error', (e) => {
      if (e.target.tagName === 'IMG') e.target.classList.add('missing');
    }, true);

    function destroy() {
      destroyed = true;
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.getElementById(BUTTON_ID)?.remove();
      layer.remove();
    }

    attach();
    return { attach, show, destroy };
  }

  // The season ends when the league's playoff bracket does. Round count comes
  // from the bracket itself; playoff_round_type sets weeks per round
  // (0: one week each, 1: two-week final, 2: two weeks each).
  function lastWeek(league, bracket) {
    const { playoff_week_start: start, playoff_round_type: roundType } = league.settings || {};
    const rounds = Math.max(0, ...bracket.map((m) => m.r));
    // Without a bracket there's nothing to bound by, so don't invent a limit.
    if (!start || !rounds) return Infinity;
    const weeks = roundType === 2 ? rounds * 2 : roundType === 1 ? rounds + 1 : rounds;
    return start + weeks - 1;
  }

  // Future picks start this season if its draft hasn't happened yet, else next season.
  function pickSeasons(league, drafts) {
    const season = Number(league.season);
    const done = drafts.some((d) => d.season === league.season && d.status === 'complete');
    const first = done ? season + 1 : season;
    return Array.from({ length: PICK_SEASONS }, (_, i) => String(first + i));
  }

  // Runs at document_start: watching the DOM hides Sleeper's placeholder in the
  // same task React inserts it, before it can paint. Polling is a safety net for
  // route changes that only touch text or attributes.
  new MutationObserver(sync).observe(document, { childList: true, subtree: true });
  addEventListener('popstate', sync);
  setInterval(sync, 500);
  sync();
})();
