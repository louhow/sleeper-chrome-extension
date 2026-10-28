// The NBA panel: its shell around the tab shown, and the Team tab itself (the
// Matchup and League tabs are in matchup-view.js). Pure: (state, api log) -> HTML.
(globalThis.SNP ||= {}).nbaPanelView = (() => {
  const { playerDays, lockInDefault, statLine, lockState, spotRefs, swapTargets, lockedGameId, scoreTier, gameState } = globalThis.SNP.model;
  const { esc, f2, headshot, teamName, injuryTag, gameTime, weekday, gameLabel, lockIcon, slotBadge, lineup, taxiRule, reserveRule, irBlockNames, irBlockTip,
    whatIfOn, playerOf, teamTag, researchLine, padTo, real, loading, errorMsg, shell, teamCard, rowHead, swapHint, swapClass, emptyCard, apiView, sessionExpired } = globalThis.SNP.ui;

  function render(state, log) {
    // Sleeper's League tab keeps its own content; the week's matchups go on top of it.
    if (state.page === 'league') {
      return `<div class="app league">${state.sessionExpired ? sessionExpired() : globalThis.SNP.nbaMatchupView.league(state)}</div>`;
    }
    const body = state.tab === 'api' ? apiView(state, log)
      : state.sessionExpired ? sessionExpired()
      : state.page === 'matchup' ? globalThis.SNP.nbaMatchupView.render(state)
      : teamView(state);
    // Optimize lineup: only on the owner's editable Team tab, once the week's games are in.
    const l = state.ready && state.page === 'team' && state.tab === 'page' && !state.error && !state.sessionExpired ? lineup(state) : null;
    const blocked = irBlockNames(l);
    return shell(state, log, body, { optimize: Boolean(l?.editable && l.week), irBlock: blocked ? irBlockTip(blocked) : '' });
  }

  function teamView(s) {
    if (s.error) return errorMsg(s.error);
    const l = lineup(s);
    if (!l) return loading();
    const { week, starters, editable } = l;
    const targets = new Set(editable && s.swap ? swapTargets(s.swap, l) : []);
    // Only spots with somewhere to go get a button, so nothing is a dead click.
    const movable = new Set(editable ? spotRefs(l).filter((ref) => swapTargets(ref, l).length) : []);
    const ctx = {
      movable,
      s,
      week,
      // Sleeper's own per-player points use the league's scoring; what-if rebuilds them from Lock-In rules.
      points: whatIfOn(s) ? null : l.matchup?.players_points || {},
      locks: l.locks,
      // Your own lineup's lockable games can be locked from their cell.
      lockRoster: l.lockable ? l.roster.roster_id : null,
      started: l.started,
      editable: editable && !s.saving,
      targets,
    };
    const picked = s.swap && s.players[spotId(s.swap, starters)];
    return `
      ${summary(s, l)}
      ${week ? rosterSections(ctx, l, swapHint(s, editable, picked?.name, irBlockNames(l))) : loading('Loading week…')}`;
  }

  // A section's header row, aligned with its player rows: title, the week's days, points.
  function sectionHead(ctx, title, hint = '', cls = '') {
    const { s, week } = ctx;
    const days = week.days.map((date) => `<div class="dh${date === s.today ? ' today' : ''}">
      <b>${esc(weekday(date, 'narrow'))}</b>${Number(date.slice(8))}</div>`).join('');
    return rowHead(title, { hint, cls, middle: `<div class="days">${days}</div>` });
  }

  // Every player card needs the week's schedule, so these only render once it's loaded.
  function rosterSections(ctx, l, hint) {
    const { s } = ctx;
    const { slots, starters, bench, taxi, reserve, taxiEditable, reserveEditable } = l;
    const settings = s.league.settings || {};
    const card = (slot, id, spot) => playerCard(ctx, slot, id, spot);
    const openSpots = (prefix, n, slot) => Array.from({ length: n }, (_, k) => card(slot, '0', `${prefix}:${k}`)).join('');
    const taxiCards = taxiEditable
      ? taxi.map((id) => card('TX', id, `t:${id}`)).join('') + openSpots('te', l.taxiRoom, 'TX')
      : padTo(taxi, settings.taxi_slots).map((id) => card('TX', id)).join('');
    const reserveCards = reserveEditable
      ? reserve.map((id) => card('IR', id, `r:${id}`)).join('') + openSpots('re', l.reserveRoom, 'IR')
      : padTo(reserve, settings.reserve_slots).map((id) => card('IR', id)).join('');
    const benchCards = bench.map((id) => card('BN', id, `b:${id}`)).join('') +
      (taxiEditable || reserveEditable ? openSpots('be', l.benchRoom, 'BN') : '');
    return `
      ${sectionHead(ctx, 'Starters', hint)}
      ${starters.map((id, i) => card(slots[i] ?? 'UTIL', id, `s:${i}`)).join('')}
      ${benchCards ? `${sectionHead(ctx, 'Bench')}${benchCards}` : ''}
      ${reserve.length || settings.reserve_slots ? `${sectionHead(ctx, 'Injured Reserve', reserveEditable ? esc(reserveRule(settings)) : '', 'ir-head')}${reserveCards}` : ''}
      ${taxi.length || settings.taxi_slots ? `${sectionHead(ctx, 'Taxi Squad', taxiEditable ? esc(taxiRule(l)) : '', 'taxi-head')}${taxiCards}` : ''}
      ${picksView(s)}`;
  }

  // The player in a spot ref (see model.spotOf), or null for an open spot.
  function spotId(ref, starters) {
    const [kind, key] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    if (kind === 's') return starters[Number(key)];
    return kind === 'b' || kind === 't' ? key : null;
  }

  // The team card: points so far and the projection, the Matchup tab's totals
  // (nbaWeek.side), and the Waivers button on your own team.
  function summary(s, l) {
    const { roster, week, matchup } = l;
    const sd = week ? globalThis.SNP.nbaWeek.side(s, l) : null;
    const opp = matchup?.matchup_id != null &&
      week.matchups.find((m) => m.matchup_id === matchup.matchup_id && m.roster_id !== roster.roster_id);
    const claims = s.claims?.length || 0;
    return teamCard(s, roster, {
      points: sd?.anyPoints ? sd.points : null,
      proj: sd?.proj ?? null,
      opponent: opp && s.rosters.find((r) => r.roster_id === opp.roster_id),
      week,
      extra: l.mine ? `<button class="waivers" data-action="claims">Waivers${claims ? ` <span class="count">${claims}</span>` : ''}</button>` : '',
    });
  }

  // Their latest finished game this week, as the box score under the name:
  // "@ NYK · 26 PTS, 4 REB, ..." (the whole line is the tooltip when it's cut short).
  function lastGameLine(s, week, id, done) {
    const stats = done && statLine(week.statRows?.find((r) => String(r.player_id) === String(id) && String(r.game_id) === String(done.game.id))?.stats);
    if (!stats) return '';
    const text = `${done.home ? 'vs' : '@'} ${done.opponent} · ${stats}`;
    return `<div class="line3" title="${esc(`${weekday(done.date)} ${text}`)}">${esc(text)}</div>`;
  }

  function playerCard(ctx, slot, id, spot) {
    const { s, week, points, locks, editable, movable, lockRoster, started, targets } = ctx;
    const button = editable && spot && (movable.has(spot) || s.swap === spot) ? spot : null;
    const cls = swapClass(s, editable, spot, targets);
    if (!real(id)) return emptyCard(slotBadge(slot, button), cls);
    const p = playerOf(s.players, id);
    const locked = lockedGameId(locks[id]);
    const days = playerDays(week, p.team, id).map((d) => ({ ...d, locked: locked != null && String(d.game?.id) === String(locked) }));
    const lockedDay = days.find((d) => d.locked);
    const st = lockState(days, locks[id], s.now, started ? (game) => started(id, game) : null);
    // Only a starter's finished game can be locked in, and only one they started.
    const starting = !['BN', 'TX', 'IR'].includes(slot);
    const lastDone = st.games.filter((d) => d.game.status === 'complete').at(-1);
    const state = st.lockable ? 'lockable' : st.unsure ? 'maybe' : st.benched ? 'benched' : null;
    const mark = (d) => (starting && d === lastDone ? state : null);
    return `<article class="card${cls}">
      ${slotBadge(slot, button)}
      <img class="headshot" src="${headshot(id)}" alt="" data-player="${esc(id)}">
      <div class="info">
        <div class="line1"><button class="name" data-player="${esc(id)}">${esc(p.name)}</button>${teamTag(p, { chips: true })}${injuryTag(p)}</div>
        ${researchLine(week.research[id])}
        ${lastGameLine(s, week, id, lastDone)}
      </div>
      <div class="days">${days.map((d) => {
        const m = mark(d);
        return dayCell(d, s, m, (m === 'lockable' || m === 'maybe') && lockRoster != null ? `${lockRoster}:${id}` : null);
      }).join('')}</div>
      ${lockedDay
        // Locked: the score that counts, boxed like its day cell (its score's color in a gold frame).
        ? `<div class="week-pts locked"><b class="tier-${scoreTier(lockedDay.actual ?? lockedDay.proj ?? 0, s.tiers)}">${lockIcon()}${f2(lockedDay.actual ?? lockedDay.proj ?? 0)}</b></div>`
        : `<div class="week-pts">
        <b>${f2(points ? points[id] : st.points)}</b>
        <span>proj ${f2(lockInDefault(days))}</span>
      </div>`}
    </article>`;
  }

  // One day of a player's week: opponent, points (projected until played) and
  // tip-off, styled by where the game stands. A game locked in is filled; a
  // finished one that can still be locked is outlined bright, with an open
  // lock; one that may be lockable (unknown whether they started it) is
  // outlined dashed; finished games past locking, or played on the bench,
  // recede; live and today's games stand out from the rest of the week. With
  // `lockRef` (your own lineup), a lockable cell is a button: hovering it asks
  // "Lock?", and clicking it asks to confirm in the cell, since a lock is final.
  // `mark`: 'lockable', 'maybe' or 'benched' for the finished game in question.
  // A game played is tinted by its score (green, yellow, red, as in the game
  // log); a locked one keeps its gold fill, framed in that color.
  function dayCell(d, s, mark, lockRef = null) {
    const lockable = mark === 'lockable' || mark === 'maybe';
    if (!d.game) return `<div class="day${d.date === s.today ? ' today' : ''}"><div class="cell"></div></div>`;
    const where = gameState(d.game, s.now);
    const done = where === 'done';
    const live = where === 'live';
    const state = d.locked ? 'locked' : mark === 'lockable' ? 'lockable' : mark === 'maybe' ? 'lockable maybe'
      : done ? 'past' : live ? 'live' : d.date === s.today ? 'today' : 'future';
    const kind = done && d.actual != null ? `${state} tier-${scoreTier(d.actual, s.tiers)}` : state;
    const value = done || d.actual != null ? d.actual : d.proj;
    const time = done ? 'Final' : live ? 'Live' : d.game.start ? gameTime(d.game.start) : '';
    const note = mark === 'benched' ? 'played on your bench, so it can\'t be locked in'
      : mark === 'maybe' ? 'can be locked in only if they were starting at tip-off (the extension didn\'t see your lineup then)'
      : { locked: 'locked in', lockable: 'can still be locked in', past: 'too late to lock in' }[state];
    const title = `${gameLabel(d)}${time ? `, ${time}` : ''}${note ? `, ${note}` : ''}`;
    const icon = d.locked || lockable ? lockIcon(!d.locked) : '';
    const shown = value == null ? '–' : f2(value);
    if (lockRef && s.lockConfirm === lockRef) {
      return `<div class="day game ${kind} confirming" title="${esc(mark === 'maybe' ? `Lock in ${shown}? Only if they were starting at tip-off. Locking is final.` : `Lock in ${shown}? Locking is final.`)}">
      <div class="cell">
        <span class="ask"><span>Lock</span><span>${esc(shown)}?</span></span>
        <span class="yes-no"><button class="yes" data-lock-confirm="${esc(lockRef)}" ${s.saving ? 'disabled' : ''}>Yes</button><button class="no" data-lock-cancel ${s.saving ? 'disabled' : ''}>No</button></span>
      </div>
    </div>`;
    }
    const inner = `<span class="o">${d.home ? 'vs ' : '@'}${esc(d.opponent)}</span>
        <span class="v">${shown}</span>
        <span class="time"><span class="when">${icon}${esc(time)}</span>${lockRef ? `<span class="ask">${lockIcon(true)}Lock?</span>` : ''}</span>`;
    // Today's games read by their state; "today" is one still to tip off.
    return `<div class="day game ${kind}" title="${esc(title)}">
      ${lockRef ? `<button class="cell" data-lock="${esc(lockRef)}" ${s.saving ? 'disabled' : ''} aria-label="${esc(`Lock in ${shown}, ${title}`)}">${inner}</button>`
        : `<div class="cell">${inner}</div>`}
    </div>`;
  }

  function picksView(s) {
    if (!s.picks?.length) return '';
    const ordinal = (n) => {
      const teen = n % 100 >= 11 && n % 100 <= 13;
      return `${n}${(!teen && { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10]) || 'th'}`;
    };
    const byId = Object.fromEntries(s.rosters.map((r) => [r.roster_id, r]));
    return `<div class="rhead"><div class="rtitle"><h3>Draft Picks</h3></div></div><ul class="picks">${s.picks.map((p) => `<li>
      <b>${esc(p.season)} ${ordinal(p.round)} Rd</b>
      ${p.original !== s.rosterId ? `<span class="sub">via ${esc(teamName(s, byId[p.original] || { roster_id: p.original }))}</span>` : ''}
    </li>`).join('')}</ul>`;
  }

  return { render };
})();
