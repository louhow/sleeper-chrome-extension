// An NFL league's session (nba/session.js hands over to it once the league
// turns out to be NFL): the extension's own Team and Matchup tabs (panel.js),
// the League tab's matchup cards (league.js), Optimize lineup (optimize.js)
// and the Players tab's Last 5 column (players.js). Sleeper's own Team
// component reads and saves the lineup (page-hook.js).
//   nflSession(leagueId, page, api, league) -> { attach, show, destroy, refresh }
(globalThis.SNP ||= {}).nflSession = (leagueId, initialPage, api, league) => {
  const { bridge, loaders, nflPanel, nflOptimize, nflLeague, nflPlayers } = globalThis.SNP;
  const info = { currentWeek: null, tiers: null }; // the week on now and the league's score colors
  // The Team tab's lineup as Sleeper's Team component holds it; without `full`, only whether it's yours to edit.
  const lineup = (full) => bridge.ask('snp:nfl-lineup', { leagueId, full });
  // Saves starters through Sleeper's Team component: { ok, error }.
  const nflSave = (detail) => bridge.call('snp:nfl-lineup-save', { leagueId, ...detail });
  // The tab's handlers go first, so an Escape that closes the dialog doesn't also cancel a swap under it.
  const panel = nflPanel({ leagueId, api, league, info, lineup, nflSave, openDialog: () => optimizer.open(), dialogOpen: () => optimizer.isOpen() });
  const optimizer = nflOptimize({ lineup, nflSave, notify: (text) => panel.notify(text) });
  const leagueCards = nflLeague(league);
  const playersTab = nflPlayers({ api, league, info });
  let page = initialPage;
  let destroyed = false;
  let frame = 0;

  async function load() {
    const now = await api.get('/v1/state/nfl');
    info.currentWeek = Number(now.display_week || now.week || 1);
    info.tiers = await loaders.loadTiers(api, league, info.currentWeek).catch((err) => {
      console.warn('[sleeper-nfl] score colors unavailable', err);
      return null;
    });
    if (destroyed) return;
    document.documentElement.dataset.snpPlayersLeague = leagueId;
    // The Players tab's columns can go in now (page-hook.js).
    bridge.tell('snp:players-ready', { leagueId });
    await panel.load();
  }

  function attachNow() {
    if (destroyed) return;
    leagueCards.attach(page);
    panel.attach();
    optimizer.attachButton(page);
  }
  // Sleeper re-renders its tabs and header now and then, so this follows
  // every page change, once a frame at most: each pass reads Sleeper's Team
  // component and League leagueCards.
  function attach() {
    if (frame || destroyed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      attachNow();
    });
  }

  function show(next) {
    page = next;
    panel.show(next);
    if (next !== 'team') optimizer.close();
    attach();
  }

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    playersTab.destroy();
    leagueCards.destroy();
    optimizer.destroy();
    panel.destroy();
    if (document.documentElement.dataset.snpPlayersLeague === leagueId) delete document.documentElement.dataset.snpPlayersLeague;
  }

  panel.show(page);
  // Sleeper's tab goes out of sight as soon as the league is known to be NFL.
  attachNow();
  load().catch(panel.fail);
  return { attach, show, destroy, refresh: panel.refresh };
};
