// NFL Team and Matchup tabs, drawn like the NBA ones in place of Sleeper's own
// (which stay on the page, hidden, so its saves still work): a compact row per
// player, any team or matchup from the picker. Pure: state -> HTML.
(globalThis.SNP ||= {}).nflPanelView = (() => {
  const { esc, f2, shortName, weekNav, real, playerOf, teamTag, researchLine, padTo, loading, errorMsg, owns, rosterParts, opponentOf,
    shell, irBlockNames, irBlockTip, irBanner, reserveRule, pageTitle, teamCard, teamSideOf, matchupPair, rowHead, swapHint, swapClass, emptyCard, tierClass, muRow, muEmpty, muStarters, muSection, apiView, sessionExpired } = globalThis.SNP.ui;
  const { scoreTier, spotRefs, swapTargets, autosubOptions: subOptions, winProbability, gameState, medianOn, leagueMedian, medianStanding, isChopped, chopBlock, chopTeamStats, graveyard } = globalThis.SNP.model;
  const { slotBadge, headshot, injury, chopAvatar } = globalThis.SNP.nflUi;
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
      irBlock: l?.irBlocked.length ? irBlockTip(irBlockNames(l)) : '',
      tools: `<button class="icon" data-action="sleeper-view" title="Show Sleeper's own ${esc(pageTitle(s))} tab" aria-label="Sleeper's view">⇄</button>`,
    });
  }

  // One roster's lineup for the shown week (see ui.rosterParts), once its games are in.
  function lineup(s, rosterId = s.rosterId) {
    const parts = s.weeks?.[s.week] ? rosterParts(s, rosterId, POSITION_ORDER) : null;
    if (!parts) return null;
    const mine = owns(s, parts.roster);
    const settings = s.league.settings || {};
    const editable = mine && s.editableWeek === s.week;
    // Active roster = everyone not on IR or taxi; it holds one player per roster position.
    const active = (parts.roster.players || []).length - parts.reserve.length - parts.taxi.length;
    return { ...parts, mine, players: s.players, editable,
      // IR belongs to the roster, so like Sleeper it's edited from the week that's on.
      reserveEditable: editable && (settings.reserve_slots || 0) > 0,
      reserveRoom: Math.max(0, (settings.reserve_slots || 0) - parts.reserve.length),
      benchRoom: Math.max(0, (s.league.roster_positions || []).length - active),
      irBlocked: globalThis.SNP.model.illegalReserve(parts.reserve, s.players, settings) };
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

  // A chopped league's block for the shown week (model.chopBlock): every team
  // still alive with its totals and starters played.
  function chopBlockOf(s) {
    const teams = (s.rosters || []).filter((r) => !r.settings?.eliminated).map((roster) => {
      const l = lineup(s, roster.roster_id);
      const t = l ? totals(s, l) : { points: null, proj: 0, toPlay: 0 };
      const starters = l ? l.starters.filter(real).length : 0;
      return { rosterId: roster.roster_id, roster, ...t, played: starters - t.toPlay, starters };
    });
    return chopBlock(teams);
  }

  // A chopped league's Team tab card line, as Sleeper's app has it: points per
  // week and FAAB left, then (the week on now) the safe chance and its bar,
  // or the week the team was chopped. Null in other leagues.
  function chopLine(s, roster) {
    if (!isChopped(s.league)) return null;
    const { avg, faab } = chopTeamStats(s.league, roster);
    const stats = `${avg == null ? '–' : f2(avg)} avg fpts · $${faab} faab`;
    const out = roster.settings?.eliminated;
    const t = !out && s.week === s.currentWeek ? chopBlockOf(s).find((x) => x.rosterId === roster.roster_id) : null;
    return `<div class="sub">${out ? `<b class="chop-tag">Chopped</b> · wk ${esc(out)} · ` : ''}${stats}</div>
      ${t ? `<div class="chop-me-safe"><b class="${t.zone}">${Math.round(t.safe * 100)}% safe</b>${chopBar(t.safe, t.zone)}</div>` : ''}`;
  }
  // A chopped team's avatar marks on the Team tab card (halo or horns, the axe badge); none for a team alive.
  function chopFace(s, roster) {
    const d = isChopped(s.league) && roster.settings?.eliminated ? graveyard(s.league, s.rosters).find((x) => x.roster === roster) : null;
    return d ? (img) => chopAvatar(img, d.angel) : undefined;
  }
  // A share as a bar, in its zone's color.
  const chopBar = (safe, zone) => `<span class="chop-bar ${zone}"><span style="width:${Math.round(safe * 100)}%"></span></span>`;

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
    // While an ineligible player sits on IR, the only moves are ones that take them off (model.canMove).
    const editable = l.editable && !s.saving;
    const ml = editable ? moveLineup(s, l) : null;
    const targets = new Set(ml && s.swap ? targetsOf(s.swap, ml) : []);
    // Only spots with somewhere to go get a button, so nothing is a dead click.
    const movable = new Set(ml ? spotRefs(ml).filter((ref) => !ml.lockedRefs.has(ref) && targetsOf(ref, ml).length) : []);
    const settings = s.league.settings || {};
    // AutoSub: the subs set, and while one is being picked, the starter it's for and who can take their place.
    const subs = l.leg?.subs || {};
    const subFor = editable && s.autosub && l.starters.includes(s.autosub) ? s.autosub : null;
    const subPicks = new Set(subFor ? autosubOptions(s, l, subFor) : []);
    const ctx = { s, editable, targets, movable, subs, subFor, subPicks, l };
    const picked = s.swap && spotPlayer(s.swap, l);
    const row = (slot, id, spot) => playerRow(ctx, slot, id, spot, l.irBlocked.includes(id));
    // Open bench spots only show while IR can be edited: they're where a player coming off IR can go.
    const open = (prefix, n, slot) => Array.from({ length: n }, (_, k) => row(slot, '0', `${prefix}:${k}`)).join('');
    const bench = l.bench.map((id) => row('BN', id, `b:${id}`)).join('') + (l.reserveEditable ? open('be', l.benchRoom, 'BN') : '');
    const reserve = l.reserveEditable
      ? l.reserve.map((id) => row('IR', id, `r:${id}`)).join('') + open('re', l.reserveRoom, 'IR')
      : padTo(l.reserve, settings.reserve_slots).map((id) => row('IR', id)).join('');
    const subName = subFor && s.players[subFor]?.name;
    const subBar = ml && s.swap?.startsWith('s:') ? autosubBar(s, l, subs) : '';
    const head = (title, hint = '') => rowHead(title, { hint, cls: 'nfl', middle: '<div class="nfl-game-h">Game</div>' });
    // IR and taxi keep the league's slots, open ones included, so the page holds its shape.
    return `${teamCard(s, l.roster, { points: t.points, proj: t.proj, opponent: oppId != null && s.rosters.find((r) => r.roster_id === oppId), week: l.week, sub: chopLine(s, l.roster), face: chopFace(s, l.roster) })}
      ${irBanner(l)}
      ${head('Starters', subFor ? `Pick an AutoSub for ${esc(subName || 'them')}${subPicks.size ? '' : ': no one on the bench can'} · Esc to cancel` : swapHint(s, l.editable, real(picked) ? s.players[picked]?.name || 'them' : null, irBlockNames(l)))}
      ${subBar}
      ${l.starters.map((id, i) => row(l.slots[i] ?? 'FLEX', id, `s:${i}`)).join('')}
      ${bench ? `${head('Bench')}${bench}` : ''}
      ${l.reserve.length || settings.reserve_slots ? `${head('Injured Reserve', l.reserveEditable ? esc(reserveRule(settings)) : '')}${reserve}` : ''}
      ${l.taxi.length || settings.taxi_slots ? `${head('Taxi Squad')}${padTo(l.taxi, settings.taxi_slots).map((id) => row('TX', id)).join('')}` : ''}`;
  }

  // The bench players who can be named AutoSub for a starter (model.autosubOptions).
  function autosubOptions(s, l, starterId) {
    if (!l.leg) return []; // AutoSubs live on the week's matchup leg
    const game = (id) => {
      const g = gameOf(s, id);
      return g.state === 'bye' ? null : { start: g.start, kickedOff: kickedOff(g) };
    };
    const players = Object.fromEntries(l.bench.filter(real).map((id) => [id, s.players[id] || { positions: [] }]));
    return subOptions(starterId, { slots: l.slots, starters: l.starters, bench: l.bench, players, settings: s.league.settings || {} }, l.leg?.subs, game);
  }

  // With a starter picked to move, the button that starts naming their AutoSub:
  // "S. Barkley: Set an AutoSub · 1/1 avail" (Sleeper's wording), when one can be set.
  function autosubBar(s, l, subs) {
    const id = spotPlayer(s.swap, l);
    if (!real(id) || !autosubOptions(s, l, id).length) return '';
    const left = Math.max(0, (s.league.settings?.max_subs || 0) - Object.keys(subs).length);
    return `<div class="autosub-bar"><button type="button" data-action="autosub-start">Set an AutoSub for ${esc(s.players[id]?.name || 'them')}</button><span>${left}/${s.league.settings?.max_subs || 0} avail</span></div>`;
  }

  // The chips on a row that has an AutoSub: a starter's names their sub (a tap takes it
  // off, until the starter's game kicks off); the sub's names who they cover for.
  function autosubChip(s, id, subs, editable) {
    const sub = subs[id];
    if (sub) {
      const name = shortName(playerOf(s.players, sub));
      return editable && !kickedOff(gameOf(s, id))
        ? `<button type="button" class="autosub-chip" data-autosub-clear="${esc(id)}" title="Remove this AutoSub">AutoSub ${esc(name)} ✕</button>`
        : `<span class="autosub-chip">AutoSub ${esc(name)}</span>`;
    }
    const starter = Object.keys(subs).find((k) => subs[k] === id);
    return starter ? `<span class="autosub-chip" title="Takes the spot if the starter doesn't play">AutoSub for ${esc(shortName(playerOf(s.players, starter)))}</span>` : '';
  }

  // The lineup as model.swapTargets sees it (starters and bench), and the
  // spots held by players whose game has kicked off, which Sleeper locks.
  function moveLineup(s, l) {
    const locked = (id) => real(id) && kickedOff(gameOf(s, id));
    const players = Object.fromEntries([...l.starters, ...l.bench, ...l.reserve].filter(real).map((id) => [id, s.players[id] || { positions: [] }]));
    const starters = l.starters.map((id) => id || '0');
    const lockedRefs = new Set([...starters.flatMap((id, i) => (locked(id) ? [`s:${i}`] : [])), ...l.bench.filter(locked).map((id) => `b:${id}`)]);
    return { slots: l.slots, starters, bench: l.bench, players, taxi: [], reserve: l.reserve, settings: s.league.settings || {}, lockedRefs,
      reserveEditable: l.reserveEditable, reserveRoom: l.reserveRoom, benchRoom: l.benchRoom, irBlocked: l.irBlocked };
  }
  const targetsOf = (ref, ml) => swapTargets(ref, ml).filter((r) => !ml.lockedRefs.has(r));

  function spotPlayer(ref, l) {
    const [kind, key] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
    return kind === 's' ? l.starters[Number(key)] : kind === 'b' || kind === 'r' ? key : null;
  }

  function playerRow(ctx, slot, id, spot = null, irBad = false) {
    const { s, editable, targets, movable, subs, subFor, subPicks } = ctx;
    const button = editable && spot && !subFor && (movable.has(spot) || s.swap === spot) ? spot : null;
    // While an AutoSub is picked, the starter it's for is marked, who can take over lit and the rest dimmed.
    const subCls = !subFor || !spot ? '' : id === subFor ? ' selected' : subPicks.has(id) ? ' target' : ' dim';
    const cls = (subFor ? subCls : swapClass(s, editable, spot, targets)) + (irBad ? ' ir-bad' : '');
    if (!real(id)) return emptyCard(slotBadge(slot, button), cls, 'nfl');
    const p = playerOf(s.players, id);
    const week = s.weeks[s.week];
    const n = numbers(s, id);
    return `<article class="card nfl${cls}"${subFor && subPicks.has(id) ? ` data-sub-pick="${esc(id)}"` : ''}>
      ${slotBadge(slot, button)}
      ${photo(id, p)}
      <div class="info">
        <div class="line1"><button class="name" data-player="${esc(id)}">${esc(p.name)}</button>${teamTag(p)}${injury(p)}${autosubChip(s, id, subs, editable)}</div>
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

  // The game under a matchup row, as Sleeper's Matchup tab words it: "Final L 21-35 vs LAR", "Q2 4:12 7-10 @ SEA", "vs PHI · Mon 7:15pm".
  function matchupGameText(g) {
    if (g.state === 'bye') return 'Bye';
    const at = `${g.homeSide ? 'vs' : '@'} ${g.opponent}`;
    if (g.state === 'done') {
      const result = g.mine > g.theirs ? 'W' : g.mine < g.theirs ? 'L' : 'T';
      return `Final ${result} ${g.mine ?? 0}-${g.theirs ?? 0} ${at}`;
    }
    return g.state === 'live' ? `${g.clock} ${g.mine ?? 0}-${g.theirs ?? 0} ${at}${g.redZone === g.team ? ' · RZ' : ''}` : `${at} · ${kickoff(g.start)}`;
  }

  function side(s, id, cls) {
    if (!real(id)) return muEmpty(`nfl ${cls}`);
    const p = playerOf(s.players, id);
    const n = numbers(s, id);
    const stats = statLine(s.weeks[s.week].stats[id], p.position);
    return `<div class="mp nfl ${cls}">
      ${photo(id, p)}
      <div class="mp-id">
        <div class="name"><button data-player="${esc(id)}">${esc(shortName(p))}</button>${injury(p)}</div>
        <div class="sub">${teamTag(p, { sep: '•' })}</div>
      </div>
      <div class="mp-pts">${points(s, p, n)}<span>proj ${f2(n.proj)}</span></div>
      <div class="mp-game ${n.g.state}"><span class="sub">${esc(matchupGameText(n.g))}</span>${stats ? `<span class="stats">${esc(stats)}</span>` : ''}</div>
    </div>`;
  }

  return { render, lineup, totals, chopBlockOf, chopBar, moveLineup, targetsOf, autosubOptions };
})();
