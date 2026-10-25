// "Optimize lineup" dialog: the shown week's starting slots in lineup order,
// each with the change model.bestLineup proposes (or why it stays), the
// finished games worth locking in, and any score benching would throw away.
// Nothing saves until the owner applies a row or all of them. Pure: state -> HTML.
(globalThis.SNP ||= {}).optimize = (() => {
  const { playerDays, scoreTier, applySlot } = globalThis.SNP.model;
  const { esc, f2, headshot, injuryTag, teamTag, slotBadge, weekday, gameTime, gameLabel, nextGame, lockIcon, shortName, real, playerOf, playerName,
    optimizeDialog, planSummary, applyAll, applyChange, slotPlayer, tierClass } = globalThis.SNP.ui;

  // Plain text for the "How it picks" tooltip.
  const HOW = [
    'How it picks:',
    'Starts your best projected players for the next day of games.',
    'Starters without a game that day can sit. Run it again before their next one.',
    'Locks a finished game when it beats what keeping the slot open is likely to bring.',
    'Leaves locked-in and live players alone.',
  ].join('\n');
  // Why Apply waits while a green score would be given up.
  const BLOCKED = 'Tick the box above to confirm giving up that score';

  const games = (n) => `${n} game${n === 1 ? '' : 's'}`;
  const pts = (x) => (x == null ? '–' : f2(x));
  const names = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);

  function render(s, m = s.modal) {
    const { plan } = m;
    const name = (id) => playerName(s.players, id);
    // Giving up a green score stops you until you confirm; any smaller lockable score is a softer warning.
    const good = plan.changes.filter((c) => c.goodScore);
    const soft = plan.changes.filter((c) => c.lost && !c.goodScore);
    const goodTotal = good.reduce((sum, c) => sum + c.lost.actual, 0);
    const blocked = good.length > 0 && !m.ack;
    const who = (list) => names(list.map((c) => `<b>${esc(name(c.id))}</b> ${score(s, c.lost.actual)}`));
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
        <div class="os-head"><span>Slot</span><span>Starting</span><span>Replaces</span>
          <span class="dp-pts" title="Projected points on ${esc(day(plan))}">${esc(day(plan))}</span><span class="dp-avg" title="Projected points per game left this week">Pts/G</span><span></span></div>
        ${plan.slots.map((slot, i) => slotRow(s, m, plan, slot, i, blocked)).join('')}` : '';
    const lockText = `Lock ${on.length === 1 ? 'in 1 game' : `in ${on.length} games`}`;
    const apply = on.length && !plan.changes.length ? lockText
      : on.length ? `${lockText} and ${good.length ? `apply all, losing ${f2(goodTotal)} pts` : 'apply all'}`
      : good.length ? `Apply all and lose ${f2(goodTotal)} pts` : 'Apply all';
    return optimizeDialog(m, {
      week: s.week,
      how: HOW,
      summary: summary(plan),
      notes: warning,
      rows,
      actionable,
      apply: applyAll(m, apply, { risky: good.length > 0, held: blocked, title: blocked ? BLOCKED : '' }),
    });
  }

  // The day the plan is for, e.g. "Fri".
  const day = (plan) => (plan.date ? weekday(plan.date) : 'Day');

  // The starters' projected points on that day now and after the changes.
  function summary(plan) {
    return plan.date ? planSummary(plan, `${day(plan)} projection`, `Starters playing ${day(plan)}`)
      : planSummary(plan, 'Lineup projection', 'No games left this week');
  }

  // One starting slot, in lineup order: who starts there. When the plan
  // changes it, who comes in leads (so the column reads as the new lineup)
  // and who they replace sits beside them, faded. Each change applies on its own
  // (with any slot it's tied to); a slot that stays as it is says so.
  function slotRow(s, m, plan, slot, i, blocked) {
    const cur = plan.current[i];
    const next = plan.starters[i];
    if (cur !== next) {
      const change = plan.changes.find((c) => c.id === cur);
      const { starters, slots } = applySlot(plan.current, plan.starters, i);
      // Giving up a green score waits for the tick box, here as in Apply all.
      const risky = blocked && plan.changes.some((c) => c.goodScore && !starters.includes(c.id));
      const others = slots.filter((k) => k !== i).map((k) => plan.slots[k]);
      const drops = change?.drops;
      const tone = change?.goodScore ? 'lose' : change?.lost ? 'warn' : '';
      const outToday = plan.info[cur]?.today;
      const outWhy = !real(cur) ? '' : ` · ${outToday == null ? `no game ${esc(day(plan))}` : `${esc(day(plan))} ${f2(outToday)}`} · ${f2(plan.info[cur]?.perGame ?? 0)}/g`;
      const outSub = `<span class="sub move">${moveText(plan, cur, 'out')}<span class="why">${outWhy}</span></span>${drops
        ? `<span class="sub drops ${tone}"${change.dropsUnsure ? ' title="If they were starting when it tipped off; the extension didn\'t see your lineup then"' : ''}>${change.dropsUnsure ? 'May drop' : 'Drops'} lock-in ${score(s, drops.actual)} ${esc(gameLabel(drops))}</span>` : ''}`;
      return `<div class="os-row swap${change?.goodScore ? ' losing' : change?.lost ? ' warning' : ''}">
        <span class="os-slot">${slotBadge(slot)}</span>
        ${player(s, next, 'in', `<span class="sub move">${moveText(plan, next, 'in')} · ${esc(upcoming(s, next))}</span>`)}
        ${player(s, cur, 'out', outSub)}
        ${numbers(plan, next)}
        <span class="os-act">
          ${applyChange(m, i, others, { held: risky, title: risky ? BLOCKED : '' })}
          ${drops && plan.lockable ? `<button class="os-lock-current" data-op-lock-out="${esc(cur)}" ${m.saving ? 'disabled' : ''}
            title="${esc(`Or keep ${s.players[cur]?.name || 'them'} and lock ${f2(drops.actual)} (${gameLabel(drops)}) instead. Locking is final${change.dropsUnsure ? '; Sleeper only allows it if they were starting at tip-off and haven\'t been benched since' : ''}.`)}">${m.busy === `lockout:${cur}` ? 'Locking…'
              : `${lockIcon()}Lock current`}</button>` : ''}
        </span>
      </div>`;
    }
    const lock = plan.locks?.find((k) => k.id === cur);
    if (lock) return lockRow(s, m, plan, slot, lock);
    const info = plan.info[cur] || {};
    const notYet = plan.notYet?.find((k) => k.id === cur);
    const maybe = plan.maybe?.find((k) => k.id === cur);
    const status = !real(cur) ? 'Empty'
      : info.fixed === 'locked' ? `${lockIcon()}Locked`
      : info.fixed === 'live' ? 'Playing'
      : 'No change';
    const sub = info.fixed === 'locked' ? `${score(s, info.locked.actual ?? 0)} ${esc(gameLabel(info.locked))}`
      : notYet ? `${score(s, notYet.actual)} ${esc(gameLabel(notYet.game))} · ${openText(s, notYet)} · ${esc(upcoming(s, cur))}`
      : maybe ? `<span title="Lockable only if they were starting when it tipped off; the extension didn't see your lineup then">${score(s, maybe.actual)} ${esc(gameLabel(maybe.game))} · lockable if started</span> · ${esc(upcoming(s, cur))}`
      : esc(upcoming(s, cur));
    return `<div class="os-row same${info.fixed === 'locked' ? ' locked' : ''}">
      <span class="os-slot">${slotBadge(slot)}</span>
      ${player(s, cur, 'keep', `<span class="sub">${sub}</span>`)}
      ${numbers(plan, cur)}
      <span class="os-act"><span class="os-status">${status}</span></span>
    </div>`;
  }

  // A finished game worth locking in. "Keep open" leaves it out and plans
  // around it; it stays listed so it can come back.
  function lockRow(s, m, plan, slot, k) {
    const until = k.until ? ` until ${weekday(k.until)} ${gameTime(k.until)}` : '';
    const busy = m.busy === `lock:${k.id}`;
    const toggle = k.on
      ? `<button class="os-link" data-op-keep="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>Keep open</button>`
      : `<button class="os-link" data-op-relock="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>Lock instead</button>`;
    const sub = `<span class="sub">${score(s, k.actual)} ${esc(gameLabel(k.game))} · ${openText(s, k)}</span>
      <span class="sub">${k.on ? `Lockable${esc(until)}` : 'Keeping open'} · ${toggle}</span>`;
    return `<div class="os-row lock${k.on ? '' : ' off'}">
      <span class="os-slot">${slotBadge(slot)}</span>
      ${player(s, k.id, 'keep', sub)}
      ${numbers(plan, k.id)}
      <span class="os-act">${k.on
        ? `<button class="os-apply lock" data-op-lock-row="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>${busy ? 'Saving…' : `${lockIcon()}Lock`}</button>`
        : '<span class="os-status">Open</span>'}</span>
    </div>`;
  }

  // One player in a slot row: headshot, name and the sub lines given.
  function player(s, id, kind, sub) {
    const p = playerOf(s.players, id);
    return slotPlayer(id, p, kind, sub, { photo: headshot(id), tags: `${teamTag(p, { chips: true })}${injuryTag(p)}` });
  }

  // What the player in the slot is projected to score: that day, and per game left.
  function numbers(plan, id) {
    const info = (real(id) && plan.info[id]) || {};
    if (!real(id)) return '<span class="dp-pts"></span><span class="dp-avg"></span>';
    if (info.fixed === 'locked') return '<span class="dp-pts">–</span><span class="dp-avg" title="Locked in, so later games don\'t count">–</span>';
    return `<span class="dp-pts">${pts(info.today)}</span><span class="dp-avg" title="${esc(games(info.gamesLeft ?? 0))} left">${f2(info.perGame ?? 0)}</span>`;
  }

  // Where a player in a changed slot goes to, or comes from.
  function moveText(plan, id, kind) {
    if (!real(id)) return '';
    const k = (kind === 'out' ? plan.starters : plan.current).indexOf(id);
    const where = k < 0 ? 'bench' : plan.slots[k];
    return `${kind === 'out' ? 'To' : 'From'} ${esc(where)}`;
  }

  // What keeping the slot open is worth, and who from the bench would bring it.
  function openText(s, k) {
    return `open ${f2(k.open)}${k.openBy ? ` with ${esc(shortName(s.players[k.openBy]))}` : ''}`;
  }

  // The player's next game this week, e.g. "Fri vs BOS 7:00pm".
  function upcoming(s, id) {
    return nextGame(playerDays(s.weeks[s.week], s.players[id]?.team, id));
  }

  // A finished game's fantasy points in its score color (see model.scoreTier).
  function score(s, points) {
    return `<span class="score-chip${tierClass(scoreTier(points, s.tiers))}">${f2(points)}</span>`;
  }

  return { render };
})();
