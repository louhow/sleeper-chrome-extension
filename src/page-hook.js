// Runs in the page's own world. For NBA leagues, Sleeper's web app renders the
// waiver (W) and ADD buttons but answers clicks with "not yet available", and
// opens its own NBA player card from the Players and Trend tabs. This takes
// over those clicks once the extension has confirmed the league is NBA. The
// player id (and Sleeper's own waiver status) come from React props, which
// only this world can read, and go to the extension as JSON in a DOM event.
// It also keeps the Matchup tab when switching to an NBA league from the sidebar,
// opens the Players tab on this week's projections, adds games played and
// shot-volume columns (and the admin adminFPTS and adminDelta) to it, and for NFL leagues reads (and
// saves) the Team tab's lineup for Optimize lineup.
(() => {
  const ACTION = '.player-action-button.waiver, .player-action-button.add';
  // Player name and headshot on the Players tab, and a row on the Trend tab.
  const PLAYER = '.player-meta-container, .trending-list-item .player-details';
  // A league in the left sidebar.
  const NAV_LEAGUE = 'a.nav-league-item-wrapper';
  const MAX_DEPTH = 12;

  // The nearest fiber (walking up from the element) whose props pass `match`.
  function fiber(el, match) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    for (let f = key && el[key], i = 0; f && i < MAX_DEPTH; f = f.return, i++) {
      if (f.memoizedProps && match(f.memoizedProps)) return f;
    }
    return null;
  }

  const props = (el, match) => fiber(el, match)?.memoizedProps ?? null;

  // The page's half of its messages with the extension: the same code as
  // src/bridge.js, where the protocol is written down (and why it's a copy).
  const bridge = (() => {
    // bridge.js copy: start
    function tell(name, detail) {
      document.dispatchEvent(new CustomEvent(name, { detail: detail === undefined ? null : JSON.stringify(detail) }));
    }

    function on(name, fn) {
      const listener = (e) => {
        let detail;
        try {
          detail = e.detail == null ? null : JSON.parse(e.detail);
        } catch (err) {
          console.error(`[snp] bad ${name} message`, err);
          return;
        }
        fn(detail);
      };
      document.addEventListener(name, listener);
      return () => document.removeEventListener(name, listener);
    }

    function ask(name, detail) {
      let reply = null;
      const off = on(name, (x) => {
        reply = x;
      });
      tell(`${name}-request`, detail);
      off();
      return reply;
    }

    const answer = (name, fn) => on(`${name}-request`, (detail) => tell(name, fn(detail)));

    let nextId = 1;
    function call(name, detail) {
      const id = nextId++;
      return new Promise((resolve) => {
        const off = on(name, (reply) => {
          if (reply?.id !== id) return;
          off();
          resolve(reply);
        });
        tell(`${name}-request`, { ...detail, id });
      });
    }

    const answerLater = (name, fn) => on(`${name}-request`, async (detail) => tell(name, { ...(await fn(detail)), id: detail?.id ?? null }));

    return { ask, answer, call, answerLater, tell, on };
    // bridge.js copy: end
  })();

  // The page's storage, which can be switched off: reads give null and writes
  // do nothing then (leagues open where Sleeper sends them, views aren't remembered).
  const safeStore = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage off.
      }
    },
  };

  addEventListener('click', (e) => {
    const league = document.documentElement.dataset.snpNbaLeague;
    if (!league || !location.pathname.startsWith(`/leagues/${league}/`) || !(e.target instanceof Element)) return;
    const action = e.target.closest(ACTION);
    const card = !action && e.target.closest(PLAYER);
    const p = action ? props(action, (x) => x.playerId)
      : card ? props(card, (x) => x.playerId || x.player?.player_id)
      : null;
    if (!p) return;
    // Window capture runs before React's listener on the document, so Sleeper never sees the click.
    e.preventDefault();
    e.stopImmediatePropagation();
    if (action) {
      const status = p.waiverStatus?.status || (action.classList.contains('waiver') ? 'waiver' : 'free_agent');
      bridge.tell('snp:player-action', { playerId: String(p.playerId), status });
    } else {
      bridge.tell('snp:player-card', { playerId: String(p.playerId || p.player.player_id) });
    }
  }, true);

  // Sleeper's sidebar sends every league to /leagues/<id>, which lands on its
  // League tab. Instead each league (any sport) opens on the tab you were last
  // on in it, remembered in the page's storage; one you haven't been on yet
  // opens on its Matchup tab when you come from a Matchup tab and it's NBA.
  // Through Sleeper's own router, so its state stays in step.
  const LEAGUE_PAGE = /^\/leagues\/(\d+)\/([a-z]+)(?:\/|$)/;
  const pageKey = (id) => `snp:league-page:${id}`;
  let seenPath = '';
  function rememberPage() {
    if (location.pathname === seenPath) return;
    seenPath = location.pathname;
    const [, id, page] = seenPath.match(LEAGUE_PAGE) ?? [];
    if (id) safeStore.set(pageKey(id), page);
  }
  addEventListener('click', (e) => {
    if (!(e.target instanceof Element)) return;
    const link = e.target.closest(NAV_LEAGUE);
    const item = link && props(link, (x) => x.league && x.selectLeague);
    const nav = item && props(link, (x) => x.router?.push);
    if (!item || !nav) return;
    const id = item.league.league_id;
    let page = safeStore.get(pageKey(id));
    if (!page && item.league.sport === 'nba' && /^\/leagues\/\d+\/matchup(\/|$)/.test(location.pathname)) page = 'matchup';
    if (!page || location.pathname.startsWith(`/leagues/${id}/${page}`)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    item.selectLeague(id);
    item.closeNavbar?.();
    nav.router.push(`/leagues/${id}/${page}`);
  }, true);

  // The sidebar's leagues, each link marked with its league id and sport
  // (data-snp-league, data-snp-sport), which only this world can read: the
  // extension adds NBA leagues' matchup lines there (nba/nav.js).
  bridge.answer('snp:nav-leagues', () => [...document.querySelectorAll(NAV_LEAGUE)].flatMap((link) => {
    const league = props(link, (x) => x.league && x.selectLeague)?.league;
    if (!league) return [];
    if (link.dataset.snpLeague !== league.league_id) link.dataset.snpLeague = league.league_id;
    if (link.dataset.snpSport !== league.sport) link.dataset.snpSport = league.sport;
    return [{ leagueId: league.league_id, sport: league.sport }];
  }));

  // NBA Players tab. It opens on Projection for the current week (Sleeper's
  // own default can be the season, and its week dropdown reads "2026" on load).
  // In Stats: shot-volume columns (FGM and FGA after PTS, 3PA after 3PM, FTM
  // and FTA at the end), which Sleeper's stats already carry but don't score,
  // so they show dimmed; and with a week picked, an Avg / Best / Worst switch
  // in the table's corner. Avg is Sleeper's week (per game) plus a GP column;
  // Best and Worst swap in each player's best or worst game, in whole numbers.
  // With admin tools on, adminFPTS and adminDelta columns beside Sleeper's FPTS.
  // adminFPTS is scored with the what-if values from the extension's Scoring
  // control; adminDelta is how many places that moves a player in the list on
  // screen. Both go into Sleeper's own table component (its stat keys and
  // per-player stats map), so Sleeper renders them and its headers sort them.
  // Sleeper prints a stat key as its header; the space lets each wrap onto two lines.
  const ADMIN_KEY = 'admin FPTS';
  const DELTA_KEY = 'admin Delta';
  // Sleeper sorts a missing or 0 value as -1, so shifts are stored offset to stay positive.
  const DELTA_OFFSET = 10000;
  const PLAYERS_PANEL = '.integration-players-panel';
  // Shot volume, which doesn't score: at the end of the table in Stats, behind
  // the "Shooting" checkbox in Sleeper's filter row (off by default).
  const VOLUME = ['fgm', 'fga', 'tpa', 'ftm', 'fta'];
  // A week's days, a mark each (played, on now, still to play), sorting by games left.
  const WEEK_KEY = 'Week';
  // Its column: seven 5px marks and 2px gaps, and a little air.
  const WEEK_W = 52;
  // Narrowed columns give the name area this much of the header's corner.
  const NAME_EXTRA = 12;
  // The Shooting +/- at the end of the header.
  const TOGGLE_W = 26;
  // Games played in the week (Sleeper's week stats are per game, with no count).
  const GP_KEY = 'GP';
  // Marks a picked game in the stats map, so its cells print as whole numbers.
  const GAME = 'snpGame';
  const PICKS = [['avg', 'Avg', 'Average per game this week'], ['best', 'Best', 'Best game this week'], ['worst', 'Worst', 'Worst game this week']];
  // NFL: the last five weeks played, through the week picked, a mark each in
  // its score's color; it sorts by points per game over them.
  const RECENT_KEY = 'Last 5';
  let weekPick = 'avg';
  let shooting = false;
  // The league whose Players tab the extension has data for ('snp:players-ready', NBA or NFL).
  let readyLeague = null;
  // { leagueId, enabled, changed } from the extension (NBA); it does the scoring itself.
  // Not enabled (no ?snp-admin=1), the columns stay out.
  let admin = null;
  let adminVersion = 0;
  let tints = {};
  let places = {}; // player id -> [FPTS place, adminFPTS place] in the list on screen

  bridge.on('snp:players-ready', ({ leagueId }) => {
    readyLeague = leagueId;
    patchPlayers();
  });
  bridge.on('snp:admin-scoring', (x) => {
    admin = x;
    adminVersion++;
    patchPlayers();
  });
  // A week the extension was loading is in.
  bridge.on('snp:week-games-ready', () => patchPlayers());

  // Asks the extension (see bridge), keeping a reply that `isDone` for `ttl`;
  // until one is, the last kept reply stands in. Null while the data loads.
  const asked = {};
  function cachedAsk(name, detail, isDone, ttl) {
    const key = `${name}|${JSON.stringify(detail)}`;
    const hit = asked[key];
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = bridge.ask(name, detail);
    if (value && isDone(value)) asked[key] = { at: Date.now(), value };
    return value ?? hit?.value ?? null;
  }

  // Per player, the points the changed settings add, and for the players in
  // view, their rank shift, its color and both places.
  const adminScores = (stats, view, base) => bridge.ask('snp:admin-scores', { stats, view, base }) || { points: {}, shifts: {}, tints: {}, places: {} };
  // Each player's best or worst game of a week, or games played; kept for the page.
  const weekGames = (season, week, mode) => cachedAsk('snp:week-games', { season, week, mode }, () => true, Infinity);
  // A week's schedule, kept for a minute as games finish while the page is
  // open, and not until the points are in, so they show as soon as they load.
  const weekSchedule = (season, week) => cachedAsk('snp:week-schedule', { season, week }, (x) => x.pointsReady, 60e3);
  // NFL: each player's scores over the last five weeks played. Kept for a
  // minute while a week is on (the extension keeps finished weeks), and not until it's all in.
  const recentWeeks = (season, week) => cachedAsk('snp:recent-weeks', { season, week }, (x) => x.ready, 60e3);

  // What you last had on (Projection or Stats, the season and week, Avg / Best
  // / Worst, Shooting), per league, in the page's storage. A week that was the
  // current one comes back as the current one, so a new week opens on it.
  const viewKey = (leagueId) => `snp:players-view:${leagueId}`;
  function savedView(leagueId) {
    try {
      return JSON.parse(safeStore.get(viewKey(leagueId))) || null;
    } catch {
      return null;
    }
  }
  function saveView(panel) {
    const { leagueId, leg } = panel.props;
    const { statType, statInterval, season } = panel.state;
    // Until the view being restored is on, what shows is Sleeper's default, not yours.
    const want = panel.snpWant;
    if (want && Date.now() < want.until && !(statType === want.statType && String(statInterval) === String(want.statInterval))) return;
    panel.snpWant = null;
    const view = { statType, season, interval: statInterval, current: leg > 0 && String(statInterval) === String(leg), pick: weekPick, shooting, team: pickedTeam(panel) };
    const text = JSON.stringify(view);
    if (panel.snpSaved === text) return;
    panel.snpSaved = text;
    safeStore.set(viewKey(leagueId), text);
  }

  // Sleeper's table, on a league the extension has loaded (NBA or NFL).
  function playersPanel() {
    const league = document.documentElement.dataset.snpPlayersLeague;
    const el = document.querySelector(PLAYERS_PANEL);
    const panel = el && fiber(el, (x) => x.scoringSettings && (x.sport === 'nba' || x.sport === 'nfl') && 'leagueId' in x)?.stateNode;
    const ours = Boolean(panel?.state && league && readyLeague === league && String(panel.props.leagueId) === league);
    return ours ? panel : null;
  }

  // Sleeper's columns with ours worked in: the admin pair right after FPTS (when on),
  // then GP (a week's Avg), the week's games (a week picked), Sleeper's own,
  // and the shot-volume columns at the end (Stats, Shooting on). Switching
  // away takes them back out. Null until Sleeper has settled which FPTS it shows.
  function columns(keys, base, other, { adminOn, volumeOn, gpOn, weekOn, recentOn }) {
    if (keys[0] !== base || keys.includes(other)) return null;
    const out = keys.filter((k) => k !== ADMIN_KEY && k !== DELTA_KEY && k !== GP_KEY && k !== WEEK_KEY && k !== RECENT_KEY && !VOLUME.includes(k));
    if (volumeOn) out.push(...VOLUME);
    if (recentOn) out.splice(1, 0, RECENT_KEY);
    if (weekOn) out.splice(1, 0, WEEK_KEY);
    if (gpOn) out.splice(1, 0, GP_KEY);
    if (adminOn) out.splice(1, 0, ADMIN_KEY, DELTA_KEY);
    return out;
  }

  // Once per league, after Sleeper's first load: the view you last had on
  // (see savedView), else Projection for the current week (Sleeper's leg),
  // through the state and fetch Sleeper's own dropdowns use.
  function openOnLastView(panel) {
    const { leagueId, leg } = panel.props;
    if (panel.snpOpenedFor === leagueId || panel.state.loading) return;
    panel.snpOpenedFor = leagueId;
    const saved = savedView(leagueId);
    weekPick = PICKS.some(([mode]) => mode === saved?.pick) ? saved.pick : 'avg';
    shooting = Boolean(saved?.shooting);
    if (saved?.team && panel.props.usersInLeagueMap?.[saved.team]) {
      panel.snpTeamPicked = true;
      pickTeam(panel, saved.team);
    }
    const want = saved && (saved.statType === 'proj' || saved.statType === 'stat')
      ? { statType: saved.statType, season: saved.current ? panel.state.season : String(saved.season || panel.state.season),
        statInterval: saved.current && leg > 0 ? +leg : saved.interval === 'season' ? 'season' : +saved.interval }
      : leg > 0 ? { statType: 'proj', season: panel.state.season, statInterval: +leg } : null;
    if (!want || want.statInterval !== 'season' && !(want.statInterval > 0)) return;
    const { statType, statInterval, season } = panel.state;
    if (statType === want.statType && String(statInterval) === String(want.statInterval) && String(season) === String(want.season)) return;
    panel.snpWant = { ...want, until: Date.now() + 5000 };
    panel.setState({ ...want, leg: +want.statInterval }, () => panel._fetchData?.(panel.props, panel.state));
  }

  // Sleeper's week dropdown keeps the value it was created with, as a string,
  // while its options are numbers, so on load it shows its placeholder (the
  // season) rather than "Week 1". It's set to the option the table shows.
  function weekLabel(panel) {
    for (const el of document.querySelectorAll(`${PLAYERS_PANEL} .filter-dropdown .app-dropdown`)) {
      const f = fiber(el, (x) => Array.isArray(x.options) && x.options.some((o) => o.value === 'season'));
      const dropdown = f?.stateNode;
      const option = f?.memoizedProps.options.find((o) => String(o.value) === String(panel.state.statInterval));
      if (dropdown?.state && option && dropdown.state.selectedValue !== option.value) dropdown.setState({ selectedValue: option.value });
    }
  }

  // The players the list shows right now (after Sleeper's position, search and owned filters).
  function listPlayers() {
    const grid = document.querySelector(`${PLAYERS_PANEL} .ReactVirtualized__Grid`);
    return (grid && fiber(grid, (x) => Array.isArray(x.players) && x.playerStatsMap)?.memoizedProps.players) || [];
  }
  const playersInView = () => listPlayers().map((p) => String(p.player_id));

  // The stats map Sleeper renders is rebuilt from its own: the picked games
  // (Best or Worst) first, then adminFPTS = FPTS plus what the changed settings
  // add or take away, so it matches FPTS exactly until a value changes.
  function patchPlayers() {
    const panel = playersPanel();
    // NFL gets the team picker, team lines and the Last 5 column; the rest is NBA's.
    const nfl = panel?.props.sport === 'nfl';
    const adminOn = Boolean(panel && admin?.enabled && admin.leagueId === readyLeague && !nfl);
    document.documentElement.toggleAttribute('data-snp-admin-changed', Boolean(adminOn && admin.changed));
    document.documentElement.toggleAttribute('data-snp-admin-col', Boolean(panel?.state.statKeys?.includes(ADMIN_KEY)));
    sizeColumns(panel);
    if (!panel) {
      weekSwitch(null);
      return;
    }
    if (!panel.snpHooked) {
      // Sleeper replaces its stats map on every week, season or Projection/Stats switch,
      // and filters the list on its own state; patch right after.
      const didUpdate = panel.componentDidUpdate;
      panel.componentDidUpdate = function (...args) {
        didUpdate?.apply(this, args);
        patchPlayers();
      };
      panel.snpHooked = true;
    }
    openOnLastView(panel);
    weekLabel(panel);
    if (!panel.state.loading) saveView(panel);
    const { playerStatsMap: map, statKeys = [], statType, statInterval, season } = panel.state;
    const base = statType === 'stat' ? 'fpts' : 'fpts_proj';
    const other = base === 'fpts' ? 'fpts_proj' : 'fpts';
    // A week picked in Stats (rather than the season).
    const shownWeek = statInterval != null && statInterval !== 'season' && Number(statInterval) > 0 ? Number(statInterval) : null;
    const week = statType === 'stat' && !nfl ? shownWeek : null;
    weekSwitch(week);
    shotToggle(statType === 'stat' && !nfl);
    teamPicker(panel);
    if (nfl) unclaimedChops(panel);
    const fetched = shownWeek && !nfl ? weekSchedule(season, shownWeek) : null;
    // The season shows the weeks through the current one (Sleeper's leg).
    const recent = nfl ? recentWeeks(season, shownWeek ?? panel.props.leg) : null;
    panel.snpRecent = recent;
    // Teams from the extension's players, else from Sleeper's own list.
    const schedule = fetched && { ...fetched, teamOf: { ...Object.fromEntries(listPlayers().map((p) => [String(p.player_id), p.team])), ...fetched.teamOf } };
    panel.snpSchedule = schedule;
    const mode = week ? weekPick : 'avg';
    const picked = mode === 'avg' ? null : weekGames(season, week, mode);
    const gpOn = Boolean(week && mode === 'avg');
    const played = gpOn ? weekGames(season, week, 'played') : null;
    // Sleeper's own map: any map that isn't the one we last set.
    if (map && map !== panel.snpMap) panel.snpSource = map;
    const source = panel.snpSource;
    const view = adminOn ? playersInView() : [];
    // Order doesn't matter (sorting by adminDelta reorders it), only who is in view.
    const loaded = picked || played ? `${season}|${week}` : '';
    const left = schedule ? JSON.stringify(schedule.teams) : '';
    const key = [mode, loaded, gpOn, left, recent?.sig ?? '', adminOn ? adminVersion : 'off', [...view].sort().join(',')].join('|');
    const update = {};
    if (source && (panel.snpSourceSeen !== source || panel.snpKey !== key)) {
      const stats = buildStatsMap(source, { picked, played: gpOn && played, recent, schedule, adminOn, view, base });
      if (stats !== map) update.playerStatsMap = stats;
      panel.snpSourceSeen = source;
      panel.snpKey = key;
    }
    const keys = columns(statKeys, base, other, { adminOn, volumeOn: statType === 'stat' && shooting && !nfl, gpOn, weekOn: Boolean(shownWeek) && !nfl, recentOn: nfl });
    if (keys && keys.join() !== statKeys.join()) update.statKeys = keys;
    // In Stats, Sleeper keeps sorting by the projection (fpts_proj), which isn't
    // a column there, so the list never follows the numbers shown (and Best or
    // Worst wouldn't reorder it). A sort on a column that isn't shown (that, or
    // GP once Best or Worst drops it) goes to the FPTS on screen; any column
    // sort carries over, and Sleeper re-sorts by the new numbers.
    const shown = keys || statKeys;
    if (statType === 'stat' && panel.state.sort && shown[0] === base && !shown.includes(panel.state.sort)) update.sort = base;
    if (Object.keys(update).length) {
      if (update.playerStatsMap) panel.snpMap = update.playerStatsMap;
      panel.setState(update);
    }
    watchRows();
    decorateRows();
    alignSections(panel);
    if (isSettled(panel, keys, { shownWeek, nfl, schedule, gpOn, played, mode, picked, recent })) reveal();
  }

  // The stats map Sleeper renders, from its own (`source`), in one pass: a
  // picked game (Best or Worst) in place of the week, as one game played, so
  // Sleeper's per-game numbers are its own; GP (games played, once the week's
  // games load: until then it shows "-"); Last 5's points per game and the week's games still
  // to play, to sort by; and adminFPTS and adminDelta. New objects per player,
  // so Sleeper's rows see the change and re-render.
  function buildStatsMap(source, { picked, played, recent, schedule, adminOn, view, base }) {
    if (!picked && !played && !recent && !schedule && !adminOn) return source;
    const out = Object.fromEntries(Object.entries(source).map(([id, s0]) => {
      const s = picked?.[id] ? { ...picked[id], fpts_proj: s0?.fpts_proj, [GAME]: 1 } : s0 && { ...s0 };
      if (!s) return [id, s];
      if (played) s[GP_KEY] = played[id] ?? 0;
      if (recent) s[RECENT_KEY] = recent.avg[id] ?? 0;
      if (schedule) s[WEEK_KEY] = (schedule.teams[schedule.teamOf[id]] || []).filter((d) => d === 'left').length;
      return [id, s];
    }));
    if (!adminOn) return out;
    // Scored on the numbers shown (a picked game's, say).
    const scores = admin.changed ? adminScores(out, view, base) : null;
    const inView = new Set(view);
    for (const [id, s] of Object.entries(out)) {
      if (s?.[base] == null) continue;
      // Per game, so it sorts by the number on screen: Sleeper shows every stat
      // per game (a season's stats are totals) but sorts on the stored value.
      s[ADMIN_KEY] = (s[base] + (scores?.points[id] ?? 0)) / (s.gp > 0 ? s.gp : 1);
      if (inView.has(id)) s[DELTA_KEY] = DELTA_OFFSET + (scores?.shifts[id] ?? 0);
    }
    tints = scores?.tints || {};
    places = scores?.places || {};
    return out;
  }

  // Whether the table can show: the view restored and loaded, our columns on
  // and sized, and the week's data the columns need.
  function isSettled(panel, keys, { shownWeek, nfl, schedule, gpOn, played, mode, picked, recent }) {
    return !panel.state.loading && !panel.snpWant && Boolean(keys) && keys.join() === (panel.state.statKeys || []).join() &&
      (!shownWeek || nfl || schedule) && (!gpOn || played) && (mode === 'avg' || picked) && (!nfl || recent?.ready);
  }

  // A control of ours in Sleeper's table (`cls`), kept in `parent`: made with
  // `create` the first time, and again if React re-rendering `parent` dropped
  // it; `place` puts it there (default: at the end) and `placed` says whether
  // it still is. Without a parent, it's removed. Returns it, or null.
  function ensureControl(parent, cls, create, { place = (el) => parent.append(el), placed = (el) => el.parentElement === parent } = {}) {
    let el = document.querySelector(`${PLAYERS_PANEL} .${cls}`);
    if (!parent) {
      el?.remove();
      return null;
    }
    if (!el || !placed(el)) {
      el?.remove();
      el = create();
      el.classList.add(cls);
      place(el);
    }
    return el;
  }

  // The Avg / Best / Worst switch, in the empty corner of the table's header
  // above the player names, while a week is picked in Stats.
  function weekSwitch(week) {
    const header = week ? document.querySelector(`${PLAYERS_PANEL} .table-header`) : null;
    const el = ensureControl(header, 'snp-week-pick', () => {
      const el = document.createElement('div');
      el.setAttribute('role', 'radiogroup');
      el.setAttribute('aria-label', 'Week stats');
      el.innerHTML = PICKS.map(([mode, label, title]) =>
        `<button type="button" role="radio" data-snp-pick="${mode}" title="${title}">${label}</button>`).join('');
      el.addEventListener('click', (e) => {
        const button = e.target.closest('[data-snp-pick]');
        e.stopPropagation();
        if (!button || button.dataset.snpPick === weekPick) return;
        weekPick = button.dataset.snpPick;
        patchPlayers();
      });
      return el;
    });
    if (!el) return;
    centerOnLabels(header, el);
    for (const button of el.children) {
      const on = button.dataset.snpPick === weekPick;
      if (button.getAttribute('aria-checked') !== String(on)) button.setAttribute('aria-checked', String(on));
    }
  }

  // League teams by owner: avatar, team name and owner, A to Z.
  const avatarUrl = (user) => user?.metadata?.avatar || (user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : '');
  const teamName = (user) => user?.metadata?.team_name || user?.display_name || 'Team';
  function leagueTeams(panel) {
    const users = panel.props.usersInLeagueMap || {};
    return (panel.props.rostersInLeague || []).filter((r) => users[r.owner_id])
      .map((r) => ({ id: r.owner_id, user: users[r.owner_id] }))
      .sort((a, b) => teamName(a.user).localeCompare(teamName(b.user)));
  }

  // The team the list is narrowed to: Sleeper's own owner filter (in its
  // filter section) with exactly one owner on, else null for all players.
  function pickedTeam(panel) {
    const { filterByUser, filterByUserMap = {} } = panel.state;
    const on = Object.keys(filterByUserMap).filter((id) => filterByUserMap[id]);
    return filterByUser && on.length === 1 ? on[0] : null;
  }
  function pickTeam(panel, id) {
    const map = Object.fromEntries(Object.keys(panel.state.filterByUserMap || panel.props.usersInLeagueMap || {}).map((k) => [k, k === id]));
    // A team's players are rostered, so the free-agents filter comes off with it.
    panel.setState(id ? { hideOwned: false, filterByUser: true, filterByUserMap: map } : { filterByUser: false, filterByUserMap: map });
  }

  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const avatar = (user, cls) => {
    const url = avatarUrl(user);
    return url ? `<img class="${cls}" src="${esc(url)}" alt="">` : `<span class="${cls} snp-blank">${esc(teamName(user).slice(0, 1).toUpperCase())}</span>`;
  };

  // A team picker beside Sleeper's player search, to scan one team's players.
  function teamPicker(panel) {
    const top = document.querySelector(`${PLAYERS_PANEL} .header-top`);
    const search = top?.querySelector(':scope > .player-search-wrapper');
    if (!search) {
      ensureControl(null, 'snp-team-pick');
      return;
    }
    // Ticking Free agents hides every rostered player: the team pick goes with it.
    if (panel.state.hideOwned && pickedTeam(panel) && panel.snpTeamPicked) {
      panel.snpTeamPicked = false;
      pickTeam(panel, null);
    }
    const teams = leagueTeams(panel);
    const picked = pickedTeam(panel);
    const sig = `${picked}|${teams.map((t) => t.id).join()}`;
    const el = ensureControl(top, 'snp-team-pick', () => {
      const el = document.createElement('div');
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('[data-snp-team]');
        if (item) {
          const p = playersPanel();
          if (p) {
            p.snpTeamPicked = Boolean(item.dataset.snpTeam);
            pickTeam(p, item.dataset.snpTeam || null);
          }
          el.classList.remove('open');
        } else if (e.target.closest('.snp-team-button')) el.classList.toggle('open');
        el.querySelector('.snp-team-button').setAttribute('aria-expanded', String(el.classList.contains('open')));
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') el.classList.remove('open');
      });
      return el;
    }, { place: (el) => search.after(el), placed: (el) => el.previousElementSibling === search });
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const current = teams.find((t) => t.id === picked);
    el.innerHTML = `<button type="button" class="snp-team-button" aria-haspopup="listbox" aria-expanded="false">
        ${current ? avatar(current.user, 'snp-team-avatar') : '<span class="snp-team-avatar snp-all"></span>'}
        <span class="snp-team-name">${current ? esc(teamName(current.user)) : 'All teams'}</span><i class="fa fa-chevron-down"></i></button>
      <div class="snp-team-menu" role="listbox">
        <button type="button" role="option" data-snp-team="" aria-selected="${!current}"><span class="snp-team-avatar snp-all"></span><span class="snp-team-label"><b>All teams</b></span></button>
        ${teams.map((t) => `<button type="button" role="option" data-snp-team="${esc(t.id)}" aria-selected="${t.id === picked}">${avatar(t.user, 'snp-team-avatar')}
          <span class="snp-team-label"><b>${esc(teamName(t.user))}</b><small>@${esc(t.user.display_name || '')}</small></span></button>`).join('')}
      </div>`;
  }
  document.addEventListener('click', () => document.querySelector(`${PLAYERS_PANEL} .snp-team-pick.open`)?.classList.remove('open'));
  // With a team picked, arrow up and down go through the league's teams (A to
  // Z, as the picker lists them), stopping at the first and the last. Not while typing (Find player).
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.target instanceof Element && e.target.matches('input, select, textarea, [contenteditable]')) return;
    const panel = playersPanel();
    const picked = panel && pickedTeam(panel);
    if (!picked) return;
    const teams = leagueTeams(panel);
    const at = teams.findIndex((t) => t.id === picked);
    const next = teams[at + (e.key === 'ArrowDown' ? 1 : -1)];
    if (at < 0 || !next) return;
    e.preventDefault();
    panel.snpTeamPicked = true;
    pickTeam(panel, next.id);
  });

  // A rostered player's owner line: the team's avatar and name, in place of Sleeper's arrow and username.
  function ownerLine(row, id, panel) {
    const owner = row.querySelector('.player-meta-container .owner');
    const user = owner && panel.props.ownedPlayers?.[id];
    if (!owner) return;
    if (!user) {
      owner.removeAttribute('data-snp-owner');
      owner.querySelector(':scope > .snp-owner')?.remove();
      return;
    }
    const sig = `${user.user_id}|${teamName(user)}|${avatarUrl(user)}`;
    if (owner.dataset.snpOwner === sig) return;
    owner.dataset.snpOwner = sig;
    owner.querySelector(':scope > .snp-owner')?.remove();
    const line = document.createElement('span');
    line.className = 'snp-owner';
    line.title = `${teamName(user)} (@${user.display_name})`;
    line.innerHTML = `${avatar(user, 'snp-owner-avatar')}<span>${esc(teamName(user))}</span>`;
    owner.append(line);
  }

  // Chopped leagues: a red axe after the name of each player the latest chop
  // dropped and no one has picked up since, as Sleeper's app marks them. Sleeper's
  // own Players panel holds who that is (the Chopped filter's list).
  const AXE = '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(35 12 12)"><path d="M10.6 2.5h4.2c2.2 0 4.2-.9 5.8-2.3v11.2c-1.6-1.4-3.6-2.3-5.8-2.3h-4.2z" fill="currentColor"/><path d="M12.2 3v20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></g></svg>';
  // Sleeper's web Chopped filter lists every player the latest chop dropped,
  // claimed since or not; its app lists only those still on waivers. Taking
  // the rostered ones out of the panel's list makes the web filter match.
  function unclaimedChops(panel) {
    const data = panel.state.choppedData;
    const map = data?.latestChoppedPlayersMap;
    const owned = panel.props.ownedPlayers || {};
    if (!map || !Object.keys(map).some((id) => owned[id])) return;
    const left = Object.fromEntries(Object.entries(map).filter(([id]) => !owned[id]));
    panel.setState({ choppedData: { ...data, latestChoppedPlayersMap: left } });
  }

  function chopMark(row, id, panel) {
    const name = row.querySelector('.player-meta-container .name');
    if (!name) return;
    const chopped = panel.state.choppedData;
    const week = chopped?.latestChoppedPlayersMap?.[id] && !panel.props.ownedPlayers?.[id] ? chopped.latestElmininationWeek || '' : null;
    const mark = name.querySelector(':scope > .snp-chop');
    if (week == null) return mark?.remove();
    if (mark?.dataset.week === String(week)) return;
    mark?.remove();
    const el = document.createElement('span');
    el.className = 'snp-chop';
    el.dataset.week = String(week);
    el.title = week ? `Chopped in week ${week}: on waivers` : 'Chopped: on waivers';
    el.innerHTML = AXE;
    name.append(el);
  }

  // Shooting: a small +/- at the end of the column header, while Stats is on,
  // shows the shot-volume columns there (it doesn't take room in Sleeper's
  // filter row, which would wrap).
  function shotToggle(on) {
    const header = on ? document.querySelector(`${PLAYERS_PANEL} .table-header`) : null;
    document.documentElement.toggleAttribute('data-snp-shot-toggle', Boolean(header));
    const el = ensureControl(header, 'snp-shot-toggle', () => {
      const el = document.createElement('button');
      el.type = 'button';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        shooting = !shooting;
        patchPlayers();
      });
      return el;
    });
    if (!el) return;
    const text = shooting ? '−' : '+';
    if (el.textContent !== text) el.textContent = text;
    const title = `${shooting ? 'Hide' : 'Show'} shooting: FGM, FGA, 3PA, FTM, FTA (they don't score, but show who shoots)`;
    if (el.title !== title) {
      el.title = title;
      el.setAttribute('aria-label', title);
      el.setAttribute('aria-pressed', String(shooting));
    }
    centerOnLabels(header, el);
  }

  // Puts a header control's middle on the labels' text (each label box has
  // padding under it), wherever Sleeper's layout puts them.
  function centerOnLabels(header, el) {
    const text = header.querySelector('.stat-key-header > .label > span');
    if (!text) return;
    const box = text.getBoundingClientRect();
    const top = `${Math.round(box.top - header.getBoundingClientRect().top + (box.height - el.offsetHeight) / 2)}px`;
    if (el.style.top !== top) el.style.top = top;
  }

  // The week strip for a player's team: one mark a day, Monday to Sunday. A
  // game played wears its score's color (green, yellow, red, as on the Team
  // tab); hovering a mark says the game and its score or tip-off.
  function weekStrip(cell, schedule, team, id) {
    const states = schedule?.teams[team];
    cell.querySelector(':scope > .snp-value')?.remove();
    const el = overlay(cell, 'snp-week');
    const games = schedule?.games?.[team] || [];
    const scores = schedule?.points?.[id] || {};
    const sig = states ? `${team}|${states.join()}|${JSON.stringify(games.map((g) => g && scores[g.id]))}` : '';
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    if (!states) {
      el.textContent = '-';
      el.removeAttribute('title');
      return;
    }
    const left = states.filter((d) => d === 'left').length;
    const weekday = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
    const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const count = `${left} game${left === 1 ? '' : 's'} left this week`;
    el.textContent = '';
    states.forEach((d, i) => {
      const mark = document.createElement('i');
      const g = games[i];
      const score = d === 'done' && g ? scores[g.id] : null;
      mark.className = d ? `${d}${d === 'done' ? ` ${score ? score.tier : 'dnp'}` : ''}` : 'none';
      if (g) {
        mark.dataset.tip = `${weekday(schedule.days[i])} ${g.home ? 'vs' : '@'} ${g.opponent}`;
        mark.dataset.note = d === 'done' ? (score ? whole(score.fpts) : 'Didn\'t play') : d === 'live' ? 'On now' : g.start ? time(g.start) : '';
        if (score) mark.dataset.tier = score.tier;
        mark.dataset.count = count;
      }
      el.append(mark);
    });
    el.setAttribute('aria-label', count);
  }

  // NFL: the last five weeks played, a mark a week: its score's color (gray
  // when they didn't play), faint for a bye, red for a game on now, light gray
  // for one still to come. Hovering one says the week, opponent and score.
  function recentStrip(cell, recent, id, panel) {
    cell.querySelector(':scope > .snp-value')?.remove();
    const el = overlay(cell, 'snp-week', 'snp-week snp-recent');
    const team = listPlayers().find((p) => String(p.player_id) === id)?.team || recent?.teamOf?.[id] || null;
    const scores = recent?.points[id] || {};
    const sig = recent ? `${recent.sig}|${team}|${JSON.stringify(scores)}` : '';
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    if (!recent) {
      el.textContent = '-';
      return;
    }
    const schedules = panel.props.schedulesMap || {};
    const games = recent.weeks.filter((w) => scores[w]).length;
    const count = games ? `${whole(recent.avg[id] ?? 0)} a game over ${games} week${games === 1 ? '' : 's'}` : 'No games in these weeks';
    const time = (ms) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    el.textContent = '';
    for (const w of recent.weeks) {
      const score = scores[w];
      const playedFor = score?.team || team;
      const opp = schedules[playedFor]?.[`week_${w}`] || (score?.opponent ? score.opponent : null);
      const status = recent.status?.[w]?.[playedFor];
      const mark = document.createElement('i');
      const bye = opp === 'BYE' || (!opp && !score);
      mark.className = bye ? 'none' : status === 'live' ? 'live' : status === 'left' ? 'left' : score ? `done ${score.tier}` : 'done dnp';
      mark.dataset.tip = `Week ${w}${bye ? '' : ` ${opp.startsWith('@') ? `@ ${opp.slice(1)}` : `vs ${opp}`}`}`;
      mark.dataset.note = bye ? 'Bye' : status === 'left' ? (recent.kickoff?.[playedFor] ? time(recent.kickoff[playedFor]) : 'Still to play')
        : score ? `${whole(score.fpts)}${status === 'live' ? ' so far' : ''}` : status === 'live' ? 'On now' : 'Didn\'t play';
      if (score?.tier && status !== 'left') mark.dataset.tier = score.tier;
      mark.dataset.count = count;
      el.append(mark);
    }
    el.setAttribute('aria-label', count);
  }

  // The strip's hover card, on the page so the row doesn't clip it.
  let tip = null;
  function showTip(mark) {
    tip ||= Object.assign(document.createElement('div'), { className: 'snp-week-tip' });
    if (!tip.isConnected) document.body.append(tip);
    tip.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'snp-tip-head';
    const name = document.createElement('b');
    name.textContent = mark.dataset.tip;
    const note = document.createElement('span');
    note.textContent = mark.dataset.note;
    if (mark.dataset.tier) note.className = `snp-tip-score ${mark.dataset.tier}`;
    head.append(name, note);
    const foot = document.createElement('div');
    foot.className = 'snp-tip-foot';
    foot.textContent = mark.dataset.count;
    tip.append(head, foot);
    const box = mark.getBoundingClientRect();
    tip.style.display = 'block';
    tip.style.left = `${Math.round(box.left + box.width / 2 - tip.offsetWidth / 2 + scrollX)}px`;
    tip.style.top = `${Math.round(box.top - tip.offsetHeight - 8 + scrollY)}px`;
  }
  document.addEventListener('mouseover', (e) => {
    const mark = e.target.closest?.(`${PLAYERS_PANEL} .snp-week i[data-tip]`);
    if (mark) showTip(mark);
    else if (tip?.style.display === 'block') tip.style.display = 'none';
  });

  // A span of ours over a cell whose own text (Sleeper's, hidden) can't say
  // what we mean: the cell's `.<cls>`, made with `className` the first time.
  function overlay(cell, cls, className = cls) {
    if (!cell.hasAttribute('data-snp-cell')) cell.setAttribute('data-snp-cell', '');
    let el = cell.querySelector(`:scope > .${cls}`);
    if (!el) {
      el = document.createElement('span');
      el.className = className;
      cell.append(el);
    }
    return el;
  }

  function clearOverlay(cell) {
    if (!cell.hasAttribute('data-snp-cell')) return;
    cell.removeAttribute('data-snp-cell');
    cell.querySelector(':scope > .snp-value')?.remove();
    cell.querySelector(':scope > .snp-week')?.remove();
  }

  // A single game's numbers are counts: whole, but for fantasy points that score in halves.
  const whole = (v) => (v == null ? '0' : Number.isInteger(v) ? String(v) : v.toFixed(1));

  // What a cell should read when Sleeper's own text is wrong for it, else null.
  // Sleeper divides every stored stat by games played and prints one decimal.
  function cellText(key, s) {
    if (key === GP_KEY) return s?.[GP_KEY] == null ? '-' : String(s[GP_KEY]);
    if (key === ADMIN_KEY) return s?.[ADMIN_KEY] == null ? '-' : s[GAME] ? whole(s[ADMIN_KEY]) : s[ADMIN_KEY].toFixed(1);
    if (!s?.[GAME]) return null;
    return key === 'sp' ? String(Math.round((s.sp || 0) / 60)) : whole(s[key]);
  }

  // Cells whose number Sleeper can't print right get ours drawn over them:
  // GP and a picked game's whole numbers, and adminFPTS, which is stored per
  // game already (to sort right). adminDelta shows as a badge: "+3" in green,
  // "−2" in red, deeper the further the player moves, with both places under
  // it ("#13→#42"). The sorted column's header gets a thin bar under it.
  // Rows mount (and are reused) as the list scrolls, so they're watched.
  function decorateRows() {
    const panel = playersPanel();
    if (!panel) return;
    const keys = panel.state.statKeys || [];
    const map = panel.state.playerStatsMap || {};
    const k = keys.indexOf(DELTA_KEY);
    if (k >= 0) {
      const labels = document.querySelectorAll(`${PLAYERS_PANEL} .stat-key-header > .label`);
      labels.forEach((label, i) => {
        const sorted = keys[i] === panel.state.sort;
        if (label.hasAttribute('data-snp-sorted') !== sorted) label.toggleAttribute('data-snp-sorted', sorted);
      });
    }
    for (const row of document.querySelectorAll(`${PLAYERS_PANEL} .player-list-item`)) {
      const cells = row.querySelectorAll(':scope > .cell');
      const id = fiber(row, (x) => x.player?.player_id)?.memoizedProps.player.player_id;
      if (id == null) continue;
      const s = map[id];
      ownerLine(row, id, panel);
      chopMark(row, id, panel);
      keys.forEach((key, i) => {
        if (key === DELTA_KEY || !cells[i]) return;
        if (key === WEEK_KEY) {
          const schedule = panel.snpSchedule;
          weekStrip(cells[i], schedule, schedule?.teamOf[id], id);
          return;
        }
        if (key === RECENT_KEY) {
          recentStrip(cells[i], panel.snpRecent, id, panel);
          return;
        }
        const text = cellText(key, s);
        if (text == null) {
          clearOverlay(cells[i]);
          return;
        }
        cells[i].querySelector(':scope > .snp-week')?.remove();
        const value = overlay(cells[i], 'snp-value');
        if (value.textContent !== text) value.textContent = text;
      });
      const cell = cells[k];
      if (!cell) continue;
      const stored = s?.[DELTA_KEY];
      const shift = stored == null ? null : stored - DELTA_OFFSET;
      const text = shift == null ? '-' : shift > 0 ? `+${shift}` : shift < 0 ? `−${-shift}` : '0';
      if (!cell.hasAttribute('data-snp-delta')) cell.setAttribute('data-snp-delta', '');
      const badge = overlay(cell, 'snp-delta');
      if (badge.textContent !== text) badge.textContent = text;
      const [was, now] = places[id] || [];
      const where = was && admin?.changed ? `#${was}→#${now}` : '';
      const line = overlay(cell, 'snp-places');
      if (line.textContent !== where) {
        line.textContent = where;
        cell.title = where && `Rank by FPTS ${was}, by adminFPTS ${now}, among the players listed`;
      }
      // Compared with what was set, since the browser rewrites style values.
      const tint = (shift && tints[id]) || '';
      if (badge.dataset.tint !== tint) {
        badge.dataset.tint = tint;
        badge.style.background = tint;
        badge.style.color = shift ? '#fff' : '';
      }
    }
  }

  let watched = null;
  let decorateFrame = 0;
  const rowWatcher = new MutationObserver(() => {
    decorateFrame ||= requestAnimationFrame(() => {
      decorateFrame = 0;
      decorateRows();
    });
  });
  function watchRows() {
    const el = document.querySelector(PLAYERS_PANEL);
    if (el === watched) return;
    rowWatcher.disconnect();
    watched = el;
    if (el) rowWatcher.observe(el, { childList: true, subtree: true, characterData: true });
  }

  // No layout shift: on the NBA Players tab, Sleeper's table stays hidden (its
  // space kept) until the view you had is restored and our columns, sizes and
  // week data are in, then shows once. Any players route starts hidden; it shows
  // right away for other sports, and after 5s whatever happens.
  const PLAYERS_ROUTE = /^\/leagues\/(\d+)\/players(?:\/|$)/;
  const PENDING = 'data-snp-players-pending';
  const PENDING_MS = 5000;
  let pendingSince = 0;
  let routePath = null;
  function routeChanged() {
    if (location.pathname === routePath) return;
    routePath = location.pathname;
    const on = PLAYERS_ROUTE.test(routePath);
    document.documentElement.toggleAttribute(PENDING, on);
    pendingSince = on ? Date.now() : 0;
    if (on) appear.observe(document.documentElement, { childList: true, subtree: true });
    else appear.disconnect();
  }
  function reveal() {
    if (!pendingSince) return;
    pendingSince = 0;
    document.documentElement.removeAttribute(PENDING);
    appear.disconnect();
  }
  // While hidden, patch as soon as Sleeper's table shows up, not on the next tick.
  let appearFrame = 0;
  const appear = new MutationObserver(() => {
    appearFrame ||= requestAnimationFrame(() => {
      appearFrame = 0;
      checkPending();
    });
  });
  function checkPending() {
    if (!pendingSince) return;
    const id = location.pathname.match(PLAYERS_ROUTE)?.[1];
    const [league, sport] = (document.documentElement.dataset.snpLeagueSport || '').split(':');
    if (Date.now() - pendingSince > PENDING_MS || (league === id && sport !== 'nba' && sport !== 'nfl')) return reveal();
    if (document.documentElement.dataset.snpPlayersLeague && document.querySelector(PLAYERS_PANEL)) patchPlayers();
  }
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const out = original.apply(this, args);
      routeChanged();
      return out;
    };
  }
  addEventListener('popstate', routeChanged);
  routeChanged();

  // One poll for what Sleeper changes without telling: the path (for the tab
  // to reopen a league on) and the Players table.
  setInterval(() => {
    rememberPage();
    checkPending();
    if (document.documentElement.dataset.snpPlayersLeague && document.querySelector(PLAYERS_PANEL)) patchPlayers();
  }, 500);

  // Sleeper's stat columns are 60px with 2px each side, which fits its 9 in
  // the header after its 176px corner (and in the 796px rows, after the name
  // area). With more, the table would scroll sideways and the name area would
  // shrink. So the columns narrow to share the header's room. Sleeper's rows
  // start each cell 17px left of its label, which only lines a value up under
  // a left-aligned label at 60px; narrowed, the labels center and the rows'
  // name area takes those 17px (and 12 more, from the header's corner, for
  // names and team lines), so each value sits right under its label. The
  // volume columns are dimmed: they don't score.
  const volumeStyle = document.createElement('style');
  function headerRoom(toggleOn) {
    const header = document.querySelector(`${PLAYERS_PANEL} .stat-key-header`);
    const label = header?.querySelector(':scope > .label');
    if (!label) return null;
    const cell = getComputedStyle(label);
    // As laid out once narrowed: Sleeper's 176px corner and the name area's
    // extra, and the Shooting toggle's spot at the end (in Stats).
    const toggle = toggleOn ? TOGGLE_W : 0;
    return {
      room: header.clientWidth - 176 - NAME_EXTRA - toggle,
      margins: parseFloat(cell.marginLeft) + parseFloat(cell.marginRight),
    };
  }
  function sizeColumns(panel) {
    const keys = panel?.state.statKeys || [];
    const html = document.documentElement;
    const week = keys.indexOf(WEEK_KEY);
    // The week strip takes its own width; the other columns share what's left.
    const strip = week >= 0 ? WEEK_W : 0;
    const fit = (keys.length > 9 || strip) && headerRoom(panel.state.statType === 'stat' && panel.props.sport !== 'nfl');
    const others = keys.length - (strip ? 1 : 0);
    const width = fit ? `${Math.min(60, Math.floor((fit.room - (strip ? strip + fit.margins : 0)) / others - fit.margins))}px` : '';
    if (html.style.getPropertyValue('--snp-col') !== width) {
      if (width) html.style.setProperty('--snp-col', width);
      else html.style.removeProperty('--snp-col');
    }
    html.toggleAttribute('data-snp-cols', Boolean(width));
    const at = (n) => `.stat-key-header > :nth-child(${n} of .label), .player-list-item > :nth-child(${n} of .cell)`;
    const nth = keys.flatMap((k, i) => (VOLUME.includes(k) ? [i + 1] : []));
    const css = (nth.length ? `${PLAYERS_PANEL} :is(${nth.map(at).join(', ')}) { opacity: 0.5; }` : '') +
      (strip ? `html[data-snp-cols] ${PLAYERS_PANEL} :is(${at(week + 1)}) { flex-basis: ${WEEK_W}px !important; }` : '');
    if (volumeStyle.textContent !== css) volumeStyle.textContent = css;
  }


  // NFL's group headers (Fantasy, Rushing, Receiving, Passing, ...) are
  // fixed-width boxes in a row over the columns; with columns narrowed or added
  // they'd drift, so each is placed over its own columns and centered, as the
  // labels are. A group's columns are told by their stat keys; a group none
  // match takes the columns left between its neighbours'.
  const GROUPS = { fantasy: /^(fpts|Last 5$)/, rushing: /^rush_/, receiving: /^rec_/, passing: /^pass_/, kicking: /^(fg|xp)/ };
  function alignSections(panel) {
    const head = document.querySelector(`${PLAYERS_PANEL} .section-header`);
    const labels = [...document.querySelectorAll(`${PLAYERS_PANEL} .stat-key-header > .label`)];
    const keys = panel?.state.statKeys || [];
    const sections = head ? [...head.children] : [];
    const ours = document.documentElement.hasAttribute('data-snp-cols');
    if (!sections.length || !ours || labels.length !== keys.length) {
      for (const el of sections) if (el.hasAttribute('data-snp-placed')) {
        el.removeAttribute('data-snp-placed');
        el.style.removeProperty('flex');
        el.style.removeProperty('margin-left');
        el.style.removeProperty('text-align');
      }
      return;
    }
    const groupOf = (el) => Object.keys(GROUPS).find((g) => el.classList.contains(g));
    // Each group's first and last column, by key; unmatched groups fill the gaps in order.
    const spans = sections.map((el) => {
      const re = GROUPS[groupOf(el)];
      const at = re ? keys.flatMap((k, i) => (re.test(k) ? [i] : [])) : [];
      return at.length ? [at[0], at.at(-1)] : null;
    });
    spans.forEach((span, i) => {
      if (span) return;
      const from = (spans.slice(0, i).reverse().find(Boolean)?.[1] ?? -1) + 1;
      const to = (spans.slice(i + 1).find(Boolean)?.[0] ?? keys.length) - 1;
      spans[i] = from <= to ? [from, to] : null;
    });
    const left = head.getBoundingClientRect().left + parseFloat(getComputedStyle(head).paddingLeft);
    let end = left;
    sections.forEach((el, i) => {
      const span = spans[i];
      const a = span && labels[span[0]].getBoundingClientRect();
      const b = span && labels[span[1]].getBoundingClientRect();
      const width = span ? Math.round(b.right - a.left) : 0;
      const margin = span ? Math.round(a.left - end) : 0;
      end += margin + width;
      const flex = `0 0 ${width}px`;
      if (el.style.flex !== flex) el.style.flex = flex;
      if (el.style.marginLeft !== `${margin}px`) el.style.marginLeft = `${margin}px`;
      if (el.style.textAlign !== 'center') el.style.textAlign = 'center';
      el.setAttribute('data-snp-placed', '');
    });
  }

  // The admin headers read as named (not uppercase), on two lines.
  // adminFPTS wears the what-if color once a value differs from the league's.
  const ours = ':is(:nth-child(2 of .label), :nth-child(3 of .label))';
  const adminStyle = document.createElement('style');
  adminStyle.textContent = `
    html[data-snp-cols] ${PLAYERS_PANEL} :is(.stat-key-header > .label, .player-list-item > .cell) { flex-basis: var(--snp-col) !important; }
    html[data-snp-cols] ${PLAYERS_PANEL} .player-list-item > .player-meta-container { flex: 0 0 ${118 + 17 + NAME_EXTRA}px !important; }
    html[data-snp-cols] ${PLAYERS_PANEL} .stat-key-header { padding-left: ${176 + NAME_EXTRA}px !important; }
    html[data-snp-cols] ${PLAYERS_PANEL} .stat-key-header > .label { justify-content: center; text-align: center; }
    html[data-snp-cols][data-snp-shot-toggle] ${PLAYERS_PANEL} .stat-key-header { padding-right: ${TOGGLE_W}px !important; }
    html[data-snp-admin-col] ${PLAYERS_PANEL} .stat-key-header > ${ours} span {
      text-transform: none; font-size: 10px; line-height: 10px; white-space: normal; width: min-content;
    }
    html[data-snp-admin-changed] ${PLAYERS_PANEL} .stat-key-header > ${ours} span,
    html[data-snp-admin-changed] ${PLAYERS_PANEL} .player-list-item > :nth-child(2 of .cell) { color: #b69cff !important; }
    html[data-snp-players-pending] ${PLAYERS_PANEL} { visibility: hidden !important; }
    ${PLAYERS_PANEL} [data-snp-cell] { font-size: 0 !important; }
    ${PLAYERS_PANEL} .snp-value { font-size: 12px; }
    ${PLAYERS_PANEL} [data-snp-delta] { flex-direction: column; gap: 2px; }
    ${PLAYERS_PANEL} .stat-key-header > .label { position: relative; }
    ${PLAYERS_PANEL} .stat-key-header > .label[data-snp-sorted]::after {
      content: ''; position: absolute; left: 0; width: 24px; bottom: 0; height: 2px; border-radius: 1px; background: #00ceb8;
    }
    html[data-snp-cols] ${PLAYERS_PANEL} .stat-key-header > .label[data-snp-sorted]::after { left: 50%; transform: translateX(-50%); }
    ${PLAYERS_PANEL} .snp-places { font-size: 9px; line-height: 10px; color: rgba(255, 255, 255, 0.55); white-space: nowrap; font-variant-numeric: tabular-nums; }
    ${PLAYERS_PANEL} .snp-places:empty { display: none; }
    ${PLAYERS_PANEL} .table-header:has(> .snp-week-pick, > .snp-shot-toggle) { position: relative; }
    ${PLAYERS_PANEL} .snp-shot-toggle {
      position: absolute; right: 4px; top: 13px; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%;
      background: rgb(32, 38, 53); color: rgb(185, 196, 212); font: 700 14px/20px Poppins, sans-serif; text-align: center; cursor: pointer;
    }
    ${PLAYERS_PANEL} .snp-shot-toggle:hover { background: rgb(52, 61, 82); color: #fff; }
    ${PLAYERS_PANEL} .snp-shot-toggle[aria-pressed="true"] { background: rgb(196, 213, 230); color: rgb(2, 32, 71); }
    ${PLAYERS_PANEL} .snp-week-pick {
      position: absolute; left: 16px; top: 15px; display: flex; gap: 2px; padding: 3px; border-radius: 14px; background: rgb(32, 38, 53);
    }
    ${PLAYERS_PANEL} .snp-week-pick button {
      height: 20px; min-width: 40px; padding: 0 10px; border: 0; border-radius: 10px; background: none; cursor: pointer;
      font: 700 11px/20px Poppins, sans-serif; color: rgb(185, 196, 212);
    }
    ${PLAYERS_PANEL} .snp-week { display: flex; gap: 2px; height: 14px; align-items: stretch; font-size: 12px; }
    ${PLAYERS_PANEL} .snp-week i { flex: 0 0 5px; border-radius: 1.5px; background: rgba(255, 255, 255, 0.06); }
    ${PLAYERS_PANEL} .snp-week i.live { background: #ff5b6e; }
    ${PLAYERS_PANEL} .snp-week i.left { background: rgba(225, 232, 242, 0.85); }
    ${PLAYERS_PANEL} .snp-week i.done { background: rgba(185, 196, 212, 0.6); }
    ${PLAYERS_PANEL} .snp-week i.done.green { background: rgb(84, 132, 100); }
    ${PLAYERS_PANEL} .snp-week i.done.yellow { background: rgb(128, 122, 78); }
    ${PLAYERS_PANEL} .snp-week i.done.red { background: rgb(150, 72, 96); }
    ${PLAYERS_PANEL} .snp-week i.done.dnp { background: rgba(185, 196, 212, 0.3); }
    ${PLAYERS_PANEL} .snp-week i[data-tip] { cursor: default; }
    ${PLAYERS_PANEL} .snp-recent { gap: 2px; }
    ${PLAYERS_PANEL} .snp-recent i { flex-basis: 6px; }
    ${PLAYERS_PANEL} .snp-recent i.none { background: rgba(255, 255, 255, 0.04); }
    ${PLAYERS_PANEL} .snp-week i[data-tip]:hover { outline: 1px solid rgba(255, 255, 255, 0.8); outline-offset: 1px; }
    .snp-week-tip {
      position: absolute; z-index: 10000; display: none; padding: 7px 10px; border-radius: 8px; pointer-events: none;
      background: #0d1421; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5); color: #fff; font: 12px/16px Poppins, sans-serif; white-space: nowrap;
    }
    .snp-week-tip .snp-tip-head { display: flex; align-items: center; gap: 8px; }
    .snp-week-tip .snp-tip-head span { color: rgb(185, 196, 212); }
    .snp-week-tip .snp-tip-score { padding: 0 5px; border-radius: 4px; color: #fff !important; font-weight: 800; font-variant-numeric: tabular-nums; }
    .snp-week-tip .snp-tip-score.green { background: rgba(84, 132, 100, 0.95); }
    .snp-week-tip .snp-tip-score.yellow { background: rgba(128, 122, 78, 0.95); }
    .snp-week-tip .snp-tip-score.red { background: rgba(150, 72, 96, 0.95); }
    .snp-week-tip .snp-tip-foot { margin-top: 2px; color: rgb(120, 134, 156); font-size: 10px; line-height: 14px; }
    ${PLAYERS_PANEL} .snp-team-pick { position: relative; flex: 0 1 200px; min-width: 0; margin-left: 8px; }
    ${PLAYERS_PANEL} .snp-team-button {
      display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 0 12px 0 5px; border: 0; border-radius: 20px;
      background: rgb(32, 38, 53); color: #fff; font: 600 13px Poppins, sans-serif; cursor: pointer; text-align: left;
    }
    ${PLAYERS_PANEL} .snp-team-button:hover { background: rgb(40, 47, 65); }
    ${PLAYERS_PANEL} .snp-team-button .snp-team-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ${PLAYERS_PANEL} .snp-team-button .fa { color: rgb(120, 134, 156); font-size: 11px; }
    ${PLAYERS_PANEL} .snp-team-avatar { flex: none; width: 22px; height: 22px; border-radius: 50%; object-fit: cover; background: rgb(52, 61, 82); }
    ${PLAYERS_PANEL} .snp-team-avatar.snp-all { background: conic-gradient(#00ceb8 0 25%, #59a7ff 0 50%, #f78c3c 0 75%, #c48df1 0); }
    ${PLAYERS_PANEL} .snp-blank { display: inline-grid; place-items: center; color: #fff; font: 700 11px Poppins, sans-serif; }
    ${PLAYERS_PANEL} .snp-team-menu {
      position: absolute; z-index: 1000; top: 38px; left: 0; width: max(100%, 240px); max-height: 360px; overflow-y: auto; padding: 6px;
      border-radius: 12px; background: rgb(24, 29, 42); box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55); display: none;
    }
    ${PLAYERS_PANEL} .snp-team-pick.open .snp-team-menu { display: block; }
    ${PLAYERS_PANEL} .snp-team-menu button {
      display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border: 0; border-radius: 8px;
      background: none; color: #fff; font: 13px Poppins, sans-serif; text-align: left; cursor: pointer;
    }
    ${PLAYERS_PANEL} .snp-team-menu button:hover { background: rgb(40, 47, 65); }
    ${PLAYERS_PANEL} .snp-team-menu button[aria-selected="true"] { background: rgba(0, 206, 184, 0.14); }
    ${PLAYERS_PANEL} .snp-team-menu .snp-team-avatar { width: 26px; height: 26px; }
    ${PLAYERS_PANEL} .snp-team-label { display: flex; flex-direction: column; min-width: 0; }
    ${PLAYERS_PANEL} .snp-team-label b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    ${PLAYERS_PANEL} .snp-team-label small { color: rgb(120, 134, 156); font-size: 11px; line-height: 14px; }
    ${PLAYERS_PANEL} .owner[data-snp-owner] > :not(.snp-owner) { display: none !important; }
    ${PLAYERS_PANEL} .snp-chop { display: inline-flex; width: 16px; height: 16px; margin-left: 4px; vertical-align: -3px; color: rgb(255, 77, 125); }
    ${PLAYERS_PANEL} .snp-chop svg { width: 100%; height: 100%; }
    /* Sleeper floats its rookie badge (absolute) after the name, where the axe goes: in line, they sit side by side. */
    ${PLAYERS_PANEL} .name:has(> .snp-chop) > .rookie-label { position: static !important; vertical-align: -1px; }
    /* NFL rows have a game line too: the team line takes no more height than Sleeper's own (12px). */
    ${PLAYERS_PANEL} .name-container:has(.game-schedule-live-description) .snp-owner { line-height: 12px; }
    ${PLAYERS_PANEL} .name-container:has(.game-schedule-live-description) .snp-owner-avatar { width: 12px; height: 12px; }
    /* Sleeper's red-zone mark, inline at the end of the game line rather than a bar on a line of its own. */
    ${PLAYERS_PANEL} .player-meta-container .game-schedule-live-description { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${PLAYERS_PANEL} .player-meta-container .game-schedule-live-description .rz {
      display: inline-block !important; position: static !important; width: auto !important; height: auto !important;
      margin: 0 0 0 4px !important; padding: 0 3px !important; border-radius: 3px; font-size: 8px !important; line-height: 11px !important; vertical-align: 1px;
    }
    ${PLAYERS_PANEL} .snp-owner { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; color: rgb(185, 196, 212); font-size: 10px; line-height: 16px; }
    ${PLAYERS_PANEL} .snp-owner > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ${PLAYERS_PANEL} .snp-owner-avatar { flex: none; width: 16px; height: 16px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18); }
    ${PLAYERS_PANEL} .snp-owner .snp-blank { background: rgb(52, 61, 82); font-size: 9px; }
    ${PLAYERS_PANEL} .snp-week-pick button:hover { color: #fff; }
    ${PLAYERS_PANEL} .snp-week-pick button[aria-checked="true"] { background: rgb(196, 213, 230); color: rgb(2, 32, 71); }
    ${PLAYERS_PANEL} .snp-delta {
      min-width: 28px; padding: 2px 6px; border-radius: 4px; box-sizing: border-box;
      font-size: 12px; font-weight: 700; text-align: center; color: rgba(255, 255, 255, 0.45); font-variant-numeric: tabular-nums;
    }`;
  (document.head || document.documentElement).append(adminStyle, volumeStyle);

  // NFL Team tab. Sleeper's own Team component holds the lineup as shown
  // (state.starters: slot + player), the roster, players, which teams have
  // kicked off, and the save actions its web app uses.
  const TEAM = '.team-roster';
  const teamFiber = () => {
    const el = document.querySelector(TEAM);
    return el && fiber(el, (x) => x.updateMatchupLeg && x.playersMap && x.league);
  };
  // Whether a lineup saves to the week's matchup leg, else to the roster, as
  // Sleeper's _updateRoster decides (the extension's model.lineupOnLeg is the same rule).
  const lineupOnLeg = (league) => !['pre_draft', 'drafting', 'complete'].includes(league?.status);

  // The lineup as the extension needs it, or null when this isn't an NFL Team tab.
  // Without `full`, only whether it can be edited (checked on every page change, so kept cheap).
  function nflLineup(leagueId, full) {
    const f = teamFiber();
    const p = f?.memoizedProps;
    if (!p || p.sport !== 'nfl' || String(p.leagueId) !== leagueId) return null;
    const editable = Boolean((p.isTeamOwner || p.isTeamCoOwner) && !p.disableEdit);
    if (!full) return { editable, round: p.round };
    const shown = f.stateNode?.state?.starters || [];
    const roster = p.roster || {};
    const starters = shown.map((s) => s.playerId || '0');
    const away = new Set([...starters, ...(roster.reserve || []), ...(roster.taxi || [])]);
    const bench = (roster.players || []).filter((id) => !away.has(id));
    const players = {};
    const played = {};
    for (const id of [...starters, ...bench]) {
      const pl = p.playersMap[id];
      if (!pl) continue;
      players[id] = {
        name: pl.position === 'DEF' ? `${pl.first_name || ''} ${pl.last_name || ''}`.trim() || id : `${pl.first_name} ${pl.last_name}`,
        position: pl.position,
        positions: pl.fantasy_positions || [pl.position],
        team: pl.team,
        injury: pl.injury_status || null,
      };
      if (p.hasTeamPlayedMap?.[pl.team]) played[id] = true;
    }
    // Each roster row renders Sleeper's projection with the raw projected stats and league scoring.
    const projections = {};
    let scoring = null;
    for (const el of document.querySelectorAll(`${TEAM} .team-roster-item .projections`)) {
      const x = props(el, (y) => 'proj' in y && y.playerId);
      if (!x) continue;
      projections[x.playerId] = { stats: x.proj?.stats || {}, opponent: x.proj?.opponent ?? null };
      scoring ||= x.scoringSettings;
    }
    return {
      leagueId,
      rosterId: p.roster?.roster_id ?? p.rosterId,
      round: p.round,
      editable,
      slots: shown.map((s) => s.slotPosition),
      starters,
      bench,
      players,
      played,
      projections,
      scoring,
    };
  }

  bridge.answer('snp:nfl-lineup', ({ leagueId, full }) => nflLineup(leagueId, full));

  // Sleeper's own player card, for any player, from the extension's NFL Team
  // and Matchup tabs. Sleeper builds the card and hands it to openModal in its
  // own handlers: the Team component's _onClickPlayerNews, a Matchup row's
  // click. One of them runs with openModal caught, which gives the card as
  // Sleeper makes it; it's opened again with the player asked for.
  function catchCard(props, run) {
    const open = props.openModal;
    let card = null;
    props.openModal = (el) => {
      card = el;
    };
    try {
      run();
    } catch {
      card = null;
    } finally {
      props.openModal = open;
    }
    return card && card.props ? { card, open, playersMap: card.props.playersMap || props.playersMap || {} } : null;
  }
  function sleeperCard() {
    const team = teamFiber()?.stateNode;
    const first = team?.props?.roster?.players?.[0];
    if (team?._onClickPlayerNews && first) return catchCard(team.props, () => team._onClickPlayerNews(first));
    const row = document.querySelector('.matchup-player-row-container .row');
    const click = row && props(row, (x) => typeof x.onClick === 'function')?.onClick;
    const owner = row && props(row, (x) => typeof x.openModal === 'function' && x.playersMap);
    return click && owner ? catchCard(owner, () => click({ stopPropagation() {}, preventDefault() {} })) : null;
  }
  bridge.on('snp:nfl-player-card', ({ playerId, player: basics }) => {
    const caught = sleeperCard();
    // Sleeper's own record of the player when it has one; Sleeper's card fetches the rest either way.
    const player = caught && (caught.playersMap[playerId] || basics);
    if (!caught || !player) return;
    const { card, open } = caught;
    open({ ...card, key: null, props: { ...card.props, playerIds: [playerId], selectedPlayerId: playerId, playersMap: { ...caught.playersMap, [playerId]: player } } });
  });

  // NFL League tab: Sleeper's own matchup cards, read as they show (so the
  // extension's cards carry Sleeper's exact live numbers), and which is yours.
  // Sleeper keeps drawing (and updating) them; the extension hides them and
  // shows its own, and a click on one of ours clicks Sleeper's.
  const NFL_ROW = '.league-matchups .league-matchup-row-item';
  const text = (el, sel) => el?.querySelector(sel)?.textContent.trim() ?? '';
  bridge.answer('snp:nfl-league', () => {
    const rows = [...document.querySelectorAll(NFL_ROW)];
    const league = rows[0] && props(rows[0], (x) => Array.isArray(x.rosters) && 'userId' in x);
    const mine = league?.rosters.find((r) => r.owner_id === league.userId || (r.co_owners || []).includes(league.userId))?.roster_id;
    const cards = rows.map((row) => {
      const ids = props(row, (x) => 'rosterId1' in x && 'rosterId2' in x) || props(row, (x) => 'rosterId1' in x) || {};
      const sides = [...row.querySelectorAll('.matchup-row > .user')].map((user) => {
        const avatar = user.querySelector('.avatar');
        const image = avatar && getComputedStyle(avatar).backgroundImage.match(/^url\("?(.*?)"?\)$/)?.[1];
        return {
          avatar: image || null,
          owner: text(user, '.meta .team-name').replace(/^@/, ''),
          team: text(user, '.meta .name'),
          score: text(user, '.score'),
          win: text(user, '.win-percentage-number'),
          record: text(user, '.description'),
          proj: text(user, '.projections'),
          bar: parseFloat(user.querySelector('.win-bar > div')?.style.width) || 0,
        };
      });
      return { own: mine != null && (ids.rosterId1 === mine || ids.rosterId2 === mine), sides };
    });
    // The week shown (Sleeper's week picker), for whether it plays the league median.
    return { cards, round: league?.round ?? null };
  });
  bridge.on('snp:nfl-league-open', ({ index }) => {
    const row = document.querySelectorAll(NFL_ROW)[index];
    // Sleeper's click handler sits on an element inside the card.
    const target = row && [row, ...row.querySelectorAll('*')].find((el) => typeof props(el, () => true)?.onClick === 'function');
    target?.click();
  });

  // Saves a lineup through Sleeper's own actions, so its screen updates as if you'd made the swaps.
  bridge.answerLater('snp:nfl-lineup-save', async ({ leagueId, rosterId, round, starters }) => {
    try {
      const p = teamFiber()?.memoizedProps;
      const rid = p && (p.roster?.roster_id ?? p.rosterId);
      if (!p || String(p.leagueId) !== leagueId || rid !== rosterId || p.round !== round) {
        throw new Error('The Team tab changed; open Optimize again');
      }
      const res = lineupOnLeg(p.league)
        ? await p.updateMatchupLeg(leagueId, rid, round, round, starters)
        : await p.rosterUpdateStarters(leagueId, rid, starters);
      const error = res?.errors?.[0];
      if (error) throw new Error(typeof error === 'string' ? error : error.message || 'Sleeper refused the lineup');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
})();
