// Matchup view: the selected team (left) against its opponent (right), slot by
// slot, with Lock-In status and the lock control for the logged-in owner.
(globalThis.SNP ||= {}).matchup = (() => {
  const { playerDays, lockState, lockInDefault, winProbability } = globalThis.SNP.model;
  const { esc, f2, headshot, teamLogo, teamName, shortName, injuryTag, teamTag, gameTime, weekday, gameLabel, slotBadge, weekNav, lineup, real, playerOf,
    whatIfOn, loading, errorMsg, opponentOf, teamSideOf, matchupPair, muRow, muEmpty, muStarters, muSection } = globalThis.SNP.ui;

  function render(s) {
    if (s.error) return errorMsg(s.error);
    const mine = lineup(s);
    if (!mine) return loading();
    if (!mine.week) return `<div class="section-head"><h3>Starters</h3>${weekNav(s, null)}</div>${loading('Loading week…')}`;

    const oppId = opponentOf(mine);
    const theirs = oppId != null ? lineup(s, oppId) : null;
    const left = side(s, mine);
    const right = theirs && side(s, theirs);
    const [p1, p2] = right ? winProbability(left.points, left.proj, right.points, right.proj) : [null, null];
    const settings = s.league.settings || {};
    const row = (slot, idA, idB, starter) => muRow(playerSide(s, left, idA, 'mine', starter), slotBadge(slot),
      right && playerSide(s, right, idB, 'theirs', starter));
    const section = (title, slot, a, b, count) => muSection(title, a, b, count, (idA, idB) => row(slot, idA, idB, false));

    return `
      ${matchupPair(teamOf(s, left, p1), right && teamOf(s, right, p2), { tag: 'section', failed: s.failedAvatars })}
      ${muStarters(mine.lockable ? (s.saving ? 'Saving…' : 'Lock in a finished game before the player\'s next game starts') : '', weekNav(s, mine.week))}
      ${mine.slots.map((slot, i) => row(slot, mine.starters[i], theirs?.starters[i], true)).join('')}
      ${section('Bench', 'BN', mine.bench, theirs?.bench || [])}
      ${section('Injured Reserve', 'IR', mine.reserve, theirs?.reserve || [], settings.reserve_slots)}
      ${section('Taxi Squad', 'TX', mine.taxi, theirs?.taxi || [], settings.taxi_slots)}`;
  }

  // Team totals. Sleeper's own leg numbers win when logged in; otherwise they're
  // rebuilt from Lock-In rules (locked game, else the final game of the week).
  function side(s, l) {
    const states = {};
    for (const id of l.starters) {
      if (!real(id)) continue;
      const days = playerDays(l.week, s.players[id]?.team, id);
      states[id] = { days, ...lockState(days, l.locks[id], s.now, l.started ? (game) => l.started(id, game) : null) };
    }
    const all = Object.values(states);
    // Sleeper's running total: each starter's locked game, else their latest finished one.
    const live = all.reduce((sum, st) => sum + st.livePoints, 0);
    const projected = all.reduce((sum, st) => sum + (st.counted ? st.points : lockInDefault(st.days) ?? 0), 0);
    // Sleeper's totals use the league's scoring; what-if scoring keeps the ones added up here.
    const server = whatIfOn(s) ? null : l.leg ?? l.matchup;
    // The public matchup is cached for minutes, so with the (fresh) leg the total
    // is added up from its lineup instead; Sleeper's leg points (and custom points) still win.
    const points = !server ? live
      : l.leg ? l.leg.custom_points ?? l.leg.points ?? live
      : l.matchup?.custom_points ?? l.matchup?.points ?? live;
    return {
      l,
      states,
      points: points ?? 0,
      anyPoints: all.some((st) => st.locked || st.games.some((d) => d.game.status === 'complete')) || Boolean(server && (l.leg ? l.leg.points : l.matchup?.points)),
      proj: (server && l.leg?.proj_points) ?? projected,
      yetToPlay: all.filter((st) => st.yetToPlay).length,
    };
  }

  // A team's card over the matchup (ui.teamSide): `prob`, its chance to win.
  function teamOf(s, sd, prob) {
    const { roster, week } = sd.l;
    return teamSideOf(s, roster, {
      points: sd.anyPoints ? sd.points : null,
      win: prob,
      rank: week.ranks?.[roster.roster_id],
      yetToPlay: sd.yetToPlay,
      proj: sd.proj,
    });
  }

  function playerSide(s, sd, id, cls, starter) {
    if (!real(id)) return muEmpty(cls);
    const p = playerOf(s.players, id);
    const st = sd.states[id] ?? (() => {
      const days = playerDays(sd.l.week, p.team, id);
      return { days, ...lockState(days, sd.l.locks[id], s.now, sd.l.started ? (game) => sd.l.started(id, game) : null) };
    })();
    const cur = st.current;
    const curDone = cur?.game.status === 'complete';
    const curValue = cur ? (curDone || cur.actual != null ? cur.actual ?? 0 : cur.proj) : null;
    const ref = `${sd.l.roster.roster_id}:${id}`;
    // Mirrored on the opponent's side, so the logos sit toward the middle.
    const who = `<span>${teamTag(p, { chips: true, sep: '•' })}</span>`;
    const games = `<span class="mp-games">${st.games.map((d) => gameChip(d, st)).join('')}</span>`;
    const confirming = starter && s.lockConfirm === ref && !st.locked && sd.l.lockable && (st.lockable || st.unsure);
    const result = `<div class="mp-game">
        ${cur ? `<b>${cur.home ? 'vs' : '@'} ${esc(cur.opponent)}</b>
          <span class="sub">${esc(status(cur))}</span>` : '<span class="sub">No games</span>'}
      </div>
      <div class="mp-pts"><b>${starter && st.counted ? f2(st.points) : '–'}</b>${cur ? `<span>${curDone ? 'pts' : 'proj'} ${f2(curValue)}</span>` : ''}</div>`;
    return `<div class="mp ${cls}${st.locked ? ' is-locked' : ''}${confirming ? ' confirming' : ''}">
      <img class="headshot" src="${headshot(id)}" alt="" data-player="${esc(id)}">
      <div class="mp-id">
        <div class="name"><button data-player="${esc(id)}">${esc(shortName(p))}</button>${injuryTag(p)}</div>
        <div class="sub">${cls === 'theirs' ? `${games}${who}` : `${who}${games}`}</div>
      </div>
      ${confirming ? lockConfirm(s, st, ref) : `${result}<div class="mp-lk">${starter ? lockControl(s, sd, st, ref) : ''}</div>`}
    </div>`;
  }

  function status(d) {
    const day = weekday(d.date);
    if (d.game.status === 'complete') return `Final · ${day}`;
    if (d.game.status === 'in_game') return `Live · ${day}`;
    return d.game.start ? `${day} ${gameTime(d.game.start)}` : day;
  }

  // Locked games show a lock on either side; only the owner gets the LOCK button.
  function lockControl(s, sd, st, ref) {
    if (st.locked) return '<span class="lk locked" title="Locked in" aria-label="Locked in">🔒</span>';
    if (!sd.l.lockable) return '';
    if (st.benched) return '<button class="lk" disabled title="Their last game was played on your bench, so it can\'t be locked in">LOCK</button>';
    if (!st.lockable && !st.unsure) {
      return '<button class="lk" disabled title="Opens once a game ends, until the player\'s next game starts">LOCK</button>';
    }
    const title = st.unsure ? `Lock in ${status(st.current)}, only if they were starting at tip-off (the extension didn't see your lineup then)` : `Lock in ${status(st.current)}`;
    return `<button class="lk open${st.unsure ? ' maybe' : ''}" data-lock="${esc(ref)}" ${s.saving ? 'disabled' : ''} title="${esc(title)}">LOCK</button>`;
  }

  function lockConfirm(s, st, ref) {
    return `<span class="lk-confirm">
      <button class="lk go" data-lock-confirm="${esc(ref)}" ${s.saving ? 'disabled' : ''}>Lock ${f2(st.current?.actual ?? 0)}</button>
      <button class="lk cancel" data-lock-cancel aria-label="Cancel">✕</button>
    </span>`;
  }

  function gameChip(d, st) {
    const cls = [
      d.game.status === 'complete' ? 'done' : '',
      d === st.current ? 'current' : '',
      d === st.locked ? 'locked' : '',
    ].filter(Boolean).join(' ');
    return `<span class="chip ${cls}" title="${esc(gameLabel(d))}"><img src="${teamLogo(d.opponent)}" alt="${esc(d.opponent)}"></span>`;
  }

  // League tab: every matchup of the week, each as the Matchup tab's header
  // (score, win chance, record and rank, yet to play, projection), yours
  // first. Clicking one opens it on the Matchup tab.
  function league(s) {
    const week = s.weeks?.[s.week];
    const head = `<div class="lg-head"><h3>Matchups</h3>${weekNav(s, week)}</div>`;
    if (!week) return `${head}${loading('Loading week…')}`;
    const groups = new Map();
    for (const r of s.rosters || []) {
      const l = lineup(s, r.roster_id);
      const id = (l?.leg ?? l?.matchup)?.matchup_id;
      if (id == null) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(l);
    }
    const mine = (l) => l.mine;
    const pairs = [...groups.entries()].sort(([a, x], [b, y]) => (y.some(mine) - x.some(mine)) || a - b)
      .map(([, list]) => list.sort((a, b) => mine(b) - mine(a)));
    if (!pairs.length) return `${head}<p class="msg">No matchups this week.</p>`;
    return `${head}<div class="lg-list">${pairs.map(([a, b]) => {
      const left = side(s, a);
      const right = b && side(s, b);
      const [p1, p2] = right ? winProbability(left.points, left.proj, right.points, right.proj) : [null, null];
      const label = `Open ${teamName(s, a.roster)}${b ? ` vs ${teamName(s, b.roster)}` : ''} on the Matchup tab`;
      // A box that opens the matchup, holding team links (so not a <button>).
      return matchupPair(teamOf(s, left, p1), right && teamOf(s, right, p2), {
        cls: `lg-match${a.mine ? ' own' : ''}`,
        attrs: `role="button" tabindex="0" data-open-matchup="${a.roster.roster_id}" aria-label="${esc(label)}"`,
        failed: s.failedAvatars,
      });
    }).join('')}</div>`;
  }

  return { render, league };
})();
