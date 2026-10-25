// The NFL League tab: the extension's matchup cards (league-view.js draws them)
// on top of Sleeper's, which stay on the page, hidden and still updating:
// page-hook.js reads their live numbers ('snp:nfl-league'), again whenever
// they change, and a click on one of ours clicks Sleeper's.
(globalThis.SNP ||= {}).nflLeague = () => {
  const { nflLeagueView, bridge, shared } = globalThis.SNP;
  const state = { failedAvatars: new Set() };
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
    const html = nflLeagueView.render(bridge.ask('snp:nfl-league')?.cards || [], state.failedAvatars);
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
    if (card) bridge.tell('snp:nfl-league-open', { index: Number(card.dataset.nflMatchup) });
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
