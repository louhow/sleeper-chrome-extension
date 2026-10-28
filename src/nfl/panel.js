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
  const { model, ui, nflPanelView, nflWeek, loaders, shared, bridge } = globalThis.SNP;
  const SLEEPER_VIEW = 'snp:nfl-sleeper-view';
  const BACK_ID = 'snp-nfl-back';
  const PAGES = new Set(['team', 'matchup']);
  // The NFL regular season and playoffs.
  const WEEKS = 18;
  // While a game is on, the week's stats and games are read again this often (tab visible).
  const LIVE_READ_MS = 90e3;

  const state = {
    page: null, tab: 'page', now: Date.now(), league, usersById: null, rosters: null, me: null, rosterId: null,
    week: null, currentWeek: null, minWeek: league.settings?.start_week || 1, maxWeek: WEEKS,
    weeks: {}, players: {}, tiers: null, swap: null, autosub: null, saving: false, rosterMenu: false, ready: false, error: null,
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

  // A week, as nflWeek.load reads it; players met in it join the panel's.
  async function loadWeek(week, force = false) {
    if (state.weeks[week] && !force) return;
    const loaded = await nflWeek.load(api, data, league, week, info.currentWeek);
    if (destroyed) return;
    for (const [id, p] of Object.entries(loaded.players)) state.players[id] ??= p;
    state.weeks[week] = loaded.week;
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
    state.autosub = null;
    schedule();
    loadWeek(week).catch(fail);
  }

  // The team shown. Picked from the team picker, it's kept for next time;
  // followed from a link or the arrow keys, it's just for now.
  function setRoster(rosterId, { remember = false } = {}) {
    state.rosterMenu = false;
    state.swap = null;
    state.autosub = null;
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
    state.autosub = null;
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
    const next = model.applyMove(state.swap, ref, ml);
    const moves = model.describeMove(ml, next);
    state.swap = null;
    saveMove(l, next, `Saved: ${shared.movedText(moves, (id) => ui.playerName(state.players, id))}`);
  }

  // Saves a move's starters and IR. As in Sleeper's apps, no save ever has a player both
  // starting and on IR: starters going to IR leave the lineup, then IR saves, then the final lineup.
  async function saveMove(l, next, okText) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const reserveChanged = !same(next.reserve, l.reserve);
    const toReserve = new Set(next.reserve.filter((id) => !l.reserve.includes(id)));
    const benched = l.starters.map((id) => (toReserve.has(id) ? '0' : id));
    const startersChanged = !same(next.starters, l.starters.map((id) => id || '0'));
    if (!reserveChanged) return saveStarters(l, next.starters, okText);
    state.saving = true;
    state.notice = null;
    schedule();
    try {
      if (!same(benched, l.starters)) await saveOrThrow(l, benched);
      await saveReserve(l.roster.roster_id, next.reserve);
      if (startersChanged && !same(benched, next.starters)) await saveOrThrow(l, next.starters);
      setStarters(l.roster.roster_id, next.starters);
      await keepSubs(l, next.starters, next.reserve);
      if (!destroyed) flash(okText);
    } catch (err) {
      shared.report('error', '[sleeper-nfl] save failed', err);
      if (!destroyed) flash(String(err.message || err), 'error');
    } finally {
      state.saving = false;
      schedule();
    }
  }

  async function saveOrThrow(l, starters) {
    const result = await nflSave({ rosterId: l.roster.roster_id, round: state.week, starters });
    if (!result.ok) throw new Error(result.error);
    setStarters(l.roster.roster_id, starters);
  }

  // Saves a roster's IR the way Sleeper's web app does.
  async function saveReserve(rosterId, reserve) {
    const res = await api.graphql('roster_update_reserve', `mutation roster_update_reserve {
roster_update_reserve(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, reserve: ${JSON.stringify(reserve)}) {
  roster_id starters players reserve taxi
}
}`, { auth: true });
    Object.assign(state.rosters.find((r) => r.roster_id === rosterId), res.roster_update_reserve);
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
      await keepSubs(l, starters);
      flash(okText);
    } else {
      flash(result.error, 'error');
    }
  }

  // ---- AutoSub ----
  // A starter's AutoSub is the bench player who takes their spot if they don't play: the
  // week's matchup leg keeps them as `subs` (starter id -> sub id), saved with the leg's lineup.

  const legOf = (rosterId) => state.weeks[state.week]?.legs?.find((m) => m.roster_id === rosterId);

  // Saves the leg's lineup with `subs`, and checks Sleeper's answer holds them as asked.
  async function writeSubs(rosterId, starters, subs) {
    const res = await api.graphql(`update_matchup_leg autosub (week ${state.week})`, `mutation update_matchup_leg($subs: Map) {
update_matchup_leg(league_id: ${JSON.stringify(leagueId)}, roster_id: ${Number(rosterId)}, leg: ${Number(state.week)}, round: ${Number(state.week)}, starters: ${JSON.stringify(starters.map((id) => id || '0'))}, subs: $subs) {
  leg roster_id round starters subs
}
}`, { auth: true, variables: { subs: JSON.stringify(subs) } });
    const held = res?.update_matchup_leg?.subs || {};
    const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
    if (!same(held, subs)) throw new Error('Sleeper did not keep the AutoSub');
    const leg = legOf(rosterId);
    if (leg) leg.subs = Object.keys(held).length ? held : null;
  }

  async function saveSubs(l, subs, okText) {
    if (!l?.editable || state.saving) return;
    state.saving = true;
    state.notice = null;
    state.autosub = null;
    state.swap = null;
    schedule();
    try {
      await writeSubs(l.roster.roster_id, l.starters, subs);
      if (!destroyed) flash(okText);
    } catch (err) {
      shared.report('error', '[sleeper-nfl] autosub failed', err);
      if (!destroyed) flash(String(err.message || err), 'error');
    } finally {
      state.saving = false;
      schedule();
    }
  }

  // After a lineup save, the subs that still make sense are put back: no one has to
  // trust that Sleeper's lineup save leaves them alone.
  async function keepSubs(l, starters, reserve = l.reserve) {
    const had = l.leg?.subs;
    if (!had || !Object.keys(had).length) return;
    const bench = [...l.bench, ...l.starters].filter((id) => ui.real(id) && !starters.includes(id) && !reserve.includes(id));
    await writeSubs(l.roster.roster_id, starters, model.liveSubs(had, starters, bench));
  }

  function startAutosub() {
    const l = nflPanelView.lineup(state);
    const id = l && state.swap?.startsWith('s:') ? l.starters[Number(state.swap.slice(2))] : null;
    if (!l?.editable || state.saving || !id || !nflPanelView.autosubOptions(state, l, id).length) return;
    state.swap = null;
    state.autosub = id;
    schedule();
  }

  // The bench player tapped: named AutoSub for the starter, or taken off if they already were.
  function pickSub(id) {
    const l = nflPanelView.lineup(state);
    const starter = state.autosub;
    if (!l || !starter || !nflPanelView.autosubOptions(state, l, starter).includes(id)) return;
    const name = (x) => ui.playerName(state.players, x);
    saveSubs(l, model.withAutosub(l.leg?.subs, starter, id), `AutoSub: ${name(id)} takes ${name(starter)}'s spot if they don't play`);
  }

  function clearSub(starter) {
    const l = nflPanelView.lineup(state);
    if (!l?.leg?.subs?.[starter]) return;
    saveSubs(l, model.withAutosub(l.leg.subs, starter, null), `AutoSub removed for ${ui.playerName(state.players, starter)}`);
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
    const sub = e.target.closest('[data-sub-pick]')?.dataset.subPick;
    if (sub) return pickSub(sub);
    const unsub = e.target.closest('[data-autosub-clear]')?.dataset.autosubClear;
    if (unsub) return clearSub(unsub);
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
    if (action === 'autosub-start') return startAutosub();
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
    if (e.key === 'Escape' && (state.swap || state.autosub || state.rosterMenu)) {
      state.swap = null;
      state.autosub = null;
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
      state.autosub = null;
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
