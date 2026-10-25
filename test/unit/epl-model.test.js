import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSep } from './load.js';

const { SEP } = loadSep();
const { model, scoring } = SEP;
const plain = (x) => JSON.parse(JSON.stringify(x));

const HOUR = 3600e3;
const NOW = Date.parse('2026-10-24T12:00:00Z');
const score = (id, date, home, away, extra = {}) => ({
  game_id: id, date, start_time: Date.parse(`${date}T14:00:00Z`), status: 'pre_game',
  metadata: { home_team: { team: home, abbr: `T${home}` }, away_team: { team: away, abbr: `T${away}` } }, ...extra,
});
// Club 1 plays twice this gameweek: a finished home match and an away match still to come.
const games = model.gamesFromScores([
  score('g3', '2026-10-27', '3', '1'),
  score('g1', '2026-10-24', '1', '2', { status: 'complete', start_time: NOW - 3 * HOUR }),
  score('g2', '2026-10-25', '4', '5'),
]);
const settings = { pos_f_g: 10, pos_m_g: 5, pos_m_at: 3 };
const week = {
  games,
  gamesByTeam: model.gamesByTeam(games),
  proj: model.pointsByGame([
    { player_id: 'p1', game_id: 'g1', stats: { pos_f_g: 0.5 } },
    { player_id: 'p1', game_id: 'g3', stats: { pos_f_g: 0.4 } },
    { player_id: 'p2', game_id: 'g2', stats: { pos_m_g: 1, pos_m_at: 1 } },
    { player_id: 'nogame', stats: { pos_f_g: 9 } },
  ], settings, scoring.scoreStats),
  actual: model.pointsByGame([{ player_id: 'p1', game_id: 'g1', stats: { pos_f_g: 2 } }], settings, scoring.scoreStats),
};

test('games: scores rows become games, earliest first, with club ids and abbreviations', () => {
  assert.deepEqual(plain(games.map((g) => g.id)), ['g1', 'g2', 'g3']);
  assert.deepEqual(plain(games[0]), {
    id: 'g1', date: '2026-10-24', start: NOW - 3 * HOUR, status: 'complete',
    home: '1', homeAbbr: 'T1', away: '2', awayAbbr: 'T2',
  }, 'no club names in scores rows');
  const fromSchedule = model.gamesFromScores([{ game_id: 7, date: '2026-10-24', home: { team: '9', abbr: 'NIN' }, away: { team: '8', abbr: 'EIG' } }]);
  assert.deepEqual(plain(fromSchedule.map((g) => [g.id, g.status, g.start, g.home, g.awayAbbr])), [['7', 'pre_game', null, '9', 'EIG']],
    '/schedule rows work too, without a kickoff time');
  assert.deepEqual(plain(model.gamesFromScores(null)), []);
});

test('double gameweek: a club lists both its games, and points are kept per game', () => {
  assert.deepEqual(plain(week.gamesByTeam['1'].map((g) => g.id)), ['g1', 'g3']);
  assert.deepEqual(plain(week.gamesByTeam['4'].map((g) => g.id)), ['g2']);
  assert.deepEqual(plain(week.proj.p1), {
    g1: { points: 5, stats: { pos_f_g: 0.5 } },
    g3: { points: 4, stats: { pos_f_g: 0.4 } },
  });
  assert.equal(week.proj.nogame, undefined, 'rows without a game are skipped');
  assert.equal(week.proj.p2.g2.points, 8);
});

test('player games and week totals: played match counts its result, the next its projection', () => {
  const pg = model.playerGames(week, '1', 'p1');
  assert.deepEqual(plain(pg.map((g) => [g.game.id, g.home, g.opponent, g.opponentAbbr, g.proj, g.actual, g.played])), [
    ['g1', true, '2', 'T2', 5, 20, true],
    ['g3', false, '3', 'T3', 4, null, false],
  ]);
  assert.deepEqual(plain(model.weekTotals(pg, NOW)), { points: 20, proj: 24, played: 1, left: 1, live: false, any: true });
  assert.deepEqual(plain(model.weekTotals(model.playerGames(week, null, 'x'), NOW)), { points: 0, proj: 0, played: 0, left: 0, live: false, any: false });
  const live = model.weekTotals([{ game: { status: 'in_game', start: NOW - HOUR }, proj: 3, actual: 1 }], NOW);
  assert.equal(live.live, true);
  assert.equal(live.proj, 1, 'a match under way counts what has been scored');
  const unplayed = model.weekTotals([{ game: { status: 'complete', start: NOW - HOUR }, proj: 3, actual: null }], NOW);
  assert.equal(unplayed.proj, 0, 'a finished match without a stat line is worth nothing');
  assert.equal(model.started({ status: 'pre_game', start: NOW - 1 }, NOW), true, 'kicked off by the clock');
  assert.equal(model.started({ status: 'pre_game', start: null }, NOW), false);
});

