import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { nbaMatchupView: matchup, model, scoring } = loadSnp();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const games = [
  { game_id: 'g1', date: '2026-10-21', start_time: Date.parse('2026-10-22T01:00:00Z'), status: 'complete', metadata: { home_team: { team: 'LAL' }, away_team: { team: 'GSW' } } },
  { game_id: 'g2', date: '2026-10-25', start_time: Date.parse('2026-10-25T20:00:00Z'), status: 'pre_game', metadata: { home_team: { team: 'UTA' }, away_team: { team: 'LAL' } } },
  { game_id: 'g3', date: '2026-10-22', start_time: Date.parse('2026-10-22T23:00:00Z'), status: 'pre_game', metadata: { home_team: { team: 'PHI' }, away_team: { team: 'CLE' } } },
];
const pts = (rows) => model.pointsByGame(rows, { pts: 1 }, scoring.scoreStats);
const week = (legs) => ({
  matchups: [],
  legs,
  days: model.weekDays(games),
  gamesByTeam: model.gamesByTeam(games),
  proj: pts([{ player_id: 'luka', game_id: 'g1', stats: { pts: 30.79 } }, { player_id: 'luka', game_id: 'g2', stats: { pts: 39.83 } }, { player_id: 'don', game_id: 'g3', stats: { pts: 25.75 } }]),
  actual: pts([{ player_id: 'luka', game_id: 'g1', stats: { pts: 41.5 } }]),
  research: {},
  ranks: { 10: 3, 5: 7 },
});
const legs = (lukaLock) => [
  { roster_id: 10, matchup_id: 7, starters: ['luka'], points: null, proj_points: 157.23, starters_games: lukaLock ? { luka: lukaLock } : {} },
  { roster_id: 5, matchup_id: 7, starters: ['don'], points: null, proj_points: 181.21, starters_games: {} },
];
const state = (overrides = {}) => ({
  page: 'matchup',
  league: { name: 'Basketball Butter', status: 'in_season', roster_positions: ['PG', 'BN'], settings: { reserve_slots: 1 } },
  usersById: {
    u1: { display_name: 'louhow', metadata: { team_name: 'COOKIE MONSTER' } },
    u2: { display_name: 'badonkeyds', metadata: { team_name: 'Cling Kong' } },
  },
  rosters: [
    { roster_id: 10, owner_id: 'u1', settings: { wins: 0, losses: 0 }, players: ['luka', 'bench1'], reserve: [] },
    { roster_id: 5, owner_id: 'u2', settings: { wins: 0, losses: 0 }, players: ['don'], reserve: ['hurt'] },
  ],
  players: {
    luka: { name: 'Luka Doncic', first: 'Luka', last: 'Doncic', positions: ['PG'], position: 'PG', team: 'LAL' },
    don: { name: 'Donovan Mitchell', first: 'Donovan', last: 'Mitchell', positions: ['SG', 'PG'], position: 'SG', team: 'CLE' },
    bench1: { name: 'Bench Guy', first: 'Bench', last: 'Guy', positions: ['SF'], position: 'SF', team: 'BOS' },
    hurt: { name: 'Hurt Guy', first: 'Hurt', last: 'Guy', positions: ['C'], position: 'C', team: 'MIA', injury: 'Out' },
  },
  rosterId: 10,
  me: 'u1',
  week: 1,
  currentWeek: 1,
  minWeek: 1,
  maxWeek: 21,
  now: Date.parse('2026-10-22T12:00:00Z'),
  weeks: { 1: week(legs()) },
  // The extension saw Luka starting from before his Wednesday game until now.
  lineupHistory: { 1: { 10: [{ from: Date.parse('2026-10-21T12:00:00Z'), to: Date.parse('2026-10-22T12:00:00Z'), starters: ['luka'] }] } },
  ...overrides,
});

