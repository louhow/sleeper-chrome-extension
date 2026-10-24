// "Optimize lineup" dialog: the shown week's starting slots in lineup order,
// each with the change model.bestLineup proposes (or why it stays), the
// finished games worth locking in, and any score benching would throw away.
// Nothing saves until the owner applies a row or all of them. Pure: state -> HTML.
(globalThis.SNP ||= {}).optimize = (() => {
  const { playerDays, scoreTier, applySlot } = globalThis.SNP.model;
  const { esc, f2, headshot, positions, injuryTag, slotBadge, weekday, gameTime, nextGame, lockIcon, dialog, dialogErrors, shortName } = globalThis.SNP.ui;

  // Plain text for the "How it picks" tooltip.
  const HOW = [
    'How it picks:',
    'Starts your best projected players for the next day of games.',
    'Starters without a game that day can sit. Run it again before their next one.',
    'Locks a finished game when it beats what keeping the slot open is likely to bring.',
    'Leaves locked-in and live players alone.',
  ].join('\n');

  const real = (id) => id && id !== '0';
  const games = (n) => `${n} game${n === 1 ? '' : 's'}`;
  const pts = (x) => (x == null ? '–' : f2(x));
  const gameText = (d) => `${weekday(d.date)} ${d.home ? 'vs' : '@'} ${d.opponent}`;
  const names = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);

  function render(s, m = s.modal) {
    const { plan } = m;
    const name = (id) => s.players[id]?.name || `Player #${id}`;
    const how = `<span class="how" tabindex="0" aria-describedby="how-tip">How it picks<span class="how-tip" id="how-tip" role="tooltip">${esc(HOW)}</span></span>`;
    // Giving up a green score stops you until you confirm; any smaller lockable score is a softer warning.
    const good = plan.changes.filter((c) => c.goodScore);
    const soft = plan.changes.filter((c) => c.lost && !c.goodScore);
    const goodTotal = good.reduce((sum, c) => sum + c.lost.actual, 0);
    const blocked = good.length > 0 && !m.ack;
    const who = (list) => names(list.map((c) => `<b>${esc(name(c.id))}</b> ${score(c.lost.actual)}`));
    const warning = (good.length ? `<div class="lose-banner" role="alert">
        <p>${who(good)} ${good.length > 1 ? 'have green games' : 'has a green game'} you could still lock in.
        Bench players can't lock in, so benching them gives up ${f2(goodTotal)} pts.</p>
        <label class="ack"><input type="checkbox" data-op-ack ${m.ack ? 'checked' : ''} ${m.saving ? 'disabled' : ''}>
          <span>Bench ${names(good.map((c) => esc(shortName(s.players[c.id]))))} anyway</span>
        </label>
      </div>` : '') + (soft.length ? `<div class="warn-banner" role="status">
        <p>${who(soft)} ${soft.length > 1 ? 'have finished games' : 'has a finished game'} you could still lock in. On the bench ${soft.length > 1 ? 'those scores' : 'that score'} can't be locked.</p>
      </div>` : '');
    const locks = plan.locks || [];
    const on = locks.filter((k) => k.on);
    const actionable = plan.changes.length > 0 || on.length > 0;
    const rows = plan.slots.length ? `
        <div class="os-head"><span>Slot</span><span class="os-lines"><span class="os-player">Player</span>
          <span class="dp-pts" title="Projected points on ${esc(day(plan))}">${esc(day(plan))}</span><span class="dp-avg" title="Projected points per game left this week">Pts/G</span></span><span></span></div>
        ${plan.slots.map((slot, i) => slotRow(s, m, plan, slot, i, blocked)).join('')}` : '';
    // What the last row saved, until the next save.
    const done = m.done ? `<p class="op-done" role="status">${esc(m.done)}</p>` : '';
    const body = actionable ? `
        ${summary(plan)}
        ${done}
        ${warning}
        ${rows}`
      : `${summary(plan)}${done}<p class="msg">This is already your best lineup for week ${esc(s.week)}.</p>${rows}`;
    const lockText = `Lock ${on.length === 1 ? 'in 1 game' : `in ${on.length} games`}`;
    const apply = on.length && !plan.changes.length ? lockText
      : on.length ? `${lockText} and ${good.length ? `apply all, losing ${f2(goodTotal)} pts` : 'apply all'}`
      : good.length ? `Apply all and lose ${f2(goodTotal)} pts` : 'Apply all';
    return dialog('Optimize Lineup', `Week ${s.week}`, `
      <div class="dialog-body">
        ${dialogErrors(m.errors)}
        ${body}
      </div>
      <footer class="dialog-foot op-foot">
        <button data-action="close-modal" ${m.saving ? 'disabled' : ''}>${actionable ? 'Cancel' : 'Close'}</button>
        ${actionable ? `<button class="primary${good.length ? ' risky' : ''}" data-action="apply-lineup" ${m.saving || blocked ? 'disabled' : ''}
          ${blocked ? 'title="Tick the box above to confirm giving up that score"' : ''}>${m.busy === 'all' ? 'Saving…' : esc(apply)}</button>` : ''}
      </footer>`, how);
  }

  // The day the plan is for, e.g. "Fri".
  const day = (plan) => (plan.date ? weekday(plan.date) : 'Day');

  // The starters' projected points on that day now and after the changes.
  function summary(plan) {
    const gain = plan.after - plan.before;
    return `<div class="op-sum">
      <span class="label">${plan.date ? `${esc(day(plan))} projection<span class="sub">Starters playing ${esc(day(plan))}</span>`
        : 'Lineup projection<span class="sub">No games left this week</span>'}</span>
      <span class="nums"><b>${f2(plan.before)}</b><span class="arrow">→</span><b class="after">${f2(plan.after)}</b>
        ${plan.changes.length ? `<span class="gain${gain < 0 ? ' down' : ''}">${gain >= 0 ? '+' : ''}${f2(gain)}</span>` : ''}</span>
    </div>`;
  }

  // One starting slot, in lineup order: who's there now and, when the plan
  // changes it, who comes in. Each change applies on its own (with any slot
  // it's tied to); a slot that stays as it is says so.
  function slotRow(s, m, plan, slot, i, blocked) {
    const cur = plan.current[i];
    const next = plan.starters[i];
    if (cur !== next) {
      const change = plan.changes.find((c) => c.id === cur);
      const { starters, slots } = applySlot(plan.current, plan.starters, i);
      // Giving up a green score waits for the tick box, here as in Apply all.
      const risky = blocked && plan.changes.some((c) => c.goodScore && !starters.includes(c.id));
      const others = slots.filter((k) => k !== i).map((k) => plan.slots[k]);
      const busy = m.busy === `row:${i}`;
      return `<div class="os-row swap${change?.goodScore ? ' losing' : change?.lost ? ' warning' : ''}">
        <span class="os-slot">${slotBadge(slot)}</span>
        <span class="os-lines">
          ${line(s, plan, cur, 'out', moveText(s, plan, cur, 'out'), change?.lost)}
          ${line(s, plan, next, 'in', moveText(s, plan, next, 'in'))}
        </span>
        <span class="os-act">
          <button class="os-apply" data-op-row="${i}" ${m.saving || risky ? 'disabled' : ''}
            ${risky ? 'title="Tick the box above to confirm giving up that score"' : others.length ? `title="Also changes ${esc(others.join(', '))}"` : ''}>${busy ? 'Saving…' : 'Apply'}</button>
          ${others.length ? `<span class="os-with">with ${esc(others.join(', '))}</span>` : ''}
        </span>
      </div>`;
    }
    const lock = plan.locks?.find((k) => k.id === cur);
    if (lock) return lockRow(s, m, plan, slot, lock);
    const info = plan.info[cur] || {};
    const notYet = plan.notYet?.find((k) => k.id === cur);
    const status = !real(cur) ? 'Empty'
      : info.fixed === 'locked' ? `${lockIcon()}Locked`
      : info.fixed === 'live' ? 'Playing'
      : 'No change';
    const sub = info.fixed === 'locked' ? `${score(info.locked.actual ?? 0)} ${esc(gameText(info.locked))}`
      : notYet ? `${score(notYet.actual)} ${esc(gameText(notYet.game))} · open ${f2(notYet.open)}`
      : esc(upcoming(s, cur));
    return `<div class="os-row same${info.fixed === 'locked' ? ' locked' : ''}">
      <span class="os-slot">${slotBadge(slot)}</span>
      <span class="os-lines">${line(s, plan, cur, 'keep', sub)}</span>
      <span class="os-act"><span class="os-status">${status}</span></span>
    </div>`;
  }

  // A finished game worth locking in. "Keep open" leaves it out and plans
  // around it; it stays listed so it can come back.
  function lockRow(s, m, plan, slot, k) {
    const until = k.until ? ` until ${new Date(k.until).toLocaleDateString(undefined, { weekday: 'short' })} ${gameTime(k.until)}` : '';
    const busy = m.busy === `lock:${k.id}`;
    const sub = `${score(k.actual)} ${esc(gameText(k.game))} · open ${f2(k.open)}
      <span class="os-sub2">${k.on ? `Lockable${esc(until)} · <button class="os-link" data-op-keep="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>Keep open</button>`
        : `Keeping open · <button class="os-link" data-op-relock="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>Lock instead</button>`}</span>`;
    return `<div class="os-row lock${k.on ? '' : ' off'}">
      <span class="os-slot">${slotBadge(slot)}</span>
      <span class="os-lines">${line(s, plan, k.id, 'keep', sub)}</span>
      <span class="os-act">${k.on
        ? `<button class="os-apply lock" data-op-lock-row="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>${busy ? 'Saving…' : `${lockIcon()}Lock`}</button>`
        : '<span class="os-status">Open</span>'}</span>
    </div>`;
  }

  // One player in a slot row: headshot, name, a sub line, and what they're projected to score.
  function line(s, plan, id, kind, sub, lost) {
    if (!real(id)) {
      return `<span class="os-line ${kind} empty"><span class="headshot blank"></span><span class="dp-info"><span class="dp-name">Empty</span></span><span class="dp-pts"></span><span class="dp-avg"></span></span>`;
    }
    const p = s.players[id] || { name: `Player #${id}`, positions: [] };
    const info = plan.info[id] || {};
    const move = kind === 'keep' ? '' : ' move';
    const note = lost ? `<span class="sub ${scoreTier(lost.actual) === 'green' ? 'lose' : 'warn'}">Can't lock ${score(lost.actual)} · ${esc(gameText(lost))}</span>` : '';
    return `<span class="os-line ${kind}">
      <img class="headshot" src="${headshot(id)}" alt="" data-player="${esc(id)}">
      <span class="dp-info">
        <span class="dp-name"><button class="name" data-player="${esc(id)}">${esc(p.name)}</button> ${positions(p)} <span class="team">- ${esc(p.team || 'FA')}</span>${injuryTag(p)}</span>
        <span class="sub${move}">${sub}</span>${note}
      </span>
      ${info.fixed === 'locked' ? '<span class="dp-pts">–</span><span class="dp-avg" title="Locked in, so later games don\'t count">–</span>'
        : `<span class="dp-pts">${pts(info.today)}</span><span class="dp-avg" title="${esc(games(info.gamesLeft ?? 0))} left">${f2(info.perGame ?? 0)}</span>`}
    </span>`;
  }

  // Where a player in a changed slot goes to, or comes from.
  function moveText(s, plan, id, kind) {
    if (!real(id)) return '';
    const k = (kind === 'out' ? plan.starters : plan.current).indexOf(id);
    const where = k < 0 ? 'bench' : plan.slots[k];
    return kind === 'out' ? `To ${esc(where)}` : `From ${esc(where)} · ${esc(upcoming(s, id))}`;
  }

  // The player's next game this week, e.g. "Fri vs BOS 7:00pm".
  function upcoming(s, id) {
    return nextGame(playerDays(s.weeks[s.week], s.players[id]?.team, id));
  }

  // A finished game's fantasy points in its score color (see model.scoreTier).
  function score(points) {
    return `<span class="score ${scoreTier(points)}">${f2(points)}</span>`;
  }

  return { render, HOW };
})();
