// The NBA Optimize lineup dialog (src/optimize.js draws it): the best lineup
// for the shown week, worked out again right before every save, saved all at
// once or a row at a time, with the finished games worth locking in.
//   ctx: { state, schedule, modalSave, saveStarters, saveLeg }
(globalThis.SNP ||= {}).nbaOptimize = ({ state, schedule, modalSave, saveStarters, saveLeg }) => {
  const { model, ui, shared } = globalThis.SNP;
  const shortOf = (id) => ui.shortName(ui.playerOf(state.players, id));
  // Names a few moves; past that, just the count, so the notice stays one line.
  const movedText = (changes) => shared.movedText(changes, shortOf, 3);

  // Proposes the best lineup for the shown week; nothing saves until it's applied.
  function open() {
    const lineup = ui.lineup(state);
    if (state.saving || !lineup?.editable || !lineup.week || ui.whatIfOn(state)) return;
    state.swap = null;
    state.lockConfirm = null;
    state.notice = null;
    state.modal = { kind: 'optimize', plan: model.bestLineup(lineup, Date.now()), noLock: [], ack: false, errors: [], saving: false, busy: null, done: null };
    schedule();
  }

  // Keeping a lock open, or taking it back, plans the lineup again around it.
  function toggleLock(playerId, on) {
    const m = state.modal;
    const lineup = ui.lineup(state);
    if (m?.kind !== 'optimize' || m.saving || !lineup) return;
    m.noLock = on ? m.noLock.filter((id) => id !== playerId) : [...new Set([...m.noLock, playerId])];
    m.plan = model.bestLineup(lineup, Date.now(), { noLock: m.noLock });
    m.ack = false;
    schedule();
  }

  // The dialog's plan, worked out again right before a save. Games can tip off
  // while the dialog is open; if the plan changed, the dialog shows the new one
  // instead of saving something unseen. Null when it can't save.
  function freshPlan() {
    const m = state.modal;
    const lineup = ui.lineup(state);
    if (m?.kind !== 'optimize' || m.saving || !lineup?.editable) return null;
    // The plan was made with the league's scoring; what-if numbers would change it.
    if (ui.whatIfOn(state)) {
      m.errors = ['Switch what-if scoring off to apply. Optimize picks the lineup with your league\'s scoring.'];
      schedule();
      return null;
    }
    const plan = model.bestLineup(lineup, Date.now(), { noLock: m.noLock });
    if (!model.samePlan(plan, m.plan)) {
      m.plan = plan;
      m.ack = false;
      m.errors = ['Games have tipped off since this opened. Review the updated changes.'];
      schedule();
      return null;
    }
    return { m, lineup, plan };
  }

  // After one row saves, the dialog stays open on the plan from the new lineup.
  function replan(m, okText) {
    m.plan = model.bestLineup(ui.lineup(state), Date.now(), { noLock: m.noLock });
    m.ack = false;
    m.done = okText;
  }

  // Locks one game now, on the lineup as it stands; the dialog stays open.
  const lockNow = (lineup, id, gameId, okText) =>
    modalSave(() => saveLeg('lock_in', lineup.roster.roster_id, lineup.starters, { ...lineup.locks, [id]: gameId }), okText, replan);

  // Saves the proposed lineup and locks in one write (locks are final).
  function apply() {
    const fresh = freshPlan();
    if (!fresh) return;
    const { m, lineup, plan } = fresh;
    // Giving up a score that beat its projection takes the tick box.
    if (plan.changes.some((c) => c.goodScore) && !m.ack) return;
    const moved = movedText(plan.changes);
    const locks = lineup.lockable ? plan.locks.filter((k) => k.on) : [];
    m.busy = 'all';
    if (!locks.length) return plan.changes.length ? modalSave(() => saveStarters(plan.starters), `Saved: ${moved}`) : undefined;
    const lockedText = `Locked ${locks.map((k) => `${shortOf(k.id)} ${ui.f2(k.actual)}`).join(', ')}`;
    const startersGames = { ...lineup.locks, ...Object.fromEntries(locks.map((k) => [k.id, k.game.game.id])) };
    return modalSave(() => saveLeg('lock_in', lineup.roster.roster_id, plan.starters, startersGames),
      plan.changes.length ? `${lockedText} · Saved: ${moved}` : lockedText);
  }

  // Applies one slot's change (and any slot tied to it); the dialog stays open.
  function applyRow(i) {
    const fresh = freshPlan();
    if (!fresh) return;
    const { m, plan } = fresh;
    const { starters, slots } = model.applySlot(plan.current, plan.starters, i);
    if (!slots.length) return;
    if (plan.changes.some((c) => c.goodScore && !starters.includes(c.id)) && !m.ack) return;
    const ids = new Set(slots.flatMap((k) => [plan.current[k], plan.starters[k]]));
    m.busy = `row:${i}`;
    return modalSave(() => saveStarters(starters), `Saved: ${movedText(plan.changes.filter((c) => ids.has(c.id)))}`, replan);
  }

  // A swap's secondary option: keep the starter going out and lock their
  // finished game instead (one the extension couldn't confirm they started
  // included, the button said so). On the lineup as it stands; the dialog stays open.
  function lockOut(id) {
    const fresh = freshPlan();
    if (!fresh) return;
    const { m, lineup } = fresh;
    if (!lineup.lockable || !lineup.starters.includes(id)) return;
    const st = model.lockCheck(lineup, id, state.players[id]?.team, Date.now());
    if (st.error) {
      m.errors = [st.error];
      return schedule();
    }
    m.busy = `lockout:${id}`;
    return lockNow(lineup, id, st.current.game.id, `Locked ${shortOf(id)} ${ui.f2(st.current.actual ?? 0)}`);
  }

  // Locks one recommended game now.
  function lockRow(id) {
    const fresh = freshPlan();
    if (!fresh) return;
    const { m, lineup, plan } = fresh;
    const k = plan.locks.find((x) => x.id === id && x.on);
    if (!k || !lineup.lockable) return;
    m.busy = `lock:${id}`;
    return lockNow(lineup, id, k.game.game.id, `Locked ${shortOf(id)} ${ui.f2(k.actual)}`);
  }

  // The dialog's clicks; true when one was theirs.
  function click(target) {
    const m = state.modal;
    if (m?.kind !== 'optimize') return false;
    const row = target.closest('[data-op-row]');
    if (row) applyRow(Number(row.dataset.opRow));
    const out = target.closest('[data-op-lock-out]');
    if (out) lockOut(out.dataset.opLockOut);
    const lock = target.closest('[data-op-lock-row]');
    if (lock) lockRow(lock.dataset.opLockRow);
    const keep = target.closest('[data-op-keep], [data-op-relock]');
    if (keep) toggleLock(keep.dataset.opKeep ?? keep.dataset.opRelock, keep.dataset.opRelock != null);
    if (target.closest('[data-action="apply-lineup"]')) apply();
    return Boolean(row || out || lock || keep);
  }

  return { open, click };
};
