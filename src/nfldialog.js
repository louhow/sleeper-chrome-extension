// NFL Optimize lineup: the OPTIMIZE button beside Sleeper's own WAIVER and
// TRADE buttons on its Team tab, and the dialog (src/nfl.js draws it), which
// the compact Team tab's toolbar opens too. It saves through Sleeper's own
// Team component (page-hook.js reads and writes the lineup).
//   ctx: { lineup(full), nflSave(detail), notify(text) }; notify shows a save
//   notice where the user is (the compact tab) and says whether it did, else
//   the dialog's own layer shows it.
(globalThis.SNP ||= {}).nflDialog = ({ lineup, nflSave, notify }) => {
  const { model, scoring, nfl, ui, shared } = globalThis.SNP;
  const BUTTON_ID = 'snp-optimize';
  const state = { modal: null, notice: null };
  const layer = shared.shadowHost('sleeper-nfl-dialog', render);
  const { host, root } = layer;
  const flash = shared.flasher(state, render);
  let destroyed = false;

  // Sleeper's projections, scored with the league's settings exactly as its
  // Team tab shows them, and the best lineup from them.
  function plan(l) {
    const proj = Object.fromEntries(Object.entries(l.projections).map(([id, p]) => [id, scoring.scoreStats(l.scoring || {}, p.stats)]));
    return { plan: model.bestNflLineup({ ...l, proj }), proj };
  }

  function render() {
    if (destroyed || !layer.styled) return;
    if (!state.modal && !state.notice) return host.remove();
    if (!host.isConnected) document.documentElement.appendChild(host);
    const scroll = root.querySelector('.dialog-body')?.scrollTop ?? 0;
    root.innerHTML = `<div class="page-layer">${nfl.render(state)}${ui.notice(state)}</div>`;
    const body = root.querySelector('.dialog-body');
    if (body) body.scrollTop = scroll;
  }

  function open() {
    const l = lineup(true);
    if (!l?.editable) return;
    state.modal = { lineup: l, ...plan(l), errors: [], saving: false, busy: null, done: null };
    state.notice = null;
    render();
  }

  function close() {
    if (state.modal?.saving) return;
    state.modal = null;
    render();
  }

  // The plan worked out again before a save: if a game kicked off while the
  // dialog was open, it shows the new plan instead of saving one you haven't seen.
  function fresh() {
    const m = state.modal;
    if (!m || m.saving) return null;
    const l = lineup(true);
    const next = l?.editable ? plan(l) : null;
    if (!next) {
      m.errors = ['The Team tab changed; open Optimize again.'];
      render();
      return null;
    }
    if (JSON.stringify(l.starters) !== JSON.stringify(m.lineup.starters) ||
      JSON.stringify(next.plan.starters) !== JSON.stringify(m.plan.starters)) {
      Object.assign(m, { lineup: l, ...next, errors: ['Games have kicked off since this opened. Review the updated changes.'] });
      render();
      return null;
    }
    return { m, l, next };
  }

  const movedText = (l, changes) => shared.movedText(changes, (id) => ui.playerName(l.players, id), 3);

  // Saves starters through Sleeper's own Team component. With `stay`, the
  // dialog stays open on the plan from the saved lineup, saying what saved.
  async function save(m, l, starters, okText, busy, stay) {
    m.saving = true;
    m.busy = busy;
    m.errors = [];
    m.done = null;
    render();
    const result = await nflSave({ rosterId: l.rosterId, round: l.round, starters });
    if (destroyed) return;
    m.saving = false;
    m.busy = null;
    if (!result.ok) {
      m.errors = [result.error];
    } else if (stay) {
      // Sleeper's component shows the saved lineup; until it does, it's worked out here.
      const read = lineup(true);
      const saved = read && JSON.stringify(read.starters) === JSON.stringify(starters) ? read
        : { ...l, starters, bench: [...l.starters, ...l.bench].filter((id) => ui.real(id) && !starters.includes(id)) };
      Object.assign(m, { lineup: saved, ...plan(saved), done: okText });
    } else {
      state.modal = null;
      if (!notify(okText)) flash(okText);
    }
    render();
  }

  function apply() {
    const f = fresh();
    if (f) save(f.m, f.l, f.next.plan.starters, `Saved: ${movedText(f.l, f.next.plan.changes)}`, 'all', false);
  }

  // One slot's change (and any slot tied to it); the dialog stays open.
  function applyRow(i) {
    const f = fresh();
    if (!f) return;
    const { starters, slots } = model.applySlot(f.l.starters, f.next.plan.starters, i);
    if (!slots.length) return;
    const ids = new Set(slots.flatMap((k) => [f.l.starters[k], f.next.plan.starters[k]]));
    save(f.m, f.l, starters, `Saved: ${movedText(f.l, f.next.plan.changes.filter((c) => ids.has(c.id)))}`, `row:${i}`, true);
  }

  // The OPTIMIZE button, first in the Team tab's header actions while the lineup is yours to edit.
  // Sleeper re-renders its header now and then, so this runs on every page change.
  function attachButton(page) {
    const actions = page === 'team' ? document.querySelector('.user-tab-menu .actions') : null;
    const button = document.getElementById(BUTTON_ID);
    if (!actions || !lineup(false)?.editable) return button?.remove();
    if (button && actions.firstElementChild === button) return;
    const el = button || Object.assign(document.createElement('div'), {
      id: BUTTON_ID,
      className: 'btn-container space',
      innerHTML: nfl.BUTTON,
      title: 'Propose the best starting lineup for this week',
      tabIndex: 0,
    });
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Optimize lineup');
    actions.prepend(el);
  }

  function onClick(e) {
    if (e.target instanceof Element && e.target.closest(`#${BUTTON_ID}`)) open();
  }
  function onKey(e) {
    if (e.key === 'Escape' && state.modal) close();
  }
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  const stopKeys = shared.activateOnKey(document, `#${BUTTON_ID}`, open);
  root.addEventListener('click', (e) => {
    // A player's name or headshot opens Sleeper's own player card, as on the compact tabs.
    const player = e.target.closest('[data-player]')?.dataset.player;
    if (player) return shared.nflPlayerCard(player, state.modal?.lineup.players[player]);
    const row = e.target.closest('[data-op-row]');
    if (row) return applyRow(Number(row.dataset.opRow));
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'close-modal') close();
    if (action === 'apply-lineup') apply();
  });
  shared.markMissingImages(root, state, render);

  function destroy() {
    destroyed = true;
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    stopKeys();
    document.getElementById(BUTTON_ID)?.remove();
    host.remove();
  }

  return { open, close, attachButton, isOpen: () => Boolean(state.modal), destroy };
};
