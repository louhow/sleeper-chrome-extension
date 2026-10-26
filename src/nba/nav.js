// Sleeper's left sidebar shows an NFL league's matchup (team names, points and
// projections) under its name, but an NBA league only its format. This adds the
// same lines for every NBA league there (nav-view.js draws them in Sleeper's
// markup). page-hook.js marks each sidebar league with its id and sport. The
// league open in a session gives its own numbers, so the sidebar matches its
// panel; any other is loaded here, once, and again only once a game has tipped
// off since (at most every STALE_MS, while the tab is visible).
//   nbaNav() -> { attach(activeLeagueId), feed(leagueId, state), destroy }
(globalThis.SNP ||= {}).nbaNav = () => {
  const { createApi, bridge, shared, loaders, ui, nbaWeek, nbaNavView } = globalThis.SNP;
  const NAV_LEAGUE = 'a.nav-league-item-wrapper';
  const STALE_MS = 10 * 60e3;
  const RETRY_MS = 5 * 60e3;
  // Sleeper's format line ("2026 14-Team Dynasty Standard") makes way for ours.
  const hide = shared.hideSleeper('nav-format', `${NAV_LEAGUE}[data-snp-nav] .format-container`);
  // league id -> { state: () => week state or null, numbers (last drawn), loadedAt, loading, own (fed by its session) }
  const leagues = new Map();
  // Each of our elements' last HTML, compared instead of its innerHTML (which
  // the browser writes back its own way, so it would never match and every
  // draw would touch the page, waking content.js's observer).
  const drawn = new WeakMap();
  let active = null;
  let frame = 0;
  let destroyed = false;

  function attach(activeLeagueId) {
    // A league left keeps its session's last numbers until games move them on.
    if (activeLeagueId !== active && leagues.get(active)?.own) Object.assign(leagues.get(active), { own: false, loadedAt: Date.now() });
    active = activeLeagueId;
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  // The open league's session: `state` returns its state for the week on now
  // (null while it has none to give), which wins over anything loaded here.
  function feed(leagueId, state) {
    leagues.set(leagueId, { ...leagues.get(leagueId), state, own: true, loadedAt: Date.now() });
  }

  function draw() {
    if (destroyed) return;
    const now = Date.now();
    for (const { leagueId, sport } of bridge.ask('snp:nav-leagues') || []) {
      if (sport === 'nba' && leagueId !== active && due(leagues.get(leagueId), now)) load(leagueId);
    }
    let shown = false;
    for (const link of document.querySelectorAll(`${NAV_LEAGUE}[data-snp-sport="nba"]`)) {
      const entry = leagues.get(link.dataset.snpLeague);
      const numbers = entry && numbersOf(entry.state?.(), now);
      if (numbers) entry.numbers = numbers;
      shown = place(link, entry?.numbers ? nbaNavView.render(entry.numbers) : '') || shown;
    }
    hide.set(shown);
  }

  // Whether a league needs loading: never loaded, a failed load long enough
  // ago, or numbers that games since have moved on.
  function due(entry, now) {
    if (!entry) return true;
    if (entry.loading || entry.own || document.visibilityState !== 'visible') return false;
    if (entry.failed) return now - entry.loadedAt > RETRY_MS;
    if (now - entry.loadedAt < STALE_MS) return false;
    const s = entry.state?.();
    return Boolean(s?.weeks[s.week]?.games.some((g) => g.status !== 'complete' && g.start != null && g.start <= now));
  }

  // Our lines in the link, after Sleeper's (hidden) format line; '' takes them out.
  function place(link, html) {
    const format = link.querySelector('.format-container');
    let ours = link.querySelector('.nav-league-matchup[data-snp]');
    if (!html || !format) {
      ours?.remove();
      delete link.dataset.snpNav;
      return false;
    }
    if (!ours) {
      ours = document.createElement('div');
      ours.className = 'nav-league-matchup';
      ours.dataset.snp = '';
    }
    if (drawn.get(ours) !== html) {
      ours.innerHTML = html;
      drawn.set(ours, html);
    }
    if (format.nextElementSibling !== ours) format.after(ours);
    link.dataset.snpNav = '';
    return true;
  }

  // Your team and its opponent this week, from a week state (see load), or null.
  function numbersOf(s, now) {
    if (!s?.weeks?.[s.week]) return null;
    const state = { ...s, now };
    const mine = ui.myRoster(state);
    const l = mine && ui.lineup(state, mine.roster_id);
    const opp = l && ui.opponentOf(l);
    if (opp == null) return null;
    const team = (sd) => ({ team: ui.teamName(state, sd.l.roster), points: sd.anyPoints ? sd.points : null, proj: sd.proj });
    return { mine: team(nbaWeek.side(state, l)), theirs: team(nbaWeek.side(state, ui.lineup(state, opp))) };
  }

  // A league's week on now, as its session would load it, with the league's
  // own scoring. A fresh client each time, so its call log goes with it.
  async function load(leagueId) {
    const entry = { ...leagues.get(leagueId), loading: true };
    leagues.set(leagueId, entry);
    try {
      const api = createApi(() => {});
      const data = loaders.leagueData(api, leagueId, 'sleeper-nba-nav');
      const [league, nbaState, users, rosters, players, me] = await Promise.all([
        api.get(`/v1/league/${leagueId}`),
        api.get('/v1/state/nba'),
        api.get(`/v1/league/${leagueId}/users`),
        data.rosters(),
        nbaWeek.players(api),
        data.me(),
      ]);
      const week = nbaWeek.currentWeek(league, nbaState);
      const historyKey = `lineups:${leagueId}:${week}`;
      const [core, legs, stored] = await Promise.all([
        nbaWeek.load(api, league, week, league.scoring_settings || {}),
        data.legs(week, nbaWeek.LEG_FIELDS),
        chrome.storage.local.get(historyKey),
      ]);
      const state = {
        league, usersById: loaders.usersById(users), rosters, players, me, week, currentWeek: week,
        weeks: { [week]: { ...core, legs } },
        lineupHistory: { [week]: stored[historyKey] || {} },
      };
      // The league's session may have started meanwhile; its numbers win.
      if (!leagues.get(leagueId)?.own) leagues.set(leagueId, { state: () => state, loadedAt: Date.now() });
    } catch (err) {
      console.warn('[sleeper-nba-nav] matchup unavailable', err);
      if (!leagues.get(leagueId)?.own) leagues.set(leagueId, { ...entry, loading: false, failed: true, loadedAt: Date.now() });
    }
    attach(active);
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    for (const link of document.querySelectorAll(`${NAV_LEAGUE}[data-snp-nav]`)) place(link, '');
    hide.remove();
  }

  return { attach, feed, destroy };
};
