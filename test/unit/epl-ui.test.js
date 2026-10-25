import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSep } from './load.js';

const { SEP, SNP } = loadSep();
const { ui, model, scoring, view } = SEP;
const plain = (x) => JSON.parse(JSON.stringify(x));

test('helpers that are the same as NBA and NFL come from the core', () => {
  for (const name of ['esc', 'CDN', 'shortName', 'gameTime', 'dialogErrors', 'notice']) assert.equal(ui[name], SNP.ui[name], name);
});

const NOW = Date.parse('2026-10-24T12:00:00Z');
const user = (id, name, extra = {}) => ({ user_id: id, display_name: name, ...extra });
const state = (over = {}) => ({
  me: 'u1',
  usersById: { u1: user('u1', 'louis', { metadata: { team_name: 'Cole World' }, avatar: 'abc' }), u2: user('u2', 'mitch') },
  ...over,
});

test('text helpers: escaping, numbers, names', () => {
  assert.equal(ui.esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(ui.esc(null), '');
  assert.equal(ui.f2(1.005), '1.00');
  assert.equal(ui.f2(null), '–');
  assert.equal(ui.f2(NaN), '–');
  assert.equal(ui.f2('3'), '3.00', 'numeric strings format too');
  assert.equal(ui.f1(2.25), '2.3');
  assert.equal(ui.f1(undefined), '–');
  assert.equal(ui.pct(49.6), '50%');
  assert.equal(ui.pct(null), '–');
  assert.equal(ui.shortName({ first: 'Bryan', last: 'Mbeumo', name: 'Bryan Mbeumo' }), 'B. Mbeumo');
  assert.equal(ui.shortName({ name: 'Casemiro' }), 'Casemiro');
  assert.equal(ui.shortName(null), 'Unknown');
});

test('teams: names, owners, avatars and records, also without a roster', () => {
  const s = state();
  const mine = { roster_id: 1, owner_id: 'u1', settings: { wins: 4, losses: 3, ties: 1 } };
  const theirs = { roster_id: 2, owner_id: 'u2', co_owners: ['u1'] };
  assert.equal(ui.teamName(s, mine), 'Cole World');
  assert.equal(ui.teamName(s, theirs), 'mitch');
  assert.equal(ui.teamName(s, { roster_id: 7 }), 'Team 7');
  assert.equal(ui.teamName(s, undefined), 'Team ?');
  assert.equal(ui.ownerName(s, mine), 'louis');
  assert.equal(ui.ownerName(s, null), '');
  assert.equal(ui.avatar(s, mine), 'https://sleepercdn.com/avatars/thumbs/abc');
  assert.equal(ui.avatar(s, null), null);
  assert.equal(ui.avatarImg(s, mine), '<img class="avatar" src="https://sleepercdn.com/avatars/thumbs/abc" alt="">');
  assert.equal(ui.avatarImg(s, theirs, 'avatar small'), '<div class="avatar small"></div>');
  assert.equal(ui.record(mine), '4-3-1');
  assert.equal(ui.record(null), '0-0');
  assert.equal(ui.owns(s, mine), true);
  assert.equal(ui.owns(s, theirs), true, 'co-owners own it too');
  assert.equal(ui.owns(s, null), false);
  assert.equal(ui.owns({ me: null }, mine), false);
  const rosters = [{ roster_id: 3, owner_id: 'u2', players: ['p9'] }, { ...mine, players: ['p1'] }];
  assert.equal(ui.myRoster(state({ rosters })).roster_id, 1);
  assert.equal(ui.myRoster(state({ rosters, me: 'nobody' })), null);
  assert.equal(ui.ownerOf(state({ rosters }), 'p9').roster_id, 3);
  assert.equal(ui.ownerOf(state({ rosters }), 'p0'), null);
});

test('players: positions, injuries and the shared player line', () => {
  const p = { name: 'Cole Palmer', positions: ['F', 'M'], teamAbbr: 'CHE', injury: 'Sus' };
  assert.equal(ui.positions(p), '<span class="pos f">F</span><span class="pos m">M</span>');
  assert.equal(ui.injuryTag(p), '<span class="inj severe">Sus</span>');
  assert.equal(ui.injuryTag({ injury: 'GTD' }), '<span class="inj ">GTD</span>');
  assert.equal(ui.injuryTag({}), '');
  const line = ui.playerLine({ players: { 9: p } }, '9', { sub: 'x' });
  assert.match(line, /<button class="name" data-player="9">Cole Palmer<\/button><span class="pos f">F<\/span>/);
  assert.match(line, /• CHE<\/span><span class="inj severe">Sus<\/span>/);
  assert.match(line, /<div class="line2">x<\/div>/);
  assert.match(ui.playerLine({ players: {} }, '5', { nameButton: false }), /<span class="name">Player #5<\/span>.*• FA/s);
  assert.equal(ui.positionRank({ position: 'F' }), 0);
  assert.equal(ui.positionRank({ position: 'GK' }), 3);
  assert.equal(ui.positionRank(null), 4);
  assert.equal(ui.roleName('F', 3), 'Forwards');
  assert.equal(ui.roleName('M', 1), 'Midfielder');
  assert.equal(ui.roleName('GK', 1), 'Goalkeeper');
  assert.equal(ui.roleName('X', 2), 'X');
});

test('dates and times', () => {
  assert.equal(ui.gameTime(Date.parse('2026-10-24T14:30:00Z')), new Date(Date.parse('2026-10-24T14:30:00Z')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase());
  assert.equal(ui.weekday('2026-10-24'), new Date('2026-10-24T12:00:00').toLocaleDateString(undefined, { weekday: 'short' }));
  assert.equal(ui.weekday(null), '');
  assert.equal(ui.shortDate(null), '');
});

test('slot badges: plain, flex with both colors, and as the lineup button', () => {
  assert.equal(ui.slotBadge('GK'), '<span class="slot gk">GK</span>');
  assert.equal(ui.slotBadge('BN', 'b:1'), '<button class="slot bn" data-spot="b:1" aria-label="Move BN">BN</button>');
  const flex = ui.slotBadge('FM_FLEX', null, 'M');
  assert.match(flex, /^<span class="slot flex f m" style="background:linear-gradient\(135deg, var\(--f\) 0% 50%, var\(--m\) 50% 100%\)"/);
  assert.match(flex, /title="FM flex: F or M"/);
  assert.match(flex, /<span class="slot-label">M<\/span><span class="slot-sub">F\/M<\/span>/);
});

test('match text: next match, live, or the final results', () => {
  const g = (status, start, home, abbr) => ({ game: { status, start, date: '2026-10-24' }, home, opponentAbbr: abbr });
  assert.equal(ui.nextGameText([], NOW), 'No match this week');
  assert.equal(ui.nextGameText([g('complete', NOW - 9e6, true, 'ARS'), g('complete', NOW - 1e6, false, 'MUN')], NOW), 'Final · vs ARS, @ MUN');
  assert.equal(ui.nextGameText([g('in_game', NOW - 1e3, false, 'MUN')], NOW), 'Live @ MUN');
  assert.equal(ui.nextGameText([g('pre_game', null, true, 'BOU')], NOW), `${ui.weekday('2026-10-24')} vs BOU`);
  const chips = ui.gameChips([{ ...g('complete', NOW - 9e6, true, 'ARS'), opponent: '11' }, { ...g('pre_game', NOW + 9e6, false, 'MUN'), opponent: '12' }], NOW);
  assert.match(chips, /^<span class="chip done" title="[^"]+ vs ARS"><img src="https:\/\/sleepercdn.com\/images\/team_logos\/clubsoccer\/11.png" alt="ARS"><\/span><span class="chip"/);
});

test('notices, dialog errors and the week nav', () => {
  assert.equal(ui.notice({ notice: { kind: 'ok', text: 'Saved' } }), '<p class="notice ok" role="status">Saved</p>');
  assert.equal(ui.notice({}), '');
  assert.equal(ui.dialogErrors(['a<b']), '<div class="dialog-errors" role="alert"><p>a&lt;b</p></div>');
  assert.equal(ui.dialogErrors([]), '');
  const nav = ui.weekNav({ week: 9, minWeek: 1, maxWeek: 9, currentWeek: 9 });
  assert.match(nav, /<b>Week 9<\/b><span>current<\/span>/);
  assert.match(nav, /aria-label="Next week" disabled/);
  assert.doesNotMatch(nav, /aria-label="Previous week" disabled/);
  assert.match(ui.dialog('T', '', '<p>b</p>', { cls: 'wide' }), /<div class="dialog wide" role="dialog"/);
  assert.equal(ui.reserveRule({ reserve_allow_out: 1, reserve_allow_sus: 1 }), 'IR, Out and Sus players can move to IR.');
  assert.equal(ui.reserveRule({}), 'IR players can move to IR.');
});

// A gameweek where club A has played and club B hasn't.
function weekState() {
  const games = model.gamesFromScores([
    { game_id: 'g1', date: '2026-10-24', start_time: NOW - 3 * 3600e3, status: 'complete', metadata: { home_team: { team: 'A', abbr: 'AAA' }, away_team: { team: 'Z', abbr: 'ZZZ' } } },
    { game_id: 'g2', date: '2026-10-25', start_time: NOW + 3600e3, status: 'pre_game', metadata: { home_team: { team: 'B', abbr: 'BBB' }, away_team: { team: 'Y', abbr: 'YYY' } } },
  ]);
  const sc = { pos_f_g: 10, pos_m_g: 5 };
  const week = {
    games,
    gamesByTeam: model.gamesByTeam(games),
    proj: model.pointsByGame([{ player_id: 'f1', game_id: 'g1', stats: { pos_f_g: 0.5 } }, { player_id: 'm1', game_id: 'g2', stats: { pos_m_g: 1 } }], sc, scoring.scoreStats),
    actual: model.pointsByGame([{ player_id: 'f1', game_id: 'g1', stats: { pos_f_g: 1 } }], sc, scoring.scoreStats),
    legs: null,
  };
  return state({
    now: NOW,
    week: 9,
    currentWeek: 9,
    weeks: { 9: week },
    rosterId: 1,
    league: { status: 'in_season', roster_positions: ['F', 'FM_FLEX', 'GK', 'BN', 'BN'], settings: { reserve_slots: 1 } },
    players: {
      f1: { name: 'F One', position: 'F', positions: ['F'], team: 'A' },
      m1: { name: 'M One', position: 'M', positions: ['M'], team: 'B' },
      gk: { name: 'Keeper', position: 'GK', positions: ['GK'], team: 'B' },
      f2: { name: 'F Two', position: 'F', positions: ['F'], team: 'A' },
      d1: { name: 'D One', position: 'D', positions: ['D'], team: 'B', injury: 'Out' },
    },
    rosters: [{ roster_id: 1, owner_id: 'u1', starters: ['f1', 'm1', 'gk'], players: ['f1', 'm1', 'gk', 'd1', 'f2'], reserve: [], metadata: {} }],
  });
}

test('lineup: slots, labels, bench order, locks and what can be edited', () => {
  const s = weekState();
  const l = ui.lineup(s);
  assert.deepEqual(plain(l.slots), ['F', 'FM_FLEX', 'GK']);
  assert.deepEqual(plain(l.labels), ['F', 'M', 'GK']);
  assert.equal(l.formation, '0-1-1');
  assert.deepEqual(plain(l.order), [0, 1, 2]);
  assert.deepEqual(plain(l.bench), ['f2', 'd1'], 'bench by position, forwards first');
  assert.deepEqual([...l.locked], ['f1', 'f2'], 'club A has kicked off');
  assert.equal(l.mine, true);
  assert.equal(l.editable, false, 'in season, a lineup needs its matchup leg');
  assert.equal(ui.lineup({ ...s, league: { ...s.league, status: 'pre_draft' } }).editable, true);
  assert.equal(l.reserveRoom, 1);
  assert.equal(l.benchRoom, 0);
  assert.equal(ui.lineup({ ...s, players: null }), null);
  const withLeg = { ...s, weeks: { 9: { ...s.weeks[9], legs: [{ roster_id: 1, starters: ['f2', 'f1', 'gk'], matchup_id: 1 }] } } };
  const fromLeg = ui.lineup(withLeg);
  assert.deepEqual(plain(fromLeg.starters), ['f2', 'f1', 'gk'], 'the leg is authoritative');
  assert.equal(fromLeg.editable, true);
});

test('team totals: added up from the starters, or Sleeper\'s leg numbers', () => {
  const s = weekState();
  const t = ui.teamTotals(s, ui.lineup(s));
  assert.equal(t.points, 10);
  assert.equal(t.proj, 15);
  assert.equal(t.anyPoints, true);
  assert.equal(t.yetToPlay, 2);
  const legged = ui.teamTotals(s, { ...ui.lineup(s), leg: { points: 12, custom_points: 13, proj_points: 20 } });
  assert.deepEqual([legged.points, legged.proj], [13, 20]);
});

test('API tab: one entry per call, with status, timing and a preview when open', () => {
  const log = [
    { id: 2, path: '/v1/league/1', url: 'https://api.sleeper.app/v1/league/1', status: 200, ms: 12.4, bytes: 2048, at: NOW, json: { a: 1 } },
    { id: 1, path: 'graphql me', url: 'https://sleeper.com/graphql', status: 401, ms: 3, at: NOW, auth: true, request: ' query me { me { user_id } } ', error: '401 from graphql me' },
  ];
  const s = { tab: 'api', openCalls: new Set([1, 2]), page: 'match', rosters: [], loggedIn: true };
  const html = view.render(s, log);
  assert.match(html, /<span class="status ok">200<\/span><span class="call"><code>\/v1\/league\/1<\/code><span class="meta">12 ms · 2.0 KB · /);
  assert.match(html, /<pre>\{\n {2}&quot;a&quot;: 1\n\}<\/pre>/);
  assert.match(html, /<span class="status bad">401<\/span>.*<span class="auth">auth<\/span>/s);
  assert.match(html, /<pre class="request">query me \{ me \{ user_id \} \}<\/pre><pre class="error">401 from graphql me<\/pre>/);
  assert.match(html, /Open raw response ↗/);
  assert.match(view.render({ ...s, openCalls: new Set() }, []), /<p class="msg">No calls yet.<\/p>/);
});
