// The NFL League tab's standings (ui.standingsTable draws them) in place of
// Sleeper's, which stay on the page, hidden: click a header to sort, a team to
// open it on the Team tab. A chopped league has the chopping block instead
// (chop.js). The week's numbers are the NFL panel's (panel.weekView).
//   ctx: { info: { currentWeek }, panel }
(globalThis.SNP ||= {}).nflStandings = ({ info, panel }) => {
  const { ui, shared } = globalThis.SNP;
  const state = { failedAvatars: new Set(), standingsSort: null };
  const { host, root } = shared.shadowHost('sleeper-nfl-standings', render);
  host.className = 'on-league';
  const hide = shared.hideSleeper('nfl-standings-table', '.league-tab-container .league-tab-standings');
  let page = null;
  let destroyed = false;

  function render() {
    if (destroyed || page !== 'league') return;
    const s = panel.weekView(info.currentWeek);
    const html = s ? `<div class="app league nfl-standings">${ui.standingsTable({ ...s, ...state })}</div>` : '';
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
    hide.set(Boolean(root.querySelector('.standings')));
  }

  root.addEventListener('click', (e) => {
    const team = e.target.closest('[data-open-team]');
    if (team) return panel.openTeam(Number(team.dataset.openTeam));
    const sort = e.target.closest('[data-sort]');
    if (!sort) return;
    const key = sort.dataset.sort;
    const cur = state.standingsSort;
    // A new column sorts best-first (most points, first rank, A to Z); again flips it.
    state.standingsSort = cur?.key === key ? { key, dir: -cur.dir } : { key, dir: ['rank', 'team', 'waiver'].includes(key) ? 1 : -1 };
    render();
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
