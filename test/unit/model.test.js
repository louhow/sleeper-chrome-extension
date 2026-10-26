import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { model, scoring } = loadSnp();
const plain = (x) => JSON.parse(JSON.stringify(x));

const score = (gameId, date, home, away, extra = {}) =>
  ({ game_id: gameId, date, start_time: Date.parse(`${date}T23:00:00Z`), status: 'pre_game', metadata: { home_team: { team: home }, away_team: { team: away } }, ...extra });

test('week runs Monday to Sunday around its first game', () => {
  const days = model.weekDays([score('a', '2026-10-21', 'LAL', 'GSW'), score('b', '2026-10-20', 'DET', 'BOS')]);
  assert.deepEqual(plain(days), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
  assert.deepEqual(plain(model.weekDays([score('c', '2026-10-25', 'UTA', 'LAL')])).at(0), '2026-10-19', 'a Sunday belongs to the week before');
  assert.deepEqual(plain(model.weekDays([])), []);
});

test('player days pair each game with home/away, projection and actual points', () => {
  const games = [score('g1', '2026-10-21', 'LAL', 'GSW'), score('g2', '2026-10-25', 'UTA', 'LAL', { status: 'complete' })];
  const settings = { pts: 1 };
  const week = {
    days: model.weekDays(games),
    gamesByTeam: model.gamesByTeam(games),
    proj: model.pointsByGame([{ player_id: '1970', game_id: 'g1', stats: { pts: 30.79 } }, { player_id: '1970', game_id: 'g2', stats: { pts: 39.83 } }], settings, scoring.scoreStats),
    actual: model.pointsByGame([{ player_id: '1970', game_id: 'g2', stats: { pts: 41 } }], settings, scoring.scoreStats),
  };
  const days = model.playerDays(week, 'LAL', '1970');
  assert.equal(days.length, 7);
  assert.deepEqual(plain(days.filter((d) => d.game).map((d) => [d.date, d.home ? 'vs' : '@', d.opponent, d.proj, d.actual ?? null])),
    [['2026-10-21', 'vs', 'GSW', 30.79, null], ['2026-10-25', '@', 'UTA', 39.83, 41]]);
  assert.equal(model.lockInDefault(days), 39.83, 'unlocked players score their final game');
  assert.equal(model.lockInDefault(model.playerDays(week, 'NYK', 'x')), null, 'no games, no projection');
  assert.equal(model.lockInDefault(model.playerDays(week, 'LAL', 'unprojected')), null, 'unprojected final game, no projection');
});

test('owned picks follow trades in both directions', () => {
  const picks = model.ownedPicks({
    rosterId: 10,
    rosterIds: [8, 9, 10],
    seasons: ['2027', '2028'],
    rounds: 2,
    traded: [
      { season: '2027', round: 1, roster_id: 10, owner_id: 9 },
      { season: '2027', round: 2, roster_id: 8, owner_id: 10 },
      { season: '2028', round: 1, roster_id: 10, owner_id: 8 },
    ],
  });
  assert.deepEqual(plain(picks), [
    { season: '2027', round: 2, original: 8 },
    { season: '2027', round: 2, original: 10 },
    { season: '2028', round: 2, original: 10 },
  ]);
});

const lineup = () => ({
  slots: ['PG', 'G', 'F', 'C', 'UTIL'],
  starters: ['pg', 'sg', 'sf', '0', 'c2'],
  bench: ['pf', 'c', 'pgsg'],
  players: {
    pg: { positions: ['PG'] },
    sg: { positions: ['SG'] },
    sf: { positions: ['SF'] },
    c2: { positions: ['C'] },
    pf: { positions: ['PF'] },
    c: { positions: ['C', 'PF'] },
    pgsg: { positions: ['PG', 'SG'] },
  },
});

test('swap targets respect slot eligibility in both directions', () => {
  const l = lineup();
  // The PG could slide to G or UTIL, but neither occupant can play PG in return.
  assert.deepEqual(plain(model.swapTargets('s:0', l)), ['b:pgsg']);
  // The G-slot SG could go to UTIL, but the center there can't play G.
  assert.deepEqual(plain(model.swapTargets('s:1', l)), ['b:pgsg']);
  // Empty C slot takes any bench player who can play C; UTIL's C can slide over too.
  assert.deepEqual(plain(model.swapTargets('s:3', l)), ['s:4', 'b:c']);
  // A bench big can go to F, C (empty) or UTIL, never another bench spot.
  assert.deepEqual(plain(model.swapTargets('b:c', l)), ['s:2', 's:3', 's:4']);
});

test('applying a swap moves players between slots and the bench', () => {
  const l = lineup();
  const starters = (from, to) => plain(model.applyMove(from, to, l).starters);
  assert.deepEqual(starters('s:0', 's:1'), ['sg', 'pg', 'sf', '0', 'c2']);
  assert.deepEqual(starters('b:c', 's:3'), ['pg', 'sg', 'sf', 'c', 'c2'], 'bench player fills an empty slot');
  assert.deepEqual(starters('s:2', 'b:pf'), ['pg', 'sg', 'pf', '0', 'c2'], 'benched starter just drops out');
});

const day = (id, date, status, start, extra = {}) =>
  ({ date, game: { id, date, status, start: Date.parse(start) }, opponent: 'GSW', home: true, proj: 30, ...extra });
const NOW = Date.parse('2026-10-22T12:00:00Z');

test('lock-in: a finished game is lockable until the next game starts', () => {
  const days = [
    day('g1', '2026-10-21', 'complete', '2026-10-21T23:00:00Z', { actual: 34.5 }),
    day('g2', '2026-10-23', 'pre_game', '2026-10-23T23:00:00Z'),
  ];
  const st = model.lockState(days, undefined, NOW);
  assert.equal(st.lockable, true);
  assert.equal(st.current.game.id, 'g1');
  assert.equal(st.counted, null, 'nothing counts yet');
  assert.equal(st.yetToPlay, true);
  const tipped = model.lockState(days, undefined, Date.parse('2026-10-23T23:05:00Z'));
  assert.equal(tipped.lockable, false, 'window closes at the next tip-off');
  assert.equal(tipped.current.game.id, 'g2');
});

test('lock-in: a locked game counts and is final; otherwise the last game counts', () => {
  const days = [
    day('g1', '2026-10-21', 'complete', '2026-10-21T23:00:00Z', { actual: 34.5 }),
    day('g2', '2026-10-23', 'complete', '2026-10-23T23:00:00Z', { actual: 12 }),
  ];
  const locked = model.lockState(days, 'g1', NOW);
  assert.deepEqual([locked.locked.game.id, locked.points, locked.lockable, locked.yetToPlay], ['g1', 34.5, false, false]);
  const unlocked = model.lockState(days, undefined, NOW);
  assert.deepEqual([unlocked.counted.game.id, unlocked.points], ['g2', 12]);
  assert.equal(model.lockState(days, { game_id: 'g1' }, NOW).locked.game.id, 'g1', 'object-shaped locks work too');
  assert.equal(model.lockState([day('g3', '2026-10-24', 'pre_game', '2026-10-24T23:00:00Z')], undefined, NOW).lockable, false,
    'nothing to lock before the first game ends');
});

test("win probability matches Sleeper's (37% vs 63% at 157.23 vs 181.21)", () => {
  const [a, b] = model.winProbability(0, 157.23, 0, 181.21);
  assert.equal(Math.round(a * 100), 37);
  assert.equal(Math.round(b * 100), 63);
  assert.deepEqual(plain(model.winProbability(120, 120, 100, 100)), [1, 0], 'final scores decide it');
  const [lo] = model.winProbability(0, 50, 0, 400);
  assert.equal(lo, 0.01, 'clamped to 1-99%');
});

test('win probability: a settled tie is a coin flip, missing numbers count as 0, no projection stays finite', () => {
  assert.deepEqual(plain(model.winProbability(0, 0, 0, 0)), [0.5, 0.5], 'no points and no projections');
  assert.deepEqual(plain(model.winProbability(40, 40, 40, 40)), [0.5, 0.5], 'a finished tie');
  assert.deepEqual(plain(model.winProbability(null, null, 10, 10)), [0, 1], 'side one has nothing, side two is settled at 10');
  assert.deepEqual(plain(model.winProbability(undefined, 20, 0, 20)), plain(model.winProbability(0, 20, 0, 20)));
  for (const p of model.winProbability(5, 0, 0, 10)) assert.ok(Number.isFinite(p), 'a projection of 0 never divides by zero');
});

test('standings ranks use roster_standings, else record then waiver order', () => {
  const rosters = [
    { roster_id: 1, settings: { wins: 0, waiver_position: 14 } },
    { roster_id: 10, settings: { wins: 0, waiver_position: 3 } },
    { roster_id: 5, settings: { wins: 1, waiver_position: 7 } },
  ];
  assert.deepEqual(plain(model.standingsRanks(rosters, [])), { 5: 1, 10: 2, 1: 3 });
  assert.deepEqual(plain(model.standingsRanks(rosters, [{ roster_id: 1, rank: 1 }])), { 1: 1 });
});

// Taxi: league allows non-rookies with up to 2 years; roster is full with 1 open taxi slot.
const taxiLineup = (overrides = {}) => ({
  ...lineup(),
  bench: ['rookie', 'vet'],
  taxi: ['kid'],
  taxiEditable: true,
  taxiOpen: true,
  taxiRoom: 1,
  benchRoom: 0,
  settings: { taxi_slots: 2, taxi_years: 2, taxi_allow_vets: 1, taxi_deadline: 4 },
  players: {
    ...lineup().players,
    pg: { positions: ['PG'], years_exp: 1 },
    rookie: { positions: ['SF'], years_exp: 0 },
    vet: { positions: ['C'], years_exp: 9 },
    kid: { positions: ['PG'], years_exp: 2 },
  },
  ...overrides,
});

test('taxi eligibility follows experience settings', () => {
  const s = { taxi_years: 2, taxi_allow_vets: 1 };
  assert.equal(model.taxiEligible({ years_exp: 2 }, s), true, 'up to and including taxi_years');
  assert.equal(model.taxiEligible({ years_exp: 3 }, s), false);
  assert.equal(model.taxiEligible({ years_exp: 1 }, { ...s, taxi_allow_vets: 0 }), false, 'rookies only');
  assert.equal(model.taxiEligible({ years_exp: 0 }, { ...s, taxi_allow_vets: 0 }), true);
  assert.equal(model.taxiEligible({ years_exp: 12 }, { taxi_years: 0, taxi_allow_vets: 1 }), true, '0 = no limit');
});

test('taxi window: open until the deadline, then one-way', () => {
  const s = { taxi_deadline: 4 };
  assert.equal(model.taxiOpen(s, 'regular', 1, false), true, 'week 1 before tip-off');
  assert.equal(model.taxiOpen(s, 'regular', 1, true), false, 'locked once week 1 starts');
  assert.equal(model.taxiOpen(s, 'regular', 2, false), false);
  assert.equal(model.taxiOpen(s, 'off', 1, true), true, 'offseason');
  assert.equal(model.taxiOpen({ taxi_deadline: 2 }, 'pre', 2, true), true, 'through preseason week 2');
  assert.equal(model.taxiOpen({ taxi_deadline: 2 }, 'pre', 3, false), false);
  assert.equal(model.taxiOpen({ taxi_deadline: 0 }, 'regular', 9, true), true, 'no deadline');
});

test('taxi moves while open: eligible players go on, displaced taxi players come off', () => {
  const l = taxiLineup();
  assert.deepEqual(plain(model.swapTargets('b:rookie', l)), ['s:2', 's:4', 't:kid', 'te:0'], 'lineup swaps, plus taxi for an eligible player');
  assert.deepEqual(plain(model.swapTargets('b:vet', l)), ['s:3', 's:4'], 'lineup moves only: a 9-year vet is too experienced for taxi');
  assert.deepEqual(plain(model.swapTargets('t:kid', l)), ['s:0', 'b:rookie'],
    'taxi player trades with taxi-eligible starters whose slot it fits, or taxi-eligible bench players');
  assert.deepEqual(plain(model.swapTargets('te:0', l)), ['s:0', 'b:rookie'], 'an open slot takes any eligible player');
  assert.deepEqual(plain(model.applyMove('b:rookie', 't:kid', l)), { starters: l.starters, taxi: ['rookie'], reserve: [] });
  assert.deepEqual(plain(model.applyMove('s:0', 'te:0', l)), { starters: ['0', 'sg', 'sf', '0', 'c2'], taxi: ['kid', 'pg'], reserve: [] });
  assert.deepEqual(plain(model.applyMove('t:kid', 's:0', l)), { starters: ['kid', 'sg', 'sf', '0', 'c2'], taxi: ['pg'], reserve: [] });
});

test('taxi moves after the deadline: only off taxi, into an open bench spot', () => {
  const full = taxiLineup({ taxiOpen: false });
  assert.deepEqual(plain(model.swapTargets('t:kid', full)), [], 'roster full: nowhere to go');
  assert.deepEqual(plain(model.swapTargets('b:rookie', full)), ['s:2', 's:4'], 'lineup swaps still work, nothing moves onto taxi');
  const room = taxiLineup({ taxiOpen: false, benchRoom: 1 });
  assert.deepEqual(plain(model.swapTargets('t:kid', room)), ['be:0']);
  assert.deepEqual(plain(model.applyMove('t:kid', 'be:0', room)), { starters: room.starters, taxi: [], reserve: [] });
});

test('describeMove names where each moved player ends up', () => {
  const l = taxiLineup();
  const moves = (from, to) => plain(model.describeMove(l, model.applyMove(from, to, l)));
  assert.deepEqual(moves('b:rookie', 't:kid'), [{ id: 'kid', to: 'bench' }, { id: 'rookie', to: 'taxi' }]);
  assert.deepEqual(moves('t:kid', 's:0'), [{ id: 'pg', to: 'taxi' }, { id: 'kid', to: 'PG' }]);
  assert.deepEqual(moves('s:0', 's:1'), [{ id: 'pg', to: 'G' }, { id: 'sg', to: 'PG' }]);
});

// Starters pg, sg, sf, (empty), c2; bench: an Out center and a healthy guard; IR: one hurt player, one open slot.
const irLineup = (overrides = {}) => ({
  ...lineup(),
  bench: ['out', 'fine'],
  reserve: ['hurt'],
  reserveEditable: true,
  reserveRoom: 1,
  benchRoom: 0,
  settings: { reserve_slots: 2, reserve_allow_out: 1, reserve_allow_dtd: 1 },
  players: {
    ...lineup().players,
    pg: { positions: ['PG'], injury: 'Out' },
    out: { positions: ['C'], injury: 'Out' },
    fine: { positions: ['PG'] },
    hurt: { positions: ['PG', 'SG'], injury: 'IR' },
  },
  ...overrides,
});

test('IR eligibility: IR and PUP always, other statuses when the league allows them', () => {
  const settings = { reserve_allow_out: 1, reserve_allow_dtd: 1 };
  assert.equal(model.reserveEligible({ injury: 'Out' }, settings), true);
  assert.equal(model.reserveEligible({ injury: 'DTD' }, settings), true);
  assert.equal(model.reserveEligible({ injury: 'IR' }, {}), true);
  assert.equal(model.reserveEligible({ injury: 'Questionable' }, settings), false);
  assert.equal(model.reserveEligible({ injury: 'Sus' }, settings), false);
  assert.equal(model.reserveEligible({}, settings), false);
});

test('IR moves: eligible players go onto IR, and IR players come off into their spot', () => {
  const l = irLineup();
  assert.ok(model.swapTargets('b:out', l).includes('re:0'), 'an Out bench player can fill the open IR slot');
  assert.ok(model.swapTargets('b:out', l).includes('r:hurt'), 'or trade places with the IR player');
  assert.ok(model.swapTargets('s:0', l).includes('re:0'), 'an Out starter can go to IR');
  assert.ok(!model.swapTargets('b:fine', l).some((r) => r.startsWith('r')), 'a healthy player cannot');
  assert.deepEqual(plain(model.swapTargets('r:hurt', l)), ['s:0', 'b:out'], 'full roster: IR player only trades with eligible players it fits');
  assert.deepEqual(plain(model.applyMove('b:out', 're:0', l)), { starters: l.starters, taxi: [], reserve: ['hurt', 'out'] });
  assert.deepEqual(plain(model.applyMove('r:hurt', 's:0', l)), { starters: ['hurt', 'sg', 'sf', '0', 'c2'], taxi: [], reserve: ['pg'] });
  assert.deepEqual(plain(model.describeMove(l, model.applyMove('s:0', 're:0', l))), [{ id: 'pg', to: 'IR' }]);
});

test('IR players come off into an open spot only when the active roster has room', () => {
  const openUtil = { starters: ['pg', 'sg', 'sf', 'c2', '0'] };
  const room = irLineup({ ...openUtil, benchRoom: 1 });
  const targets = plain(model.swapTargets('r:hurt', room));
  assert.ok(targets.includes('be:0') && targets.includes('s:4'), 'open bench spot or the empty UTIL slot');
  assert.deepEqual(plain(model.applyMove('r:hurt', 'be:0', room)), { starters: room.starters, taxi: [], reserve: [] });
  assert.ok(!plain(model.swapTargets('r:hurt', irLineup(openUtil))).includes('s:4'), 'no room: the empty slot is off limits');
});

// A week where each player has their own team, so their games are theirs alone.
// games: { [player]: [[gameId, date, status, proj, actual?], ...] }
function optimizerWeek(games) {
  const scores = Object.entries(games).flatMap(([team, list]) => list.map(([id, date, status]) =>
    score(id, date, team, 'OPP', { status })));
  const rows = (i) => Object.entries(games).flatMap(([pid, list]) => list.filter((g) => g[i] != null)
    .map((g) => ({ player_id: pid, game_id: g[0], stats: { pts: g[i] } })));
  return {
    days: model.weekDays(scores),
    gamesByTeam: model.gamesByTeam(scores),
    proj: model.pointsByGame(rows(3), { pts: 1 }, scoring.scoreStats),
    actual: model.pointsByGame(rows(4), { pts: 1 }, scoring.scoreStats),
  };
}
// Score colors as in an NBA league like the extension's: green from 24, yellow from 15.
const NBA_TIERS = { all: [15, 24], positions: {} };
const optimizerLineup = (slots, starters, bench, positions, games, locks = {}) => ({
  slots, starters, bench, locks, tiers: NBA_TIERS,
  players: Object.fromEntries(Object.entries(positions).map(([id, pos]) => [id, { team: id, positions: pos }])),
  week: optimizerWeek(games),
});
const OPT_NOW = Date.parse('2026-10-21T12:00:00Z');

test('best lineup: scarce positions go to the players who can only fill them', () => {
  // Putting the C/PF star at C (their first position) would leave F to the weaker wing.
  const l = optimizerLineup(['C', 'F'], ['big', 'sf'], ['cen'], { big: ['C', 'PF'], cen: ['C'], sf: ['SF'] }, {
    big: [['b1', '2026-10-22', 'pre_game', 40]],
    cen: [['c1', '2026-10-22', 'pre_game', 30]],
    sf: [['s1', '2026-10-22', 'pre_game', 25]],
  });
  const plan = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(plan.starters), ['cen', 'big']);
  assert.deepEqual(plain(plan.changes.map((c) => [c.id, c.from, c.to])), [['cen', 'BN', 'C'], ['big', 'C', 'F'], ['sf', 'F', 'BN']]);
  assert.deepEqual([plan.before, plan.after], [65, 70]);
});

