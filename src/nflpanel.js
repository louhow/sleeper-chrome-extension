// NFL Team and Matchup tabs, drawn like the NBA ones in place of Sleeper's own
// (which stay on the page, hidden, so its saves still work): a compact row per
// player, any team or matchup from the picker. Pure: state -> HTML.
(globalThis.SNP ||= {}).nflpanel = (() => {
  const { esc, f2, teamName, avatar, record, weekNav, notice } = globalThis.SNP.ui;
  const { scoreTier, spotRefs, swapTargets, winProbability } = globalThis.SNP.model;
  const nfl = globalThis.SNP.nfl;
  const view = globalThis.SNP.view;
  const PAGES = { team: 'Team', matchup: 'Matchup' };
  const real = (id) => id && id !== '0';

  function render(s, log) {
    const body = s.tab === 'api' ? view.apiView(s, log)
      : s.sessionExpired ? view.sessionExpired()
      : s.error ? `<p class="msg error">${esc(s.error)}</p>`
      : s.page === 'matchup' ? matchupView(s)
      : teamView(s);
    return `<div class="app nfl-panel">${toolbar(s, log)}<div class="body">${body}</div>${s.tab === 'api' || s.modal ? '' : notice(s)}</div>`;
  }

  function toolbar(s, log) {
    const tab = (id, label) => `<button role="tab" data-tab="${id}" aria-selected="${s.tab === id}" class="${s.tab === id ? 'active' : ''}">${label}</button>`;
    const picker = !s.rosters?.length || s.sessionExpired ? '' : s.page === 'matchup' ? view.matchupPicker(s) : view.teamPicker(s);
    const l = s.page === 'team' && s.tab === 'page' ? lineup(s) : null;
    const optimize = l?.mine && s.optimizable
      ? `<button class="optimize" data-action="optimize" title="Propose the best starting lineup for this week" ${s.saving ? 'disabled' : ''}>Optimize lineup</button>` : '';
    return `<nav class="toolbar">
      <div class="tabs" role="tablist">${tab('page', PAGES[s.page] || 'Team')}${tab('api', `API calls <span class="count">${log.length}</span>`)}</div>
      <div class="tools">
        ${optimize}
        ${picker}
        <button class="icon" data-action="sleeper-view" title="Show Sleeper's own ${esc(PAGES[s.page] || 'Team')} tab" aria-label="Sleeper's view">⇄</button>
        <button class="icon" data-action="refresh" title="Refetch everything" aria-label="Refresh">↻</button>
      </div>
    </nav>`;
  }

  // One roster's lineup for the shown week. The logged-in leg is Sleeper's own;
  // the public matchup (cached for minutes) and the roster are fallbacks.
  function lineup(s, rosterId = s.rosterId) {
    const roster = s.rosters?.find((r) => r.roster_id === rosterId);
    const week = s.weeks?.[s.week];
    if (!roster || !week) return null;
    const slots = (s.league.roster_positions || []).filter((p) => p !== 'BN');
    const leg = week.legs?.find((x) => x.roster_id === roster.roster_id);
    const matchup = week.matchups.find((m) => m.roster_id === roster.roster_id);
    const starters = leg?.starters ?? matchup?.starters ?? roster.starters ?? [];
    const reserve = roster.reserve || [];
    const taxi = roster.taxi || [];
    const placed = new Set([...starters, ...reserve, ...taxi]);
    const bench = (roster.players || []).filter((id) => !placed.has(id))
      .sort((a, b) => POSITION_ORDER.indexOf(s.players[a]?.position) - POSITION_ORDER.indexOf(s.players[b]?.position));
    const mine = owns(s, roster);
    return { roster, week, slots, starters, bench, reserve, taxi, leg, matchup, mine, players: s.players, editable: mine && s.editableWeek === s.week };
  }
  const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
  const owns = (s, roster) => s.me != null && (roster.owner_id === s.me || (roster.co_owners || []).includes(s.me));

  // The player's game this week and where it stands: 'bye', 'pre', 'live' or 'done'.
  function gameOf(s, id) {
    const week = s.weeks[s.week];
    const team = week.teamOf[id] ?? s.players[id]?.team;
    const g = team && week.games[team];
    if (!g) return { state: 'bye', team };
    const state = g.status === 'complete' ? 'done' : g.status === 'in_game' || (g.start != null && g.start <= s.now) ? 'live' : 'pre';
    const home = g.home === team;
    return { ...g, state, team, homeSide: home, opponent: home ? g.away : g.home, mine: home ? g.homeScore : g.awayScore, theirs: home ? g.awayScore : g.homeScore };
  }

  // Points so far (Sleeper's stats, scored with the league's settings), and the
  // projection: the game's, until it's on; then what's scored plus the
  // projection for the time left; once it's over, what was scored.
  function numbers(s, id) {
    const week = s.weeks[s.week];
    const g = gameOf(s, id);
    const actual = week.actual[id];
    const proj = week.proj[id] ?? 0;
    const now = g.state === 'done' ? actual ?? 0 : g.state === 'live' ? (actual ?? 0) + proj * g.left : proj;
    return { g, actual, proj, now };
  }

  function gameText(s, g) {
    if (g.state === 'bye') return 'Bye';
    const at = `${g.homeSide ? 'vs' : '@'} ${g.opponent}`;
    if (g.state === 'done') {
      const result = g.mine > g.theirs ? 'W' : g.mine < g.theirs ? 'L' : 'T';
      return `${at} · Final ${result} ${g.mine ?? 0}-${g.theirs ?? 0}`;
    }
    if (g.state === 'live') return `${at} · ${g.clock} · ${g.mine ?? 0}-${g.theirs ?? 0}${g.redZone === g.team ? ' · RZ' : ''}`;
    return `${at} · ${kickoff(g.start)}`;
  }
  const kickoff = (ms) => (ms == null ? '' : new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(/\s(AM|PM)$/i, (m) => m.trim().toLowerCase()).replace(/:00(am|pm)/, '$1'));

  // A box score in a line, as Sleeper's Team tab shows it: "18 CAR, 101 YD, 3/4 REC, 36 YD".
  function statLine(st, position) {
    if (!st) return '';
    const n = (k) => st[k] || 0;
    const out = [];
    if (position === 'DEF') {
      if (n('sack')) out.push(`${n('sack')} SACK`);
      if (n('int')) out.push(`${n('int')} INT`);
      if (n('fum_rec')) out.push(`${n('fum_rec')} FR`);
      if (n('def_td')) out.push(`${n('def_td')} TD`);
      if (st.pts_allow != null) out.push(`${st.pts_allow} PA`);
      return out.join(', ');
    }
    if (position === 'K') {
      if (n('fga')) out.push(`${n('fgm')}/${n('fga')} FG`);
      if (n('xpa')) out.push(`${n('xpm')}/${n('xpa')} XP`);
      return out.join(', ');
    }
    if (n('pass_att')) out.push(`${n('pass_cmp')}/${n('pass_att')} CMP`, `${n('pass_yd')} YD`);
    if (n('pass_td')) out.push(`${n('pass_td')} TD`);
    if (n('pass_int')) out.push(`${n('pass_int')} INT`);
    if (n('rush_att')) out.push(`${n('rush_att')} CAR`, `${n('rush_yd')} YD`);
    if (n('rush_td')) out.push(`${n('rush_td')} TD`);
    if (n('rec_tgt') || n('rec')) out.push(`${n('rec')}/${n('rec_tgt')} REC`, `${n('rec_yd')} YD`);
    if (n('rec_td')) out.push(`${n('rec_td')} TD`);
    if (n('fum_lost')) out.push(`${n('fum_lost')} FUM`);
    if (['DL', 'LB', 'DB'].includes(position)) {
      if (n('idp_tkl')) out.push(`${n('idp_tkl')} TKL`);
      if (n('idp_sack')) out.push(`${n('idp_sack')} SACK`);
      if (n('idp_int')) out.push(`${n('idp_int')} INT`);
    }
    return out.join(', ');
  }

  // Team totals for a lineup: points so far and the live projection.
  function totals(s, l) {
    const ids = l.starters.filter(real);
    const live = ids.map((id) => numbers(s, id));
    const points = l.leg?.custom_points ?? l.matchup?.custom_points ?? live.reduce((sum, x) => sum + (x.actual ?? 0), 0);
    return { points, proj: live.reduce((sum, x) => sum + x.now, 0), toPlay: live.filter((x) => x.g.state === 'pre').length };
  }

  function opponentOf(s, l) {
    const own = l.leg ?? l.matchup;
    if (own?.matchup_id == null) return null;
    const pool = l.leg ? s.weeks[s.week].legs : s.weeks[s.week].matchups;
    return pool.find((m) => m.matchup_id === own.matchup_id && m.roster_id !== l.roster.roster_id)?.roster_id ?? null;
  }

  // ---- Team tab ----

  function teamView(s) {
    const l = lineup(s);
    if (!l) return '<p class="msg">Loading…</p>';
    const t = totals(s, l);
    const oppId = opponentOf(s, l);
    const opp = oppId != null && s.rosters.find((r) => r.roster_id === oppId);
    const owner = s.usersById?.[l.roster.owner_id];
    const name = teamName(s, l.roster);
    const image = avatar(s, l.roster);
    const editable = l.editable && !s.saving;
    const ml = editable ? moveLineup(s, l) : null;
    const targets = new Set(ml && s.swap ? targetsOf(s.swap, ml) : []);
    // Only spots with somewhere to go get a button, so nothing is a dead click.
    const movable = new Set(ml ? spotRefs(ml).filter((ref) => !ml.lockedRefs.has(ref) && targetsOf(ref, ml).length) : []);
    const ctx = { s, l, editable, targets, movable };
    const picked = s.swap && spotPlayer(s.swap, l);
    const hint = l.editable ? (s.saving ? 'Saving lineup…'
      : picked ? `Pick a player to swap with ${esc(s.players[picked]?.name || 'them')} · Esc to cancel`
      : s.swap ? 'Pick a player for this slot · Esc to cancel'
      : 'Tap a position to update your lineup') : '';
    const settings = s.league.settings || {};
    const row = (slot, id, spot) => playerRow(ctx, slot, id, spot);
    return `<section class="team-card">
        ${image ? `<img class="avatar" src="${esc(image)}" alt="">` : '<div class="avatar"></div>'}
        <div class="who">
          <div class="team-name">${esc(name)}</div>
          <div class="sub">${owner && owner.display_name !== name ? `${esc(owner.display_name)} · ` : ''}${record(l.roster)}${opp ? ` · vs ${esc(teamName(s, opp))}` : ''}</div>
        </div>
        <div class="score">
          <div class="pts">${f2(t.points)}</div>
          <div class="sub">proj ${f2(t.proj)}</div>
        </div>
        ${weekNav(s, l.week)}
      </section>
      ${head('Starters', hint)}
      ${l.starters.map((id, i) => row(l.slots[i] ?? 'FLEX', id, `s:${i}`)).join('')}
      ${l.bench.length ? `${head('Bench')}${l.bench.map((id) => row('BN', id, `b:${id}`)).join('')}` : ''}
      ${l.reserve.length || settings.reserve_slots ? `${head('Injured Reserve')}${l.reserve.map((id) => row('IR', id)).join('') || '<p class="msg quiet">No one on IR</p>'}` : ''}
      ${l.taxi.length || settings.taxi_slots ? `${head('Taxi Squad')}${l.taxi.map((id) => row('TX', id)).join('') || '<p class="msg quiet">No one on taxi</p>'}` : ''}`;
  }

  // The lineup as model.swapTargets sees it (starters and bench), and the
  // spots held by players whose game has kicked off, which Sleeper locks.
  function moveLineup(s, l) {
    const locked = (id) => real(id) && ['live', 'done'].includes(gameOf(s, id).state);
    const players = Object.fromEntries([...l.starters, ...l.bench].filter(real).map((id) => [id, s.players[id] || { positions: [] }]));
    const starters = l.starters.map((id) => id || '0');
    const lockedRefs = new Set([...starters.flatMap((id, i) => (locked(id) ? [`s:${i}`] : [])), ...l.bench.filter(locked).map((id) => `b:${id}`)]);
    return { slots: l.slots, starters, bench: l.bench, players, taxi: [], reserve: [], settings: {}, lockedRefs };
  }
  const targetsOf = (ref, ml) => swapTargets(ref, ml).filter((r) => !ml.lockedRefs.has(r));

  function spotPlayer(ref, l) {
    const [kind, key] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    return kind === 's' ? l.starters[Number(key)] : key;
  }

  function head(title, hint = '') {
    return `<div class="rhead nfl">
      <div class="rtitle"><h3>${esc(title)}</h3>${hint ? `<div class="hint">${hint}</div>` : ''}</div>
      <div class="nfl-game-h">Game</div>
      <div class="week-pts">Pts</div>
    </div>`;
  }

  function playerRow(ctx, slot, id, spot = null) {
    const { s, editable, targets, movable } = ctx;
    const button = editable && spot && (movable.has(spot) || s.swap === spot) ? spot : null;
    const cls = !editable || !spot ? '' : s.swap === spot ? ' selected' : s.swap ? (targets.has(spot) ? ' target' : ' dim') : '';
    if (!real(id)) {
      return `<article class="card nfl empty${cls}">${nfl.slotBadge(slot, button)}<div class="headshot"></div><div class="info"><span class="name">Empty</span></div></article>`;
    }
    const p = s.players[id] || { name: `Player #${id}`, positions: [] };
    const week = s.weeks[s.week];
    const { g, actual, proj } = numbers(s, id);
    const research = week.research[id];
    const pct = (n) => (n == null ? '–' : `${Math.ceil(n)}%`);
    const tier = g.state === 'done' && actual != null ? scoreTier(actual, s.tiers, p.positions?.[0] || p.position) : '';
    return `<article class="card nfl${cls}">
      ${nfl.slotBadge(slot, button)}
      <img class="headshot${p.position === 'DEF' ? ' logo' : ''}" src="${nfl.headshot(id, p)}" alt="" data-player="${esc(id)}">
      <div class="info">
        <div class="line1"><button class="name" data-player="${esc(id)}">${esc(p.name)}</button><span class="team">${esc(p.position || '')} - ${esc(p.team || 'FA')}</span>${nfl.injury(p)}</div>
        <div class="line2" title="Started and rostered in leagues like this one"><b>${pct(research?.started)}</b> Start<span class="bar">|</span><b>${pct(research?.owned)}</b> Rostered</div>
      </div>
      <div class="nfl-game ${g.state}">
        <b>${esc(gameText(s, g))}</b>
        <span>${esc(statLine(week.stats[id], p.position))}</span>
      </div>
      <div class="week-pts">
        <b class="${tier ? `tier-${tier}` : ''}">${g.state === 'pre' || g.state === 'bye' ? '–' : f2(actual ?? 0)}</b>
        <span>proj ${f2(proj)}</span>
      </div>
    </article>`;
  }

  // ---- Matchup tab ----

  function matchupView(s) {
    const mine = lineup(s);
    if (!mine) return '<p class="msg">Loading…</p>';
    const oppId = opponentOf(s, mine);
    const theirs = oppId != null ? lineup(s, oppId) : null;
    const a = totals(s, mine);
    const b = theirs && totals(s, theirs);
    const [p1, p2] = b ? winProbability(a.points, a.proj, b.points, b.proj) : [null, null];
    const card = (l, t, p) => ({
      avatar: avatar(s, l.roster),
      owner: s.usersById?.[l.roster.owner_id]?.display_name,
      team: teamName(s, l.roster),
      score: f2(t.points),
      win: p == null ? '' : `${Math.round(p * 100)}%`,
      bar: p == null ? 0 : p * 100,
      record: record(l.roster),
      proj: f2(t.proj),
      rosterId: l.roster.roster_id,
    });
    const rows = (title, slot, x, y) => {
      const n = Math.max(x.length, y.length);
      return n ? `<h3 class="mu-title">${title}</h3>${Array.from({ length: n }, (_, i) => muRow(s, slot, x[i], y[i], Boolean(theirs))).join('')}` : '';
    };
    return `<div class="lg-match mu-head nfl-mu-head">
        ${nfl.side(card(mine, a, p1), 'mine', s.failedAvatars || new Set())}
        <span class="vs">VS</span>
        ${theirs ? nfl.side(card(theirs, b, p2), 'theirs', s.failedAvatars || new Set()) : '<div class="mu-team theirs bye"><span class="sub">No opponent this week</span></div>'}
      </div>
      <div class="mu-starters">
        <div><h3>Starters</h3><div class="hint">${a.toPlay} yet to play${b ? ` · ${b.toPlay} for them` : ''}</div></div>
        ${weekNav(s, mine.week)}
      </div>
      ${mine.slots.map((slot, i) => muRow(s, slot, mine.starters[i], theirs?.starters[i], Boolean(theirs))).join('')}
      ${rows('Bench', 'BN', mine.bench, theirs?.bench || [])}
      ${rows('Injured Reserve', 'IR', mine.reserve, theirs?.reserve || [])}
      ${rows('Taxi Squad', 'TX', mine.taxi, theirs?.taxi || [])}`;
  }

  function muRow(s, slot, idA, idB, hasOpponent) {
    return `<div class="mu-row">
      ${side(s, idA, 'mine')}
      ${nfl.slotBadge(slot)}
      ${hasOpponent ? side(s, idB, 'theirs') : '<div class="mp theirs empty"></div>'}
    </div>`;
  }

  function side(s, id, cls) {
    if (!real(id)) return `<div class="mp nfl ${cls} empty"><div class="headshot"></div><div class="mp-id"><span class="name">Empty</span></div></div>`;
    const p = s.players[id] || { name: `Player #${id}`, positions: [] };
    const { g, actual, proj } = numbers(s, id);
    const tier = g.state === 'done' && actual != null ? scoreTier(actual, s.tiers, p.positions?.[0] || p.position) : '';
    const at = g.state === 'bye' ? 'Bye' : `${g.homeSide ? 'vs' : '@'} ${g.opponent}`;
    const when = g.state === 'done' ? `Final ${g.mine ?? 0}-${g.theirs ?? 0}` : g.state === 'live' ? `${g.clock} · ${g.mine ?? 0}-${g.theirs ?? 0}${g.redZone === g.team ? ' · RZ' : ''}` : g.state === 'pre' ? kickoff(g.start) : '';
    const short = p.position === 'DEF' ? p.name : `${(p.first || p.name || '').slice(0, 1)}. ${p.last || p.name}`;
    return `<div class="mp nfl ${cls}">
      <img class="headshot${p.position === 'DEF' ? ' logo' : ''}" src="${nfl.headshot(id, p)}" alt="" data-player="${esc(id)}">
      <div class="mp-id">
        <div class="name"><button data-player="${esc(id)}">${esc(short)}</button>${nfl.injury(p)}</div>
        <div class="sub"><span class="team">${esc(p.position || '')} • ${esc(p.team || 'FA')}</span></div>
      </div>
      <div class="mp-game ${g.state}"><b>${esc(at)}</b><span class="sub">${esc(when)}</span></div>
      <div class="mp-pts"><b class="${tier ? `tier-${tier}` : ''}">${g.state === 'pre' || g.state === 'bye' ? '–' : f2(actual ?? 0)}</b><span>proj ${f2(proj)}</span></div>
    </div>`;
  }

  return { render, lineup, moveLineup, targetsOf, numbers, gameText, statLine, totals, kickoff };
})();