test('header pairs both teams with win %, record, rank and projection', () => {
  const out = text(matchup.render(state()));
  // Sleeper's running total counts only locked and final games, so Luka's open one is 0 (the leg's points are empty).
  // The projections are added up: Luka's last game of the week (39.83), Mitchell's (25.75), never the legs' frozen ones.
  assert.match(out, /@louhow COOKIE MONSTER 0.00 84% WIN 0-0 \(#3\) Yet to play \(1\) 39\.83 VS @badonkeyds Cling Kong – 16% WIN 0-0 \(#7\) Yet to play \(1\) 25\.75/);
});

test('starter rows mirror the slot with the lockable game and logos', () => {
  const html = matchup.render(state());
  const out = text(html);
  assert.match(out, /L\. Doncic PG • LAL vs GSW Final · Wed – pts 41\.50 LOCK PG D\. Mitchell SG PG • CLE @ PHI Thu 7:00pm – proj 25\.75 Bench/);
  assert.match(html, /<button class="lk open" data-lock="10:luka"/);
  assert.match(html, /class="chip done current"[^>]*><img src="https:\/\/sleepercdn\.com\/images\/team_logos\/nba\/gsw\.webp"/);
  assert.match(out, /Bench B\. Guy SF • BOS No games – BN Empty/);
  assert.match(out, /Injured Reserve Empty IR H\. Guy Out/);
});

test('lock-in needs the player starting at tip-off: a bench game can\'t lock, and an unseen one may', () => {
  const at = (iso) => Date.parse(iso);
  // Benched for his Wednesday game, moved in after it.
  const benched = matchup.render(state({ lineupHistory: { 1: { 10: [
    { from: at('2026-10-21T12:00:00Z'), to: at('2026-10-22T03:00:00Z'), starters: ['0'] },
    { from: at('2026-10-22T10:00:00Z'), to: at('2026-10-22T12:00:00Z'), starters: ['luka'] },
  ] } } }));
  assert.match(benched, /<button class="lk" disabled title="Their last game was played on your bench, so it can't be locked in">LOCK/);
  // Never seen around tip-off: it may be lockable, and says so.
  const unseen = matchup.render(state({ lineupHistory: { 1: {} } }));
  assert.match(unseen, /<button class="lk open maybe" data-lock="10:luka"[^>]*title="Lock in [^"]*only if they were starting at tip-off/);
});

test('lock-in asks to confirm, and shows locked games as final', () => {
  const confirming = matchup.render(state({ lockConfirm: '10:luka' }));
  assert.match(confirming, /data-lock-confirm="10:luka"[^>]*>Lock 41\.50</);
  assert.match(confirming, /data-lock-cancel/);
  const locked = text(matchup.render(state({ weeks: { 1: week(legs('g1')) } })));
  assert.match(locked, /L\. Doncic PG • LAL vs GSW Final · Wed 41\.50 pts 41\.50 🔒 PG/);
  assert.match(locked, /Yet to play \(0\)/);
});

test('lock controls only for rosters the logged-in user owns', () => {
  const theirs = matchup.render(state({ rosterId: 5 }));
  assert.deepEqual(theirs.match(/data-lock="[^"]+"/g), ['data-lock="10:luka"'], 'your side keeps its lock even on the right');
  const loggedOut = matchup.render(state({ me: null }));
  assert.doesNotMatch(loggedOut, /data-lock=/);
});

test('league median: the League tab leads with it, and every team over it now wears a medallion, only when the league plays one', () => {
  const league = { ...state().league, settings: { reserve_slots: 1, league_average_match: 1, playoff_week_start: 19 } };
  // Luka's locked 41.50 and none (0): median 20.75; projections 41.50 (locked) and 25.75: median 33.63.
  const lg = matchup.league(state({ league, page: 'league', weeks: { 1: week(legs('g1')) } }));
  assert.match(text(lg), /^ Matchups ‹ Week 1 OCT 19-25 › M League Median: 20\.75 Proj 33\.63 Win an extra matchup by scoring higher than the league median\. Top 1 of 2 win M @louhow/);
  assert.match(lg, /<section class="median-bar" aria-label="League median">/);
  // Over it now and likely to stay over: a solid medallion on the avatar; under it, none.
  const medals = [...lg.matchAll(/<span class="medal (\w+)" title="([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(medals, [['likely', 'Over the league median now, 91% to finish over it']]);
  assert.match(lg, /<span class="mu-av"><(?:img|div) class="avatar team-link"[^>]*>(?:<\/div>)?<span class="medal likely"/);
  // The Matchup tab: medallions on the matchup's teams, no banner.
  const mu = matchup.render(state({ league, weeks: { 1: week(legs('g1')) } }));
  assert.equal([...mu.matchAll(/class="medal likely"/g)].length, 1);
  assert.doesNotMatch(mu, /median-bar/);
  for (const s of [state(), state({ league: { ...league, settings: { ...league.settings, playoff_week_start: 1 } } })]) {
    assert.doesNotMatch(matchup.render(s) + matchup.league({ ...s, page: 'league' }), /medal|median-bar/);
  }
});

test('league tab standings: record centered, FAAB and waiver spot padded into columns', () => {
  const rosters = [
    { roster_id: 10, owner_id: 'u1', settings: { wins: 1, losses: 0, waiver_position: 2, waiver_budget_used: 1 }, players: [], reserve: [] },
    { roster_id: 5, owner_id: 'u2', settings: { wins: 0, losses: 1, waiver_position: 12 }, players: [], reserve: [] },
  ];
  const faab = { ...state().league, settings: { ...state().league.settings, waiver_type: 2, waiver_budget: 100 } };
  const html = matchup.league(state({ page: 'league', rosters, league: faab }));
  assert.match(html, /<th class="mid" aria-sort="none"><button class="sort" data-sort="record">/);
  assert.equal((html.match(/<td class="mid">/g) || []).length, 2, 'a centered record a row');
  assert.match(html, /<span class="amt">\$99<\/span> <span class="sub"><span class="pos">\(2\)<\/span><\/span>/);
  assert.match(html, /<span class="amt">\$100<\/span> <span class="sub"><span class="pos">\(12\)<\/span><\/span>/);
});

test('league tab standings: the playoff line sits under the last team in, only in rank order and only with playoffs', () => {
  const r = (id, wins, waiver) => ({ roster_id: id, owner_id: `u${id}`, settings: { wins, losses: 3 - wins, fpts: 100 + id, waiver_position: waiver }, players: [], reserve: [] });
  const rosters = [r(1, 3, 4), r(2, 2, 3), r(3, 1, 2), r(4, 0, 1)];
  const playoffs = { ...state().league, settings: { ...state().league.settings, playoff_week_start: 19, playoff_teams: 2, num_teams: 4 } };
  const lg = (extra) => matchup.league(state({ page: 'league', rosters, league: playoffs, weeks: { 1: { ...week(legs()), ranks: { 1: 1, 2: 2, 3: 3, 4: 4 } } }, ...extra }));
  const rowsOf = (html) => [...html.matchAll(/<tr class="([^"]*)">\s*<td[^>]*>(?:<span class="cut-rule">)?([^<]*)/g)].map((m) => m[1] === 'playoff-cut' ? 'cut' : m[2].trim());
  assert.deepEqual(rowsOf(lg()), ['1', '2', 'cut', '3', '4']);
  assert.match(lg(), /<tr class="playoff-cut"><td colspan="7"><span class="cut-rule">Top 2 make the playoffs<\/span><\/td><\/tr>/);
  assert.deepEqual(rowsOf(lg({ standingsSort: { key: 'rank', dir: -1 } })), ['4', '3', 'cut', '2', '1'], 'rank flipped: the line moves with the teams');
  assert.doesNotMatch(lg({ standingsSort: { key: 'pf', dir: -1 } }), /playoff-cut/, 'sorted by points the line means nothing');
  assert.doesNotMatch(lg({ league: state().league }), /playoff-cut/, 'no playoff_week_start, no playoffs');
  assert.doesNotMatch(lg({ league: { ...playoffs, settings: { ...playoffs.settings, playoff_week_start: 0 } } }), /playoff-cut/);
});

test('league tab standings: PF, PA, Max PF and waiver columns, sortable by the header', () => {
  const rosters = [
    { roster_id: 10, owner_id: 'u1', settings: { wins: 1, losses: 0, fpts: 120, fpts_against: 100, ppts: 150, waiver_position: 2 }, players: [], reserve: [] },
    { roster_id: 5, owner_id: 'u2', settings: { wins: 0, losses: 1, fpts: 100, fpts_against: 120, ppts: 170, waiver_position: 1 }, players: [], reserve: [] },
  ];
  const lg = (extra) => matchup.league(state({ page: 'league', rosters, ...extra }));
  const order = (html) => [...html.matchAll(/<td><span class="name-cell"[^>]*>.*?<span class="team-name">([^<]+)/g)].map((m) => m[1]);
  const head = text(lg());
  assert.match(head, /Standings # ▲ Team Record PF PA Max PF Waiver 3 COOKIE MONSTER 1-0 120\.00 100\.00 150\.00 2 7 Cling Kong 0-1 100\.00 120\.00 170\.00 1/);
  assert.deepEqual(order(lg()), ['COOKIE MONSTER', 'Cling Kong']);
  assert.match(lg(), /<th class="" aria-sort="ascending"><button class="sort on" data-sort="rank">/);
  assert.deepEqual(order(lg({ standingsSort: { key: 'maxPf', dir: -1 } })), ['Cling Kong', 'COOKIE MONSTER']);
  assert.deepEqual(order(lg({ standingsSort: { key: 'waiver', dir: 1 } })), ['Cling Kong', 'COOKIE MONSTER']);
});
