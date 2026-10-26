// A chopped league's League tab: the chopping block, chopped players and
// graveyard (chop-view.js draws them) in place of Sleeper's standings, which
// in a chopped league are all 0-0. Sleeper's Recent Activity stays below.
// The week's numbers are the NFL panel's (panel.weekView), read live while
// this tab shows; the chopped players come from each chopped week's transactions.
//   ctx: { leagueId, api, league, info: { currentWeek }, panel }
(globalThis.SNP ||= {}).nflChop = ({ leagueId, api, league, info, panel }) => {
  const { nflChopView, model, shared } = globalThis.SNP;
  const SORT_KEY = 'snp:chop-sort';
  const state = { failedAvatars: new Set(), transactions: null, error: null, sort: shared.safeStore.get(SORT_KEY) || 'proj' };
  const { host, root } = shared.shadowHost('sleeper-nfl-chop', render);
  host.className = 'on-league';
  const hide = shared.hideSleeper('nfl-standings', '.league-tab-container .league-tab-standings');
  let page = null;
  let destroyed = false;
  let loading = false;

  // Every chopped week's transactions, once a session (the chops are done for good).
  async function loadChops() {
    loading = true;
    const s = league.settings || {};
    const weeks = [];
    for (let w = s.start_week || 1; w <= (s.last_chopped_leg || 0); w++) weeks.push(w);
    try {
      const lists = await Promise.all(weeks.map((w) => api.get(`/v1/league/${leagueId}/transactions/${w}`)));
      state.transactions = lists.flat().filter((t) => t?.type === 'chopped');
    } catch (err) {
      state.error = String(err.message || err);
    }
    render();
  }

  function render() {
    if (destroyed || page !== 'league') return;
    const s = panel.weekView(info.currentWeek);
    if (s && !state.transactions && !state.error && !loading) loadChops();
    const players = s && state.transactions ? model.choppedPlayers(state.transactions, s.rosters) : null;
    const html = nflChopView.render(s && { ...s, failedAvatars: state.failedAvatars, chop: { players, sort: state.sort, error: state.error } });
    if (root.innerHTML !== html) root.innerHTML = html;
  }

  // Ours goes where Sleeper's standings are, once it has something to show.
  function attach(next) {
    page = next;
    const standings = page === 'league' ? document.querySelector('.league-tab-container .league-tab-standings') : null;
    if (!standings) {
      host.remove();
      hide.set(false);
      return;
    }
    render();
    if (standings.previousElementSibling !== host) standings.before(host);
    hide.set(Boolean(root.querySelector('.chop-card')));
  }

  root.addEventListener('click', (e) => {
    const sort = e.target.closest('[data-chop-sort]')?.dataset.chopSort;
    if (sort) {
      state.sort = sort;
      shared.safeStore.set(SORT_KEY, sort);
      return render();
    }
    const player = e.target.closest('[data-player]')?.dataset.player;
    if (player) return shared.nflPlayerCard(player, panel.weekView(info.currentWeek)?.players[player]);
    const team = e.target.closest('[data-open-team]');
    if (team) panel.openTeam(Number(team.dataset.openTeam));
  });
  shared.activateOnKey(root, '[data-open-team]');
  shared.markMissingImages(root, state, render);

  function destroy() {
    destroyed = true;
    host.remove();
    hide.remove();
  }

  // The panel calls `refresh` whenever its data changes.
  return { attach, refresh: () => attach(page), destroy };
};