test('applying one slot of a plan: a bench swap alone, linked moves together', () => {
  // PG: a -> b (b from the bench), C: big -> cen with big moving to F and sf to the bench.
  const current = ['a', 'big', 'sf', 'keep'];
  const planned = ['b', 'cen', 'big', 'keep'];
  assert.deepEqual(plain(model.applySlot(current, planned, 0)), { starters: ['b', 'big', 'sf', 'keep'], slots: [0] });
  const linked = { starters: ['a', 'cen', 'big', 'keep'], slots: [1, 2] };
  assert.deepEqual(plain(model.applySlot(current, planned, 1)), linked);
  assert.deepEqual(plain(model.applySlot(current, planned, 2)), linked, 'from either end of the chain');
  // Two starters trading slots go together; an empty slot filled from the bench goes alone.
  assert.deepEqual(plain(model.applySlot(['x', 'y', '0'], ['y', 'x', 'z'], 1)), { starters: ['y', 'x', '0'], slots: [0, 1] });
  assert.deepEqual(plain(model.applySlot(['x', 'y', '0'], ['y', 'x', 'z'], 2)), { starters: ['x', 'y', 'z'], slots: [2] });
  assert.deepEqual(plain(model.applySlot(current, planned, 3)), { starters: current, slots: [] }, 'nothing to change');
});

