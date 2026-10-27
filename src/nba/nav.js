// Sleeper's left sidebar shows an NFL league's matchup (team names, points and
// projections) under its name, but an NBA league only its format. This adds the
// same lines for every NBA league there (nav-view.js draws them in Sleeper's
// markup); puts a win bar, as on the mobile app's home screen, between the two
// scores of every league's line (Sleeper's own NFL lines included, worked out
// from the numbers on them); and gives a chopped league your rank and safe
// chance where an opponent would be. page-hook.js marks each sidebar league
// with its id, sport and whether it's chopped. The league open in a session
// gives its own numbers, so the sidebar matches its panel; any other NBA or
// chopped league is loaded here, once, and again only once a game has tipped
// off since (at most every STALE_MS, while the tab is visible).
//   nbaNav() -> { attach(activeLeagueId), feed(leagueId, state), destroy }
(globalThis.SNP ||= {}).nbaNav = () => {
  const { createApi, bridge, shared, loaders, ui, model, nbaWeek, nbaNavView, nflWeek, nflPanelView } = globalThis.SNP;
  const NAV_LEAGUE = 'a.nav-league-item-wrapper';
  const STALE_MS = 10 * 60e3;
  const RETRY_MS = 5 * 60e3;
  // Sleeper's format line ("2026 14-Team Dynasty Standard") makes way for ours.
  const hide = shared.hideSleeper('nav-format', `${NAV_LEAGUE}[data-snp-nav] .format-container`);
  // The win bar (nav-view.js) on a row of its own under the scores (Sleeper's
  // 60px .win-bar-wrapper between them is too narrow); a chopped league's rank
  // takes the opponent's side, which Sleeper leaves empty there.
  const style = document.createElement('style');
  style.textContent = `
    ${NAV_LEAGUE} .snp-win { display: flex; align-items: center; gap: 6px; margin-top: 4px; font: 700 9px/10px Inter, sans-serif; white-space: nowrap; }
    ${NAV_LEAGUE} .snp-win span { min-width: 22px; }
    ${NAV_LEAGUE} .snp-win i { display: block; flex: 1; height: 4px; border-radius: 2px; background: rgba(58, 70, 91, 0.9); overflow: hidden; }
    ${NAV_LEAGUE} .snp-win b { display: block; height: 100%; border-radius: 2px; }
    ${NAV_LEAGUE} .snp-win.up { color: #00ceb8; } ${NAV_LEAGUE} .snp-win.up b { background: #00ceb8; }
    ${NAV_LEAGUE} .snp-win.warn { color: #f8d24b; } ${NAV_LEAGUE} .snp-win.warn b { background: #f8d24b; }
    ${NAV_LEAGUE} .snp-win.down { color: #ff5b6e; } ${NAV_LEAGUE} .snp-win.down b { background: #ff5b6e; }
    ${NAV_LEAGUE}[data-snp-chop] .team-name-container > :not(:first-child), ${NAV_LEAGUE}[data-snp-chop] .right-score { display: none; }
    ${NAV_LEAGUE} .snp-rank { flex: 1; } ${NAV_LEAGUE} .snp-chop-rank { text-align: right; font: 700 11px Inter, sans-serif; color: #fff; }
    ${NAV_LEAGUE} .snp-chop-rank.safe { color: #00ceb8; } ${NAV_LEAGUE} .snp-chop-rank.danger { color: #f8d24b; } ${NAV_LEAGUE} .snp-chop-rank.chop { color: #ff5b6e; }`;
  (document.head || document.documentElement).append(style);
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
    for (const { leagueId, sport, chopped } of bridge.ask('snp:nav-leagues') || []) {
      // The open NBA league's session always feeds it; a chopped one's only with the NFL tabs on.
      if (sport === 'nba' && leagueId !== active && due(leagues.get(leagueId), now)) load(leagueId);
      if (sport === 'nfl' && chopped && due(leagues.get(leagueId), now)) loadChopped(leagueId);
    }
    let shown = false;
    for (const link of document.querySelectorAll(`${NAV_LEAGUE}[data-snp-sport="nba"]`)) {
      const entry = leagues.get(link.dataset.snpLeague);
      const numbers = entry && numbersOf(entry.state?.(), now);
      if (numbers) entry.numbers = numbers;
      shown = place(link, entry?.numbers ? nbaNavView.render(entry.numbers) : '') || shown;
    }
    hide.set(shown);
    for (const link of document.querySelectorAll(`${NAV_LEAGUE}[data-snp-sport="nfl"]`)) {
      if (link.hasAttribute('data-snp-chopped')) drawChopped(link, now);
      else drawBar(link);
    }
  }

  // Sleeper's own NFL line: the win bar under it, from the points and projections on it.
  function drawBar(link) {
    const matchup = link.querySelector('.nav-league-matchup:not([data-snp])');
    const numbers = (side) => [...(matchup?.querySelectorAll(`.${side}-score .score, .${side}-score .projections`) || [])].map((el) => parseFloat(el.textContent));
    const [mine, mineProj] = numbers('left');
    const [theirs, theirsProj] = numbers('right');
    const has = matchup?.querySelector('.small-text.right')?.textContent.trim() && Number.isFinite(mineProj) && Number.isFinite(theirsProj);
    const [win] = has ? model.winProbability(Number.isFinite(mine) ? mine : 0, mineProj, Number.isFinite(theirs) ? theirs : 0, theirsProj) : [];
    putIn(matchup, has ? nbaNavView.winBar(win) : '');
  }

  // A chopped league's line: Sleeper draws your team and points, with an empty
  // opponent; ours puts your safe chance in the bar and your rank in its place.
  function drawChopped(link, now) {
    const entry = leagues.get(link.dataset.snpLeague);
    const numbers = entry && chopNumbersOf(entry.state?.(), now);
    if (numbers) entry.numbers = numbers;
    const c = entry?.numbers;
    const matchup = link.querySelector('.nav-league-matchup:not([data-snp])');
    const ok = Boolean(c && matchup);
    if (link.hasAttribute('data-snp-chop') !== ok) link.toggleAttribute('data-snp-chop', ok);
    putIn(matchup, ok ? nbaNavView.chopBar(c) : '');
    putIn(matchup?.querySelector('.score-container'), ok ? nbaNavView.chopRank(c) : '', 'snp-rank');
  }

  // Our element inside one of Sleeper's (its last HTML kept, so nothing is touched for nothing).
  function putIn(parent, html, cls = 'snp-bar') {
    let ours = parent?.querySelector(`:scope > [data-snp-win].${cls}`);
    if (!html) return ours?.remove();
    if (!ours) {
      ours = document.createElement('div');
      ours.className = cls;
      ours.dataset.snpWin = '';
      parent.append(ours);
    }
    if (drawn.get(ours) !== html) {
      ours.innerHTML = html;
      drawn.set(ours, html);
    }
  }

  // Whether a league needs loading: never loaded, a failed load long enough
  // ago, or numbers that games since have moved on.
  function due(entry, now) {
    if (!entry) return true;
    if (entry.loading || entry.own || document.visibilityState !== 'visible') return false;
    if (entry.failed) return now - entry.loadedAt > RETRY_MS;
    if (now - entry.loadedAt < STALE_MS) return false;
    const s = entry.state?.();
    return Object.values(s?.weeks?.[s.week]?.games || {}).some((g) => g.status !== 'complete' && g.start != null && g.start <= now);
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
      shared.report('warn', '[sleeper-nba-nav] matchup unavailable', err);
      if (!leagues.get(leagueId)?.own) leagues.set(leagueId, { ...entry, loading: false, failed: true, loadedAt: Date.now() });
    }
    attach(active);
  }

  // A chopped league's rank and safe chance this week (nflPanelView.chopBlockOf), or the week you were chopped; null without your team.
  function chopNumbersOf(s, now) {
    if (!s?.weeks?.[s.week]) return null;
    const state = { ...s, now };
    const mine = ui.myRoster(state);
    if (!mine) return null;
    if (mine.settings?.eliminated) return { out: mine.settings.eliminated };
    const block = nflPanelView.chopBlockOf(state);
    const t = block.find((x) => x.rosterId === mine.roster_id);
    return t ? { rank: t.rank, of: block.length, safe: t.safe, zone: t.zone } : null;
  }

  // A chopped league's week on now, as its NFL tabs load it (nflWeek.load).
  async function loadChopped(leagueId) {
    const entry = { ...leagues.get(leagueId), loading: true };
    leagues.set(leagueId, entry);
    try {
      const api = createApi(() => {});
      const data = loaders.leagueData(api, leagueId, 'sleeper-nav');
      const [league, nflState, users, rosters, me] = await Promise.all([
        api.get(`/v1/league/${leagueId}`),
        api.get('/v1/state/nfl'),
        api.get(`/v1/league/${leagueId}/users`),
        data.rosters(),
        data.me(),
      ]);
      const week = Number(nflState.display_week || nflState.week || 1);
      const loaded = await nflWeek.load(api, data, league, week, week, { research: false });
      const state = { league, usersById: loaders.usersById(users), rosters, players: loaded.players, me, week, currentWeek: week, weeks: { [week]: loaded.week } };
      if (!leagues.get(leagueId)?.own) leagues.set(leagueId, { state: () => state, loadedAt: Date.now() });
    } catch (err) {
      shared.report('warn', '[sleeper-nav] chopped league unavailable', err);
      if (!leagues.get(leagueId)?.own) leagues.set(leagueId, { ...entry, loading: false, failed: true, loadedAt: Date.now() });
    }
    attach(active);
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    for (const link of document.querySelectorAll(`${NAV_LEAGUE}[data-snp-nav]`)) place(link, '');
    for (const el of document.querySelectorAll(`${NAV_LEAGUE} [data-snp-win]`)) el.remove();
    for (const link of document.querySelectorAll(`${NAV_LEAGUE}[data-snp-chop]`)) link.removeAttribute('data-snp-chop');
    hide.remove();
    style.remove();
  }

  return { attach, feed, destroy };
};
