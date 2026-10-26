// A chopped league's League tab: the chopping block and graveyard
// (chop-view.js draws them) in place of Sleeper's standings, which in a
// chopped league are all 0-0. Sleeper's Recent Activity stays below. The
// week's numbers are the NFL panel's (panel.weekView), read live while this
// tab shows. (The chopped players are marked on the Players tab: page-hook.js.)
//   ctx: { info: { currentWeek }, panel }
(globalThis.SNP ||= {}).nflChop = ({ info, panel }) => {
  const { nflChopView, shared } = globalThis.SNP;
  const state = { failedAvatars: new Set() };
  const { host, root } = shared.shadowHost('sleeper-nfl-chop', render);
  host.className = 'on-league';
  const hide = shared.hideSleeper('nfl-standings', '.league-tab-container .league-tab-standings');
  let page = null;
  let destroyed = false;

  function render() {
    if (destroyed || page !== 'league') return;
    const s = panel.weekView(info.currentWeek);
    const html = nflChopView.render(s && { ...s, failedAvatars: state.failedAvatars });
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