test('best lineup: picks for the next day of games, so a starter without one sits until their next game', () => {
  // Thursday is next. Two plays and starts; one only plays Friday, so they wait for Friday's run.
  const l = optimizerLineup(['UTIL'], ['two'], ['one', 'done'], { two: ['PG'], one: ['SG'], done: ['SF'] }, {
    two: [['t1', '2026-10-22', 'pre_game', 12], ['t2', '2026-10-24', 'pre_game', 10]],
    one: [['o1', '2026-10-23', 'pre_game', 16]],
    done: [['d1', '2026-10-20', 'complete', 50, 48]],
  });
  const plan = model.bestLineup(l, OPT_NOW);
  assert.equal(plan.date, '2026-10-22');
  assert.deepEqual(plain(plan.changes), [], 'one has no game Thursday');
  assert.deepEqual([plan.before, plan.after], [12, 12]);
  // Friday: two's Thursday game is done, so one starts and two can come back Saturday.
  l.week = optimizerWeek({
    two: [['t1', '2026-10-22', 'complete', 12, 6], ['t2', '2026-10-24', 'pre_game', 15]],
    one: [['o1', '2026-10-23', 'pre_game', 9]],
    done: [['d1', '2026-10-20', 'complete', 50, 48]],
  });
  const fri = model.bestLineup(l, Date.parse('2026-10-23T12:00:00Z'));
  assert.equal(fri.date, '2026-10-23');
  assert.deepEqual(plain(fri.changes.map((c) => [c.id, c.to, c.today, c.perGame, c.gamesLeft, c.lost])),
    [['one', 'UTIL', 9, 9, 1, null], ['two', 'BN', null, 15, 1, null]], 'two\'s 6 is not worth locking over a 15 projection');
  assert.deepEqual([fri.before, fri.after], [0, 9]);
});

test('best lineup: slots no one can fill that day go to the best of the rest of the week', () => {
  // Only thu plays Thursday. The other slot goes to sun (16 a game) over sat (10) and none (no games).
  const l = optimizerLineup(['UTIL', 'UTIL'], ['sat', 'none'], ['sun', 'thu'], { sat: ['PG'], none: ['SG'], sun: ['SF'], thu: ['C'] }, {
    sat: [['a1', '2026-10-24', 'pre_game', 10]],
    none: [],
    sun: [['s1', '2026-10-25', 'pre_game', 16]],
    thu: [['t1', '2026-10-22', 'pre_game', 5]],
  });
  const plan = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(plan.starters).sort(), ['sun', 'thu']);
  assert.deepEqual([plan.before, plan.after], [0, 5]);
});

