import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { ui } = loadSnp();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// ui.lineup feeds nba/session.js's saves, so its output is pinned field by field.
const league = () => ({
  rosterId: 1, week: 1, currentWeek: 1, seasonType: 'regular', now: 0,
  league: { status: 'in_season', roster_positions: ['PG', 'G', 'UTIL', 'BN', 'BN'], settings: { reserve_slots: 2, taxi_slots: 1, taxi_deadline: 0 } },
  rosters: [{ roster_id: 1, owner_id: 'u1', co_owners: ['u3'], players: ['a', 'b', 'c', 'e', 'd', 'g', 'f', 't'], starters: ['a', 'b', '0'], taxi: ['t'], reserve: ['f'] }],
  players: { a: { position: 'PG' }, b: { position: 'SG' }, d: { position: 'SF' }, e: { position: 'C' }, g: { position: 'PG' }, f: { position: 'PF' }, t: { position: 'C' } },
  weeks: { 1: { matchups: [{ roster_id: 1, matchup_id: 1, starters: ['b', 'a', '0'] }], legs: [{ roster_id: 1, matchup_id: 1, starters: ['a', '0', 'b'], starters_games: { a: 'g1' } }], games: [] } },
});
// Through JSON: the VM context's arrays and objects have their own prototypes.
const pick = (l) => JSON.parse(JSON.stringify({
  slots: l.slots, starters: l.starters, bench: l.bench, taxi: l.taxi, reserve: l.reserve, locks: l.locks, started: typeof l.started,
  mine: l.mine, editable: l.editable, lockable: l.lockable, taxiEditable: l.taxiEditable, taxiOpen: l.taxiOpen,
  taxiRoom: l.taxiRoom, reserveEditable: l.reserveEditable, reserveRoom: l.reserveRoom, benchRoom: l.benchRoom,
}));
const parts = { slots: ['PG', 'G', 'UTIL'], bench: ['g', 'd', 'e', 'c'], taxi: ['t'], reserve: ['f'], taxiOpen: true, taxiRoom: 0, reserveRoom: 1, benchRoom: 0 };

test('lineup: the leg is authoritative; bench by primary position, unknowns last', () => {
  assert.deepEqual(pick(ui.lineup(league())), {
    ...parts, starters: ['a', '0', 'b'], locks: { a: 'g1' }, started: 'object',
    mine: false, editable: false, lockable: false, taxiEditable: false, reserveEditable: false,
  });
});

test('lineup: a co-owner edits the current week, locks included', () => {
  assert.deepEqual(pick(ui.lineup({ ...league(), me: 'u3' })), {
    ...parts, starters: ['a', '0', 'b'], locks: { a: 'g1' }, started: 'function',
    mine: true, editable: true, lockable: true, taxiEditable: true, reserveEditable: true,
  });
  const past = pick(ui.lineup({ ...league(), me: 'u1', currentWeek: 2 }));
  assert.deepEqual([past.editable, past.lockable, past.taxiEditable], [false, false, false]);
});

test('lineup: without a leg in season it is read-only, from the public matchup, else the roster', () => {
  const s = { ...league(), me: 'u1' };
  s.weeks[1].legs = [];
  const l = pick(ui.lineup(s));
  assert.deepEqual([l.starters, l.editable, l.locks], [['b', 'a', '0'], false, {}]);
  const playoffs = { ...s, league: { ...s.league, status: 'post_season' } };
  assert.equal(ui.lineup(playoffs).editable, false, 'playoff lineups save to the leg too (model.lineupOnLeg)');
  assert.equal(ui.lineup({ ...s, league: { ...s.league, status: 'complete' } }).editable, true, 'off season: the roster');
  const noWeek = pick(ui.lineup({ ...league(), me: 'u1', weeks: undefined }));
  assert.deepEqual([noWeek.starters, noWeek.editable], [['a', 'b', '0'], false]);
  assert.equal(ui.lineup({ ...league(), players: null }), null, 'waits for the players');
  assert.equal(ui.lineup({ ...league(), rosterId: 9 }), null);
});

test('small helpers: open spots, unknown players, names, tags and games', () => {
  assert.deepEqual([ui.real('a'), ui.real('0'), ui.real(null), ui.real('')], [true, false, false, false]);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.playerOf({}, 'x9'))), { name: 'Player #x9', positions: [] });
  assert.equal(ui.playerName({ a: { name: 'A' } }, 'a'), 'A');
  assert.deepEqual(Array.from(ui.padTo(['a'], 3)), ['a', '0', '0']);
  assert.deepEqual(Array.from(ui.padTo(['a', 'b'], 1)), ['a', 'b'], 'never cuts');
  assert.deepEqual(Array.from(ui.padTo([], undefined)), []);
  assert.equal(ui.shortName({ name: 'Luka Doncic', first: 'Luka', last: 'Doncic' }), 'L. Doncic');
  assert.equal(ui.shortName({ name: 'Buffalo Bills', first: 'Buffalo', last: 'Bills', position: 'DEF' }), 'Buffalo Bills');
  assert.equal(ui.teamTag({ position: 'QB', team: 'KC' }), '<span class="team">QB - KC</span>');
  assert.equal(ui.teamTag({ positions: ['PG'], team: null }, { chips: true, sep: '•' }), '<span class="pos pg">PG</span> <span class="team">• FA</span>');
  assert.equal(ui.gameLabel({ date: '2026-10-24', home: false, opponent: 'MIA' }), 'Sat @ MIA');
  assert.equal(ui.weekday(Date.parse('2026-10-24T16:00:00Z')), 'Sat', 'a time in ms');
  assert.equal(ui.pct(22.1), '23%');
  assert.equal(ui.pct(null), '–');
});

