// The NFL League tab: the extension's matchup cards (league-view.js draws them)
// on top of Sleeper's, which stay on the page, hidden and still updating:
// page-hook.js reads their live numbers ('snp:nfl-league'), again whenever
// they change. A click on one of ours opens the matchup in the extension's
// own dialog, a full-size one laid out like the Matchup tab (both lineups slot
// by slot, from the panel's data: `weekView(week)`), on the week the League tab
// showed and with yours on the left when it's your matchup; a team in it opens
// on the Team tab (`openTeam`). Each card's rosters come from Sleeper's props
// when they're there, else from the owner names on the card (`rosterOf(owner)`,
// `myRosterId()`: the panel's rosters and users); a card that resolves neither
// way clicks Sleeper's instead.
(globalThis.SNP ||= {}).nflLeague = (league, { weekView = null, currentWeek = null, openTeam = null, rosterOf = null, myRosterId = null } = {}) => {
  const { nflLeagueView, nflPanelView, ui, bridge, shared } = globalThis.SNP;
  const state = { failedAvatars: new Set(), reply: null, dialog: null, html: '', dialogHtml: '' };
  const { host, root } = shared.shadowHost('sleeper-nfl-league');
  host.className = 'on-league';
  const layer = shared.shadowHost('sleeper-nfl-matchup', renderDialog);
  // Sleeper's own player card (a name in the dialog opens it) steps in front of the dialog.
  const behind = shared.behindSleeperCard(layer.host);
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

  // page-hook's reply with every roster it couldn't read filled in by owner name, and `own` from that.
  function resolve(reply) {
    const mine = reply.mine ?? myRosterId?.() ?? null;
    const cards = (reply.cards || []).map((c) => {
      const rosters = c.sides.map((t, i) => c.rosters?.[i] ?? (t && rosterOf?.(t.owner)) ?? null);
      return { ...c, rosters, own: Boolean(c.own) || (mine != null && rosters.includes(mine)) };
    });
    return { ...reply, cards, mine };
  }

  function render() {
    if (destroyed) return;
    state.reply = resolve(bridge.ask('snp:nfl-league') || {});
    const html = nflLeagueView.render(state.reply, league, state.failedAvatars);
    if (state.html !== html) {
      state.html = html;
      shared.morph(root, html);
    }
    renderDialog();
  }

  // The dialog: the Matchup tab's body for the matchup picked, loading until its week is in.
  function renderDialog() {
    if (destroyed || !layer.styled) return;
    const d = state.dialog;
    if (!d) {
      state.dialogHtml = '';
      return layer.host.remove();
    }
    if (!layer.host.isConnected) document.documentElement.appendChild(layer.host);
    const s = weekView?.(d.week);
    const body = s ? nflPanelView.matchup({ ...s, rosterId: d.rosterId, failedAvatars: state.failedAvatars }) : ui.loading();
    const html = `<div class="page-layer">${ui.dialog('Matchup', '', `<div class="dialog-body"><div class="app nfl-panel mu-dialog"><div class="body">${body}</div></div></div>`)}</div>`;
    if (state.dialogHtml === html) return;
    state.dialogHtml = html;
    shared.morph(layer.root, html);
  }

  function openDialog(rosterId, week) {
    state.dialog = { rosterId, week };
    behind.on();
    renderDialog();
  }
  function closeDialog() {
    if (!state.dialog) return;
    state.dialog = null;
    behind.off();
    renderDialog();
  }
  // The dialog's week picker, within the panel's weeks.
  function stepWeek(step) {
    const s = state.dialog && weekView?.(state.dialog.week);
    const week = state.dialog.week + step;
    if (!s || week < s.minWeek || week > s.maxWeek) return;
    state.dialog.week = week;
    renderDialog();
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
    const week = round ?? currentWeek?.() ?? null;
    if (weekView && rosters.length && week != null) return openDialog(rosters.includes(mine) ? mine : rosters[0], week);
    bridge.tell('snp:nfl-league-open', { index });
  });
  shared.activateOnKey(root, '[data-nfl-matchup]');
  shared.markMissingImages(root, state, render);
  layer.root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'close-modal') return closeDialog();
    if (action === 'prev') return stepWeek(-1);
    if (action === 'next') return stepWeek(1);
    // A team opens on the Team tab; a player's name or headshot, Sleeper's own player card.
    const team = e.target.closest('[data-open-team]');
    if (team) {
      closeDialog();
      return openTeam?.(Number(team.dataset.openTeam));
    }
    const player = e.target.closest('[data-player]')?.dataset.player;
    if (player) shared.nflPlayerCard(player, weekView?.(state.dialog?.week)?.players[player]);
  });
  shared.activateOnKey(layer.root, '[data-open-team]', (el) => {
    closeDialog();
    openTeam?.(Number(el.dataset.openTeam));
  });
  shared.markMissingImages(layer.root, state, renderDialog);
  function onKey(e) {
    if (e.key === 'Escape' && state.dialog) closeDialog();
  }
  document.addEventListener('keydown', onKey);

  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    watch.disconnect();
    behind.off();
    document.removeEventListener('keydown', onKey);
    host.remove();
    layer.host.remove();
    hide.remove();
  }

  return { attach, refresh: render, isOpen: () => Boolean(state.dialog), close: closeDialog, destroy };
};