test('best lineup: benching a starter with a lockable finished game flags the lost score', () => {
  const l = optimizerLineup(['F'], ['kj'], ['wing'], { kj: ['SF', 'PF'], wing: ['SF'] }, {
    kj: [['k1', '2026-10-20', 'complete', 10, 12.5], ['k2', '2026-10-23', 'pre_game', 9]],
    wing: [['w1', '2026-10-22', 'pre_game', 20]],
  });
  const plan = model.bestLineup(l, OPT_NOW);
  const benched = plan.changes.find((c) => c.id === 'kj');
  assert.equal(benched.to, 'BN');
  assert.deepEqual([benched.lost.game.id, benched.lost.actual, benched.goodScore], ['k1', 12.5, false], '12.5 is not a green score');
  assert.equal(plan.changes.find((c) => c.id === 'wing').lost, null, 'a bench player had nothing to lock');
  const green = optimizerLineup(['F'], ['kj'], ['wing'], { kj: ['SF', 'PF'], wing: ['SF'] }, {
    kj: [['k1', '2026-10-20', 'complete', 10, 24], ['k2', '2026-10-23', 'pre_game', 9]],
    wing: [['w1', '2026-10-22', 'pre_game', 30]],
  });
  const big = model.bestLineup(green, OPT_NOW).changes.find((c) => c.id === 'kj');
  assert.deepEqual([big.lost.actual, big.goodScore], [24, true], 'benching a green score is flagged');
  // Worth at least the lockable score: a 12.5 finished game beats a 12 projection.
  const close = optimizerLineup(['F'], ['kj'], ['wing'], { kj: ['SF', 'PF'], wing: ['SF'] }, {
    kj: [['k1', '2026-10-20', 'complete', 10, 12.5], ['k2', '2026-10-23', 'pre_game', 9]],
    wing: [['w1', '2026-10-22', 'pre_game', 12]],
  });
  assert.deepEqual(plain(model.bestLineup(close, OPT_NOW).changes), []);
});

test('open value: the last game counts, and an earlier one gets locked when it beats what is left', () => {
  assert.equal(model.openValue([]), 0);
  assert.equal(model.openValue([20]), 20);
  // Two games left: the first is worth locking only when it beats the second, so the open slot is worth more than either.
  const two = model.openValue([22.42, 22.99]);
  assert.ok(two > 25.7 && two < 26, `about 25.8 (${two})`);
  assert.ok(model.openValue([10, 20, 30]) > 30, 'each extra game adds a chance');
  assert.equal(model.openValue([0, 0]), 0, 'nothing projected is worth nothing');
});

test('best lineup: recommends locking a finished game that beats leaving the slot open', () => {
  const l = optimizerLineup(['F'], ['kj'], ['wing'], { kj: ['SF', 'PF'], wing: ['SF'] }, {
    kj: [['k1', '2026-10-20', 'complete', 10, 12.5], ['k2', '2026-10-23', 'pre_game', 9]],
    wing: [['w1', '2026-10-22', 'pre_game', 12]],
  });
  const plan = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(plan.changes), []);
  // Keeping it open is worth the bench wing's 12 (more than kj's own 9), still short of 12.5.
  assert.deepEqual(plain(plan.locks.map((k) => [k.id, k.on, k.game.game.id, k.actual, k.open, k.openBy, k.gamesLeft])), [['kj', true, 'k1', 12.5, 12, 'wing', 1]]);
  assert.deepEqual(plain(plan.fixed), [], 'the lock isn\'t a reason to list them as staying put');
  // Unticked: not locked now, but kj keeps the slot (and the chance to lock it later).
  const open = model.bestLineup(l, OPT_NOW, { noLock: ['kj'] });
  assert.deepEqual(plain(open.locks.map((k) => [k.id, k.on])), [['kj', false]], 'still listed, to tick again');
  assert.deepEqual(plain(open.changes), []);
  // Behind what's still to come: not worth locking yet.
  l.week = optimizerWeek({
    kj: [['k1', '2026-10-20', 'complete', 10, 12.5], ['k2', '2026-10-23', 'pre_game', 20]],
    wing: [['w1', '2026-10-22', 'pre_game', 5]],
  });
  const later = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(later.locks), []);
  assert.deepEqual(plain(later.notYet.map(({ id, actual, open, game }) => ({ id, actual, open, game: game.game.id }))), [{ id: 'kj', actual: 12.5, open: 20, game: 'k1' }]);
  // No game left: the last game counts anyway, so there's nothing to lock.
  l.week = optimizerWeek({ kj: [['k1', '2026-10-20', 'complete', 10, 12.5]], wing: [['w1', '2026-10-22', 'pre_game', 5]] });
  assert.deepEqual(plain(model.bestLineup(l, OPT_NOW).locks), []);
  // Not your lineup to lock.
  assert.deepEqual(plain(model.bestLineup({ ...l, lockable: false }, OPT_NOW).locks), []);
});

test('best lineup: a lock shuts the slot to the bench too, so a bench player who fits it counts as keeping it open', () => {
  // tre's finished 20 beats his own game left (13), but locking him would shut luka out of PG for the week.
  const games = {
    tre: [['t1', '2026-10-20', 'complete', 10, 20], ['t2', '2026-10-22', 'pre_game', 13]],
    luka: [['l1', '2026-10-23', 'pre_game', 32]],
  };
  const l = optimizerLineup(['PG'], ['tre'], ['luka'], { tre: ['PG', 'SG'], luka: ['PG'] }, games);
  const plan = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(plan.locks), []);
  assert.deepEqual(plain(plan.notYet.map(({ id, open, openBy }) => ({ id, open, openBy }))), [{ id: 'tre', open: 32, openBy: 'luka' }]);
  // A bench player who can't play the slot doesn't count.
  const c = optimizerLineup(['PG'], ['tre'], ['luka'], { tre: ['PG', 'SG'], luka: ['C'] }, games);
  assert.deepEqual(plain(model.bestLineup(c, OPT_NOW).locks.map((k) => [k.id, k.openBy])), [['tre', null]]);
});

test('lineup history: who was starting at a time, from the lineups seen', () => {
  const t = (n) => n * 1e6; // about 17 minutes a step, so 100 steps is over a day
  let h = model.seeLineup([], ['a', 'b'], t(100));
  h = model.seeLineup(h, ['a', 'b'], t(200));
  h = model.seeLineup(h, ['c', 'b'], t(300));
  h = model.seeLineup(h, ['c', 'b'], t(400));
  assert.deepEqual(plain(h), [{ from: t(100), to: t(200), starters: ['a', 'b'] }, { from: t(300), to: t(400), starters: ['c', 'b'] }]);
  assert.deepEqual(plain(model.seeLineup(h, ['x'], t(350))), plain(h), 'an older read changes nothing');
  let many = [];
  for (let i = 0; i < 150; i++) many = model.seeLineup(many, [String(i)], i);
  assert.equal(many.length, 100, 'capped');
  assert.deepEqual(plain(many.at(-1).starters), ['149'], 'keeping the latest');
  assert.equal(model.startedAt(h, 'b', t(150)), true, 'inside a span');
  assert.equal(model.startedAt(h, 'c', t(150)), false);
  assert.equal(model.startedAt(h, 'a', t(150)), false, 'started it, but benched since (Sleeper: ineligible)');
  assert.equal(model.startedAt(h, 'b', t(250)), true, 'between spans that agree');
  const later = [{ from: t(100), to: t(200), starters: ['c'] }, { from: t(300), to: t(400), starters: ['a'] }];
  assert.equal(model.startedAt(later, 'a', t(250)), null, 'between spans that disagree: a change happened, but when?');
  assert.equal(model.startedAt(h, 'b', t(50)), null, 'before anything was seen');
  assert.equal(model.startedAt([], 'a', t(150)), null);
  // Seen while the game was on, the lineup can't have changed for it since tip-off.
  const live = [{ from: t(100), to: t(100), starters: ['x'] }, { from: t(260) + 5 * 60e3, to: t(260) + 5 * 60e3, starters: ['a'] }];
  assert.equal(model.startedAt(live, 'a', t(260)), true, 'read 5 minutes after tip-off');
  assert.equal(model.startedAt(live, 'a', t(260) - model.FROZEN_MS - 1), null, 'read after that game ended: unknown');
  // Sleeper's rule: moved to the bench since the game began, even if back now, makes it ineligible.
  const benched = [{ from: t(100), to: t(270), starters: ['a'] }, { from: t(280), to: t(280), starters: ['x'] }, { from: t(290), to: t(300), starters: ['a'] }];
  assert.equal(model.startedAt(benched, 'a', t(260)), false, 'benched after tip-off, then started again');
  assert.equal(model.startedAt(benched, 'a', t(285)), true, 'benched before this tip-off, starting while it was on: eligible');
  assert.equal(model.startedAt([{ from: t(100), to: t(100), starters: ['x'] }, { from: t(300), to: t(300), starters: ['x'] }], 'a', t(200)), false,
    'benched before and after: not starting');
});