test('null-safe helpers: no number, roster or date renders a placeholder, never a throw', () => {
  const s = { me: 'u1', usersById: {} };
  assert.equal(ui.f2(NaN), '–');
  assert.equal(ui.f2(undefined), '–');
  assert.equal(ui.f2('3'), '3.00');
  assert.equal(ui.teamName(s, undefined), 'Team ?');
  assert.equal(ui.ownerName(s, null), '');
  assert.equal(ui.avatar(s, null), null);
  assert.equal(ui.record(null), '0-0');
  assert.equal(ui.owns(s, null), false);
  assert.equal(ui.weekday(null), '');
  assert.equal(ui.weekday(''), '');
});

test('avatars: the image, else the plain circle (or the team initial in pickers)', () => {
  const failed = new Set(['https://x/broken.png']);
  assert.equal(ui.avatarImg('https://x/a.png', 'avatar', failed), '<img class="avatar" src="https://x/a.png" alt="">');
  assert.equal(ui.avatarImg('https://x/broken.png', 'avatar', failed), '<div class="avatar"></div>');
  assert.equal(ui.avatarImg(null, 'avatar team-link', undefined, { attrs: 'data-open-team="3"' }), '<div class="avatar team-link" data-open-team="3"></div>');
  assert.equal(ui.avatarImg('https://x/broken.png', 'tp-avatar', failed, { initial: 'B' }), '<span class="tp-avatar blank">B</span>');
});

test('team side: points as numbers or Sleeper\'s text, win chance, links to the team', () => {
  const side = ui.teamSide({ rosterId: 4, avatar: null, owner: 'lou', team: 'A & B', points: 12.5, win: 0.574, record: '2-1', rank: 3, yetToPlay: 2, proj: 99 }, 'mine');
  assert.equal(text(side), '@lou A &amp; B 12.50 57% WIN 2-1 (#3) Yet to play (2) 99.00');
  assert.match(side, /<span class="up" style="width:57%">/);
  assert.equal((side.match(/data-open-team="4"/g) || []).length, 3, 'avatar, owner and name');
  const sleeper = ui.teamSide({ owner: 'x', team: 'T', points: '25.90', win: 0.1, bar: 9.5, record: '0-1', proj: '' }, 'theirs');
  assert.equal(text(sleeper), '@x T 25.90 10% WIN 0-1 –');
  assert.match(sleeper, /<span class="down" style="width:9.5%">/, 'Sleeper\'s own bar width');
  assert.doesNotMatch(sleeper, /team-link|ytp/);
  assert.equal(text(ui.teamSide({ team: 'T', points: null, win: null, record: '0-0', proj: 1 }, 'mine')), '@unknown T – 0-0 1.00', 'no points yet, no chance shown');
  const pair = ui.matchupPair({ team: 'A', record: '', proj: 0 }, null, { cls: 'lg-match own', attrs: 'data-x="1"' });
  assert.match(pair, /^<div class="mu-head lg-match own" data-x="1">/);
  assert.match(text(pair), /VS No opponent this week/);
});

test('team tab rows: swap hint, swap classes and open spots', () => {
  assert.equal(ui.swapHint({}, false, null), '');
  assert.equal(ui.swapHint({ saving: true }, true, 'A'), 'Saving lineup…');
  assert.equal(ui.swapHint({ swap: 's:0' }, true, 'A <b>'), 'Pick a player to swap with A &lt;b&gt; · Esc to cancel');
  assert.equal(ui.swapHint({ swap: 's:2' }, true, null), 'Pick a player for this slot · Esc to cancel');
  assert.equal(ui.swapHint({}, true, null), 'Tap a position to update your lineup');
  const targets = new Set(['b:x']);
  assert.deepEqual(['s:0', 'b:x', 'b:y', null].map((spot) => ui.swapClass({ swap: 's:0' }, true, spot, targets)), [' selected', ' target', ' dim', '']);
  assert.equal(ui.swapClass({}, true, 's:0', targets), '');
  assert.equal(ui.emptyCard('<b>BN</b>', ' dim', 'nfl'), '<article class="card nfl empty dim"><b>BN</b><div class="headshot"></div><div class="info"><span class="name">Empty</span></div></article>');
});