test('slots: flex slots spell out the positions they take', () => {
  assert.deepEqual(plain(model.slotAccepts('FM_FLEX')), ['F', 'M']);
  assert.deepEqual(plain(model.slotAccepts('FMD_FLEX')), ['F', 'M', 'D']);
  assert.deepEqual(plain(model.slotAccepts('GK')), ['GK']);
  assert.deepEqual(plain(model.slotAccepts('BN')), ['GK', 'D', 'M', 'F']);
  assert.equal(model.fits('MD_FLEX', { positions: ['D'] }), true);
  assert.equal(model.fits('MD_FLEX', { positions: ['F'] }), false);
  assert.equal(model.fits('GK', null), true, 'an empty spot goes anywhere');
  assert.equal(model.fits('IR', { positions: ['F'] }), true);
});

test('IR: injury statuses the league allows', () => {
  const s = { reserve_allow_out: 1, reserve_allow_sus: 0, reserve_allow_dtd: 0, reserve_allow_doubtful: 1 };
  assert.equal(model.reserveEligible({ injury: 'Out' }, s), true);
  assert.equal(model.reserveEligible({ injury: 'Sus' }, s), false);
  assert.equal(model.reserveEligible({ injury: 'GTD' }, s), true, 'GTD goes on with doubtful allowed');
  assert.equal(model.reserveEligible({ injury: 'IR' }, {}), true);
  assert.equal(model.reserveEligible({ injury: null }, s), false);
});

test('formations: parsed from text and from the roster metadata for the week', () => {
  assert.deepEqual(plain(model.parseFormation('3-4-3')), { D: 3, M: 4, F: 3 });
  assert.equal(model.parseFormation('3-4'), null);
  assert.equal(model.parseFormation(null), null);
  assert.deepEqual(plain(model.savedFormation({ metadata: { formation: '{"9":"4-4-2"}' } }, 9)), { D: 4, M: 4, F: 2 });
  assert.equal(model.savedFormation({ metadata: { formation: '{"9":"4-4-2"}' } }, 10), null);
  assert.equal(model.savedFormation({ metadata: { formation: 'not json' } }, 9), null);
  assert.equal(model.savedFormation(null, 9), null);
});

const players = {
  f1: { positions: ['F'] }, f2: { positions: ['F'] }, m1: { positions: ['M'] }, m2: { positions: ['M'] }, fm: { positions: ['F', 'M'] },
  d1: { positions: ['D'] }, d2: { positions: ['D'] }, gk: { positions: ['GK'] }, gk2: { positions: ['GK'] },
};
const SLOTS = ['F', 'M', 'D', 'GK', 'FM_FLEX', 'MD_FLEX'];

test('slot labels: flex slots follow the saved formation, else their occupant', () => {
  const starters = ['f1', 'm1', 'd1', 'gk', 'fm', 'd2'];
  const own = model.slotLabels(SLOTS, starters, players, null);
  assert.deepEqual(plain(own), ['F', 'M', 'D', 'GK', 'F', 'D']);
  assert.equal(model.formationOf(own), '2-1-2');
  const saved = model.slotLabels(SLOTS, starters, players, { D: 1, M: 3, F: 1 });
  assert.deepEqual(plain(saved), ['F', 'M', 'D', 'GK', 'M', 'M'], 'reaches the saved counts');
  const impossible = model.slotLabels(SLOTS, starters, players, { D: 5, M: 0, F: 0 });
  assert.deepEqual(plain(impossible), plain(own), 'an unreachable formation falls back to the occupants');
  assert.deepEqual(plain(model.slotLabels(SLOTS, ['f1', 'm1', 'd1', 'gk', '0', '0'], players, null)), ['F', 'M', 'D', 'GK', 'F', 'M'],
    'empty flex slots take their first position');
});