test('lineup reads follow tip-offs: one per tip-off time, never on a timer', () => {
  const min = 60e3;
  const day = [100 * min, 100 * min, 130 * min, 160 * min, null]; // two games at once, then two more
  assert.deepEqual(plain(model.nextTipRead(day, 0, 5 * min, min)), { tip: 100 * min, at: 105 * min }, 'nothing until 5 minutes past the first');
  assert.deepEqual(plain(model.nextTipRead(day, 105 * min, 5 * min, min)), { tip: 130 * min, at: 135 * min }, 'games together share one read');
  assert.deepEqual(plain(model.nextTipRead(day, 102 * min, 5 * min, min)), { tip: 100 * min, at: 105 * min });
  assert.deepEqual(plain(model.nextTipRead(day, 104.5 * min, 5 * min, min)), { tip: 100 * min, at: 105.5 * min }, 'at least a minute apart');
  assert.equal(model.nextTipRead(day, 170 * min, 5 * min, min), null, 'none left');
  // A day of reads is one per tip-off time.
  let reads = 0;
  for (let next = model.nextTipRead(day, 0, 5 * min, min); next; next = model.nextTipRead(day, next.at, 5 * min, min)) reads += 1;
  assert.equal(reads, 3);
});

test('best lineup: a game played on the bench can\'t be locked after moving in, and an unseen one is only a maybe', () => {
  // dillon moved in after his finished game; it scored well over what's left, but he was on the bench for it.
  const games = {
    dillon: [['d1', '2026-10-20', 'complete', 10, 30], ['d2', '2026-10-22', 'pre_game', 10]],
    rui: [['r1', '2026-10-23', 'pre_game', 5]],
  };
  const l = optimizerLineup(['F'], ['dillon'], ['rui'], { dillon: ['SF'], rui: ['SF'] }, games);
  const benched = model.bestLineup({ ...l, started: () => false }, OPT_NOW);
  assert.deepEqual(plain(benched.locks), []);
  assert.deepEqual(plain(benched.maybe), []);
  const unseen = model.bestLineup({ ...l, started: () => null }, OPT_NOW);
  assert.deepEqual(plain(unseen.locks), [], 'never recommended without knowing');
  assert.deepEqual(plain(unseen.maybe.map((k) => [k.id, k.actual])), [['dillon', 30]]);
  const seen = model.bestLineup({ ...l, started: () => true }, OPT_NOW);
  assert.deepEqual(plain(seen.locks.map((k) => k.id)), ['dillon']);
});

test('best lineup: a starter with no games left keeps their final game, which counts without a lock', () => {
  // Sunday is next. jaquez is done for the week (21.5 Saturday): kept, that's his slot's score.
  // black plays Sunday (10.41); walter, on the bench, plays Sunday too (12.76) and fits either slot.
  const l = optimizerLineup(['G', 'SG'], ['jaquez', 'black'], ['walter'], { jaquez: ['SG', 'SF'], black: ['SG'], walter: ['SG', 'SF'] }, {
    jaquez: [['j1', '2026-10-24', 'complete', 20, 21.5]],
    black: [['b1', '2026-10-23', 'complete', 8, 0], ['b2', '2026-10-25', 'pre_game', 10.41]],
    walter: [['w1', '2026-10-25', 'pre_game', 12.76]],
  });
  const now = Date.parse('2026-10-25T12:00:00Z');
  // Whether jaquez started Saturday is unknown: his final game counts anyway, so walter replaces black.
  const plan = model.bestLineup({ ...l, started: () => null }, now);
  assert.deepEqual(plain(plan.changes.map((c) => [c.id, c.from, c.to])), [['walter', 'BN', 'SG'], ['black', 'SG', 'BN']]);
  // Known to have played it on the bench: it doesn't count for him, so he's the one to go.
  const benched = model.bestLineup({ ...l, started: (id) => (id === 'jaquez' ? false : null) }, now);
  assert.deepEqual(plain(benched.changes.map((c) => c.id).sort()), ['jaquez', 'walter']);
});

test('best lineup: a player being locked keeps their slot, and the lineup works around them', () => {
  // Without the lock, kj would slide to UTIL to make room for the pure SF at F.
  const l = optimizerLineup(['F', 'UTIL'], ['kj', 'pg'], ['sf'], { kj: ['SF', 'PF'], pg: ['PG'], sf: ['SF'] }, {
    kj: [['k1', '2026-10-20', 'complete', 10, 12.5], ['k2', '2026-10-23', 'pre_game', 9]],
    pg: [['p1', '2026-10-22', 'pre_game', 5]],
    sf: [['s1', '2026-10-22', 'pre_game', 20]],
  });
  const plan = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(plan.starters), ['kj', 'sf']);
  assert.deepEqual(plain(plan.changes.map((c) => [c.id, c.from, c.to])), [['sf', 'BN', 'UTIL'], ['pg', 'UTIL', 'BN']]);
  assert.deepEqual(plain(plan.locks.map((k) => k.id)), ['kj']);
});

test('best lineup: locked players and players in a game right now stay put', () => {
  const l = optimizerLineup(['G', 'UTIL'], ['lock', 'live'], ['star', 'benchLive'], { lock: ['PG'], live: ['SG'], star: ['PG'], benchLive: ['SG'] }, {
    lock: [['l1', '2026-10-20', 'complete', 5, 4]],
    live: [['v1', '2026-10-21', 'in_game', 1]],
    star: [['s1', '2026-10-22', 'pre_game', 50]],
    benchLive: [['b1', '2026-10-21', 'in_game', 60]],
  }, { lock: 'l1' });
  const plan = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(plan.starters), ['lock', 'live']);
  assert.deepEqual(plain(plan.changes), []);
  assert.deepEqual(plain(plan.fixed), [{ id: 'lock', reason: 'locked' }, { id: 'live', reason: 'live' }, { id: 'benchLive', reason: 'live' }]);
});

test('best lineup: ties keep players where they are, then fill empty slots', () => {
  const l = optimizerLineup(['G', 'UTIL', 'C'], ['pg', 'sg', '0'], ['c'], { pg: ['PG'], sg: ['PG', 'SG'], c: ['C'] }, {
    pg: [['p1', '2026-10-22', 'pre_game', 20]],
    sg: [['g1', '2026-10-22', 'pre_game', 20]],
    c: [],
  });
  const plan = model.bestLineup(l, OPT_NOW);
  assert.deepEqual(plain(plan.starters), ['pg', 'sg', 'c'], 'a player with no games still beats an empty slot');
  assert.deepEqual(plain(plan.changes.map((c) => [c.id, c.from, c.to])), [['c', 'BN', 'C']]);
});

test('score tiers: the league starters\' games in thirds, green from the top third, red under the bottom one', () => {
  const tiers = model.scoreTiers([0, 10, 20, 30, 40, 50, 60].map((points) => ({ points })));
  assert.deepEqual(plain(tiers.all), [20, 40]);
  assert.deepEqual([40, 55, 39.99, 20, 19.99, -2].map((x) => model.scoreTier(x, tiers)), ['green', 'green', 'yellow', 'yellow', 'red', 'red']);
  // Between two games, a third falls in proportion, as spreadsheets do it.
  assert.deepEqual(plain(model.scoreTiers([0, 10, 20, 30].map((points) => ({ points }))).all.map((x) => +x.toFixed(4))), [10, 20]);
  assert.equal(model.scoreTier(30, null), '', 'no games yet: no color');
  assert.equal(model.scoreTiers([]), null);
});

