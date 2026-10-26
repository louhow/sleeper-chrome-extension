// NFL Team and Matchup tabs: the extension's own (panel-view.js draws them),
// in place of Sleeper's. Sleeper's own tab stays on the page, hidden (its Team
// component saves lineups and feeds Optimize); the ⇄ button shows it instead,
// remembered in the page's storage, and "⇄ Compact view" beside Sleeper's tab
// row comes back. Like the NBA tabs, Sleeper's tab is hidden as soon as the
// league is known to be NFL and ours stays blank until its first load is in,
// so nothing shifts.
//   ctx: { leagueId, api, league, info: { currentWeek, tiers }, lineup(full),
//   nflSave(detail), openDialog(), dialogOpen(), livePages (more pages whose
//   week reads live, e.g. a chopped league's League tab), onUpdate() (after
//   any change to the panel's data) }
(globalThis.SNP ||= {}).nflPanel = ({ leagueId, api, league, info, lineup, nflSave, openDialog, dialogOpen, livePages = [], onUpdate }) => {
  const { model, scoring, ui, nflPanelView, loaders, shared, bridge } = globalThis.SNP;
  const SLEEPER_VIEW = 'snp:nfl-sleeper-view';
  const BACK_ID = 'snp-nfl-back';
  const PAGES = new Set(['team', 'matchup']);
  // The NFL regular season and playoffs.
  const WEEKS = 18;
  // While a game is on, the week's stats and games are read again this often (tab visible).
  const LIVE_READ_MS = 90e3;
  const LEG_FIELDS = 'leg matchup_id roster_id round starters points proj_points custom_points';

  const state = {
    page: null, tab: 'page', now: Date.now(), league, usersById: null, rosters: null, me: null, rosterId: null,
    week: null, currentWeek: null, minWeek: league.settings?.start_week || 1, maxWeek: WEEKS,
    weeks: {}, players: {}, tiers: null, swap: null, saving: false, rosterMenu: false, ready: false, error: null,
    sessionExpired: false, editableWeek: null, optimizable: false, failedAvatars: new Set(), openCalls: new Set(), notice: null,
  };
  const data = loaders.leagueData(api, leagueId, 'sleeper-nfl');
  const panel = shared.shadowHost('sleeper-nfl-panel', schedule);
  const { host, root } = panel;
  const hide = shared.hideSleeper('nfl-tab', '.postdraft-panel > .scrollbar-container');
  const flash = shared.flasher(state, schedule);
  let sleeperView = shared.safeStore.get(SLEEPER_VIEW) === '1';
  let destroyed = false;
  let frame = 0;

  function fail(err) {
    if (destroyed) return;
    shared.report('error', '[sleeper-nfl]', err);
    state.error = String(err.message || err);
    state.ready = true;
    schedule();
  }

  function schedule() {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (destroyed) return;
      state.now = Date.now();
      state.sessionExpired = api.sessionExpired();
      state.tiers = info.tiers;
      onUpdate?.();
      if (!state.ready || !panel.styled || !host.isConnected) return;
      const top = root.querySelector('.body')?.scrollTop ?? 0;
      root.innerHTML = nflPanelView.render(state, api.log);
      const body = root.querySelector('.body');
      if (body) body.scrollTop = top;
    });
  }

  const shown = () => PAGES.has(state.page) && !sleeperView;

  // Ours goes in place of Sleeper's tab content.
  function attach() {
    hide.set(shown());
    const wrapper = shown() ? document.querySelector('.postdraft-panel > .scrollbar-container') : null;
    if (!wrapper) {
      host.remove();
      return attachBack();
    }
    if (host.previousElementSibling !== wrapper) {
      wrapper.after(host);
      schedule();
    }
    attachBack();
    if (!state.ready) return;
    // Optimize and swaps save through Sleeper's Team component, for the week it shows.
    const own = state.page === 'team' ? lineup(false) : null;
    const editableWeek = own?.editable ? own.round : null;
    if (editableWeek !== state.editableWeek || Boolean(own?.editable) !== state.optimizable) {
      state.editableWeek = editableWeek;
      state.optimizable = Boolean(own?.editable);
      schedule();
    }
  }

  // Sleeper's own tab, while it's shown, gets a way back to ours.
  function attachBack() {
    const tabs = sleeperView && PAGES.has(state.page) ? document.querySelector('.postdraft-panel > .center-tab-selector') : null;
    const el = document.getElementById(BACK_ID);
    if (!tabs) return el?.remove();
    if (el && el.parentElement === tabs) return;
    const button = el || Object.assign(document.createElement('button'), {
      id: BACK_ID,
      type: 'button',
      textContent: '⇄ Compact view',
      title: 'Back to the extension\'s compact view',
    });
    button.style.cssText = 'margin-left:auto;align-self:center;height:28px;padding:0 12px;border:1px solid rgba(255,255,255,.2);border-radius:14px;background:none;color:#b9c4d4;font:700 12px Poppins,sans-serif;cursor:pointer';
    button.onclick = () => setSleeperView(false);
    tabs.append(button);
  }

  function setSleeperView(on) {
    sleeperView = on;
    if (on) shared.safeStore.set(SLEEPER_VIEW, '1');
    else shared.safeStore.remove(SLEEPER_VIEW);
    attach();
  }

  async function load(force = false) {
    const rosterKey = `roster:${leagueId}`;
    const [users, rosters, me, prefs] = await Promise.all([
      api.get(`/v1/league/${leagueId}/users`),
      data.rosters(),
      data.me(),
      chrome.storage.local.get(rosterKey),
    ]);
    if (destroyed) return;
    // The team picked last time, else yours, as on the NBA tabs.
    const saved = rosters.find((r) => r.roster_id === prefs[rosterKey]);
    Object.assign(state, {
      usersById: loaders.usersById(users),
      rosters,
      me,
      rosterId: state.rosterId ?? (saved || loaders.myRoster(rosters, me) || rosters[0])?.roster_id ?? null,
      currentWeek: info.currentWeek,
    });
    if (force) state.weeks = {};
    state.week ??= info.currentWeek;
    await loadWeek(state.week);
    state.ready = true;
    attach();
    schedule();
  }

  // A week: who's starting (the logged-in legs, else the public matchups),
  // Sleeper's projections and stats scored with the league's settings, each
  // team's game, and rostered and started percentages. Players' names,
  // positions, teams and injuries come with the projection and stat rows.
  async function loadWeek(week, force = false) {
    if (state.weeks[week] && !force) return;
    const season = league.season;
    const type = league.settings?.type ?? 0;
    const [matchups, projRows, statRows, scores, research, legs] = await Promise.all([
      api.get(`/v1/league/${leagueId}/matchups/${week}`),
      api.get(`/projections/nfl/${season}/${week}?season_type=regular`),
      week <= info.currentWeek ? api.get(`/stats/nfl/${season}/${week}?season_type=regular`) : [],
      api.graphql(`scores (week ${week})`, loaders.scoresQuery('nfl', 'regular', season, week, 'game_id metadata status start_time'))
        .then((d) => d?.scores || []).catch(() => []),
      api.get(`/players/nfl/research/regular/${season}/${week}?league_type=${type}`).catch(() => ({})),
      data.legs(week, LEG_FIELDS),
    ]);
    if (destroyed) return;
    const { players, teamOf, proj, actual, stats } = model.nflWeekPoints(projRows || [], statRows || [], league.scoring_settings || {}, scoring.scoreStats);
    for (const [id, p] of Object.entries(players)) state.players[id] ??= p;
    const { games, days } = model.nflGames(scores);
    state.weeks[week] = { matchups: matchups || [], legs, teamOf, proj, actual, stats, games, days, research: research || {} };
    planLiveRead();
    schedule();
  }

  // While a game of the week shown is on, its stats and games are read again;
  // otherwise once the next kickoff comes. Only while the tab is visible.
  let liveTimer = null;
  let lastLiveRead = Date.now();
  function planLiveRead() {
    clearTimeout(liveTimer);
    const week = state.weeks[state.week];
    if (!week || state.week !== info.currentWeek || destroyed) return;
    const now = Date.now();
    const at = model.nextLiveRead(Object.values(week.games), now, LIVE_READ_MS);
    if (at == null) return;
    liveTimer = setTimeout(liveRead, Math.max(LIVE_READ_MS / 3, at - now));
  }
  function liveRead() {
    if (destroyed) return;
    if (document.visibilityState !== 'visible' || !(PAGES.has(state.page) || livePages.includes(state.page))) return planLiveRead();
    lastLiveRead = Date.now();
    loadWeek(state.week, true).catch(() => planLiveRead());
  }
  function onVisible() {
    if (document.visibilityState === 'visible' && state.ready && Date.now() - lastLiveRead > LIVE_READ_MS) liveRead();
  }
  document.addEventListener('visibilitychange', onVisible);

  // Whatever saved the lineup (a swap here or Optimize), Sleeper's own numbers follow.
  const stopSaved = bridge.on('snp:nfl-lineup-save', (result) => {
    if (result?.ok && state.ready) setTimeout(() => loadWeek(state.week, true).catch(() => {}), 1500);
  });

  function setWeek(week) {
    if (week < state.minWeek || week > state.maxWeek || state.saving) return;
    state.week = week;
    state.swap = null;
    schedule();
    loadWeek(week).catch(fail);
  }

  // The team shown. Picked from the team picker, it's kept for next time;
  // followed from a link or the arrow keys, it's just for now.
  function setRoster(rosterId, { remember = false } = {}) {
    state.rosterMenu = false;
    state.swap = null;
    if (remember) chrome.storage.local.set({ [`roster:${leagueId}`]: rosterId });
    if (rosterId === state.rosterId) return schedule();
    state.rosterId = rosterId;
    schedule();
  }

  // A team on the Matchup tab opens on the Team tab, through Sleeper's own tab (so its router follows).
  function openTeam(rosterId) {
    setRoster(rosterId);
    state.tab = 'page';
    shared.openSleeperTab('team');
  }

  // A swap on your own Team tab: tap a slot badge, then one of the spots it
  // can trade places with. Saved through Sleeper's Team component.
  function pickSpot(ref) {
    const l = nflPanelView.lineup(state);
    if (!l?.editable || state.saving) return;
    if (!state.swap) {
      state.swap = ref;
      return schedule();
    }
    if (state.swap === ref) {
      state.swap = null;
      return schedule();
    }
    const ml = nflPanelView.moveLineup(state, l);
    if (!nflPanelView.targetsOf(state.swap, ml).includes(ref)) {
      state.swap = ref;
      return schedule();
    }
    const { starters } = model.applyMove(state.swap, ref, ml);
    const moves = model.describeMove({ ...ml, starters: l.starters }, { ...ml, starters });
    state.swap = null;
    saveStarters(l, starters, `Saved: ${shared.movedText(moves, (id) => ui.playerName(state.players, id))}`);
  }

  async function saveStarters(l, starters, okText) {
    state.saving = true;
    state.notice = null;
    schedule();
    const result = await nflSave({ rosterId: l.roster.roster_id, round: state.week, starters });
    if (destroyed) return;
    state.saving = false;
    if (result.ok) {
      setStarters(l.roster.roster_id, starters);
      flash(okText);
    } else {
      flash(result.error, 'error');
    }
  }

  // A saved lineup shows at once (the public matchups lag minutes behind it).
  function setStarters(rosterId, starters) {
    const week = state.weeks[state.week];
    if (!week) return;
    for (const list of [week.legs || [], week.matchups]) {
      const entry = list.find((m) => m.roster_id === rosterId);
      if (entry) entry.starters = [...starters];
    }
  }

  root.addEventListener('click', (e) => {
    // The team picker's menu closes on any click outside it.
    if (state.rosterMenu && !e.target.closest('.team-pick')) state.rosterMenu = false;
    const tab = e.target.closest('[data-tab]')?.dataset.tab;
    if (tab) {
      state.tab = tab;
      return schedule();
    }
    const pick = e.target.closest('[data-pick-roster]');
    if (pick) return setRoster(Number(pick.dataset.pickRoster), { remember: true });
    const team = e.target.closest('[data-open-team]');
    if (team) return openTeam(Number(team.dataset.openTeam));
    // A player's name or headshot opens Sleeper's own player card.
    const player = e.target.closest('[data-player]')?.dataset.player;
    if (player) return shared.nflPlayerCard(player, state.players[player]);
    const spot = e.target.closest('[data-spot]')?.dataset.spot;
    if (spot) return pickSpot(spot);
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'roster-menu') state.rosterMenu = !state.rosterMenu;
    if (action === 'prev') return setWeek(state.week - 1);
    if (action === 'next') return setWeek(state.week + 1);
    if (action === 'optimize') {
      // The dialog covers the tab, so a notice still showing goes with it.
      state.notice = null;
      return openDialog();
    }
    if (action === 'refresh') return load(true).catch(fail);
    if (action === 'sleeper-view') setSleeperView(true);
    schedule();
  });
  shared.activateOnKey(root, '[data-open-team]', (el) => openTeam(Number(el.dataset.openTeam)));
  shared.markMissingImages(root, state, schedule);

  // Like the NBA picker, the menu closes on a click anywhere else on the page.
  function onOutsideClick(e) {
    if (!state.rosterMenu || e.composedPath().includes(host)) return;
    state.rosterMenu = false;
    schedule();
  }
  document.addEventListener('click', onOutsideClick, true);

  function onKey(e) {
    if (!host.isConnected || dialogOpen()) return;
    if (e.key === 'Escape' && (state.swap || state.rosterMenu)) {
      state.swap = null;
      state.rosterMenu = false;
      return schedule();
    }
    const step = shared.arrowStep(e);
    if (!step || state.tab !== 'page' || !state.rosters?.length) return;
    const next = model.nextTeam(shared.teamOrder(state), state.rosterId, step);
    if (next == null) return;
    e.preventDefault();
    setRoster(next);
  }
  document.addEventListener('keydown', onKey);

  function show(page) {
    if (state.page !== page) {
      state.swap = null;
      state.rosterMenu = false;
      schedule();
    }
    state.page = page;
  }

  function destroy() {
    destroyed = true;
    stopSaved();
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutsideClick, true);
    clearTimeout(liveTimer);
    cancelAnimationFrame(frame);
    host.remove();
    hide.remove();
    document.getElementById(BACK_ID)?.remove();
  }

  // Shows a save notice here when the tab is on screen; says whether it did.
  function notify(text) {
    if (!host.isConnected || !state.ready) return false;
    flash(text);
    return true;
  }

  // The panel's data as views read it, showing `week` (loaded on first ask):
  // null until it's in.
  function weekView(week) {
    if (!state.ready || state.error) return null;
    if (!state.weeks[week]) {
      if (!pendingWeeks.has(week)) {
        pendingWeeks.add(week);
        loadWeek(week).catch(fail).finally(() => pendingWeeks.delete(week));
      }
      return null;
    }
    return { ...state, week };
  }
  const pendingWeeks = new Set();

  return { load: () => load().catch(fail), fail, attach, show, notify, refresh: schedule, destroy, weekView, openTeam };
};