const lineupOf = (over = {}) => ({
  slots: SLOTS,
  starters: ['f1', 'm1', 'd1', 'gk', 'fm', 'd2'],
  bench: ['m2', 'f2', 'gk2'],
  reserve: ['x'],
  players: { ...players, x: { positions: ['M'], injury: 'Out' }, m2: { positions: ['M'], injury: 'Out' } },
  settings: { reserve_allow_out: 1 },
  locked: new Set(),
  reserveEditable: true,
  reserveRoom: 1,
  benchRoom: 0,
  ...over,
});

test('lineup moves: swap targets, applying a move and describing it', () => {
  const l = lineupOf();
  assert.deepEqual(plain(model.swapTargets('s:0', l)), ['s:4', 'b:f2'], 'a forward goes to F or FM flex');
  assert.deepEqual(plain(model.swapTargets('b:m2', l)), ['s:1', 's:4', 's:5', 'r:x', 're:0'],
    'an Out midfielder can start, or go to IR');
  assert.deepEqual(plain(model.swapTargets('s:0', lineupOf({ locked: new Set(['f2']) }))), ['s:4'], 'locked players stay put');
  const next = model.applyMove('b:m2', 're:0', l);
  assert.deepEqual(plain(next), { starters: l.starters, reserve: ['x', 'm2'] });
  assert.deepEqual(plain(model.describeMove(l, next)), [{ id: 'm2', to: 'IR' }]);
  const swapped = model.applyMove('s:0', 'b:f2', l);
  assert.deepEqual(plain(swapped.starters), ['f2', 'm1', 'd1', 'gk', 'fm', 'd2']);
  assert.deepEqual(plain(model.describeMove({ ...l, labels: ['F', 'M', 'D', 'GK', 'F', 'D'] }, swapped)), [{ id: 'f1', to: 'bench' }, { id: 'f2', to: 'F' }]);
  assert.equal(model.swapTargets('r:x', l).includes('s:1'), false, 'a healthy starter cannot trade places with an IR player');
  const off = model.applyMove('r:x', 'be:0', { ...l, benchRoom: 1 });
  assert.deepEqual(plain(off), { starters: l.starters, reserve: [] }, 'off IR onto an open bench spot');
});

test('Hungarian algorithm: cheapest assignment of rows to columns', () => {
  assert.deepEqual(plain(model.cheapestAssignment([[4, 1, 3], [2, 0, 5], [3, 2, 2]])), [1, 0, 2]);
  assert.deepEqual(plain(model.cheapestAssignment([[9, 1, 9, 0], [1, 9, 9, 0]])), [3, 0]);
  assert.deepEqual(plain(model.cheapestAssignment([])), []);
});