test('score tiers by position: each position its own thirds, with enough games; the rest use everyone\'s', () => {
  const games = [
    ...Array.from({ length: 40 }, (_, i) => ({ position: 'QB', points: 10 + i })),
    ...Array.from({ length: 40 }, (_, i) => ({ position: 'TE', points: i / 2 })),
    ...Array.from({ length: 5 }, () => ({ position: 'K', points: 8 })),
  ];
  const tiers = model.scoreTiers(games, { byPosition: true });
  assert.deepEqual(Object.keys(tiers.positions).sort(), ['QB', 'TE']);
  assert.equal(model.scoreTier(15, tiers, 'TE'), 'green', 'a TE\'s 15 is a great game');
  assert.equal(model.scoreTier(15, tiers, 'QB'), 'red', 'a QB\'s 15 is not');
  assert.equal(model.scoreTier(8, tiers, 'K'), model.scoreTier(8, { ...tiers, positions: {} }), 'too few kickers: everyone\'s thirds');
  assert.equal(tiers.games, 85);
});

test('tier samples: only the week\'s starters, only games played, scored with the league\'s settings', () => {
  const rows = [
    { player_id: 'a', stats: { gp: 1, pts: 10 } },
    { player_id: 'b', stats: { gp: 1, pts: 30 } },
    { player_id: 'c', stats: { pts: 0 } },
    { player_id: 'd', stats: { sp: 600, pts: 4 } },
  ];
  const out = model.tierSamples(rows, new Set(['a', 'c', 'd']), { pts: 2 }, scoring.scoreStats, (id) => id.toUpperCase());
  assert.deepEqual(plain(out), [{ position: 'A', points: 20 }, { position: 'D', points: 8 }]);
});

test('cheapest assignment matches brute force on random matrices', () => {
  // Deterministic pseudo-random numbers, so a failure always reproduces.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const brute = (cost, row = 0, used = new Set()) => {
    if (row === cost.length) return 0;
    let best = Infinity;
    cost[row].forEach((c, j) => {
      if (used.has(j)) return;
      used.add(j);
      best = Math.min(best, c + brute(cost, row + 1, used));
      used.delete(j);
    });
    return best;
  };
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + Math.floor(rand() * 5);
    const m = n + Math.floor(rand() * 3);
    const cost = Array.from({ length: n }, () => Array.from({ length: m }, () => Math.floor(rand() * 20) - 10));
    const cols = model.cheapestAssignment(cost);
    assert.equal(new Set(cols).size, n, 'each row gets its own column');
    assert.equal(cols.reduce((sum, j, i) => sum + cost[i][j], 0), brute(cost), JSON.stringify(cost));
  }
});

const nfl = (slots, starters, bench, players, proj, played = {}) => ({
  slots, starters, bench, proj, played,
  players: Object.fromEntries(Object.entries(players).map(([id, p]) => [id, typeof p === 'string' ? { positions: [p] } : p])),
});

test('NFL best lineup: superflex goes to a QB only when that beats the flex options', () => {
  // Two QBs: the second QB (18) beats the best remaining WR (12) at SUPER_FLEX, and the WR takes FLEX.
  const l = nfl(['QB', 'WR', 'FLEX', 'SUPER_FLEX'], ['qb1', 'wr1', 'rb1', 'wr2'], ['qb2', 'wr3'],
    { qb1: 'QB', qb2: 'QB', wr1: 'WR', wr2: 'WR', wr3: 'WR', rb1: 'RB' },
    { qb1: 22, qb2: 18, wr1: 15, wr2: 12, wr3: 9, rb1: 8 });
  const plan = model.bestNflLineup(l);
  assert.deepEqual(plain(plan.starters), ['qb1', 'wr1', 'wr2', 'qb2']);
  assert.deepEqual(plain(plan.changes.map((c) => [c.id, c.from, c.to, c.proj])),
    [['wr2', 'SUPER_FLEX', 'FLEX', 12], ['qb2', 'BN', 'SUPER_FLEX', 18], ['rb1', 'FLEX', 'BN', 8]]);
  assert.deepEqual([plan.before, plan.after], [57, 67]);
});

test('NFL best lineup: kicked-off players stay put, ruled-out players are worth nothing', () => {
  const l = nfl(['RB', 'WR'], ['rb1', 'wr1'], ['rb2', 'wr2'],
    { rb1: 'RB', rb2: 'RB', wr1: 'WR', wr2: { positions: ['WR'], injury: 'Out' } },
    { rb1: 5, rb2: 20, wr1: 6, wr2: 25 }, { rb1: true, rb2: false });
  const plan = model.bestNflLineup(l);
  assert.deepEqual(plain(plan.starters), ['rb1', 'wr1'], 'rb1 already played; wr2 is Out');
  assert.deepEqual(plain(plan.fixed), [{ id: 'rb1', reason: 'played' }]);
  assert.deepEqual(plain(plan.changes), []);
  // Questionable players can start; the dialog highlights them.
  l.players.wr2.injury = 'Questionable';
  assert.deepEqual(plain(model.bestNflLineup(l).starters), ['rb1', 'wr2']);
});

test('NFL best lineup: a bye week projects nothing and IDP flex takes any defender', () => {
  const l = nfl(['DL', 'IDP_FLEX', 'K'], ['dl1', 'lb1', 'k1'], ['db1', 'k2'],
    { dl1: 'DL', lb1: 'LB', db1: 'DB', k1: 'K', k2: 'K' },
    { dl1: 7, lb1: 6, db1: 9, k2: 8 });
  assert.deepEqual(plain(model.bestNflLineup(l).starters), ['dl1', 'db1', 'k2'], 'k1 is on bye');
});

test('lineup solver: any sport, ties broken by `later` past 99.99 points, negative worth still starts', () => {
  const players = { a: { positions: ['X'] }, b: { positions: ['X'] }, c: { positions: ['Y'] } };
  const base = { slots: ['X'], starters: ['a', 'c'], bench: ['b'], players, worth: () => 10 };
  const later = { a: 120, b: 150, c: 200 };
  const plan = model.solveLineup({ ...base, later: (id) => later[id], fits: (slot, p) => slot === 'BN' || p.positions.includes(slot) || slot === 'ANY', openSlot: 'ANY' });
  assert.deepEqual(plain(plan.starters), ['b', 'c'], 'b is worth more later, and the slot past `slots` is ANY');
  const negative = model.solveLineup({ ...base, starters: ['a'], bench: [], worth: () => -2 });
  assert.deepEqual(plain(negative.starters), ['a'], 'a slot never goes empty to dodge a negative projection');
});

test('game state: done, live (on now, or past its start while still to come) or left; nothing without a game', () => {
  const now = Date.parse('2026-10-21T23:30:00Z');
  const at = (start, status) => ({ status, start: Date.parse(start) });
  assert.equal(model.gameState(at('2026-10-21T20:00:00Z', 'complete'), now), 'done');
  assert.equal(model.gameState(at('2026-10-21T23:00:00Z', 'in_game'), now), 'live');
  assert.equal(model.gameState(at('2026-10-21T23:00:00Z', 'pre_game'), now), 'live', 'tipped off before Sleeper says so');
  assert.equal(model.gameState(at('2026-10-22T23:00:00Z', 'pre_game'), now), 'left');
  assert.equal(model.gameState({ status: 'pre_game', start: null }, now), 'left');
  assert.equal(model.gameState(null, now), '');
});

test('side team: NFL names each side plainly, NBA nests it', () => {
  assert.equal(model.sideTeam({ home_team: 'DET', away_team: 'GB' }, 'away_team'), 'GB');
  assert.equal(model.sideTeam({ home_team: { team: 'LAL' } }, 'home_team'), 'LAL');
  assert.equal(model.sideTeam(undefined, 'home_team'), undefined);
});

