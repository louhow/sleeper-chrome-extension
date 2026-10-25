// Pure render functions: (state, api log) -> HTML string for the shadow root.
(globalThis.SNP ||= {}).view = (() => {
  const { playerDays, lockInDefault, lockState, spotRefs, swapTargets, lockedGameId, scoreTier } = globalThis.SNP.model;
  const { esc, f2, headshot, teamName, avatar, record, injuryTag, positions, gameTime, weekday, lockIcon, slotBadge, weekNav, notice, lineup, taxiRule, reserveRule,
    whatIfOn, whatIfBanner, owns } = globalThis.SNP.ui;
  const PREVIEW_CHARS = 20000;
  const PAGES = { team: 'Team', matchup: 'Matchup' };

  function render(state, log) {
    // Sleeper's League tab keeps its own content; the week's matchups go on top of it.
    if (state.page === 'league') {
      return `<div class="app league">${state.sessionExpired ? sessionExpired() : globalThis.SNP.matchup.league(state)}</div>`;
    }
    const body = state.tab === 'api' ? apiView(state, log)
      : state.sessionExpired ? sessionExpired()
      : state.page === 'matchup' ? globalThis.SNP.matchup.render(state)
      : teamView(state);
    // The notice floats over the panel so showing or clearing it never shifts the cards being clicked.
    // While a dialog is open it shows over the dialog instead.
    const whatIf = state.tab !== 'api' && whatIfOn(state);
    return `<div class="app${whatIf ? ' whatif' : ''}">${toolbar(state, log)}${whatIf ? whatIfBanner(state) : ''}<div class="body">${body}</div>${state.tab === 'api' || state.modal ? '' : notice(state)}</div>`;
  }

  function toolbar(s, log) {
    const tab = (id, label) =>
      `<button role="tab" data-tab="${id}" aria-selected="${s.tab === id}" class="${s.tab === id ? 'active' : ''}">${label}</button>`;
    const picker = s.rosters?.length ? teamPicker(s) : '';
    // Only on the owner's editable Team tab, once the week's games are in.
    const l = s.ready && s.page === 'team' && s.tab === 'page' && !s.error && !s.sessionExpired ? lineup(s) : null;
    const optimize = !(l?.editable && l.week) ? ''
      : whatIfOn(s) ? '<button class="optimize" disabled title="Optimize uses your league\'s scoring. Switch what-if scoring off to use it.">Optimize lineup</button>'
      : `<button class="optimize" data-action="optimize" title="Propose the best starting lineup for this week" ${s.saving ? 'disabled' : ''}>Optimize lineup</button>`;
    return `<nav class="toolbar">
      <div class="tabs" role="tablist">${tab('page', PAGES[s.page] || 'Team')}${tab('api', `API calls <span class="count">${log.length}</span>`)}</div>
      <div class="tools">
        ${optimize}
        ${picker && !s.sessionExpired ? picker : ''}
        <button class="icon" data-action="refresh" title="Refetch everything" aria-label="Refresh">↻</button>
      </div>
    </nav>`;
  }

  // The team shown: a picker with each team's avatar, name and owner, A to Z,
  // and, while it's someone else's, a one-click way back to your own.
  function teamPicker(s) {
    const pic = (r, cls) => {
      const url = r && avatar(s, r);
      return url ? `<img class="${cls}" src="${esc(url)}" alt="">` : `<span class="${cls} blank">${esc(r ? teamName(s, r).slice(0, 1).toUpperCase() : '')}</span>`;
    };
    const teams = [...s.rosters].sort((a, b) => teamName(s, a).localeCompare(teamName(s, b)));
    const current = s.rosters.find((r) => r.roster_id === s.rosterId);
    const mine = s.rosters.find((r) => owns(s, r));
    const back = mine && current && mine.roster_id !== current.roster_id
      ? `<button class="my-team" data-pick-roster="${mine.roster_id}" title="Back to ${esc(teamName(s, mine))}"><span aria-hidden="true">←</span>My team</button>` : '';
    return `${back}<div class="team-pick${s.rosterMenu ? ' open' : ''}">
      <button class="tp-button" data-action="roster-menu" data-roster="${current?.roster_id ?? ''}" aria-haspopup="listbox" aria-expanded="${Boolean(s.rosterMenu)}" aria-label="Team to show">
        ${pic(current, 'tp-avatar')}<span class="tp-name">${esc(current ? teamName(s, current) : 'Pick a team')}</span><span class="tp-chevron" aria-hidden="true"></span>
      </button>
      <div class="tp-menu" role="listbox">${teams.map((r) => {
        const owner = s.usersById?.[r.owner_id];
        return `<button role="option" data-pick-roster="${r.roster_id}" aria-selected="${r.roster_id === s.rosterId}">${pic(r, 'tp-avatar')}
          <span class="tp-label"><b>${esc(teamName(s, r))}</b><small>@${esc(owner?.display_name || 'unknown')}${mine?.roster_id === r.roster_id ? ' · you' : ''}</small></span></button>`;
      }).join('')}</div>
    </div>`;
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
    if (s.error) return `<p class="msg error">${esc(s.error)}</p>`;
    const l = lineup(s);
    if (!l) return '<p class="msg">Loading…</p>';
    const { week, matchup, starters, editable } = l;
    const targets = new Set(editable && s.swap ? swapTargets(s.swap, l) : []);
    // Only spots with somewhere to go get a button, so nothing is a dead click.
    const movable = new Set(editable ? spotRefs(l).filter((ref) => swapTargets(ref, l).length) : []);
    const ctx = {
      movable,
      s,
      week,
      // Sleeper's own per-player points use the league's scoring; what-if rebuilds them from Lock-In rules.
      points: whatIfOn(s) ? null : matchup?.players_points || {},
      locks: l.locks,
      // Your own lineup's lockable games can be locked from their cell.
      lockRoster: l.lockable ? l.roster.roster_id : null,
      started: l.started,
      editable: editable && !s.saving,
      selecting: Boolean(editable && s.swap),
      targets,
    };

    const picked = s.swap && s.players[spotId(s.swap, starters)];
    const hint = editable ? (s.saving ? 'Saving lineup…'
      : picked ? `Pick a player to swap with ${esc(picked.name)} · Esc to cancel`
      : s.swap ? 'Pick a player for this slot · Esc to cancel'
      : 'Tap a position to update your lineup') : '';

    return `
      ${teamCard(s, l)}
      ${week ? rosterSections(ctx, l, hint) : '<p class="msg">Loading week…</p>'}`;
  }

  // A section's header row, aligned with its player rows: title, the week's days, points.
  function sectionHead(ctx, title, hint = '', cls = '') {
    const { s, week } = ctx;
    const days = week.days.map((date) => `<div class="dh${date === s.today ? ' today' : ''}">
      <b>${esc(weekday(date, 'narrow'))}</b>${Number(date.slice(8))}</div>`).join('');
    return `<div class="rhead${cls ? ` ${cls}` : ''}">
      <div class="rtitle"><h3>${esc(title)}</h3>${hint ? `<div class="hint">${hint}</div>` : ''}</div>
      <div class="days">${days}</div>
      <div class="week-pts">Pts</div>
    </div>`;
  }

  // Every player card needs the week's schedule, so these only render once it's loaded.
  function rosterSections(ctx, l, hint) {
    const { s } = ctx;
    const { slots, starters, bench, taxi, reserve, taxiEditable, reserveEditable } = l;
    const settings = s.league.settings || {};
    const card = (slot, id, spot) => playerCard(ctx, slot, id, spot);
    const padded = (ids, count) => [...ids, ...Array(Math.max(0, (count || 0) - ids.length)).fill('0')];
    const openSpots = (prefix, n, slot) => Array.from({ length: n }, (_, k) => card(slot, '0', `${prefix}:${k}`)).join('');
    const taxiCards = taxiEditable
      ? taxi.map((id) => card('TX', id, `t:${id}`)).join('') + openSpots('te', l.taxiRoom, 'TX')
      : padded(taxi, settings.taxi_slots).map((id) => card('TX', id)).join('');
    const reserveCards = reserveEditable
      ? reserve.map((id) => card('IR', id, `r:${id}`)).join('') + openSpots('re', l.reserveRoom, 'IR')
      : padded(reserve, settings.reserve_slots).map((id) => card('IR', id)).join('');
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

  function teamCard(s, l) {
    const { roster, week, matchup, leg, starters } = l;
    const owner = s.usersById?.[roster.owner_id];
    const image = avatar(s, roster);
    // Sleeper's totals use the league's scoring, so under what-if scoring they're added up here from Lock-In rules.
    // The public matchup is cached for minutes, so with the (fresh) leg, or under what-if
    // scoring, the total is added up here as Sleeper does: each starter's locked game,
    // else their latest finished one. Sleeper's own leg points (and a commissioner's custom points) still win.
    const states = (whatIfOn(s) || leg) && week ? starters.filter((id) => id && id !== '0')
      .map((id) => lockState(playerDays(week, s.players[id]?.team, id), l.locks[id], s.now)) : null;
    const proj = whatIfOn(s) && states ? states.reduce((sum, st) => sum + (st.counted ? st.points : lockInDefault(st.games) ?? 0), 0)
      : leg?.proj_points ?? (week && starters.reduce((sum, id) => sum + (lockInDefault(playerDays(week, s.players[id]?.team, id)) ?? 0), 0));
    const live = states?.reduce((sum, st) => sum + st.livePoints, 0);
    const points = whatIfOn(s) ? live
      : leg ? leg.custom_points ?? leg.points ?? live : matchup?.custom_points ?? matchup?.points;
    const opp = matchup?.matchup_id != null &&
      week.matchups.find((m) => m.matchup_id === matchup.matchup_id && m.roster_id !== roster.roster_id);
    const oppRoster = opp && s.rosters.find((r) => r.roster_id === opp.roster_id);
    const name = teamName(s, roster);
    const claims = s.claims?.length || 0;
    return `<section class="team-card">
      ${image ? `<img class="avatar" src="${esc(image)}" alt="">` : '<div class="avatar"></div>'}
      <div class="who">
        <div class="team-name">${esc(name)}</div>
        <div class="sub">${owner && owner.display_name !== name ? `${esc(owner.display_name)} · ` : ''}${record(roster)}${oppRoster ? ` · vs ${esc(teamName(s, oppRoster))}` : ''}</div>
      </div>
      <div class="score">
        <div class="pts">${points ? f2(points) : '–'}</div>
        <div class="sub">proj ${f2(proj)}</div>
      </div>
      ${l.mine ? `<button class="waivers" data-action="claims">Waivers${claims ? ` <span class="count">${claims}</span>` : ''}</button>` : ''}
      ${weekNav(s, week)}
    </section>`;
  }

  function cardClass({ s, editable, selecting, targets }, spot) {
    if (!editable || !spot) return '';
    if (s.swap === spot) return ' selected';
    if (selecting) return targets.has(spot) ? ' target' : ' dim';
    return '';
  }

  function playerCard(ctx, slot, id, spot) {
    const { s, week, points, locks, editable, movable, lockRoster, started } = ctx;
    const button = editable && spot && (movable.has(spot) || s.swap === spot) ? spot : null;
    const cls = cardClass(ctx, spot);
    if (!id || id === '0') {
      return `<article class="card empty${cls}">${slotBadge(slot, button)}<div class="headshot"></div><div class="info"><span class="name">Empty</span></div></article>`;
    }
    const p = s.players[id] || { name: `Player #${id}`, positions: [] };
    const locked = lockedGameId(locks[id]);
    const days = playerDays(week, p.team, id).map((d) => ({ ...d, locked: locked != null && String(d.game?.id) === String(locked) }));
    const lockedDay = days.find((d) => d.locked);
    const st = lockState(days, locks[id], s.now, started ? (game) => started(id, game) : null);
    // Only a starter's finished game can be locked in, and only one they started.
    const starting = !['BN', 'TX', 'IR'].includes(slot);
    const lastDone = st.games.filter((d) => d.game.status === 'complete').at(-1);
    const state = st.lockable ? 'lockable' : st.unsure ? 'maybe' : st.benched ? 'benched' : null;
    const mark = (d) => (starting && d === lastDone ? state : null);
    const research = week.research[id];
    const pct = (n) => (n == null ? '–' : `${Math.ceil(n)}%`);
    return `<article class="card${cls}">
      ${slotBadge(slot, button)}
      <img class="headshot" src="${headshot(id)}" alt="" data-player="${esc(id)}">
      <div class="info">
        <div class="line1"><button class="name" data-player="${esc(id)}">${esc(p.name)}</button>${positions(p)}<span class="team">- ${esc(p.team || 'FA')}</span>${injuryTag(p)}</div>
        <div class="line2" title="Started and rostered in leagues like this one"><b>${pct(research?.started)}</b> Start<span class="bar">|</span><b>${pct(research?.owned)}</b> Rostered</div>
      </div>
      <div class="days">${days.map((d) => {
        const m = mark(d);
        return dayCell(d, s, m, (m === 'lockable' || m === 'maybe') && lockRoster != null ? `${lockRoster}:${id}` : null);
      }).join('')}</div>
      ${lockedDay
        // Locked: the score that counts, boxed like its day cell (its score's color in a gold frame).
        ? `<div class="week-pts locked"><b class="tier-${scoreTier(lockedDay.actual ?? lockedDay.proj ?? 0)}">${lockIcon()}${f2(lockedDay.actual ?? lockedDay.proj ?? 0)}</b></div>`
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
    const kind = done && d.actual != null ? `${state} tier-${scoreTier(d.actual)}` : state;
    const value = done || d.actual != null ? d.actual : d.proj;
    const time = done ? 'Final' : live ? 'Live' : d.game.start ? gameTime(d.game.start) : '';
    const note = mark === 'benched' ? 'played on your bench, so it can\'t be locked in'
      : mark === 'maybe' ? 'can be locked in only if they were starting at tip-off (the extension didn\'t see your lineup then)'
      : { locked: 'locked in', lockable: 'can still be locked in', past: 'too late to lock in' }[state];
    const title = `${weekday(d.date)} ${d.home ? 'vs' : '@'} ${d.opponent}${time ? `, ${time}` : ''}${note ? `, ${note}` : ''}`;
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

  return { render };
})();
