// "Optimize lineup" dialog: the shown week's starting slots in lineup order,
// each with the change model.bestLineup proposes (or why it stays), the
// finished games worth locking in, and any score benching would throw away.
// Nothing saves until the owner applies a row or all of them. Pure: state -> HTML.
(globalThis.SNP ||= {}).nbaOptimizeView = (() => {
  const { playerDays, scoreTier, applySlot, formBars } = globalThis.SNP.model;
  const { esc, f2, headshot, injuryTag, teamTag, slotBadge, weekday, gameTime, gameLabel, nextGame, lockIcon, shortName, real, playerOf, playerName,
    optimizeDialog, planSummary, applyAll, slotPlayer, tierClass, weekAhead } = globalThis.SNP.ui;

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
        <div class="os-head nba"><span>Slot</span><span>Starting</span><span>Replaces</span>
          <span class="dp-lock" title="A finished game's score you could lock in">Lock</span>
          <span class="dp-pts" title="Projected points on ${esc(day(plan))}">${esc(day(plan))}</span>
          <span class="dp-open" title="What leaving the slot open is worth over the games left this week">Open</span>
          <span class="dp-form" title="Their last games' fantasy points, and the average. Hover a bar for its scores. Gold marks the lock score; the tick under a bar is the ${esc(day(plan))} projection">Form</span>
          <span class="os-act-head" title="The filled button on each row is what Apply all does for it. The link under it is the other choice.">Action</span></div>
        ${plan.slots.map((slot, i) => slotRow(s, m, plan, slot, i, blocked)).join('')}` : '';
    const lockText = `Lock ${on.length === 1 ? 'in 1 game' : `in ${on.length} games`}`;
    const apply = on.length && !plan.changes.length ? lockText
      : on.length ? `${lockText} and ${good.length ? `apply all, losing ${f2(goodTotal)} pts` : 'apply all'}`
      : good.length ? `Apply all and lose ${f2(goodTotal)} pts` : 'Apply all';
    return optimizeDialog(m, {
      week: s.week,
      ahead: weekAhead(s),
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
      // Someone about to be locked moves to a specific slot first; Apply all does both.
      const nextLock = plan.locks?.find((k) => k.id === next && k.on);
      const tone = change?.goodScore ? 'lose' : change?.lost ? 'warn' : '';
      const outToday = plan.info[cur]?.today;
      const outWhy = !real(cur) ? '' : ` · ${outToday == null ? `no game ${esc(day(plan))}` : `${esc(day(plan))} ${f2(outToday)}`} · ${f2(plan.info[cur]?.perGame ?? 0)}/g`;
      const outSub = `<span class="sub move">${moveText(plan, cur, 'out')}<span class="why">${outWhy}</span></span>${drops
        ? `<span class="sub drops ${tone}"${change.dropsUnsure ? ' title="If they were starting when it tipped off; the extension didn\'t see your lineup then"' : ''}>${change.dropsUnsure ? 'May drop' : 'Drops'} lock-in ${score(s, drops.actual)} ${esc(gameLabel(drops))}</span>` : ''}`;
      return `<div class="os-row nba swap${change?.goodScore ? ' losing' : change?.lost ? ' warning' : ''}">
        <span class="os-slot">${slotBadge(slot)}</span>
        ${player(s, next, 'in', `<span class="sub move">${moveText(plan, next, 'in')} · ${esc(upcoming(s, next))}</span>${nextLock ? `<span class="sub">${lockIcon()}Then locks ${score(s, nextLock.actual)} ${esc(gameLabel(nextLock.game))} · ${openText(s, nextLock)}</span>` : ''}`)}
        ${player(s, cur, 'out', outSub)}
        ${numbers(s, plan, next, nextLock?.actual)}
        <span class="os-act">${swapActions(s, m, plan, i, { cur, next, nextLock, drops, change, risky, others })}</span>
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
    return `<div class="os-row nba same${info.fixed === 'locked' ? ' locked' : ''}">
      <span class="os-slot">${slotBadge(slot)}</span>
      ${player(s, cur, 'keep', `<span class="sub">${sub}</span>`)}
      ${numbers(s, plan, cur, info.fixed === 'locked' ? info.locked?.actual : (notYet || maybe)?.actual)}
      <span class="os-act"><span class="os-status">${status}</span></span>
    </div>`;
  }

  // A swap row's buttons. The filled one is what Apply all does for the row;
  // the link under it is the one other choice, named for who it affects:
  // - the player coming in has a finished game to lock: "Apply + lock", or just the change;
  // - the player going out has one: "Apply change" (it's lost), or keep them and lock it.
  function swapActions(s, m, plan, i, { cur, next, nextLock, drops, change, risky, others }) {
    const held = m.saving || risky;
    const why = risky ? BLOCKED : others.length ? `Also changes ${others.join(', ')}` : '';
    const apply = (label, cls, attr) => `<button class="${cls}" ${attr} ${held ? 'disabled' : ''}${why ? ` title="${esc(why)}"` : ''}>${label}</button>`;
    const saving = (key) => m.busy === key;
    if (plan.lockable && nextLock) {
      const who = shortName(s.players[next]);
      return `${lockButton(`data-op-lock-move="${i}"`, m, saving(`lockmove:${i}`), `Apply this change and lock ${who}'s ${f2(nextLock.actual)} (${gameLabel(nextLock.game)}). Locking is final.`,
        `Apply + lock ${f2(nextLock.actual)}`, held)}
        <button class="os-link" data-op-row="${i}" ${held ? 'disabled' : ''}${why ? ` title="${esc(why)}"` : ''}>${saving(`row:${i}`) ? 'Saving…' : 'Apply without locking'}</button>`;
    }
    const primary = apply(saving(`row:${i}`) ? 'Saving…' : 'Apply change', 'os-apply', `data-op-row="${i}"`);
    if (!(drops && plan.lockable)) return primary;
    const who = shortName(s.players[cur]);
    return `${primary}
      <button class="os-link lock" data-op-lock-out="${esc(cur)}" ${m.saving ? 'disabled' : ''} title="${esc(`Or keep ${s.players[cur]?.name || 'them'} and lock ${f2(drops.actual)} (${gameLabel(drops)}) instead. Locking is final${change.dropsUnsure ? '; Sleeper only allows it if they were starting at tip-off and haven\'t been benched since' : ''}.`)}">${saving(`lockout:${cur}`) ? 'Saving…'
      : `<span class="ico">${lockIcon(true)}</span>Keep ${esc(who)}, lock ${f2(drops.actual)}`}</button>`;
  }

  // The lock button: gold trim with an open padlock, a shut one under the pointer.
  function lockButton(attr, m, busy, title, label = 'Lock', held = false) {
    return `<button class="os-lock" ${attr} ${m.saving || held ? 'disabled' : ''} title="${esc(title)}">${busy ? 'Saving…'
      : `<span class="ico open">${lockIcon(true)}</span><span class="ico shut">${lockIcon()}</span>${label}`}</button>`;
  }

  // A finished game worth locking in. "Keep open" leaves it out and plans
  // around it; it stays listed so it can come back.
  function lockRow(s, m, plan, slot, k) {
    const until = k.until ? ` until ${weekday(k.until)} ${gameTime(k.until)}` : '';
    const busy = m.busy === `lock:${k.id}`;
    const toggle = k.on
      ? `<button class="os-link" data-op-keep="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>Keep open instead</button>`
      : `<button class="os-link lock" data-op-relock="${esc(k.id)}" ${m.saving ? 'disabled' : ''}>Lock instead</button>`;
    const sub = `<span class="sub">${score(s, k.actual)} ${esc(gameLabel(k.game))} · ${openText(s, k)}</span>
      <span class="sub">${k.on ? `Lockable${esc(until)}` : 'Keeping open'}</span>`;
    return `<div class="os-row nba lock${k.on ? '' : ' off'}">
      <span class="os-slot">${slotBadge(slot)}</span>
      ${player(s, k.id, 'keep', sub)}
      ${numbers(s, plan, k.id, k.actual)}
      <span class="os-act">${k.on
        ? `${lockButton(`data-op-lock-row="${esc(k.id)}"`, m, busy, `Lock ${f2(k.actual)} (${gameLabel(k.game)}). Locking is final.`, `Lock ${f2(k.actual)}`)}${toggle}`
        : `<span class="os-status">Open</span>${toggle}`}</span>
    </div>`;
  }

  // One player in a slot row: headshot, name and the sub lines given.
  function player(s, id, kind, sub) {
    const p = playerOf(s.players, id);
    return slotPlayer(id, p, kind, sub, { photo: headshot(id), tags: `${teamTag(p, { chips: true })}${injuryTag(p)}` });
  }

  // What the player in the slot is worth: the finished score they could lock,
  // the projection that day, what keeping the slot open is worth and their form.
  function numbers(s, plan, id, lock) {
    const info = (real(id) && plan.info[id]) || {};
    if (!real(id)) return '<span class="dp-lock"></span><span class="dp-pts"></span><span class="dp-open"></span><span class="dp-form"></span>';
    const locked = info.fixed === 'locked';
    const lockCell = lock != null && lock > 0 ? score(s, lock) : '–';
    if (locked) return `<span class="dp-lock">${lockCell}</span><span class="dp-pts">–</span><span class="dp-open" title="Locked in, so later games don't count">–</span>${form(s, plan, id, lock)}`;
    return `<span class="dp-lock">${lockCell}</span><span class="dp-pts">${pts(info.today)}</span>`
      + `<span class="dp-open" title="${esc(games(info.gamesLeft ?? 0))} left">${info.gamesLeft ? f2(info.open ?? 0) : '–'}</span>${form(s, plan, id, lock)}`;
  }

  // The Form cell: a bar per score bucket over the player's last games (taller
  // is more games), the lock score's bucket in the lock color, a tick under
  // the day's projection, and their average beside it. It fills in once every
  // starter's log is in, so the column doesn't fill row by row.
  const HEIGHT = 24;
  function form(s, plan, id, lock) {
    const ids = plan.starters.filter(real);
    if (!ids.every((x) => x in s.form)) return '<span class="dp-form"><span class="form-wait"></span></span>';
    const scores = s.form[id];
    const proj = plan.info[id]?.today;
    const bars = scores?.length ? formBars(scores, [lock > 0 ? lock : null, proj > 0 ? proj : null]) : null;
    if (!bars) return '<span class="dp-form"><span class="form-none">–</span></span>';
    const [lockAt, projAt] = bars.at;
    const peak = Math.max(...bars.counts);
    // Each bucket is a full-height column, so a short bar is easy to hover; its tooltip (CSS, no delay) lists the scores.
    const cols = bars.counts.map((n, i) => {
      const h = n ? Math.max(4, Math.round((n / peak) * HEIGHT)) : i === lockAt ? 5 : 2;
      // Scores rise left to right, whole numbers; the lock score stays exact, in the lock color.
      const chip = (x) => `<span class="lk">${f2(x)}</span>`;
      const list = [...bars.inBin[i]].sort((x, y) => x - y);
      const at = i === lockAt ? list.findIndex((x) => Math.abs(x - lock) < 0.005) : -1;
      const items = list.map((x, j) => (j === at ? chip(x) : Math.round(x)));
      if (i === lockAt && at < 0) items.push(chip(lock));
      const tip = items.join(' · ') || 'No games';
      return `<span class="fcol"><span class="${i === lockAt ? 'bar lock' : 'bar'}" style="height:${h}px"></span>${i === projAt ? '<span class="tick"></span>' : ''}<span class="form-tip">${tip}</span></span>`;
    }).join('');
    const title = `Last ${bars.n} games: ${f2(bars.lo)} to ${f2(bars.hi)}, average ${f2(bars.mean)}`;
    return `<span class="dp-form"><span class="form-chart" role="img" aria-label="${esc(title)}">${cols}</span><span class="form-avg">${f2(bars.mean)}</span></span>`;
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