test('lock check: a starter\'s finished game can be locked until the next tips off, never one played on the bench', () => {
  const games = [score('g1', '2026-10-20', 'LAL', 'GSW', { status: 'complete' }), score('g2', '2026-10-23', 'LAL', 'DEN')];
  const week = { days: model.weekDays(games), gamesByTeam: model.gamesByTeam(games), proj: {}, actual: { p: { g1: 31.5 } } };
  const now = Date.parse('2026-10-21T12:00:00Z');
  const ok = model.lockCheck({ week, locks: {} }, 'p', 'LAL', now);
  assert.equal(ok.error, null);
  assert.equal(ok.current.game.id, 'g1');
  assert.equal(ok.current.actual, 31.5);
  const benched = model.lockCheck({ week, locks: {}, started: () => false }, 'p', 'LAL', now);
  assert.equal(benched.error, 'That game was played on your bench, so it can\'t be locked');
  assert.equal(model.lockCheck({ week, locks: {}, started: () => null }, 'p', 'LAL', now).error, null, 'unseen at tip-off: still offered');
  const late = model.lockCheck({ week, locks: {} }, 'p', 'LAL', Date.parse('2026-10-24T01:00:00Z'));
  assert.equal(late.error, 'That game can no longer be locked');
  assert.equal(model.lockCheck({ week, locks: { p: 'g1' } }, 'p', 'LAL', now).error, 'That game can no longer be locked', 'already locked');
});

test('week picks: games played, or each player\'s best or worst game as one game played, skipping games sat out', () => {
  const rows = [
    { player_id: 'a', game_id: 'g1', stats: { sp: 1800, pts: 30 } },
    { player_id: 'a', game_id: 'g2', stats: { sp: 1200, pts: 8 } },
    { player_id: 'a', game_id: 'g3', stats: {} },
    { player_id: 'b', game_id: 'g1', stats: { min: 20, pts: 12 } },
  ];
  const settings = { pts: 1 };
  assert.deepEqual(plain(model.weekPicks(rows, 'played', settings, scoring.scoreStats)), { a: 2, b: 1 });
  assert.deepEqual(plain(model.weekPicks(rows, 'best', settings, scoring.scoreStats).a), { sp: 1800, pts: 30, gp: 1, fpts: 30 });
  assert.equal(model.weekPicks(rows, 'worst', settings, scoring.scoreStats).a.fpts, 8);
});

test('week strip: each team\'s days as done, live or left, its games, and the points of games played in their colors', () => {
  const now = Date.parse('2026-10-21T23:30:00Z');
  const games = [
    score('g1', '2026-10-20', 'LAL', 'GSW', { status: 'complete' }),
    score('g2', '2026-10-21', 'DEN', 'LAL'),
    score('g3', '2026-10-24', 'LAL', 'BOS'),
  ];
  const tiers = { all: [10, 20], positions: {} };
  const rows = [{ player_id: 'p', game_id: 'g1', stats: { sp: 1800, pts: 25 } }, { player_id: 'p', game_id: 'g2', stats: {} }];
  const out = model.weekStrip({ days: model.weekDays(games), byTeam: model.gamesByTeam(games), rows, teams: { p: 'LAL' }, settings: { pts: 1 }, tiers, now }, scoring.scoreStats);
  assert.deepEqual(plain(out.teams.LAL), ['', 'done', 'live', '', '', 'left', '']);
  assert.deepEqual(plain(out.games.LAL[2]), { id: 'g2', home: false, opponent: 'DEN', start: games[1].start_time });
  assert.deepEqual(plain(out.points), { p: { g1: { fpts: 25, tier: 'green' } } }, 'a game sat out scores nothing');
  assert.equal(out.pointsReady, true);
  assert.equal(model.weekStrip({ days: [], byTeam: {}, rows: null, teams: {}, settings: {}, tiers: null, now }, scoring.scoreStats).pointsReady, false, 'stats still loading');
});

test('NFL games: each team\'s game with its clock, the share left and the red zone; the week\'s game days', () => {
  const { games, days } = model.nflGames([
    { game_id: 'a', start_time: 1, status: 'in_game', metadata: { home_team: 'DET', away_team: 'GB', quarter_num: 3, time_remaining: '7:30', home_score: 14, away_score: 10, red_zone: true, possession: 'GB', date_time: '2026-10-25T17:00:00Z' } },
    { game_id: 'b', start_time: 2, status: 'pre_game', metadata: { home_team: 'KC', away_team: 'LV', day: '2026-10-23' } },
    { game_id: 'c', metadata: { home_team: 'SEA' } },
  ]);
  assert.equal(games.DET, games.GB, 'both sides share the game');
  assert.deepEqual(plain(games.DET), { id: 'a', start: 1, status: 'in_game', home: 'DET', away: 'GB', homeScore: 14, awayScore: 10, clock: 'Q3 7:30', left: 0.375, redZone: 'GB' });
  assert.equal(games.KC.clock, 'Live');
  assert.equal(games.KC.left, 1);
  assert.equal(games.SEA, undefined, 'a game needs both sides');
  assert.deepEqual(plain(days), ['2026-10-23', '2026-10-25']);
  assert.equal(model.nflGames([{ metadata: { home_team: 'A', away_team: 'B', quarter_num: 5, time_remaining: '2:00' } }]).games.A.clock, 'OT 2:00');
  assert.equal(model.nflGames([{ metadata: { home_team: 'A', away_team: 'B', quarter_num: 2, quarter: 'Half' } }]).games.A.clock, 'Half');
});

test('NFL week points: the rows\' players (first seen), projections, and points and stats for games played', () => {
  const player = (first, last, position, extra = {}) => ({ first_name: first, last_name: last, position, team: 'DET', ...extra });
  const out = model.nflWeekPoints(
    [{ player_id: 'q', team: 'DET', player: player('Jared', 'Goff', 'QB', { injury_status: 'Questionable' }), stats: { pass_yd: 250 } }, { player_id: 'DET', player: player('Detroit', 'Lions', 'DEF') }],
    [{ player_id: 'q', team: 'DET', player: player('Other', 'Name', 'QB'), stats: { gp: 1, pass_yd: 300 } }, { player_id: 'w', player: player('', '', 'WR'), stats: { gp: 0 } }],
    { pass_yd: 0.04 }, scoring.scoreStats,
  );
  assert.deepEqual(plain(out.players.q), { name: 'Jared Goff', first: 'Jared', last: 'Goff', position: 'QB', positions: ['QB'], team: 'DET', injury: 'Questionable' }, 'the first row seen');
  assert.equal(out.players.DET.name, 'Detroit Lions');
  assert.equal(out.players.w.name, 'w', 'no name: the id');
  assert.deepEqual(plain(out.teamOf), { q: 'DET' });
  assert.deepEqual(plain(out.proj), { q: 10, DET: 0 });
  assert.deepEqual(plain(out.actual), { q: 12 });
  assert.deepEqual(plain(out.stats), { q: { gp: 1, pass_yd: 300 } }, 'games not played left out');
});

test('NFL recent weeks: each week\'s score in its position\'s color, points per game, and where this week\'s games stand', () => {
  const tiers = { all: [5, 15], positions: { QB: [12, 20] } };
  const row = (id, team, stats) => ({ player_id: id, team, opponent: 'X', player: { position: 'QB', fantasy_positions: ['QB'] }, stats });
  const out = model.recentWeeks({
    season: '2026', weeks: [5, 6, 7], current: 7, settings: { pass_td: 4 }, tiers, now: 1000,
    rows: [[row('q', 'DET', { gp: 1, pass_td: 6 })], [row('q', 'DET', { gp: 1, pass_td: 1 }), row('r', 'GB', { gp: 0 })], [row('q', 'DET', { gp: 1, pass_td: 2 })]],
    games: [
      { status: 'in_game', start_time: 900, metadata: { home_team: 'DET', away_team: 'GB' } },
      { status: 'pre_game', start_time: 2000, metadata: { home_team: 'KC', away_team: 'LV' } },
      { status: 'complete', start_time: 100, metadata: { home_team: 'SEA', away_team: 'SF' } },
    ],
  }, scoring.scoreStats);
  assert.deepEqual(plain(out.points.q), {
    5: { fpts: 24, tier: 'green', team: 'DET', opponent: 'X' },
    6: { fpts: 4, tier: 'red', team: 'DET', opponent: 'X' },
    7: { fpts: 8, tier: 'red', team: 'DET', opponent: 'X' },
  });
  assert.equal(out.avg.q, 12);
  assert.equal(out.points.r, undefined, 'a week not played scores nothing');
  assert.deepEqual(plain(out.status), { 7: { DET: 'live', GB: 'live', KC: 'left', LV: 'left', SEA: 'done', SF: 'done' } });
  assert.deepEqual(plain(out.kickoff), { DET: 900, GB: 900, KC: 2000, LV: 2000, SEA: 100, SF: 100 });
  assert.equal(out.sig, `2026|5,6,7|1,2,1|${JSON.stringify(out.status)}`);
  const past = model.recentWeeks({ season: '2026', weeks: [2, 3], current: 7, settings: {}, tiers, now: 1000, rows: [[], []], games: [] }, scoring.scoreStats);
  assert.deepEqual(plain(past.status), {}, 'weeks before this one: no games on');
});