test('best lineup: highest projected week, double gameweeks count twice, kicked-off players stay', () => {
  const at = (team, opp, id, proj, extra = {}) => score(id, '2026-10-26', team, opp, { ...extra, projFor: proj });
  const rows = [at('A', 'Z', 'a1'), at('A', 'Z', 'a2'), at('B', 'Z', 'b1'), at('C', 'Z', 'c1'), at('D', 'Z', 'd1')];
  const g = model.gamesFromScores(rows);
  const proj = (pid, gid, pts) => ({ player_id: pid, game_id: gid, stats: { pts } });
  const wk = {
    games: g,
    gamesByTeam: model.gamesByTeam(g),
    proj: model.pointsByGame([
      proj('f1', 'b1', 3), proj('f2', 'a1', 4), proj('f2', 'a2', 4), proj('m1', 'c1', 5), proj('m2', 'c1', 2),
      proj('fm', 'd1', 1), proj('d1', 'c1', 2), proj('d2', 'c1', 1), proj('gk', 'c1', 3), proj('gk2', 'c1', 4),
    ], { pts: 1 }, scoring.scoreStats),
    actual: {},
  };
  const team = { f1: 'B', f2: 'A', m1: 'C', m2: 'C', fm: 'D', d1: 'C', d2: 'C', gk: 'C', gk2: 'C' };
  const ps = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { ...p, team: team[id] }]));
  const l = { slots: SLOTS, starters: ['f1', 'm1', 'd1', 'gk', 'fm', 'd2'], bench: ['m2', 'f2', 'gk2'], players: ps, week: wk, locked: new Set(['gk']) };
  const plan = model.bestLineup(l, NOW);
  assert.deepEqual(plain(plan.starters), ['f1', 'm1', 'd1', 'gk', 'f2', 'm2'], 'f1 keeps his slot on a tie');
  assert.deepEqual(plain(plan.fixed), [{ id: 'gk', reason: 'locked' }]);
  assert.deepEqual(plain(plan.changes), [
    { id: 'f2', from: 'BN', to: 'FM_FLEX', proj: 8, left: 2 },
    { id: 'm2', from: 'BN', to: 'MD_FLEX', proj: 2, left: 1 },
    { id: 'fm', from: 'FM_FLEX', to: 'BN', proj: 1, left: 1 },
    { id: 'd2', from: 'MD_FLEX', to: 'BN', proj: 1, left: 1 },
  ]);
  assert.equal(plan.before, 15);
  assert.equal(plan.after, 23);
  const sitting = model.bestLineup({ ...l, players: { ...ps, f2: { ...ps.f2, injury: 'Out' } } }, NOW);
  assert.equal(sitting.starters.includes('f2'), false, 'an Out player is worth nothing');
  assert.equal(model.bestLineup({ ...l, week: null }), null);
});

test('win probability: Sleeper\'s formula, even when nothing separates the teams', () => {
  assert.deepEqual(plain(model.winProbability(0, 0, 0, 0)), [0.5, 0.5], 'no points and no projections: a coin flip');
  assert.deepEqual(plain(model.winProbability(40, 40, 40, 40)), [0.5, 0.5], 'a finished draw');
  assert.deepEqual(plain(model.winProbability(50, 50, 40, 40)), [1, 0]);
  assert.deepEqual(plain(model.winProbability(null, null, 10, 10)), [0, 1], 'missing numbers count as 0');
  const [a, b] = model.winProbability(10, 60, 20, 40);
  assert.ok(a > 0.5 && a < 0.99, `the higher projection is favored (${a})`);
  assert.ok(Math.abs(a + b - 1) < 1e-9);
  const [far] = model.winProbability(0, 200, 0, 1);
  assert.equal(far, 0.99, 'clamped to 99%');
  for (const p of model.winProbability(5, 0, 0, 10)) assert.ok(Number.isFinite(p), 'no projection never divides by zero');
});

test('standings: record, then points for, then waiver order; Sleeper\'s ranks when it has them', () => {
  const r = (id, wins, fpts, wp, extra = {}) => ({ roster_id: id, settings: { wins, fpts, fpts_decimal: 50, waiver_position: wp, ...extra } });
  const rosters = [r(1, 3, 100, 1), r(2, 4, 90, 2), r(3, 3, 120, 3), r(4, 3, 100, 0)];
  assert.deepEqual(plain(model.standings(rosters).map((x) => x.roster_id)), [2, 3, 4, 1]);
  assert.equal(model.pointsFor(rosters[0]), 100.5);
  assert.equal(model.pointsAgainst({ settings: { fpts_against: 7, fpts_against_decimal: 25 } }), 7.25);
  assert.deepEqual(plain(model.standingsRanks(rosters, [])), { 1: 4, 2: 1, 3: 2, 4: 3 });
  assert.deepEqual(plain(model.standingsRanks(rosters, [{ roster_id: 1, rank: 1 }])), { 1: 1 });
  assert.equal(model.streak({ metadata: { record: 'WLLWWW' } }), '3W');
  assert.equal(model.streak({ metadata: { streak: '2L', record: 'W' } }), '2L');
  assert.equal(model.streak({ metadata: {} }), '');
});

