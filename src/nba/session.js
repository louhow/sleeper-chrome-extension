// An NBA league's session, one per league and kept across its tabs (content.js
// starts it). Fills Sleeper's empty NBA Team and Matchup tabs
// (sleeper.com/leagues/<id>/team and /matchup) with rosters, schedules,
// projections, lineup swaps and Lock-In, and puts the week's matchups on its
// League tab. Falls back to a floating panel when the page has no placeholder
// to fill. On every page of the league it also answers Sleeper's waiver and add
// buttons (see page-hook.js) with a bid dialog. Every league starts here, since
// its sport is known only once it loads: an NFL league hands over to
// nfl/session.js, any other sport stays hidden.
// It gives the sidebar (nav.js) its numbers for the week on now.
//   nbaSession(leagueId, page, { admin, nav, settings }) -> { leagueId, attach, show, destroy, setAdmin }
(globalThis.SNP ||= {}).nbaSession = (leagueId, page, { admin, nav = null, settings = null }) => {
  const { createApi, model, scoring, ui, bridge, shared, loaders,
    nbaWeek, nbaPanelView, nbaCardView, nbaOptimizeView, nbaWaiversView, nbaWhatIfView, nbaCard, nbaWaivers, nbaOptimize, nbaPlayers } = globalThis.SNP;
  const PANEL_PAGES = new Set(['team', 'matchup', 'league']);
  const FLOAT_AFTER_MS = 4000;
  const CLOCK_MS = 60e3;
  // Lock-In needs who was starting at each tip-off, and Sleeper keeps no lineup
  // history, so your leg is read once a few minutes after each tip-off time of
  // your players' games (while the tab is visible, or when it comes back during
  // the game): Sleeper won't move a player whose game is on, so that read settles it.
  const AFTER_TIP_MS = 5 * 60e3;
  // Never read the legs more often than this, whatever asks.
  const LEG_READ_GAP_MS = 60e3;
  // While a game of the current week is on, its stats, projections and games
  // are read again this often (tab visible, on a panel tab), as on NFL.
  const LIVE_READ_MS = 90e3;

  const panel = shared.shadowHost('sleeper-nba-panel', schedule);
  const { host, root } = panel;
  // Dialogs and Players-tab notices live in their own host over the whole page.
  const layer = shared.shadowHost('sleeper-nba-dialog', schedule);
  // What-if scoring sits in the page's top-right corner, over dialogs too.
  const corner = shared.shadowHost('sleeper-nba-scoring', schedule);
  // Sleeper's "not yet available" placeholder, hidden while the panel fills its spot.
  const hide = shared.hideSleeper('nba-placeholder', '.postdraft-panel > :has(.empty-panel-container)');
  let mountedAt = Date.now();

  const state = {
    leagueId,
    page: PANEL_PAGES.has(page) ? page : 'team', // panel view: 'team' | 'matchup' | 'league'
    onPanel: PANEL_PAGES.has(page), // whether the URL is a tab the panel fills
    tab: 'page', // 'page' | 'api'
    now: Date.now(),
    today: new Date().toLocaleDateString('en-CA'), // kept in step with `now`
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
    openCalls: new Set(),
    failedAvatars: new Set(), // avatar URLs the CDN doesn't have, drawn as the plain circle
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
    tiers: null, // score colors from the league's own games (see model.scoreTiers)
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
  let disabled = false;
  let frame = 0;
  const api = createApi(schedule);
  const data = loaders.leagueData(api, leagueId, 'sleeper-nba-panel');
  const flash = shared.flasher(state, schedule);
  const reloadRosters = async () => {
    state.rosters = await data.rosters();
  };
  const ctx = { state, api, leagueId, schedule, modalSave, saveStarters, saveLeg, reloadRosters };
  const playerCard = nbaCard(ctx);
  const waivers = nbaWaivers(ctx);
  const optimizer = nbaOptimize(ctx);
  const playersTab = nbaPlayers(ctx);

  function attach() {
    nflSession?.attach();
    hide.set(!destroyed && !disabled && state.onPanel && state.page !== 'league');
    if (destroyed || disabled) return;
    if (!state.onPanel) return detach();
    // The League tab: on top of Sleeper's own content, which stays.
    if (state.page === 'league') {
      const container = document.querySelector('.league-tab-container');
      // Not there (yet): out of the way.
      if (!container) return detach();
      if (container.firstElementChild !== host) {
        host.classList.remove('floating');
        host.classList.add('on-league');
        container.prepend(host);
      }
      return;
    }
    host.classList.remove('on-league');
    const placeholder = document.querySelector('.postdraft-panel .empty-panel-container');
    const wrapper = placeholder && [...placeholder.closest('.postdraft-panel').children].find((c) => c.contains(placeholder));
    if (wrapper) {
      if (host.previousElementSibling !== wrapper) {
        host.classList.remove('floating');
        wrapper.after(host);
      }
    } else if (!host.isConnected && Date.now() - mountedAt > FLOAT_AFTER_MS) {
      host.classList.add('floating');
      document.documentElement.appendChild(host);
    }
  }

  function detach() {
    host.remove();
    mountedAt = Date.now();
  }

  function schedule() {
    // An NFL league's calls show in its own panel's API tab.
    if (nflSession) return nflSession.refresh();
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (destroyed || !(panel.styled && layer.styled && corner.styled)) return;
      state.now = Date.now();
      state.today = new Date(state.now).toLocaleDateString('en-CA');
      state.sessionExpired = api.sessionExpired();
      renderLayer();
      renderCorner();
      // Blank until everything for the first paint is in, like Sleeper's own tabs.
      if (!(state.ready || state.error || state.sessionExpired)) return;
      const scrollTop = root.querySelector('.body')?.scrollTop ?? 0;
      root.innerHTML = nbaPanelView.render(state, api.log);
      const body = root.querySelector('.body');
      if (body) body.scrollTop = scrollTop;
    });
  }

  // The open dialog, plus save notices when there's no panel (or it's covered by the dialog).
  function renderLayer() {
    const showNotice = Boolean(state.notice) && (!state.onPanel || state.modal);
    if (!state.modal && !showNotice) return layer.host.remove();
    if (!layer.host.isConnected) document.documentElement.appendChild(layer.host);
    const into = layer.root;
    // Scrolled areas keep their place across re-renders.
    const scrolls = [...into.querySelectorAll('.dialog-body, [data-scroll]')].map((el) => [el.dataset.scroll || 'dialog', el.scrollTop]);
    const focused = layer.shadow.activeElement?.matches?.('[data-bid]');
    const kind = state.modal?.kind;
    const dialog = kind === 'player' ? nbaCardView.render(state) : kind === 'optimize' ? nbaOptimizeView.render(state) : nbaWaiversView.render(state);
    // A player card opened from the optimize dialog sits on top of it.
    const under = state.modal?.back?.kind === 'optimize' ? nbaOptimizeView.render(state, state.modal.back) : '';
    into.innerHTML = `<div class="page-layer${ui.whatIfOn(state) ? ' whatif' : ''}">${under}${dialog}${showNotice ? ui.notice(state) : ''}</div>`;
    for (const [key, top] of scrolls) {
      const el = key === 'dialog' ? into.querySelector('.dialog-body') : into.querySelector(`[data-scroll="${key}"]`);
      if (el) el.scrollTop = top;
    }
    const input = into.querySelector('[data-bid]');
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
      return corner.host.remove();
    }
    if (!corner.host.isConnected) document.documentElement.appendChild(corner.host);
    const next = document.createElement('div');
    next.innerHTML = nbaWhatIfView.render(state);
    morph(corner.root, next, corner.shadow.activeElement);
  }

  // Makes `from` match `to`, keeping nodes that are already right. Children
  // pair up by position; an input keeps whatever is being typed into it.
  function morph(from, to, focused) {
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
        if (old !== focused && old.value !== node.value) old.value = node.value;
        return;
      }
      morph(old, node, focused);
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
  // for each player's difference from the league's scoring ('snp:admin-scores').
  function sendAdminScoring() {
    bridge.tell('snp:admin-scoring', { leagueId, enabled: state.whatIf.enabled, changed: Object.keys(state.whatIf.overrides).length > 0 });
  }

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
    shared.report('error', '[sleeper-nba-panel]', err);
    state.error = String(err.message || err);
    schedule();
  }

  async function loadLeague(force = false) {
    state.error = null;
    const league = await api.get(`/v1/league/${leagueId}`);
    // Tells page-hook.js which sport this is, so it only waits on NBA tables.
    // src/epl/content.js waits on it too (any sport), so it's set in the same task as the teardown below.
    if (!destroyed) document.documentElement.dataset.snpLeagueSport = `${leagueId}:${league.sport}`;
    if (league.sport !== 'nba') {
      disabled = true;
      teardown();
      await settings?.ready;
      // The NFL pages are the extension's unless the settings turned them off.
      if (league.sport === 'nfl' && !destroyed && (settings?.values().nflUi ?? true)) nflSession = globalThis.SNP.nflSession(leagueId, lastPage, api, league, nav);
      else console.info('[sleeper-nba-panel] not an NBA league, staying hidden');
      return;
    }
    // Tells page-hook.js to route this league's waiver and add buttons here.
    document.documentElement.dataset.snpNbaLeague = leagueId;
    // And to add its columns to this league's Players tab.
    document.documentElement.dataset.snpPlayersLeague = leagueId;
    const rosterKey = `roster:${leagueId}`;
    const whatIfKey = `whatif:${leagueId}`;
    const [nbaState, users, rosters, bracket, traded, drafts, players, prefs, me] = await Promise.all([
      api.get('/v1/state/nba'),
      api.get(`/v1/league/${leagueId}/users`),
      data.rosters(),
      api.get(`/v1/league/${leagueId}/winners_bracket`),
      api.get(`/v1/league/${leagueId}/traded_picks`),
      api.get(`/v1/league/${leagueId}/drafts`),
      nbaWeek.players(api, force),
      chrome.storage.local.get([rosterKey, whatIfKey]),
      data.me(),
    ]);
    const savedRoster = rosters.find((r) => r.roster_id === prefs[rosterKey]);
    // Saved what-if values that now match the league's (it changed its scoring) drop out.
    const savedWhatIf = prefs[whatIfKey] || {};
    Object.assign(state.whatIf, {
      overrides: scoring.changedOnly(league.scoring_settings || {}, savedWhatIf.overrides || {}),
      on: Boolean(savedWhatIf.on),
      drafts: {},
    });
    Object.assign(state, {
      league,
      usersById: loaders.usersById(users),
      rosters,
      players,
      me,
      rosterId: (savedRoster || loaders.myRoster(rosters, me) || rosters[0])?.roster_id ?? null,
      minWeek: league.settings?.start_week || 1,
      maxWeek: model.lastWeek(league, bracket || []),
      pickContext: { traded: traded || [], seasons: model.pickSeasons(league, drafts || []) },
      weeks: {},
    });
    updatePicks();
    state.currentWeek = nbaWeek.currentWeek(league, nbaState, state.maxWeek);
    state.seasonType = nbaState.season_type;
    if (state.week == null) state.week = state.currentWeek;
    // Lineups recorded for earlier weeks are no longer needed.
    const oldWeeks = Array.from({ length: Math.max(0, state.currentWeek - state.minWeek) }, (_, i) => `lineups:${leagueId}:${state.minWeek + i}`);
    if (oldWeeks.length) chrome.storage.local.remove(oldWeeks);
    const tiers = loaders.loadTiers(api, league, state.currentWeek).catch((err) => {
      shared.report('warn', '[sleeper-nba-panel] score colors unavailable', err);
      return null;
    });
    await loadWeek(state.week);
    state.tiers = await tiers;
    if (state.currentWeek !== state.week) loadWeek(state.currentWeek).catch(fail);
    state.ready = true;
    // The sidebar's line for this league, in step with the panel (but never in what-if scoring).
    nav?.feed(leagueId, () => (ui.whatIfOn(state) ? null : { ...state, week: state.currentWeek }));
    sendAdminScoring();
    // The Players tab's columns can go in now (page-hook.js).
    bridge.tell('snp:players-ready', { leagueId });
    schedule();
    waivers.load();
    playerCard.ready();
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
    const standingsQuery = `query roster_standings {
roster_standings(league_id: ${JSON.stringify(leagueId)}, round: ${Number(week)}) { roster_id rank }
}`;
    // Only the current week's lineups matter for Lock-In.
    const historyKey = week === state.currentWeek ? `lineups:${leagueId}:${week}` : null;
    const [core, research, legs, standings, stored] = await Promise.all([
      nbaWeek.load(api, league, week, ui.scoringOf(state)),
      api.get(`/players/nba/research/${league.season_type || 'regular'}/${league.season}/${week}?league_type=${league.settings?.type ?? 0}`),
      loadLegs(week),
      api.graphql(`roster_standings (week ${week})`, standingsQuery)
        .then((res) => res?.roster_standings ?? [])
        .catch(() => []),
      historyKey ? chrome.storage.local.get(historyKey) : {},
    ]);
    if (historyKey) state.lineupHistory[week] = stored[historyKey] || {};
    state.weeks[week] = {
      ...core,
      research: research || {},
      legs,
      ranks: model.standingsRanks(state.rosters, standings),
    };
    seeLineups(week, legs);
    if (week === state.currentWeek) {
      planTipReads();
      planLiveRead();
    }
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

  // Lineups, Lock-In picks (starters_games) and server projections for a week
  // (null when logged out or refused).
  let lastLegRead = 0;
  function loadLegs(week) {
    if (api.loggedIn()) lastLegRead = Date.now();
    return data.legs(week, nbaWeek.LEG_FIELDS);
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
    if (document.visibilityState !== 'visible') return;
    // A game on (or over) since the last read while the tab was hidden.
    const games = state.weeks[state.currentWeek]?.games || [];
    if (Date.now() - lastLiveRead > LIVE_READ_MS && games.some((g) => model.gameState(g, Date.now()) === 'live')) liveRead();
    if (missedTip == null) return;
    if (Date.now() < missedTip + model.FROZEN_MS) readLegs().catch(() => {});
    missedTip = null;
  }

  // The current week's points as games go: read again while one is on
  // (model.nextLiveRead), else a minute after the next tip-off.
  let liveTimer = null;
  let lastLiveRead = Date.now();
  function planLiveRead() {
    clearTimeout(liveTimer);
    const week = state.weeks[state.currentWeek];
    if (!week || destroyed || disabled) return;
    const now = Date.now();
    const at = model.nextLiveRead(week.games, now, LIVE_READ_MS);
    if (at != null) liveTimer = setTimeout(liveRead, Math.max(LIVE_READ_MS / 3, at - now));
  }
  async function liveRead() {
    if (destroyed || disabled) return;
    if (document.visibilityState !== 'visible' || !state.onPanel) return planLiveRead();
    lastLiveRead = Date.now();
    const week = state.currentWeek;
    try {
      const core = await nbaWeek.load(api, state.league, week, ui.scoringOf(state));
      if (state.weeks[week]) Object.assign(state.weeks[week], core);
    } catch (err) {
      shared.report('warn', '[sleeper-nba-panel] live read failed', err);
    }
    planLiveRead();
    schedule();
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

  // Saves a lineup the way Sleeper's web app does: on the week's matchup leg
  // during the season (model.lineupOnLeg), else on the roster itself.
  async function saveStarters(starters) {
    const { league, rosterId } = state;
    if (model.lineupOnLeg(league)) return saveLeg('update_matchup_leg', rosterId, starters);
    const res = await api.graphql('roster_update_starters', `mutation roster_update_starters {
roster_update_starters(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, starters: ${JSON.stringify(starters)}) {
  roster_id starters players reserve taxi
}
}`, { auth: true });
    Object.assign(state.rosters.find((r) => r.roster_id === rosterId), res.roster_update_starters);
  }

  // Saves a roster's taxi squad or IR (`field`: 'taxi' or 'reserve').
  async function saveRosterList(field, rosterId, list) {
    const name = `roster_update_${field}`;
    const res = await api.graphql(name, `mutation ${name} {
${name}(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, ${field}: ${JSON.stringify(list)}) {
  roster_id starters players reserve taxi
}
}`, { auth: true });
    Object.assign(state.rosters.find((r) => r.roster_id === rosterId), res[name]);
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
    const moved = shared.movedText(model.describeMove(lineup, next), (id) => ui.shortName(ui.playerOf(state.players, id)));
    state.swap = null;
    return save(async () => {
      if (taxiChanged) await saveRosterList('taxi', lineup.roster.roster_id, next.taxi);
      if (reserveChanged && !same(benched, lineup.starters)) await saveStarters(benched);
      if (reserveChanged) await saveRosterList('reserve', lineup.roster.roster_id, next.reserve);
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
    // A game whose start the extension didn't see can still be locked; the cell said so.
    const st = model.lockCheck(lineup, playerId, player?.team, Date.now());
    if (st.error) {
      state.notice = { kind: 'error', text: st.error };
      return schedule();
    }
    const locks = { ...lineup.locks, [playerId]: st.current.game.id };
    const name = ui.playerName(state.players, playerId);
    return save(
      () => saveLeg('lock_in', rosterId, lineup.starters, locks),
      `Locked ${name}: ${ui.f2(st.current.actual ?? 0)}`,
      `Couldn't lock ${name}`,
    );
  }

  // The team shown. Picked from the team picker (or "My team"), it's kept for
  // next time; followed from a link or the arrow keys, it's just for now.
  function setRoster(rosterId, { remember = false } = {}) {
    state.rosterMenu = false;
    if (remember) chrome.storage.local.set({ [`roster:${leagueId}`]: rosterId });
    if (rosterId === state.rosterId) return schedule();
    state.rosterId = rosterId;
    state.swap = null;
    state.lockConfirm = null;
    state.notice = null;
    updatePicks();
    schedule();
  }

  // A team on the Team or Matchup tab, through Sleeper's own tab (so its router follows).
  function openRoster(rosterId, page) {
    setRoster(rosterId);
    state.tab = 'page';
    if (state.page !== page) shared.openSleeperTab(page);
    schedule();
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
    // The team picker's menu closes on any click outside it.
    if (state.rosterMenu && !e.target.closest('.team-pick')) {
      state.rosterMenu = false;
      schedule();
    }
    const pick = e.target.closest('[data-pick-roster]');
    if (pick) return setRoster(Number(pick.dataset.pickRoster), { remember: true });
    if (e.target.closest('[data-action="roster-menu"]')) {
      state.rosterMenu = !state.rosterMenu;
      return schedule();
    }
    // A team's avatar, owner or name opens it on the Team tab; the rest of a
    // League tab matchup opens it on the Matchup tab.
    const team = e.target.closest('[data-open-team]');
    if (team) return openRoster(Number(team.dataset.openTeam), 'team');
    const match = e.target.closest('[data-open-matchup]');
    if (match) return openRoster(Number(match.dataset.openMatchup), 'matchup');
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      return schedule();
    }
    const spot = e.target.closest('[data-spot]');
    if (spot) return pickSpot(spot.dataset.spot);
    const player = e.target.closest('[data-player]');
    if (player) return playerCard.open(player.dataset.player);
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
    if (action === 'claims') waivers.openList();
    if (action === 'optimize') optimizer.open();
    if (action === 'whatif-off') setWhatIf({ on: false });
  });
  // Links and the League tab's matchup boxes work from the keyboard too.
  shared.activateOnKey(root, '[data-open-team], [data-open-matchup]');
  // <details> toggle doesn't bubble, so listen in the capture phase.
  root.addEventListener('toggle', (e) => {
    const id = Number(e.target.dataset?.call);
    // Rendering a <details open> fires toggle too; only re-render on a real change.
    if (!id || e.target.open === state.openCalls.has(id)) return;
    if (e.target.open) state.openCalls.add(id);
    else state.openCalls.delete(id);
    schedule();
  }, true);
  shared.markMissingImages(root, state, schedule);

  layer.root.addEventListener('click', (e) => {
    if (waivers.click(e.target, layer.root) || optimizer.click(e.target)) return;
    const player = e.target.closest('[data-player]');
    if (player && state.modal?.kind === 'optimize' && !state.modal.saving) return playerCard.open(player.dataset.player, state.modal);
    const season = e.target.closest('[data-card-season]');
    if (season && state.modal?.kind === 'player') return playerCard.showSeason(Number(season.dataset.cardSeason));
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'close-modal') closeModal();
    if (action === 'submit-claim') waivers.submit();
    if (action === 'whatif-off') setWhatIf({ on: false });
  });
  layer.root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-op-ack]') || state.modal?.kind !== 'optimize') return;
    state.modal.ack = e.target.checked;
    schedule();
  });
  layer.root.addEventListener('input', (e) => {
    // Kept without a re-render so typing never loses focus.
    if (e.target.matches('[data-bid]') && state.modal) state.modal.bid = e.target.value;
  });
  layer.root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-bid]')) waivers.submit();
  });
  shared.markMissingImages(layer.root, state, schedule);

  corner.root.addEventListener('click', (e) => {
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
  corner.root.addEventListener('input', (e) => {
    const key = e.target.dataset.wiKey;
    if (!key) return;
    const w = state.whatIf;
    w.drafts[key] = e.target.value;
    // A stat the league doesn't score stays listed while it's edited, even once it's back to 0.
    if (!state.league.scoring_settings?.[key]) w.showAll = true;
    const value = nbaWhatIfView.parse(e.target.value);
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
  corner.root.addEventListener('change', (e) => settle(e.target));
  corner.root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset.wiKey) settle(e.target);
  });

  // The team picker's menu and, like a tooltip, the what-if editor close on a click anywhere else.
  function onOutsideClick(e) {
    if (state.rosterMenu && !e.composedPath().includes(host)) {
      state.rosterMenu = false;
      schedule();
    }
    if (!state.whatIf.open || e.composedPath().includes(corner.host)) return;
    state.whatIf.open = false;
    schedule();
  }

  function onKey(e) {
    if (e.key === 'Escape' && state.whatIf.open) {
      state.whatIf.open = false;
      return schedule();
    }
    if (e.key === 'Escape' && state.modal) return closeModal();
    if (e.key === 'Escape' && state.rosterMenu) {
      state.rosterMenu = false;
      return schedule();
    }
    // Arrow up and down go through every team, yours too, in the picker's
    // order (A to Z), stopping at the first and the last.
    const step = shared.arrowStep(e);
    if (step) {
      if (state.modal || !state.onPanel || (state.page !== 'team' && state.page !== 'matchup') || state.tab !== 'page' || !state.rosters?.length) return;
      const next = model.nextTeam(shared.teamOrder(state), state.rosterId, step);
      if (next == null) return;
      e.preventDefault();
      return setRoster(next);
    }
    if (e.key === 'Escape' && (state.swap || state.lockConfirm)) {
      state.swap = null;
      state.lockConfirm = null;
      schedule();
    }
  }

  // Lock windows and game states move with the clock.
  const clock = setInterval(schedule, CLOCK_MS);
  const stops = [
    shared.listen(document, 'visibilitychange', onVisible),
    shared.listen(document, 'keydown', onKey),
    shared.listen(document, 'click', onOutsideClick, true),
    // Sleeper's W and ADD buttons, and player rows on its Players and Trend tabs (page-hook.js).
    bridge.on('snp:player-action', (x) => waivers.openBid(x)),
    bridge.on('snp:player-card', (x) => playerCard.open(x.playerId)),
    playersTab.destroy,
  ];

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
    clearTimeout(liveTimer);
    stops.forEach((stop) => stop());
    if (document.documentElement.dataset.snpNbaLeague === leagueId) delete document.documentElement.dataset.snpNbaLeague;
    if (document.documentElement.dataset.snpPlayersLeague === leagueId) delete document.documentElement.dataset.snpPlayersLeague;
    cancelAnimationFrame(frame);
    host.remove();
    layer.host.remove();
    corner.host.remove();
    hide.remove();
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

  return { leagueId, api, attach, show, destroy, setAdmin: setAdminTools };
};
