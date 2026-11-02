// The NFL League tab: the extension's matchup cards (league-view.js draws them)
// on top of Sleeper's, which stay on the page, hidden and still updating:
// page-hook.js reads their live numbers ('snp:nfl-league'), again whenever
// they change. A click on one of ours opens the matchup on the extension's
// Matchup tab (`open({ rosterId, week })`, yours as the left side when it's
// your matchup), as the NBA League tab does; a card whose rosters page-hook
// couldn't read clicks Sleeper's instead.
(globalThis.SNP ||= {}).nflLeague = (league, { open = null } = {}) => {
  const { nflLeagueView, bridge, shared } = globalThis.SNP;
  const state = { failedAvatars: new Set(), reply: null };
  const { host, root } = shared.shadowHost('sleeper-nfl-league');
  host.className = 'on-league';
  // Sleeper's cards sit in a list inside the list ours goes on top of.
  const hide = shared.hideSleeper('nfl-cards', '.league-matchups .league-matchup-row-item');
  let destroyed = false;
  let frame = 0;
  const watch = new MutationObserver(() => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  });
  let watched = null;

  function render() {
    if (destroyed) return;
    state.reply = bridge.ask('snp:nfl-league') || {};
    const html = nflLeagueView.render(state.reply, league, state.failedAvatars);
    if (root.innerHTML !== html) root.innerHTML = html;
  }

  // Sleeper's own cards stay until ours have some, so they never vanish for nothing.
  function attach(page) {
    const list = page === 'league' ? document.querySelector('.league-matchups') : null;
    if (!list) {
      host.remove();
      hide.set(false);
      watch.disconnect();
      watched = null;
      return;
    }
    if (watched !== list) {
      watch.disconnect();
      watched = list;
      watch.observe(list, { childList: true, subtree: true, characterData: true, attributes: true });
    }
    render();
    const ready = Boolean(root.querySelector('.lg-match'));
    hide.set(ready);
    if (ready && list.firstElementChild !== host) list.prepend(host);
  }

  root.addEventListener('click', (e) => {
    const card = e.target.closest('[data-nfl-matchup]');
    if (!card) return;
    const index = Number(card.dataset.nflMatchup);
    const { cards = [], round = null, mine = null } = state.reply || {};
    const rosters = (cards[index]?.rosters || []).filter((id) => id != null);
    if (open && rosters.length) return open({ rosterId: rosters.includes(mine) ? mine : rosters[0], week: round });
    bridge.tell('snp:nfl-league-open', { index });
  });
  shared.activateOnKey(root, '[data-nfl-matchup]');
  shared.markMissingImages(root, state, render);

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    watch.disconnect();
    host.remove();
    hide.remove();
  }

  return { attach, destroy };
};