test('claims: roster room, FAAB left, Sleeper\'s claim errors and processing order', () => {
  const league = { roster_positions: ['F', 'M', 'BN'], settings: { waiver_type: model.FAAB, waiver_budget: 100, waiver_bid_min: 1 } };
  const full = { players: ['a', 'b', 'c'], reserve: [], settings: { waiver_budget_used: 30 } };
  assert.equal(model.rosterRoom(league, full), 0);
  assert.equal(model.rosterRoom(league, { players: ['a', 'b', 'c', 'd'], reserve: ['d'] }), 0, 'IR players do not count');
  assert.equal(model.faabLeft(league, full), 70);
  assert.equal(model.faabLeft(league, null), 100);
  const err = (o) => model.claimError({ league, roster: full, waiver: true, bid: 5, drops: [], ...o });
  assert.equal(err({}), 'You must select 1 player to drop');
  assert.equal(err({ drops: ['a'] }), null);
  assert.equal(err({ drops: ['a'], bid: '' }), 'Invalid bid amount');
  assert.equal(err({ drops: ['a'], bid: -1 }), 'Bid cannot be negative');
  assert.equal(err({ drops: ['a'], bid: 2.5 }), 'Bids are whole dollars');
  assert.equal(err({ drops: ['a'], bid: 0 }), 'Bid must be a minimum of $1');
  assert.equal(err({ drops: ['a'], bid: 71 }), 'You only have $70 remaining');
  assert.equal(err({ drops: ['a'], bid: 71, waiver: false }), null, 'free agents take no bid');
  const c = (id, bid, priority) => ({ transaction_id: id, settings: { waiver_bid: bid, priority } });
  assert.deepEqual(plain(model.sortClaims([c('a', 5, 2), c('b', 9, 3), c('c', 5, 1), c('d', 5)]).map((x) => x.transaction_id)), ['b', 'c', 'a', 'd']);
});

test('waiver guess: recently dropped, or the club has kicked off', () => {
  const league = { settings: { waiver_clear_days: 2, waiver_after_game_start: 1 } };
  const drop = (at) => ({ status: 'complete', drops: { p: 1 }, status_updated: at });
  assert.equal(model.waiverGuess({ league, playerId: 'p', transactions: [drop(NOW - 864e5)], games: [], now: NOW }), 'waiver');
  assert.equal(model.waiverGuess({ league, playerId: 'p', transactions: [drop(NOW - 3 * 864e5)], games: [], now: NOW }), 'free_agent');
  assert.equal(model.waiverGuess({ league, playerId: 'p', transactions: [], games: [{ game: { status: 'in_game' } }], now: NOW }), 'waiver');
  assert.equal(model.waiverGuess({ league: { settings: {} }, playerId: 'p', transactions: [], games: [{ game: { status: 'in_game' } }], now: NOW }), 'free_agent');
});

test('club form: results from the record after each match, last five', () => {
  const g = (week, home, hr, away, ar) => ({ status: 'complete', week, date: `2026-08-0${week}`, home: { team: home, abbr: home, record: hr }, away: { team: away, abbr: away, record: ar } });
  const schedule = [
    g(1, 'A', '1-0-0', 'B', '0-0-1'),
    g(2, 'B', '0-1-1', 'A', '1-1-0'),
    g(3, 'A', '1-1-1', 'C', '1-0-0'),
    { status: 'pre_game', week: 4, home: { team: 'A' }, away: { team: 'B' } },
  ];
  const forms = model.clubForms(schedule);
  assert.deepEqual(plain(forms.A), { abbr: 'A', record: '1-1-1', form: ['W', 'D', 'L'] });
  assert.deepEqual(plain(forms.B), { abbr: 'B', record: '0-1-1', form: ['L', 'D'] });
  assert.deepEqual(plain(model.clubForms(schedule, 2).A.form), ['D', 'L']);
  const unrecorded = model.clubForms([...schedule, { status: 'complete', week: 4, date: '2026-08-04', home: { team: 'A', abbr: 'A' }, away: { team: 'C', abbr: 'C' } }]);
  assert.deepEqual(plain(unrecorded.A), plain(forms.A), 'a finished match without a record yet changes nothing');
});

test('the rules that are the same as NBA and NFL come from the core model', () => {
  const { SEP: sep, SNP } = loadSep();
  for (const name of ['cheapestAssignment', 'standingsRanks', 'FAAB', 'rosterRoom', 'faabLeft', 'claimError', 'sortClaims']) {
    assert.equal(sep.model[name], SNP.model[name], name);
  }
});
