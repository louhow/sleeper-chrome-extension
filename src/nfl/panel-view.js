// NFL Team and Matchup tabs, drawn like the NBA ones in place of Sleeper's own
// (which stay on the page, hidden, so its saves still work): a compact row per
// player, any team or matchup from the picker. Pure: state -> HTML.
(globalThis.SNP ||= {}).nflPanelView = (() => {
  const { esc, f2, shortName, weekNav, real, playerOf, teamTag, researchLine, padTo, loading, errorMsg, owns, rosterParts, opponentOf,
    shell, pageTitle, teamCard, teamSideOf, matchupPair, rowHead, swapHint, swapClass, emptyCard, tierClass, muRow, muEmpty, muStarters, muSection, apiView, sessionExpired } = globalThis.SNP.ui;
  const { scoreTier, spotRefs, swapTargets, winProbability, gameState, medianOn, leagueMedian, medianStanding } = globalThis.SNP.model;
  const { slotBadge, headshot, injury } = globalThis.SNP.nflUi;
  // Sleeper's apps list bench players by position in this order.
  const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];

  function render(s, log) {
    const body = s.tab === 'api' ? apiView(s, log)
      : s.sessionExpired ? sessionExpired()
      : s.error ? errorMsg(s.error)
      : s.page === 'matchup' ? matchupView(s)
      : teamView(s);
    const l = s.page === 'team' && s.tab === 'page' ? lineup(s) : null;
    return shell(s, log, body, {
      cls: 'nfl-panel',
      optimize: Boolean(l?.mine && s.optimizable),
      tools: `<button class="icon" data-action="sleeper-view" title="Show Sleeper's own ${esc(pageTitle(s))} tab" aria-label="Sleeper's view">⇄</button>`,
    });
  }

  // One roster's lineup for the shown week (see ui.rosterParts), once its games are in.
  function lineup(s, rosterId = s.rosterId) {
    const parts = s.weeks?.[s.week] ? rosterParts(s, rosterId, POSITION_ORDER) : null;
    if (!parts) return null;
    const mine = owns(s, parts.roster);
    return { ...parts, mine, players: s.players, editable: mine && s.editableWeek === s.week };
  }

  // The player's game this week and where it stands: 'bye', else model.gameState's 'left', 'live' or 'done'.
  function gameOf(s, id) {
    const week = s.weeks[s.week];
    const team = week.teamOf[id] ?? s.players[id]?.team;
    const g = team && week.games[team];
    if (!g) return { state: 'bye', team };
    const state = gameState(g, s.now);
    const home = g.home === team;
    return { ...g, state, team, homeSide: home, opponent: home ? g.away : g.home, mine: home ? g.homeScore : g.awayScore, theirs: home ? g.awayScore : g.homeScore };
  }
  const kickedOff = (g) => g.state === 'live' || g.state === 'done';

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

  // Where the game stands in a few words: "@ KC · Final W 27-20", "vs PHI · Q2 4:12 · 7-10 · RZ", "@ SEA · Sun 4:25pm".
  function gameText(g) {
    if (g.state === 'bye') return 'Bye';
    const at = `${g.homeSide ? 'vs' : '@'} ${g.opponent}`;
    if (g.state === 'done') {
      const result = g.mine > g.theirs ? 'W' : g.mine < g.theirs ? 'L' : 'T';
      return `${at} · Final ${result} ${g.mine ?? 0}-${g.theirs ?? 0}`;
    }
    return `${at} · ${g.state === 'live' ? liveText(g) : kickoff(g.start)}`;
  }
  const liveText = (g) => `${g.clock} · ${g.mine ?? 0}-${g.theirs ?? 0}${g.redZone === g.team ? ' · RZ' : ''}`;
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

  // Team totals for a lineup: points so far (null until a game kicks off, as on
  // NBA), the live projection and how many starters are yet to play.
  function totals(s, l) {
    const live = l.starters.filter(real).map((id) => numbers(s, id));
    const custom = l.leg?.custom_points ?? l.matchup?.custom_points;
    const points = custom ?? live.reduce((sum, x) => sum + (x.actual ?? 0), 0);
    const any = custom != null || live.some((x) => kickedOff(x.g));
    return { points: any ? points : null, proj: live.reduce((sum, x) => sum + x.now, 0), toPlay: live.filter((x) => x.g.state === 'left').length };
  }

  // The shown week's league median (model.leagueMedian) over every team with a
  // matchup that week; null when the league plays no median that week.
  function median(s) {
    if (!medianOn(s.league, s.week)) return null;
    const teams = (s.rosters || []).map((r) => lineup(s, r.roster_id)).filter((l) => (l?.leg ?? l?.matchup)?.matchup_id != null).map((l) => totals(s, l));
    return teams.length ? leagueMedian(teams) : null;
  }

  // Points once the game kicks off (– until then), a finished game's in its score color.
  function points(s, p, { g, actual }) {
    const tier = g.state === 'done' && actual != null ? scoreTier(actual, s.tiers, p.positions?.[0] || p.position) : '';
    return `<b${tier ? ` class="${tierClass(tier).trim()}"` : ''}>${kickedOff(g) ? f2(actual ?? 0) : '–'}</b>`;
  }

  const photo = (id, p) => `<img class="headshot${p.position === 'DEF' ? ' logo' : ''}" src="${headshot(id, p)}" alt="" data-player="${esc(id)}">`;

  // ---- Team tab ----

  function teamView(s) {
    const l = lineup(s);
    if (!l) return loading();
    const t = totals(s, l);
    const oppId = opponentOf(l);
    const editable = l.editable && !s.saving;
    const ml = editable ? moveLineup(s, l) : null;
    const targets = new Set(ml && s.swap ? targetsOf(s.swap, ml) : []);
    // Only spots with somewhere to go get a button, so nothing is a dead click.
    const movable = new Set(ml ? spotRefs(ml).filter((ref) => !ml.lockedRefs.has(ref) && targetsOf(ref, ml).length) : []);
    const ctx = { s, editable, targets, movable };
    const picked = s.swap && spotPlayer(s.swap, l);
    const settings = s.league.settings || {};
    const row = (slot, id, spot) => playerRow(ctx, slot, id, spot);
    const head = (title, hint = '') => rowHead(title, { hint, cls: 'nfl', middle: '<div class="nfl-game-h">Game</div>' });
    // IR and taxi keep the league's slots, open ones included, so the page holds its shape.
    return `${teamCard(s, l.roster, { points: t.points, proj: t.proj, opponent: oppId != null && s.rosters.find((r) => r.roster_id === oppId), week: l.week })}
      ${head('Starters', swapHint(s, l.editable, real(picked) ? s.players[picked]?.name || 'them' : null))}
      ${l.starters.map((id, i) => row(l.slots[i] ?? 'FLEX', id, `s:${i}`)).join('')}
      ${l.bench.length ? `${head('Bench')}${l.bench.map((id) => row('BN', id, `b:${id}`)).join('')}` : ''}
      ${l.reserve.length || settings.reserve_slots ? `${head('Injured Reserve')}${padTo(l.reserve, settings.reserve_slots).map((id) => row('IR', id)).join('')}` : ''}
      ${l.taxi.length || settings.taxi_slots ? `${head('Taxi Squad')}${padTo(l.taxi, settings.taxi_slots).map((id) => row('TX', id)).join('')}` : ''}`;
  }

  // The lineup as model.swapTargets sees it (starters and bench), and the
  // spots held by players whose game has kicked off, which Sleeper locks.
  function moveLineup(s, l) {
    const locked = (id) => real(id) && kickedOff(gameOf(s, id));
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

  function playerRow(ctx, slot, id, spot = null) {
    const { s, editable, targets, movable } = ctx;
    const button = editable && spot && (movable.has(spot) || s.swap === spot) ? spot : null;
    const cls = swapClass(s, editable, spot, targets);
    if (!real(id)) return emptyCard(slotBadge(slot, button), cls, 'nfl');
    const p = playerOf(s.players, id);
    const week = s.weeks[s.week];
    const n = numbers(s, id);
    return `<article class="card nfl${cls}">
      ${slotBadge(slot, button)}
      ${photo(id, p)}
      <div class="info">
        <div class="line1"><button class="name" data-player="${esc(id)}">${esc(p.name)}</button>${teamTag(p)}${injury(p)}</div>
        ${researchLine(week.research[id])}
      </div>
      <div class="nfl-game ${n.g.state}">
        <b>${esc(gameText(n.g))}</b>
        <span>${esc(statLine(week.stats[id], p.position))}</span>
      </div>
      <div class="week-pts">
        ${points(s, p, n)}
        <span>proj ${f2(n.proj)}</span>
      </div>
    </article>`;
  }

  // ---- Matchup tab ----

  function matchupView(s) {
    const mine = lineup(s);
    if (!mine) return loading();
    const oppId = opponentOf(mine);
    const theirs = oppId != null ? lineup(s, oppId) : null;
    const a = totals(s, mine);
    const b = theirs && totals(s, theirs);
    const [p1, p2] = b ? winProbability(a.points ?? 0, a.proj, b.points ?? 0, b.proj) : [null, null];
    const med = median(s);
    const team = (l, t, p) => teamSideOf(s, l.roster, { points: t.points, win: p, proj: t.proj, median: medianStanding(t, med) });
    const settings = s.league.settings || {};
    const row = (slot, idA, idB) => muRow(side(s, idA, 'mine'), slotBadge(slot), theirs ? side(s, idB, 'theirs') : null);
    const section = (title, slot, x, y, count) => muSection(title, x, y || [], count, (idA, idB) => row(slot, idA, idB));
    return `${matchupPair(team(mine, a, p1), theirs && team(theirs, b, p2), { cls: 'lg-match nfl-mu-head', failed: s.failedAvatars })}
      ${muStarters(`${a.toPlay} yet to play${b ? ` · ${b.toPlay} for them` : ''}`, weekNav(s, mine.week))}
      ${mine.slots.map((slot, i) => row(slot, mine.starters[i], theirs?.starters[i])).join('')}
      ${section('Bench', 'BN', mine.bench, theirs?.bench)}
      ${section('Injured Reserve', 'IR', mine.reserve, theirs?.reserve, settings.reserve_slots)}
      ${section('Taxi Squad', 'TX', mine.taxi, theirs?.taxi, settings.taxi_slots)}`;
  }

  function side(s, id, cls) {
    if (!real(id)) return muEmpty(`nfl ${cls}`);
    const p = playerOf(s.players, id);
    const n = numbers(s, id);
    const { g } = n;
    const at = g.state === 'bye' ? 'Bye' : `${g.homeSide ? 'vs' : '@'} ${g.opponent}`;
    const when = g.state === 'done' ? `Final ${g.mine ?? 0}-${g.theirs ?? 0}` : g.state === 'live' ? liveText(g) : g.state === 'left' ? kickoff(g.start) : '';
    return `<div class="mp nfl ${cls}">
      ${photo(id, p)}
      <div class="mp-id">
        <div class="name"><button data-player="${esc(id)}">${esc(shortName(p))}</button>${injury(p)}</div>
        <div class="sub">${teamTag(p, { sep: '•' })}</div>
      </div>
      <div class="mp-game ${g.state}"><b>${esc(at)}</b><span class="sub">${esc(when)}</span></div>
      <div class="mp-pts">${points(s, p, n)}<span>proj ${f2(n.proj)}</span></div>
    </div>`;
  }

  return { render, lineup, totals, moveLineup, targetsOf };
})();