test('admin deltas: what the changed settings add, how far that moves each player in view, per game', () => {
  const stats = {
    a: { fpts: 30, pts: 30, reb: 2, gp: 1 },
    b: { fpts: 29, pts: 29, reb: 2, gp: 1 },
    c: { fpts: 40, pts: 10, reb: 30, gp: 2 },
    off: { fpts: 1, reb: 50, gp: 1 },
    none: null,
  };
  const out = model.adminDeltas({ overrides: { reb: 2 }, league: { pts: 1, reb: 1 }, stats, view: ['a', 'b', 'c', 'none'], base: 'fpts' }, scoring.scoreStats);
  assert.deepEqual(plain(out.points), { a: 2, b: 2, c: 30, off: 50, none: 0 }, 'just the differences, for everyone');
  // Per game: a 30 to 32, b 29 to 31, c (40 + 30) / 2 = 35, up from 20.
  assert.deepEqual(plain(out.shifts), { a: -1, b: -1, c: 2 });
  assert.deepEqual(plain(out.places), { a: [1, 2], b: [2, 3], c: [3, 1] });
  assert.equal(out.tints.c, model.shiftTint(2, 2));
  const none = model.adminDeltas({ overrides: {}, league: { pts: 1 }, stats, view: ['a', 'b'], base: 'fpts' }, scoring.scoreStats);
  assert.deepEqual(plain(none.shifts), { a: 0, b: 0 }, 'nothing moves until a value changes');
});

test('last week: the playoff bracket\'s rounds after its start week, by round type; no bracket, no limit', () => {
  const bracket = [{ r: 1 }, { r: 2 }, { r: 3 }];
  assert.equal(model.lastWeek({ settings: { playoff_week_start: 20, playoff_round_type: 0 } }, bracket), 22);
  assert.equal(model.lastWeek({ settings: { playoff_week_start: 20, playoff_round_type: 1 } }, bracket), 23, 'two-week final');
  assert.equal(model.lastWeek({ settings: { playoff_week_start: 20, playoff_round_type: 2 } }, bracket), 25, 'two weeks a round');
  assert.equal(model.lastWeek({ settings: { playoff_week_start: 20 } }, []), Infinity);
  assert.equal(model.lastWeek({}, bracket), Infinity);
});

test('pick seasons: from this season until its draft is done, then from the next', () => {
  assert.deepEqual(plain(model.pickSeasons({ season: '2026' }, [])), ['2026', '2027', '2028']);
  assert.deepEqual(plain(model.pickSeasons({ season: '2026' }, [{ season: '2026', status: 'complete' }])), ['2027', '2028', '2029']);
  assert.deepEqual(plain(model.pickSeasons({ season: '2026' }, [{ season: '2025', status: 'complete' }], 2)), ['2026', '2027']);
});

test('lineup on the leg: once the draft is done until the league is complete, as Sleeper\'s Team tab saves', () => {
  const statuses = ['pre_draft', 'drafting', 'in_season', 'post_season', 'complete'];
  assert.deepEqual(statuses.map((status) => model.lineupOnLeg({ status })), [false, false, true, true, false]);
});

test('same plan: compares what the dialog shows, not how it was worked out', () => {
  const plan = { starters: ['a'], current: ['b'], changes: [{ id: 'a' }], locks: [], info: { a: 1 } };
  assert.equal(model.samePlan(plan, { ...plan, info: { a: 2 } }), true);
  assert.equal(model.samePlan(plan, { ...plan, locks: [{ id: 'a' }] }), false);
});

test('next team: through the order, a team or a matchup at a time, stopping at the ends', () => {
  const r = (id) => ({ roster_id: id });
  const teams = [[r(3)], [r(1)], [r(2)]];
  assert.equal(model.nextTeam(teams, 1, 1), 2);
  assert.equal(model.nextTeam(teams, 1, -1), 3);
  assert.equal(model.nextTeam(teams, 2, 1), null, 'the last');
  assert.equal(model.nextTeam(teams, 9, 1), null, 'not in the order');
  assert.equal(model.nextTeam([[r(1), r(4)], [r(2), null]], 4, 1), 2, 'matchups by their left team');
});

test('league median: played only in regular-season weeks of leagues that have it, the middle score as an opponent', () => {
  const league = (settings) => ({ settings });
  assert.equal(model.medianOn(league({ league_average_match: 1, playoff_week_start: 15 }), 14), true);
  assert.equal(model.medianOn(league({ league_average_match: 1, playoff_week_start: 15 }), 15), false, 'not in the playoffs');
  assert.equal(model.medianOn(league({ league_average_match: 1 }), 30), true, 'no playoff week set');
  assert.equal(model.medianOn(league({ league_average_match: 0 }), 1), false);
  assert.equal(model.medianOn(null, 1), false);
  assert.equal(model.median([3, 1, 2]), 2);
  assert.equal(model.median([4, 1, 3, 2]), 2.5, 'an even count: the mean of the middle two');
  assert.equal(model.median([NaN, null, 5]), 5, 'only numbers count');
  assert.equal(model.median([]), null);
  assert.deepEqual(plain(model.leagueMedian([{ points: 10, proj: 40 }, { points: null, proj: 20 }, { points: 30, proj: 30 }, { points: 20, proj: 10 }])),
    { points: 15, proj: 25, winners: 2, teams: 4 }, 'a team without points yet counts as 0');
  assert.equal(model.leagueMedian([{ points: null, proj: 20 }, { points: null, proj: 10 }]).points, null, 'no team has points yet');
});

test('median standing: a medallion only while over the median now, by how sure it is', () => {
  const m = { points: 100, proj: 150 };
  assert.equal(model.medianStanding({ points: 90, proj: 200 }, m), null, 'under it now, however good the projection');
  assert.equal(model.medianStanding({ points: null, proj: 200 }, m), null, 'no points yet');
  assert.equal(model.medianStanding({ points: 120, proj: 160 }, { points: null, proj: 150 }), null, 'no median score yet');
  assert.equal(model.medianStanding({ points: 120, proj: 160 }, null), null, 'no median that week');
  assert.equal(model.medianStanding({ points: 110, proj: 140 }, m).tier, 'over', 'over now, but projected under');
  assert.equal(model.medianStanding({ points: 140, proj: 220 }, m).tier, 'likely');
  assert.deepEqual(plain(model.medianStanding({ points: 140, proj: 140 }, { points: 100, proj: 100 })), { chance: 1, tier: 'won' }, 'everything settled');
  assert.equal(model.medianStanding({ points: 100, proj: 100 }, { points: 100, proj: 100 }), null, 'level is not over');
});

test('live reads: every so often while a game is on, else a minute after the next start, else never', () => {
  const now = Date.parse('2026-10-25T20:00:00Z');
  const at = (min, status) => ({ start: now + min * 60e3, status });
  assert.equal(model.nextLiveRead([at(-30, 'in_game'), at(60, 'pre_game')], now, 90e3), now + 90e3);
  assert.equal(model.nextLiveRead([at(-5, 'pre_game')], now, 90e3), now + 90e3, 'past its start: on, whatever the status says');
  assert.equal(model.nextLiveRead([at(-200, 'complete'), at(60, 'pre_game'), at(30, 'pre_game')], now, 90e3), now + 31 * 60e3);
  assert.equal(model.nextLiveRead([at(-200, 'complete')], now, 90e3), null);
  assert.equal(model.nextLiveRead([], now, 90e3), null);
});
