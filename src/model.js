// Pure functions that turn raw API responses into what the team view shows.
(globalThis.SNP ||= {}).model = (() => {
  const DAY_MS = 864e5;

  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

  // Sleeper's NBA weeks run Monday through Sunday; anchor on the week's first game.
  function weekDays(games) {
    const first = games.map((g) => g.date).sort()[0];
    if (!first) return [];
    const noon = Date.parse(`${first}T12:00:00Z`);
    const monday = noon - ((new Date(noon).getUTCDay() + 6) % 7) * DAY_MS;
    return Array.from({ length: 7 }, (_, i) => isoDay(monday + i * DAY_MS));
  }

  // A side's team in a GraphQL `scores` row's metadata ('home_team' or
  // 'away_team'): NFL names it plainly, NBA nests it.
  const sideTeam = (metadata, side) => (typeof metadata?.[side] === 'string' ? metadata[side] : metadata?.[side]?.team);

  // Where a game stands: 'done', 'live' (on now, or past its start time while
  // Sleeper still says it's to come) or 'left' (still to play); '' for no game.
  // `game`: { status, start }.
  function gameState(game, now) {
    if (!game) return '';
    if (game.status === 'complete') return 'done';
    return game.status === 'in_game' || (game.status === 'pre_game' && game.start != null && game.start <= now) ? 'live' : 'left';
  }

  // GraphQL `scores` rows -> { [team]: { [date]: game } }
  function gamesByTeam(scores) {
    const out = {};
    for (const s of scores) {
      const home = sideTeam(s.metadata, 'home_team');
      const away = sideTeam(s.metadata, 'away_team');
      const game = { id: s.game_id, date: s.date, start: s.start_time, status: s.status, home, away };
      for (const team of [home, away]) if (team) (out[team] ||= {})[s.date] = game;
    }
    return out;
  }

  // Projection or stat rows -> { [playerId]: { [gameId]: fantasy points } }
  function pointsByGame(rows, scoring, scoreStats) {
    const out = {};
    for (const row of rows) {
      if (!row.game_id) continue;
      (out[row.player_id] ||= {})[row.game_id] = scoreStats(scoring, row.stats || {});
    }
    return out;
  }

  // A game's box score as Sleeper's app shows it under a player: "26 PTS, 4 REB,
  // 4 AST, 9/22 FG, 4/9 3PM, 4/4 FT, 3 TO, 2 PF". Steals, blocks and fouls only
  // when there are some; null when the stats say nothing was played.
  function statLine(stats) {
    if (!stats || !(stats.gp > 0 || stats.pts != null || stats.fga != null)) return null;
    const n = (k) => stats[k] ?? 0;
    return [
      `${n('pts')} PTS`, `${n('reb')} REB`, `${n('ast')} AST`,
      `${n('fgm')}/${n('fga')} FG`, `${n('tpm')}/${n('tpa')} 3PM`, `${n('ftm')}/${n('fta')} FT`,
      ...[['stl', 'STL'], ['blk', 'BLK']].filter(([k]) => n(k) > 0).map(([k, label]) => `${n(k)} ${label}`),
      `${n('to')} TO`,
      ...(n('pf') > 0 ? [`${n('pf')} PF`] : []),
    ].join(', ');
  }

  // One cell per day of the week for a player's NBA team.
  function playerDays(week, team, playerId) {
    const games = week.gamesByTeam[team] || {};
    return week.days.map((date) => {
      const game = games[date];
      if (!game) return { date };
      const home = game.home === team;
      return {
        date,
        game,
        opponent: home ? game.away : game.home,
        home,
        proj: week.proj[playerId]?.[game.id],
        actual: week.actual[playerId]?.[game.id],
      };
    });
  }

  // In Lock-In mode an unlocked player scores their final game of the week,
  // so that game's projection is the player's default weekly projection.
  function lockInDefault(days) {
    const last = days.filter((d) => d.game).at(-1);
    return last?.proj ?? null;
  }

  // Which draft picks a roster holds, given trades. Each pick starts with its
  // original roster; a traded_picks row moves it to owner_id.
  function ownedPicks({ rosterId, rosterIds, seasons, rounds, traded }) {
    const moved = new Map(traded.map((t) => [`${t.season}:${t.round}:${t.roster_id}`, t.owner_id]));
    const picks = [];
    for (const season of seasons) {
      for (let round = 1; round <= rounds; round++) {
        for (const original of rosterIds) {
          const owner = moved.get(`${season}:${round}:${original}`) ?? original;
          if (owner === rosterId) picks.push({ season, round, original });
        }
      }
    }
    return picks;
  }

  // Which positions each slot accepts, per Sleeper's slot descriptions
  // ("G: POINT GUARD / SHOOTING GUARD", "UTIL: UTILITY (ALL)"). Bench takes anyone.
  const SLOT_ACCEPTS = {
    G: ['PG', 'SG'], F: ['SF', 'PF'],
    // NFL flex slots, from Sleeper's web app; every other NFL slot takes only its own position.
    FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
    SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'],
  };
  const OPEN_SLOTS = new Set(['UTIL', 'BN']);

  function fits(slot, player) {
    if (!player) return true; // an empty spot can go anywhere
    if (OPEN_SLOTS.has(slot)) return true;
    const accepts = SLOT_ACCEPTS[slot] || [slot];
    return (player.positions || []).some((p) => accepts.includes(p));
  }

  // Taxi rules, ported from Sleeper's apps. A player qualifies by experience:
  // up to taxi_years (0 = no limit) when non-rookies are allowed, else rookies only.
  function taxiEligible(player, settings) {
    if (!player) return false;
    const limit = settings.taxi_years === 0 ? Infinity : settings.taxi_years || 0;
    const exp = Number(player.years_exp);
    return settings.taxi_allow_vets ? exp <= limit : exp <= 0;
  }

  // Whether players may move onto taxi now. taxi_deadline is the last preseason
  // week to do so; 4 means "until the first regular-season game tips off", 0 means
  // no deadline. Moving off taxi is never restricted.
  function taxiOpen(settings, seasonType, week, weekStarted) {
    const deadline = settings.taxi_deadline || 1;
    if (['post', 'star'].includes(seasonType) && settings.leg === 1) return true;
    return seasonType === 'off' ||
      (seasonType === 'pre' && week <= deadline) ||
      (seasonType === 'regular' && deadline === 4 && week === 1 && !weekStarted) ||
      settings.taxi_deadline === 0;
  }

  // IR rules, ported from Sleeper's apps: IR and PUP always qualify, other
  // injury statuses only when the league allows them.
  const RESERVE_ALLOW = { Out: 'reserve_allow_out', Sus: 'reserve_allow_sus', Doubtful: 'reserve_allow_doubtful', DTD: 'reserve_allow_dtd', DNR: 'reserve_allow_dnr', COV: 'reserve_allow_cov', NA: 'reserve_allow_na' };
  function reserveEligible(player, settings) {
    const status = player?.injury;
    if (!status) return false;
    if (status === 'IR' || status === 'PUP') return true;
    return Boolean(RESERVE_ALLOW[status] && settings[RESERVE_ALLOW[status]]);
  }

  // A lineup spot, by ref:
  //   's:<i>'  starter slot i ('0' in starters means empty, like Sleeper)
  //   'b:<id>' bench player       'be:<k>' open bench spot (roster has room)
  //   't:<id>' taxi player        'te:<k>' open taxi slot
  //   'r:<id>' IR player          're:<k>' open IR slot
  function spotOf(ref, l) {
    const cut = ref.indexOf(':');
    const kind = ref.slice(0, cut);
    const key = ref.slice(cut + 1);
    if (kind === 's') return { ref, kind, index: Number(key), slot: l.slots[Number(key)] ?? 'UTIL', id: l.starters[Number(key)] };
    if (kind === 'b' || kind === 'be') return { ref, kind, slot: 'BN', id: kind === 'b' ? key : null };
    if (kind === 'r' || kind === 're') return { ref, kind, slot: 'IR', id: kind === 'r' ? key : null };
    return { ref, kind, slot: 'TX', id: kind === 't' ? key : null };
  }

  const occupant = (players, id) => (id && id !== '0' ? players[id] || {} : null);

  function canSwap(a, b, players) {
    if (a.slot === 'BN' && b.slot === 'BN') return false;
    if (!occupant(players, a.id) && !occupant(players, b.id)) return false;
    return fits(b.slot, occupant(players, a.id)) && fits(a.slot, occupant(players, b.id));
  }

  // One direction of a taxi move, as Sleeper validates it (from = picked first).
  function taxiMove(from, to, l) {
    const pf = occupant(l.players, from.id);
    const pt = occupant(l.players, to.id);
    const canTaxi = (p) => l.taxiOpen && taxiEligible(p, l.settings);
    // Off taxi into an open bench spot: always allowed.
    if (from.slot === 'TX' && pf) return to.kind === 'be';
    // Filling an open taxi slot.
    if (from.slot === 'TX') return Boolean(pt) && to.slot !== 'TX' && canTaxi(pt);
    // Onto taxi from the bench or a starting slot; a displaced taxi player takes the starter's slot.
    if (to.slot === 'TX' && pf && canTaxi(pf)) return from.slot === 'BN' || !pt || fits(from.slot, pt);
    return false;
  }

  // One direction of an IR move (from = the IR side). Only injured players
  // the league allows go onto IR; coming off IR needs room on the active roster,
  // unless the player trades places with someone going onto IR.
  function reserveMove(from, to, l) {
    if (from.slot !== 'IR' || to.slot === 'IR' || to.slot === 'TX') return false;
    const pf = occupant(l.players, from.id);
    const pt = occupant(l.players, to.id);
    if (pt) return reserveEligible(pt, l.settings) && (!pf || fits(to.slot, pf));
    if (!pf) return false;
    return to.kind === 'be' || (to.kind === 's' && l.benchRoom > 0 && fits(to.slot, pf));
  }

  function canMove(a, b, l) {
    if (a.ref === b.ref) return false;
    if (a.slot === 'TX' || b.slot === 'TX') return taxiMove(a, b, l) || taxiMove(b, a, l);
    if (a.slot === 'IR' || b.slot === 'IR') return reserveMove(a, b, l) || reserveMove(b, a, l);
    return canSwap(a, b, l.players);
  }

  // Every spot in a lineup. Taxi, IR and open bench spots only count when they're editable.
  function spotRefs(l) {
    const refs = [...l.starters.map((_, i) => `s:${i}`), ...l.bench.map((id) => `b:${id}`)];
    const open = (prefix, n) => Array.from({ length: Math.max(0, n || 0) }, (_, k) => `${prefix}:${k}`);
    if (l.taxiEditable || l.reserveEditable) refs.push(...open('be', l.benchRoom));
    if (l.taxiEditable) refs.push(...(l.taxi || []).map((id) => `t:${id}`), ...open('te', l.taxiRoom));
    if (l.reserveEditable) refs.push(...(l.reserve || []).map((id) => `r:${id}`), ...open('re', l.reserveRoom));
    return refs;
  }

  // Refs of every spot the selected spot can trade places with.
  function swapTargets(fromRef, l) {
    const from = spotOf(fromRef, l);
    return spotRefs(l).filter((ref) => canMove(from, spotOf(ref, l), l));
  }

  // Starters, taxi and IR after two spots trade occupants. The bench is implicit:
  // whoever isn't starting, on taxi or on IR.
  function applyMove(fromRef, toRef, l) {
    const a = spotOf(fromRef, l);
    const b = spotOf(toRef, l);
    const starters = [...l.starters];
    const lists = { t: [...(l.taxi || [])], r: [...(l.reserve || [])] };
    const place = (spot, id) => {
      if (spot.kind === 's') starters[spot.index] = id || '0';
      const key = { t: 't', te: 't', r: 'r', re: 'r' }[spot.kind];
      if (!key) return;
      // A player spot swaps its occupant (or empties); an open slot gains one.
      if (spot.id) lists[key] = id ? lists[key].map((x) => (x === spot.id ? id : x)) : lists[key].filter((x) => x !== spot.id);
      else if (id) lists[key].push(id);
    };
    const idOf = (spot) => (spot.id && spot.id !== '0' ? spot.id : null);
    const [ida, idb] = [idOf(a), idOf(b)];
    place(a, idb);
    place(b, ida);
    return { starters, taxi: lists.t, reserve: lists.r };
  }

  // Where each player affected by a move ends up: [{ id, to: slot | 'taxi' | 'IR' | 'bench' }].
  function describeMove(before, after) {
    const where = (l, id) => {
      const i = l.starters.indexOf(id);
      if (i >= 0) return before.slots[i] ?? 'UTIL';
      if ((l.reserve || []).includes(id)) return 'IR';
      return (l.taxi || []).includes(id) ? 'taxi' : 'bench';
    };
    const ids = new Set([...before.starters, ...(before.taxi || []), ...(before.reserve || []),
      ...after.starters, ...(after.taxi || []), ...(after.reserve || [])]);
    return [...ids]
      .filter((id) => id && id !== '0')
      .map((id) => ({ id, from: where(before, id), to: where(after, id) }))
      .filter((m) => m.from !== m.to)
      .map(({ id, to }) => ({ id, to }));
  }

  // Lock-In picks map player id -> game id (Sleeper's apps read them that way).
  const lockedGameId = (value) => (value && typeof value === 'object' ? value.game_id ?? value.id : value) ?? null;

  // Where a player stands under Lock-In rules this week:
  // - a finished game can be locked until the player's next game starts, and
  //   only if they were starting when it tipped off (a game played on the bench
  //   can't be locked after moving them in);
  // - a lock is final, and only one game counts;
  // - with no lock, the final game of the week counts. Until then Sleeper's
  //   running total counts each starter's latest finished game (`live`).
  // `started(game)`: whether the player was starting at that game's tip-off
  // (true, false, or null when unknown; see startedAt). Without it, assumed true.
  function lockState(days, lockValue, now = Date.now(), started = null) {
    const games = days.filter((d) => d.game);
    const lockId = lockedGameId(lockValue);
    const locked = lockId == null ? null : games.find((d) => String(d.game.id) === String(lockId)) ?? null;
    const lastDone = games.filter((d) => d.game.status === 'complete').at(-1) ?? null;
    const next = games.find((d) => d.game.status !== 'complete') ?? null;
    const nextStarted = Boolean(next) && (next.game.status === 'in_game' || (next.game.start != null && next.game.start <= now));
    const open = !locked && Boolean(lastDone) && !nextStarted;
    const was = open ? (started ? started(lastDone.game) : true) : null;
    const lockable = open && was === true;
    // Can't tell whether they started it, so it may or may not be lockable.
    const unsure = open && was == null;
    const counted = locked ?? (next ? null : games.at(-1) ?? null);
    const live = locked ?? lastDone;
    return {
      games,
      locked,
      lockable,
      unsure,
      // Finished, still in the window, but played on the bench.
      benched: open && was === false,
      // The game to show: the lock, else the one that can (or may) be locked, else what's next.
      current: locked ?? (lockable || unsure ? lastDone : next ?? lastDone),
      counted,
      points: counted ? counted.actual ?? 0 : null,
      livePoints: live ? live.actual ?? 0 : 0,
      yetToPlay: !locked && Boolean(next),
    };
  }

  // Whether a starter's game can be locked now, from the Team tab or Optimize:
  // their lockState, plus `error` saying why not (null when it can, or may:
  // a game whose start the extension didn't see is still offered).
  //   l: a lineup (week, locks, started); team: the player's NBA team.
  function lockCheck(l, id, team, now) {
    const st = lockState(playerDays(l.week, team, id), l.locks[id], now, l.started ? (game) => l.started(id, game) : null);
    const error = (st.lockable || st.unsure) && st.current ? null
      : st.benched ? 'That game was played on your bench, so it can\'t be locked' : 'That game can no longer be locked';
    return { ...st, error };
  }

  // Sleeper won't move a player once their game has tipped off, so any lineup
  // seen in this long after tip-off (a game runs longer) is the one they tipped off in.
  const FROZEN_MS = 2 * 3600e3;

  // Whether a game that tipped off at `time` can still be locked for a player,
  // by Sleeper's rule ("Player was not in starting lineup OR was moved to bench
  // since game began" makes it ineligible), from lineups the extension saw:
  // [{ from, to, starters }], each seen unchanged from `from` to `to`. Seen on
  // the bench at any point since tip-off: no. Otherwise a lineup seen while the
  // game was on settles it, and so do lineups seen before and after that agree.
  // Else null: Sleeper's API keeps no lineup history.
  function startedAt(history, id, time) {
    if (!history?.length || time == null) return null;
    const has = (h) => h.starters.includes(id);
    if (history.some((h) => h.to >= time && !has(h))) return false;
    const during = history.find((h) => h.from <= time + FROZEN_MS && h.to >= time);
    if (during) return has(during);
    const before = history.filter((h) => h.to < time).at(-1);
    const after = history.find((h) => h.from > time);
    return before && after && has(before) === has(after) ? has(before) : null;
  }

  // When to read the lineup next for Lock-In: `after` past the next tip-off
  // among `starts` (game start times; one read covers games tipping off
  // together), and never sooner than `gap` from now. Null with none left.
  function nextTipRead(starts, now, after, gap) {
    const tip = Math.min(...starts.filter((t) => t != null && t + after > now));
    return Number.isFinite(tip) ? { tip, at: Math.max(tip + after, now + gap) } : null;
  }

  // Adds a lineup seen at `at` to a history (see startedAt): extends the last
  // span when unchanged, else starts a new one. Returns a new array.
  // Keeps the latest `MAX_SPANS` lineups, far more than a week of changes needs.
  function seeLineup(history = [], starters, at) {
    const last = history.at(-1);
    if (last && at < last.to) return history;
    if (last && JSON.stringify(last.starters) === JSON.stringify(starters)) return [...history.slice(0, -1), { ...last, to: at }];
    return [...history, { from: at, to: at, starters: [...starters] }].slice(-MAX_SPANS);
  }
  const MAX_SPANS = 100;

  // Score colors, worked out from the league itself rather than fixed numbers:
  // a game's fantasy points are green when they'd be in the top third of the
  // games the league's starters have played lately (scored with its settings),
  // red in the bottom third, yellow between. Sleeper's apps use fixed numbers
  // (NBA 24 and 15, as its mobile app shows; NFL per position, and only for
  // standard and PPR scoring), and the thirds land on them for leagues scored
  // like that: NBA 16.5 and 24, NFL quarterbacks 13 and 20.6 (Sleeper's 13 and 19).
  // `samples`: [{ position, points }], a starter's game each. `byPosition`
  // gives each position its own thirds (NFL, where a TE's 10 is a QB's 20);
  // positions with fewer than `min` games use everyone's.
  const TIER_MIN_GAMES = 40;
  function scoreTiers(samples, { byPosition = false, min = TIER_MIN_GAMES } = {}) {
    if (!samples.length) return null;
    const thirds = (points) => [quantile(points, 1 / 3), quantile(points, 2 / 3)];
    const groups = {};
    if (byPosition) for (const s of samples) if (s.position) (groups[s.position] ||= []).push(s.points);
    const positions = Object.fromEntries(Object.entries(groups).filter(([, points]) => points.length >= min)
      .map(([position, points]) => [position, thirds(points)]));
    return { all: thirds(samples.map((s) => s.points)), positions, games: samples.length };
  }
  // Linear between the two nearest values, as spreadsheets do.
  function quantile(values, q) {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (sorted.length - 1) * q;
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, sorted.length - 1);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
  }
  // 'green', 'yellow' or 'red'; '' without tiers (a league with no games yet).
  function scoreTier(points, tiers, position) {
    const range = tiers && (tiers.positions[position] || tiers.all);
    if (!range || points == null) return '';
    return points >= range[1] ? 'green' : points >= range[0] ? 'yellow' : 'red';
  }
  // Whether an NBA stat line has time on court (a game sat out comes back with no stats).
  const onCourt = (stats) => stats?.sp > 0 || stats?.min > 0;
  // Whether a stat line is a game played (NFL: games played; NBA: time on court).
  const playedGame = (stats) => stats?.gp > 0 || onCourt(stats);
  // The starters' games in a week's stat rows, scored, for scoreTiers.
  // `starters`: player ids; `positionOf(id, row)`: the position to group by.
  function tierSamples(rows, starters, settings, score, positionOf) {
    const out = [];
    for (const row of rows || []) {
      if (!starters.has(String(row.player_id)) || !playedGame(row.stats)) continue;
      out.push({ position: positionOf(String(row.player_id), row), points: score(settings, row.stats) });
    }
    return out;
  }

  // The NBA Players tab's week view, from the week's per-game stat rows:
  // games played per player ('played'), or each player's best or worst game
  // ('best', 'worst') by `settings` (as Sleeper's FPTS is), as one game played.
  function weekPicks(rows, mode, settings, score) {
    const better = mode === 'worst' ? (a, b) => a < b : (a, b) => a > b;
    const best = {};
    const played = {};
    for (const { player_id: id, stats } of rows) {
      if (!onCourt(stats)) continue;
      played[id] = (played[id] || 0) + 1;
      const fpts = score(settings, stats);
      if (!best[id] || better(fpts, best[id].fpts)) best[id] = { ...stats, gp: 1, fpts };
    }
    return mode === 'played' ? played : best;
  }

  // The NBA Players tab's week strip, per team and day of `days`: where each
  // game stands (gameState), the game (id, opponent, home, tip-off), and each
  // player's points and score tier per game played (`rows`, the week's per-game
  // stat rows, or null while they load).
  //   byTeam: gamesByTeam; teams: player id -> NBA team.
  function weekStrip({ days, byTeam, rows, teams, settings, tiers, now }, score) {
    const points = {};
    for (const { player_id: id, game_id: game, stats } of rows || []) {
      if (!onCourt(stats)) continue;
      const fpts = score(settings, stats);
      // With its color, as the Team tab and game log show it.
      (points[id] ||= {})[game] = { fpts, tier: scoreTier(fpts, tiers) };
    }
    const byDay = (fn) => Object.fromEntries(Object.entries(byTeam).map(([team, games]) => [team, days.map((d) => fn(games[d], team))]));
    return {
      days, teamOf: teams, points, pointsReady: Boolean(rows), tiers,
      teams: byDay((g) => gameState(g, now)),
      games: byDay((g, team) => (g ? { id: g.id, home: g.home === team, opponent: g.home === team ? g.away : g.home, start: g.start } : null)),
    };
  }

  // An NFL week's games from GraphQL `scores` rows: each team's game (both
  // sides share one), with the score, the game clock ("Q3 4:12", "Half",
  // "OT 2:00"), the share of the game left and who has the ball in the red
  // zone; and the week's game days, in order.
  function nflGames(scores) {
    const games = {};
    const days = new Set();
    for (const g of scores) {
      const m = g.metadata || {};
      const home = sideTeam(m, 'home_team');
      const away = sideTeam(m, 'away_team');
      if (!home || !away) continue;
      if (m.day || m.date_time) days.add(String(m.day || m.date_time).slice(0, 10));
      const q = Number(m.quarter_num) || 0;
      const [mm, ss] = String(m.time_remaining || '15:00').split(':').map(Number);
      const elapsed = q ? Math.min(60, (q - 1) * 15 + (15 - (mm || 0) - (ss || 0) / 60)) : 0;
      const clock = !q ? 'Live' : m.quarter === 'Half' || m.quarter === 'half' ? 'Half' : q > 4 ? `OT ${m.time_remaining || ''}`.trim() : `Q${q} ${m.time_remaining || ''}`.trim();
      // The team with the ball inside the 20, as Sleeper's RZ mark shows it.
      const redZone = m.red_zone && m.possession ? m.possession : null;
      const game = { id: g.game_id, start: g.start_time, status: g.status, home, away, homeScore: m.home_score, awayScore: m.away_score, clock, left: Math.max(0, 1 - elapsed / 60), redZone };
      games[home] = game;
      games[away] = game;
    }
    return { games, days: [...days].sort() };
  }

  // An NFL week's players from its projection and stat rows, scored with
  // `settings`: each player's team, projected and actual points and stat line
  // (games played only), and their basics (name, position, team, injury) as
  // the rows carry them, the first row seen for each.
  function nflWeekPoints(projRows, statRows, settings, score) {
    const players = {};
    const teamOf = {};
    const proj = {};
    const actual = {};
    const stats = {};
    for (const row of [...projRows, ...statRows]) {
      const id = String(row.player_id);
      const pl = row.player;
      if (pl && !players[id]) {
        players[id] = {
          name: `${pl.first_name || ''} ${pl.last_name || ''}`.trim() || id,
          first: pl.first_name, last: pl.last_name, position: pl.position,
          positions: pl.fantasy_positions || [pl.position], team: pl.team, injury: pl.injury_status || null,
        };
      }
      if (row.team) teamOf[id] = row.team;
    }
    for (const row of projRows) proj[row.player_id] = score(settings, row.stats || {});
    for (const row of statRows) {
      if (!playedGame(row.stats)) continue;
      actual[row.player_id] = score(settings, row.stats);
      stats[row.player_id] = row.stats;
    }
    return { players, teamOf, proj, actual, stats };
  }

  // The NFL Players tab's Last 5 column: each player's score per week of
  // `weeks` (`rows`, each week's stat rows, in the same order), colored by
  // position, and points per game over them. For the week on now (`current`,
  // when it's the last of `weeks`), where each team's game stands and its
  // kickoff, from that week's GraphQL `scores` rows (`games`). `sig` changes
  // whenever any of it does.
  function recentWeeks({ season, weeks, rows, games, current, settings, tiers, now }, score) {
    const points = {};
    const teamOf = {};
    rows.forEach((list, i) => {
      for (const { player_id: id, stats, team, opponent, player } of list) {
        if (!playedGame(stats)) continue;
        const fpts = score(settings, stats);
        const position = player?.fantasy_positions?.[0] || player?.position;
        (points[id] ||= {})[weeks[i]] = { fpts, tier: scoreTier(fpts, tiers, position), team, opponent };
        teamOf[id] = team;
      }
    });
    const avg = Object.fromEntries(Object.entries(points).map(([id, byWeek]) => {
      const list = Object.values(byWeek);
      return [id, list.reduce((sum, x) => sum + x.fpts, 0) / list.length];
    }));
    const status = {};
    const kickoff = {};
    if (weeks.at(-1) === current) {
      for (const g of games) {
        const state = gameState({ status: g.status, start: g.start_time }, now);
        for (const side of ['home_team', 'away_team']) {
          const team = sideTeam(g.metadata, side);
          if (!team) continue;
          (status[current] ||= {})[team] = state;
          if (g.start_time != null) kickoff[team] = g.start_time;
        }
      }
    }
    return { weeks, current, points, avg, teamOf, status, kickoff, tiers, ready: true,
      sig: `${season}|${weeks.join(',')}|${rows.map((r) => r.length).join(',')}|${JSON.stringify(status)}` };
  }

  // Lineup optimizer. Under Lock-In a lineup can change every day, so it picks
  // for the next day of games: a starter with no game that day can sit and come
  // back later, while whoever plays gets a shot at a score worth locking. A
  // player's worth is their projection that day; a starter whose finished game
  // can still be locked, and beats what leaving the slot open is worth, is
  // worth that score, which benching them gives up, and it's recommended for
  // locking when the lineup keeps them. The rest of the week (projected points
  // per game left) breaks ties. Locked players and players in a game right now stay put.
  const gameLive = (game, now) => gameState(game, now) === 'live';

  // How far a game's fantasy points stray from the projection, as a share of
  // it (a standard deviation): NBA game logs run about a third either way.
  const GAME_SPREAD = 0.35;

  // E[max(X, floor)] for X ~ Normal(mean, sd).
  function expectedMax(mean, sd, floor) {
    if (!(sd > 0)) return Math.max(mean, floor);
    const z = (mean - floor) / sd;
    const below = 0.5 * erfc(z / Math.SQRT2);
    return mean * (1 - below) + sd * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) + floor * below;
  }

  // What leaving a slot open is worth, given the player's projections for the
  // games left: the last game counts unless an earlier one gets locked, and a
  // game gets locked when it beats what the games after it are worth.
  function openValue(projections) {
    return projections.reduceRight((after, mean, i) =>
      (i === projections.length - 1 ? mean : expectedMax(mean, GAME_SPREAD * mean, after)), 0);
  }

  function outlook(days, lockValue, starting, now, started) {
    const st = lockState(days, lockValue, now, started);
    const left = st.games.filter((d) => d.game.status === 'pre_game' && !gameLive(d.game, now));
    const perGame = left.length ? left.reduce((sum, d) => sum + (d.proj ?? 0), 0) / left.length : 0;
    // Only starters can lock, so only a starter's finished game is worth keeping.
    const banked = starting && st.lockable ? st.current : null;
    // A starter with no games left: with no lock, the week's final game counts,
    // so kept, their slot scores it (unless they're known to have played it on the bench).
    const done = st.games.filter((d) => d.game.status === 'complete').at(-1);
    const final = starting && !st.locked && !left.length && done && !st.benched ? done : null;
    return {
      final,
      // A finished game that may be lockable: it's unknown whether they started it.
      maybe: starting && st.unsure ? st.current : null,
      perGame,
      gamesLeft: left.length,
      left,
      banked,
      open: openValue(left.map((d) => Math.max(0, d.proj ?? 0))),
      value: Math.max(perGame, banked?.actual ?? 0, final?.actual ?? 0),
      fixed: st.locked ? 'locked' : st.games.some((d) => gameLive(d.game, now)) ? 'live' : null,
      locked: st.locked,
    };
  }

  // Slots that take fewer positions come first on a tie, so a pure center
  // sits at C and UTIL (or FLEX) stays open for anyone.
  const slotSpecificity = (slot) => (OPEN_SLOTS.has(slot) ? 0 : 6 - (SLOT_ACCEPTS[slot]?.length ?? 1));

  // Hungarian algorithm: the row -> column assignment with the lowest total
  // cost, for an n x m matrix with n <= m. Runs in O(n^2 m), so even a 20-slot
  // IDP lineup solves instantly.
  function cheapestAssignment(cost) {
    const n = cost.length;
    const m = cost[0]?.length ?? 0;
    const u = new Array(n + 1).fill(0);
    const v = new Array(m + 1).fill(0);
    const row = new Array(m + 1).fill(0); // column j's row (1-based), 0 when free
    const way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      row[0] = i;
      let j0 = 0;
      const minv = new Array(m + 1).fill(Infinity);
      const used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = row[j0];
        let delta = Infinity;
        let j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const reduced = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (reduced < minv[j]) {
            minv[j] = reduced;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) {
            u[row[j]] += delta;
            v[j] -= delta;
          } else {
            minv[j] -= delta;
          }
        }
        j0 = j1;
      } while (row[j0] !== 0);
      do {
        const j1 = way[j0];
        row[j0] = row[j1];
        j0 = j1;
      } while (j0);
    }
    const colOf = new Array(n);
    for (let j = 1; j <= m; j++) if (row[j]) colOf[row[j] - 1] = j - 1;
    return colOf;
  }

  // The starting lineup with the highest total worth: every movable player is
  // matched to an open slot they fit, or to the bench. Ties go to playing
  // someone with a game over leaving the slot to a player with none, then to the higher
  // total `later`, then to the lineup that moves the fewest players, then to
  // players in their most specific slot. Any sport: NBA, NFL and EPL pass
  // their own slot rules.
  //   worth(id): points a player is worth starting; plays(id): whether they
  //   have a game in the span `worth` covers; later(id): the next tie-breaker;
  //   fixedReason(id): why they can't move, or null;
  //   fits(slot, player), specificity(slot) (a small integer, higher = fewer
  //   positions), openSlot: the slot a starter index past `slots` plays.
  // Worth is floored at 0, so a slot never goes empty to dodge a negative
  // projection: that's noise more than a forecast, and an empty slot is the
  // one thing Sleeper's own lineup screens flag as a mistake.
  function solveLineup({
    slots, starters: current, bench, players, worth, plays = () => false, later = () => 0, fixedReason = () => null,
    fits: fitsSlot = fits, specificity = slotSpecificity, openSlot = 'UTIL', shift = new Set(),
  }) {
    const real = (id) => id && id !== '0';
    const fixed = [];
    const open = [];
    current.forEach((id, i) => {
      const reason = real(id) && fixedReason(id);
      if (reason) fixed.push({ id, reason });
      else open.push(i);
    });
    const benchFixed = bench.filter((id) => fixedReason(id));
    fixed.push(...benchFixed.map((id) => ({ id, reason: fixedReason(id) })));
    const pool = [...current.filter((id, i) => real(id) && open.includes(i)), ...bench.filter((id) => !benchFixed.includes(id))];

    const slotOf = (i) => slots[i] ?? openSlot;
    // Lexicographic in one number: worth (to the cent), then later (to the cent),
    // then staying put, then a specific slot. Each tier's unit outweighs what the
    // tiers below it add up to over a whole lineup, sized from this lineup's own
    // numbers, so the totals stay exact integers in a double.
    const cents = (x) => Math.max(0, Math.min(Math.round((x || 0) * 100), 99999));
    const worthOf = Object.fromEntries(pool.map((id) => [id, cents(worth(id))]));
    // A game to play outranks anything `later` adds up to (it is capped at 99999).
    const laterOf = Object.fromEntries(pool.map((id) => [id, (plays(id) ? 100000 : 0) + cents(later(id))]));
    const n = open.length;
    const spec = Math.max(0, ...open.map((i) => specificity(slotOf(i))));
    const STAY = n * spec + 1;
    const LATER = n * (STAY + spec) + 1;
    const WORTH = n * (Math.max(0, ...Object.values(laterOf)) * LATER + STAY + spec) + 1;
    const weight = (id, i) => worthOf[id] * WORTH + laterOf[id] * LATER + (current[i] === id ? STAY : 0) + specificity(slotOf(i));
    const NO = 1e15; // can't play that slot
    // Rows: players. Columns: the open slots, then one bench spot per player.
    const cost = pool.map((id) => [
      ...open.map((i) => (fitsSlot(slotOf(i), players[id] || {}) ? -weight(id, i) : NO)),
      ...pool.map(() => 0),
    ]);
    const starters = current.map((id, i) => (open.includes(i) ? '0' : id));
    if (pool.length) {
      cheapestAssignment(cost).forEach((col, k) => {
        if (col < open.length) starters[open[col]] = pool[k];
      });
    }

    // A player about to be locked can't change slots afterwards, so they take
    // the most specific slot they fit now, and whoever was there moves up to
    // the flexible slot they leave (G, F, UTIL stay open for as long as possible).
    // Only players free to move trade places; another locker is a last resort.
    for (let moved = true, guard = 0; moved && guard < 50; guard++) {
      moved = false;
      for (let i = 0; i < starters.length && !moved; i++) {
        const id = starters[i];
        if (!shift.has(id)) continue;
        let best = -1;
        const rank = (j) => specificity(slotOf(j)) * 2 + (shift.has(starters[j]) ? 0 : 1);
        for (let j = 0; j < starters.length; j++) {
          const other = starters[j];
          if (j === i || specificity(slotOf(j)) <= specificity(slotOf(i))) continue;
          if (!fitsSlot(slotOf(j), players[id] || {})) continue;
          if (real(other) && !(open.includes(j) || shift.has(other))) continue;
          if (real(other) && !fitsSlot(slotOf(i), players[other] || {})) continue;
          if (best < 0 || rank(j) > rank(best)) best = j;
        }
        if (best >= 0) {
          [starters[i], starters[best]] = [starters[best], starters[i]];
          moved = true;
        }
      }
    }

    const where = (list, id) => {
      const i = list.indexOf(id);
      return i < 0 ? 'BN' : slotOf(i);
    };
    const changes = [...new Set([...current, ...starters])]
      .filter((id) => real(id) && current.indexOf(id) !== starters.indexOf(id))
      .map((id) => ({ id, from: where(current, id), to: where(starters, id) }))
      // Lineup order, then whoever goes to the bench.
      .sort((a, b) => (starters.includes(a.id) ? starters.indexOf(a.id) : 100 + current.indexOf(a.id)) -
        (starters.includes(b.id) ? starters.indexOf(b.id) : 100 + current.indexOf(b.id)));
    const total = (list) => list.reduce((sum, id) => sum + (real(id) ? worth(id) : 0), 0);
    return { starters, changes, fixed, before: total(current), after: total(starters) };
  }

  // NBA (Lock-In): the best lineup for the next day of games (`date`), and the
  // finished games worth locking in. `noLock`: players not to lock now (unticked
  // in the dialog); they're still worth their score, so they keep the chance to lock it later.
  function bestLineup(l, now = Date.now(), { noLock = [] } = {}) {
    if (!l.week) return null;
    const look = {};
    const consider = (id, starting) => {
      look[id] = outlook(playerDays(l.week, l.players[id]?.team, id), l.locks?.[id], starting, now,
        l.started ? (game) => l.started(id, game) : null);
    };
    l.starters.forEach((id) => id && id !== '0' && consider(id, true));
    l.bench.forEach((id) => consider(id, false));
    const date = Object.values(look).map((o) => o.left[0]?.date).filter(Boolean).sort()[0] ?? null;
    // A finished game is worth keeping if it beats what leaving the slot open is worth.
    const worthy = (o) => (o.banked && o.banked.actual > 0 && o.banked.actual > o.open ? o.banked : null);
    const skip = new Set(noLock);
    const today = (id) => Math.max(look[id].left.find((d) => d.date === date)?.proj ?? 0, worthy(look[id])?.actual ?? 0,
      look[id].final?.actual ?? 0);
    const solve = (locking) => solveLineup({
      slots: l.slots, starters: l.starters, bench: l.bench, players: l.players,
      worth: today,
      // A zero projection with a game still beats an idle slot: it's all upside.
      plays: (id) => look[id].left.some((d) => d.date === date),
      later: (id) => look[id].value,
      fixedReason: (id) => look[id].fixed || (locking.has(id) ? 'locking' : null),
      shift: locking,
    });
    // Locks go to starters worth keeping that the best lineup keeps, and who
    // still have a game left (with none, the last game counts anyway). A lock
    // is final and pins the player to their slot, so the lineup is worked out
    // again around them.
    const lockable = (id) => Boolean(look[id]) && l.lockable !== false && worthy(look[id]) && look[id].gamesLeft > 0;
    // A lock closes the slot for the rest of the week, to the bench too: keeping
    // it open is worth the best of the starter's own games left or a player the
    // best lineup leaves on the bench who fits the slot (`openBy`). Those bench
    // players depend on the lineup, so it's worked out once more after.
    const pick = solve(new Set());
    const free = [...l.starters, ...l.bench].filter((id) => id && id !== '0' && !pick.starters.includes(id));
    pick.starters.forEach((id, i) => {
      if (!id || id === '0') return;
      const o = look[id];
      for (const b of free) {
        if (look[b].open > o.open && fits(l.slots[i] ?? 'UTIL', l.players[b] || {})) {
          o.open = look[b].open;
          o.openBy = b;
        }
      }
    });
    const first = solve(new Set());
    const locking = new Set(l.starters.filter((id) => lockable(id) && !skip.has(id) && first.starters.includes(id)));
    const plan = locking.size ? solve(locking) : first;
    plan.fixed = plan.fixed.filter((f) => f.reason !== 'locking');
    plan.date = date;
    // Unticked ones stay listed, so they can be ticked again.
    plan.locks = l.starters.filter((id) => locking.has(id) || (lockable(id) && skip.has(id))).map((id) => {
      const o = look[id];
      return { id, on: locking.has(id), game: o.banked, actual: o.banked.actual, open: o.open, openBy: o.openBy ?? null, gamesLeft: o.gamesLeft, until: o.left[0].game.start ?? null };
    });
    // Starters whose finished game can still be locked, but isn't worth it yet.
    // Starters with a finished game that may be lockable: whether they started it is unknown.
    plan.maybe = l.starters.filter((id) => look[id]?.maybe && look[id].gamesLeft > 0)
      .map((id) => ({ id, actual: look[id].maybe.actual ?? 0, game: look[id].maybe }));
    plan.notYet = l.starters.filter((id) => look[id]?.banked?.actual > 0 && !worthy(look[id]) && look[id].gamesLeft > 0)
      .map((id) => ({ id, actual: look[id].banked.actual, open: look[id].open, openBy: look[id].openBy ?? null, game: look[id].banked }));
    plan.changes = plan.changes.map((c) => {
      const o = look[c.id];
      const { perGame, gamesLeft, banked } = o;
      // Benching a starter whose finished game could still be locked throws that score away.
      const lost = c.to === 'BN' && banked?.actual > 0 && (worthy(o) || scoreTier(banked.actual, l.tiers) === 'green') ? banked : null;
      return {
        ...c,
        // Any finished game a benched starter could (or may) still lock, worth it or not.
        drops: c.to === 'BN' && (banked ?? o.maybe)?.actual > 0 ? banked ?? o.maybe : null,
        dropsUnsure: !banked && Boolean(o.maybe),
        perGame,
        gamesLeft,
        today: o.left.find((d) => d.date === date)?.proj ?? null,
        lost,
        // A green score is worth stopping for; anything less is a softer warning.
        goodScore: Boolean(lost) && scoreTier(lost.actual, l.tiers) === 'green',
      };
    });
    // The lineup the plan starts from, slot by slot, and what each player in it is worth.
    // Whether this lineup's finished games can be locked at all (your own, in season).
    plan.lockable = l.lockable !== false;
    plan.current = [...l.starters];
    plan.slots = [...l.slots];
    plan.info = Object.fromEntries(Object.entries(look).map(([id, o]) => [id, {
      today: o.left.find((d) => d.date === date)?.proj ?? null,
      perGame: o.perGame,
      gamesLeft: o.gamesLeft,
      fixed: o.fixed,
      locked: o.locked,
    }]));
    return plan;
  }

  // One slot of a planned lineup, applied on its own. A move can tie slots
  // together (the player coming in left another slot, or the one going out
  // takes another), so every slot tied to `i` changes with it; the rest stay put.
  // Returns the new starters and the slots that change.
  function applySlot(current, planned, i) {
    const real = (id) => id && id !== '0';
    const group = new Set([i]);
    for (const k of group) {
      for (const j of [real(planned[k]) ? current.indexOf(planned[k]) : -1, real(current[k]) ? planned.indexOf(current[k]) : -1]) {
        if (j >= 0) group.add(j);
      }
    }
    const slots = [...group].filter((k) => current[k] !== planned[k]).sort((a, b) => a - b);
    return { starters: current.map((id, k) => (group.has(k) ? planned[k] : id)), slots };
  }

  // NFL injury statuses that mean a player won't play this week.
  const NFL_SITTING = new Set(['Out', 'IR', 'PUP', 'Sus', 'NA', 'COV', 'DNR']);

  // NFL: one game a week, so a player's worth is that game's projection (0 on a
  // bye or when ruled out). Players whose team has kicked off are locked by Sleeper.
  //   l: { slots, starters, bench, players: { id: { positions, injury } }, proj: { id: points }, played: { id: true } }
  function bestNflLineup(l) {
    const worth = (id) => (NFL_SITTING.has(l.players[id]?.injury) ? 0 : l.proj[id] ?? 0);
    const plan = solveLineup({
      slots: l.slots, starters: l.starters, bench: l.bench, players: l.players,
      worth,
      fixedReason: (id) => (l.played[id] ? 'played' : null),
    });
    plan.changes = plan.changes.map((c) => ({ ...c, proj: worth(c.id) }));
    return plan;
  }

  // Sleeper's win probability (ported from its web app): each side is a normal
  // distribution centred on its projection, tighter as the current score nears it.
  // Missing numbers count as 0. Once both sides are settled (current = projection)
  // the score decides it, and level teams are a coin flip: Sleeper says [0, 0]
  // there, which the win bar would show as 0% each.
  function erfc(x) {
    const z = Math.abs(x);
    const t = 1 / (1 + z / 2);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v || 0));

  // A side's final score as a normal distribution: centred on its projection,
  // tighter as the current score nears it. No projection: as wide as a side
  // with nothing scored yet.
  function scoreSpread(current, proj) {
    const n = 1 + 10 * (proj ? 1 - current / proj : 1);
    const variance = Math.sqrt((current - proj) ** 2 / n) ** 2 || 0.1;
    return { mean: proj, variance };
  }

  function winProbability(current1, proj1, current2, proj2) {
    const [c1, p1, c2, p2] = [current1, proj1, current2, proj2].map((n) => Number(n) || 0);
    const r2 = (n) => Number(n.toFixed(2));
    if (r2(c1) === r2(p1) && r2(c2) === r2(p2)) {
      const a = r2(c1);
      const b = r2(c2);
      return a === b ? [0.5, 0.5] : a > b ? [1, 0] : [0, 1];
    }
    const a = scoreSpread(c1, p1);
    const b = scoreSpread(c2, p2);
    const mean = a.mean - b.mean;
    const sd = Math.sqrt(a.variance + b.variance);
    const cdf0 = 0.5 * erfc(mean / (sd * Math.SQRT2));
    const win = clamp(0.01, 0.99, 1 - cdf0);
    return [win, clamp(0.01, 0.99, 1 - win)];
  }

  // ---- Chopped leagues ----

  // A chopped league (Sleeper's "guillotine", settings.type 3): each week the
  // lowest scoring team is eliminated and its roster dropped to waivers.
  const CHOPPED_TYPE = 3;
  const isChopped = (league) => league?.settings?.type === CHOPPED_TYPE;
  // Above the chop zone, this many teams are in danger, as Sleeper's app draws it.
  const CHOP_DANGER = 3;

  // Each team's chance of not finishing the week last: one minus the chance its
  // final score (scoreSpread) is under every other team's, summed over a fine
  // grid around its own. Once every team is settled, the score decides it.
  function safeChances(teams) {
    const sides = teams.map((t) => {
      const current = Number(t.points) || 0;
      const proj = Number(t.proj) || 0;
      const settled = Number(current.toFixed(2)) === Number(proj.toFixed(2));
      return { ...scoreSpread(current, proj), settled };
    });
    if (sides.every((x) => x.settled)) {
      const low = Math.min(...sides.map((x) => Number(x.mean.toFixed(2))));
      const last = sides.filter((x) => Number(x.mean.toFixed(2)) === low).length;
      return sides.map((x) => (Number(x.mean.toFixed(2)) === low ? 1 - 1 / last : 1));
    }
    const STEPS = 400;
    return sides.map((me, i) => {
      const sd = Math.sqrt(me.variance);
      const from = me.mean - 8 * sd;
      const dx = (16 * sd) / STEPS;
      let lowest = 0;
      for (let k = 0; k < STEPS; k++) {
        const x = from + (k + 0.5) * dx;
        const z = (x - me.mean) / sd;
        let above = Math.exp(-z * z / 2) / (sd * Math.sqrt(2 * Math.PI)) * dx;
        for (let j = 0; j < sides.length && above > 1e-12; j++) {
          if (j === i) continue;
          const o = sides[j];
          above *= 0.5 * erfc((x - o.mean) / Math.sqrt(2 * o.variance));
        }
        lowest += above;
      }
      return Math.max(0, Math.min(1, 1 - lowest));
    });
  }

  // The week's chopping block from the teams still alive, worst first, as
  // Sleeper's app lists it: ranked by live projection (then points), each with
  // its rank (1 the best), safe chance (safeChances) and zone: the last team
  // 'chop', the CHOP_DANGER above it 'danger' (the best team never), else 'safe'.
  //   teams: [{ rosterId, points (null before any game), proj, ... }]
  function chopBlock(teams) {
    const safe = safeChances(teams);
    const ranked = teams.map((t, i) => ({ ...t, safe: safe[i] }))
      .sort((a, b) => (b.proj ?? 0) - (a.proj ?? 0) || (b.points ?? 0) - (a.points ?? 0) || a.rosterId - b.rosterId);
    const last = ranked.length - 1;
    const danger = Math.max(0, Math.min(CHOP_DANGER, last - 1));
    const zone = (i) => (last < 1 ? 'safe' : i === last ? 'chop' : i >= last - danger ? 'danger' : 'safe');
    return ranked.map((t, i) => ({ ...t, rank: i + 1, zone: zone(i) })).reverse();
  }

  // Weeks a team has played: through the last week scored, or the week it was chopped.
  function chopWeeksPlayed(league, roster) {
    const s = league?.settings || {};
    const last = roster?.settings?.eliminated || s.last_scored_leg || 0;
    return Math.max(0, last - (s.start_week || 1) + 1);
  }

  // A roster's season points per week played (null before any), and its FAAB left.
  function chopTeamStats(league, roster) {
    const st = roster?.settings || {};
    const weeks = chopWeeksPlayed(league, roster);
    const fpts = (st.fpts ?? 0) + (st.fpts_decimal ?? 0) / 100;
    return { avg: weeks ? fpts / weeks : null, faab: faabLeft(league, roster) };
  }

  // The league's points per team-week played, chopped teams' weeks included; null before any.
  function chopLeagueAvg(league, rosters) {
    let points = 0;
    let weeks = 0;
    for (const r of rosters || []) {
      points += (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
      weeks += chopWeeksPlayed(league, r);
    }
    return weeks ? points / weeks : null;
  }

  // The chopped teams, latest first: { roster, week, avg, faab, angel }. As in
  // Sleeper's app, a chopped team wears a halo (`angel`) when it scored better
  // than the league a week (chopped unluckily), else devil's horns. (Sleeper
  // doesn't say its rule; this one matches its app on a real league.)
  function graveyard(league, rosters) {
    const par = chopLeagueAvg(league, rosters);
    return (rosters || []).filter((r) => r.settings?.eliminated)
      .map((r) => {
        const stats = chopTeamStats(league, r);
        return { roster: r, week: r.settings.eliminated, ...stats, angel: par != null && stats.avg != null && stats.avg >= par };
      })
      .sort((a, b) => b.week - a.week || a.roster.roster_id - b.roster.roster_id);
  }

  // ---- League median ----

  // With "league median" on (settings.league_average_match), each regular-season
  // week every team plays one more matchup, against the league's median score:
  // the top half of the league wins it. Not in the playoffs.
  function medianOn(league, week) {
    const s = league?.settings || {};
    if (!s.league_average_match) return false;
    return !(s.playoff_week_start && week >= s.playoff_week_start);
  }

  // The middle value (the mean of the middle two for an even count); null for none.
  function median(values) {
    const v = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  // The week's median from every team's { points, proj } (points null until
  // the team has any): its points so far (null until some team has any), its
  // projection, and how many teams win it (the top half).
  function leagueMedian(teams) {
    return {
      points: teams.some((t) => t.points != null) ? median(teams.map((t) => t.points ?? 0)) : null,
      proj: median(teams.map((t) => t.proj ?? 0)),
      winners: Math.floor(teams.length / 2),
      teams: teams.length,
    };
  }

  // A team's place against the median `m` (leagueMedian), for its medallion:
  // null unless it's over the median now; else its chance of finishing over
  // (winProbability against the median's points and projection) and a tier:
  // 'won' once both are settled, 'likely' from MEDIAN_LIKELY, else 'over'.
  const MEDIAN_LIKELY = 0.75;
  function medianStanding(team, m) {
    if (!m || m.points == null || team.points == null || !(team.points > m.points)) return null;
    const [chance] = winProbability(team.points, team.proj, m.points, m.proj);
    return { chance, tier: chance === 1 ? 'won' : chance >= MEDIAN_LIKELY ? 'likely' : 'over' };
  }

  // When to read a week's stats and games again: while a game is on, `every`
  // ms from now; otherwise a minute after the next tip-off or kickoff; null
  // once nothing is left to play. `games`: [{ start, status }].
  function nextLiveRead(games, now, every) {
    if (games.some((g) => gameState(g, now) === 'live')) return now + every;
    const next = Math.min(...games.filter((g) => g.status === 'pre_game' && g.start > now).map((g) => g.start));
    return Number.isFinite(next) ? next + 60e3 : null;
  }

  // roster_id -> rank. Uses Sleeper's roster_standings when it has rows; before
  // any games it falls back to the standings order (record, points, then waiver order).
  function standingsRanks(rosters, standings) {
    if (standings?.length) return Object.fromEntries(standings.map((s) => [s.roster_id, s.rank]));
    const pts = (r) => (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
    const order = [...rosters].sort((a, b) =>
      (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0) ||
      (b.settings?.ties ?? 0) - (a.settings?.ties ?? 0) ||
      pts(b) - pts(a) ||
      (a.settings?.waiver_position ?? 0) - (b.settings?.waiver_position ?? 0));
    return Object.fromEntries(order.map((r, i) => [r.roster_id, i + 1]));
  }

  // Waivers, ported from Sleeper's add/drop dialog. waiver_type 2 is FAAB.
  const FAAB = 2;

  // Open active-roster spots: one per roster position, and IR and taxi players don't count.
  function rosterRoom(league, roster) {
    const r = roster || {};
    return (league.roster_positions || []).length - (r.players || []).length + (r.reserve || []).length + (r.taxi || []).length;
  }

  function faabLeft(league, roster) {
    return Math.max(0, (league.settings?.waiver_budget || 0) - (roster?.settings?.waiver_budget_used || 0));
  }

  // Why a claim can't be submitted yet, or null. Only dropping an active player
  // opens a spot, since IR and taxi players don't count toward the roster.
  function claimError({ league, roster, waiver, bid, drops }) {
    const settings = league.settings || {};
    const inactive = new Set([...(roster.reserve || []), ...(roster.taxi || [])]);
    const room = rosterRoom(league, roster) + drops.filter((id) => !inactive.has(id)).length;
    if (room <= 0) {
      const need = 1 - rosterRoom(league, roster);
      return `You must select ${need} player${need > 1 ? 's' : ''} to drop`;
    }
    if (waiver && settings.waiver_type === FAAB) {
      const min = settings.waiver_bid_min || 0;
      const left = faabLeft(league, roster);
      if (bid === '' || bid == null || Number.isNaN(Number(bid))) return 'Invalid bid amount';
      if (Number(bid) < 0) return 'Bid cannot be negative';
      if (!Number.isInteger(Number(bid))) return 'Bids are whole dollars';
      if (Number(bid) < min) return `Bid must be a minimum of $${min}`;
      if (Number(bid) > left) return `You only have $${left} remaining`;
    }
    return null;
  }

  // Pending claims in the order Sleeper processes them: highest bid, then priority.
  function sortClaims(claims) {
    const bid = (c) => c.settings?.waiver_bid ?? 0;
    const priority = (c) => c.settings?.priority ?? Infinity;
    return [...claims].sort((a, b) =>
      bid(b) - bid(a) || priority(a) - priority(b) || String(a.transaction_id).localeCompare(String(b.transaction_id)));
  }

  // Each id's place when the list is ranked by `value`, highest first. Ties
  // share a place, as in standings.
  function ranks(ids, value) {
    const sorted = ids.map(value).sort((a, b) => b - a);
    const first = new Map();
    sorted.forEach((v, i) => { if (!first.has(v)) first.set(v, i + 1); });
    return Object.fromEntries(ids.map((id) => [id, first.get(value(id))]));
  }

  // How many places each player moves when a list is ranked by `after` instead
  // of `before` (positive = up), so nothing moves until a value changes.
  function rankShift(ids, before, after) {
    const [was, now] = [ranks(ids, before), ranks(ids, after)];
    return Object.fromEntries(ids.map((id) => [id, was[id] - now[id]]));
  }

  // Background for a rank shift: green up, red down, deeper the further it moves
  // relative to the biggest move in the list. No move, no color.
  const SHIFT_UP = '52, 168, 83';
  const SHIFT_DOWN = '214, 69, 80';
  function shiftTint(shift, biggest) {
    if (!shift || !biggest) return '';
    const strength = Math.min(1, Math.abs(shift) / biggest);
    return `rgba(${shift > 0 ? SHIFT_UP : SHIFT_DOWN}, ${(0.2 + 0.7 * strength).toFixed(2)})`;
  }

  // The Players tab's adminFPTS and adminDelta: for each player, the points
  // the what-if `overrides` add to Sleeper's FPTS (scoring just the
  // differences from `league`), and for the players in `view`, how many places
  // that moves them, its color and both places. Ranked per game, as the table
  // shows every stat (a season's stats are totals).
  //   stats: player id -> Sleeper's stat line; base: the FPTS key shown.
  function adminDeltas({ overrides, league, stats, view, base }, score) {
    const delta = Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, value - (league[key] ?? 0)]));
    const points = Object.fromEntries(Object.entries(stats).map(([id, s]) => [id, s ? score(delta, s) : 0]));
    const ids = view.filter((id) => stats[id]?.[base] != null);
    const games = (id) => (stats[id].gp > 0 ? stats[id].gp : 1);
    const before = (id) => stats[id][base] / games(id);
    const after = (id) => (stats[id][base] + points[id]) / games(id);
    const shifts = rankShift(ids, before, after);
    const biggest = Math.max(0, ...Object.values(shifts).map(Math.abs));
    const tints = Object.fromEntries(ids.map((id) => [id, shiftTint(shifts[id], biggest)]));
    const [was, now] = [ranks(ids, before), ranks(ids, after)];
    const places = Object.fromEntries(ids.map((id) => [id, [was[id], now[id]]]));
    return { points, shifts, tints, places };
  }

  // The season ends when the league's playoff bracket does. Round count comes
  // from the bracket itself; playoff_round_type sets weeks per round
  // (0: one week each, 1: two-week final, 2: two weeks each).
  function lastWeek(league, bracket) {
    const { playoff_week_start: start, playoff_round_type: roundType } = league.settings || {};
    const rounds = Math.max(0, ...bracket.map((m) => m.r));
    // Without a bracket there's nothing to bound by, so don't invent a limit.
    if (!start || !rounds) return Infinity;
    const weeks = roundType === 2 ? rounds * 2 : roundType === 1 ? rounds + 1 : rounds;
    return start + weeks - 1;
  }

  // Sleeper only allows trading picks this many seasons ahead; it isn't exposed per league.
  const PICK_SEASONS = 3;
  // Future picks start this season if its draft hasn't happened yet, else next season.
  function pickSeasons(league, drafts, count = PICK_SEASONS) {
    const season = Number(league.season);
    const done = drafts.some((d) => d.season === league.season && d.status === 'complete');
    const first = done ? season + 1 : season;
    return Array.from({ length: count }, (_, i) => String(first + i));
  }

  // Whether a week's lineup saves to its matchup leg (else to the roster), as
  // Sleeper's web Team component (_updateRoster) decides: the leg once the
  // draft is done, until the league is complete.
  const lineupOnLeg = (league) => !['pre_draft', 'drafting', 'complete'].includes(league?.status);

  // Whether two optimize plans (bestLineup) propose the same thing.
  const samePlan = (a, b) => ['starters', 'current', 'changes', 'locks'].every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

  // Arrow keys through the teams: `order` lists groups of rosters (one team
  // each, or a matchup's pair), and the step goes from the group holding
  // `rosterId` to the next one (or the one before), stopping at the ends.
  // That group's first roster id, or null.
  function nextTeam(order, rosterId, step) {
    const at = order.findIndex((group) => group.some((r) => r?.roster_id === rosterId));
    const next = at < 0 ? null : order[at + step];
    return next?.[0]?.roster_id ?? null;
  }

  return {
    ranks, rankShift, shiftTint, adminDeltas,
    weekDays, sideTeam, gameState, gamesByTeam, pointsByGame, statLine, playerDays, lockInDefault, ownedPicks, pickSeasons, PICK_SEASONS, lastWeek,
    spotRefs, swapTargets, applyMove, describeMove, lineupOnLeg, nextTeam,
    taxiEligible, taxiOpen, reserveEligible,
    lockedGameId, lockState, lockCheck, startedAt, seeLineup, nextTipRead, FROZEN_MS, scoreTier, scoreTiers, tierSamples, onCourt, playedGame, TIER_MIN_GAMES,
    weekPicks, weekStrip, nflGames, nflWeekPoints, recentWeeks,
    openValue, solveLineup, bestLineup, samePlan, applySlot, bestNflLineup, cheapestAssignment, winProbability, scoreSpread, standingsRanks, medianOn, median, leagueMedian, medianStanding, nextLiveRead,
    FAAB, rosterRoom, faabLeft, claimError, sortClaims,
    isChopped, CHOP_DANGER, safeChances, chopBlock, chopTeamStats, chopLeagueAvg, graveyard,
  };
})();
