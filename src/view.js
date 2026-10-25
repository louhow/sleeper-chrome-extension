// Pure render functions: (state, api log) -> HTML string for the shadow root.
(globalThis.SNP ||= {}).view = (() => {
  const { playerDays, lockInDefault, lockState, spotRefs, swapTargets, lockedGameId, scoreTier } = globalThis.SNP.model;
  const { esc, f2, headshot, teamName, injuryTag, gameTime, weekday, gameLabel, lockIcon, slotBadge, lineup, taxiRule, reserveRule,
    whatIfOn, playerOf, teamTag, researchLine, padTo, real, loading, errorMsg, shell, teamCard, rowHead, swapHint, swapClass, emptyCard,
    teamPicker, matchupPicker, matchupPairs } = globalThis.SNP.ui;
  const PREVIEW_CHARS = 20000;

  function render(state, log) {
    // Sleeper's League tab keeps its own content; the week's matchups go on top of it.
    if (state.page === 'league') {
      return `<div class="app league">${state.sessionExpired ? sessionExpired() : globalThis.SNP.matchup.league(state)}</div>`;
    }
    const body = state.tab === 'api' ? apiView(state, log)
      : state.sessionExpired ? sessionExpired()
      : state.page === 'matchup' ? globalThis.SNP.matchup.render(state)
      : teamView(state);
    // Optimize lineup: only on the owner's editable Team tab, once the week's games are in.
    const l = state.ready && state.page === 'team' && state.tab === 'page' && !state.error && !state.sessionExpired ? lineup(state) : null;
    return shell(state, log, body, { optimize: Boolean(l?.editable && l.week) });
  }

  // In place of the tab while Sleeper rejects the page's login.
  function sessionExpired() {
    return `<div class="session-expired" role="alert">
      <h3>Log back in to Sleeper</h3>
      <p>Sleeper turned down this browser's login, so your lineups, <span class="nowrap">Lock-In</span> picks and scores can't load correctly.</p>
      <p>Log out of Sleeper, log back in, then reload this page.</p>
    </div>`;
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
      ${week ? rosterSections(ctx, l, swapHint(s, editable, picked?.name)) : loading('Loading week…')}`;
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

  // The team card: points so far and the projection, and the Waivers button on your own team.
  function summary(s, l) {
    const { roster, week, matchup, leg, starters } = l;
    // The public matchup is cached for minutes, so with the (fresh) leg, or under what-if
    // scoring (Sleeper's totals use the league's), the total is added up here as Sleeper
    // does: each starter's locked game, else their latest finished one. Sleeper's own
    // leg points (and a commissioner's custom points) still win.
    const states = (whatIfOn(s) || leg) && week ? starters.filter(real)
      .map((id) => lockState(playerDays(week, s.players[id]?.team, id), l.locks[id], s.now)) : null;
    const proj = whatIfOn(s) && states ? states.reduce((sum, st) => sum + (st.counted ? st.points : lockInDefault(st.games) ?? 0), 0)
      : leg?.proj_points ?? (week && starters.reduce((sum, id) => sum + (lockInDefault(playerDays(week, s.players[id]?.team, id)) ?? 0), 0));
    const live = states?.reduce((sum, st) => sum + st.livePoints, 0);
    const points = whatIfOn(s) ? live
      : leg ? leg.custom_points ?? leg.points ?? live : matchup?.custom_points ?? matchup?.points;
    const opp = matchup?.matchup_id != null &&
      week.matchups.find((m) => m.matchup_id === matchup.matchup_id && m.roster_id !== roster.roster_id);
    const claims = s.claims?.length || 0;
    return teamCard(s, roster, {
      points: points || null,
      proj,
      opponent: opp && s.rosters.find((r) => r.roster_id === opp.roster_id),
      week,
      extra: l.mine ? `<button class="waivers" data-action="claims">Waivers${claims ? ` <span class="count">${claims}</span>` : ''}</button>` : '',
    });
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
    const done = d.game.status === 'complete';
    const live = !done && (d.game.status === 'in_game' || (d.game.start != null && d.game.start <= s.now));
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

  function apiView(s, log) {
    if (!log.length) return '<p class="msg">No calls yet.</p>';
    return `<ol class="calls">${log.map((e) => callItem(s, e)).join('')}</ol>`;
  }

  function callItem(s, e) {
    const kind = e.status === 'pending' ? 'pending'
      : e.status === 'cache' ? 'cache'
      : typeof e.status === 'number' && e.status < 400 && !e.error ? 'ok' : 'bad';
    const meta = [
      e.ms != null && e.status !== 'cache' ? `${Math.round(e.ms)} ms` : '',
      e.bytes != null ? size(e.bytes) : '',
      new Date(e.at).toLocaleTimeString(),
    ].filter(Boolean).join(' · ');
    const open = s.openCalls.has(e.id);
    const detail = !open ? '' : [
      e.request ? `<pre class="request">${esc(e.request.trim())}</pre>` : '',
      e.error ? `<pre class="error">${esc(e.error)}</pre>` : '',
      e.json !== undefined ? `<pre>${esc(preview(e))}</pre>` : '',
    ].join('');
    return `<li><details data-call="${e.id}" ${open ? 'open' : ''}>
      <summary><span class="status ${kind}">${esc(e.status)}</span><span class="call"><code>${esc(e.path)}</code><span class="meta">${e.auth ? '<span class="auth">auth</span> · ' : ''}${meta}</span></span></summary>
      ${detail}
      ${e.request ? '' : `<a href="${esc(e.url)}" target="_blank" rel="noreferrer">Open raw response ↗</a>`}
    </details></li>`;
  }

  function preview(e) {
    if (e.preview == null) {
      const text = JSON.stringify(e.json, null, 2);
      e.preview = text.length > PREVIEW_CHARS
        ? `${text.slice(0, PREVIEW_CHARS)}\n… truncated (${size(text.length)} total).`
        : text;
    }
    return e.preview;
  }

  function size(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  // The pickers live in ui.js (both sports use them); content.js reads matchupPairs from here.
  return { render, matchupPairs, teamPicker, matchupPicker, apiView, sessionExpired };
})();
