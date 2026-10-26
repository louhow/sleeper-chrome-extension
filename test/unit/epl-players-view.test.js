import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSep } from './load.js';

const { SEP } = loadSep();
const { model, scoring, playersView: view } = SEP;

const NOW = Date.parse('2026-10-24T12:00:00Z');
const game = (id, date, home, away) => ({
  game_id: id, date, start_time: Date.parse(`${date}T14:00:00Z`), status: 'complete',
  metadata: { home_team: { team: home, abbr: `T${home}` }, away_team: { team: away, abbr: `T${away}` } },
});
const settings = { pos_f_g: 10, pos_m_g: 5 };
const games = [[game('a', '2026-10-04', '1', '2')], [game('b', '2026-10-18', '3', '1')]].map(model.gamesFromScores);
const actual = [
  [{ player_id: 'f1', game_id: 'a', opponent: '2', stats: { min: 90, pos_f_g: 1 } }, { player_id: 'm1', game_id: 'a', opponent: '2', stats: { min: 90, pos_m_g: 3 } }],
  [{ player_id: 'm1', game_id: 'b', opponent: '3', stats: { min: 90, pos_m_g: 3 } }],
].map((rows) => model.pointsByGame(rows, settings, scoring.scoreStats));
const players = {
  f1: { name: 'Forward One', team: '1', teamAbbr: 'T1', position: 'F', positions: ['F'], active: true, rank: 1 },
  m1: { name: 'Mid One', team: '1', teamAbbr: 'T1', position: 'M', positions: ['M'], active: true, rank: 2 },
};
const state = (extra = {}) => ({
  now: NOW,
  players,
  rosters: [],
  usersById: {},
  season: { stats: { f1: { pts_std: 50 }, m1: { pts_std: 40 } } },
  weeks: {},
  playersTab: { mode: 'available', position: 'ALL', query: '', trend: 'add', shown: 0, freeAgentsOnly: false, sort: null },
  recent: model.recentForm({ weeks: [7, 8], actual, games, rostered: ['f1', 'm1'], positionOf: (id) => players[id].position }),
  ...extra,
});
const names = (html) => [...html.matchAll(/data-player="(\w+)">/g)].map((m) => m[1]).filter((id, i, all) => all.indexOf(id) === i);

test('players: a Last 5 strip per player, a mark per gameweek with what its hover card shows', () => {
  const html = view.render(state());
  assert.match(html, /<button class="col sort" data-psort="last5" [^>]*aria-pressed="false">Last 5<\/button>/);
  const strip = html.match(/<span class="last5"[^>]*aria-label="Last 5: 10\.0 a game over 1 match">(.*?)<\/span>/s)[1];
  assert.deepEqual([...strip.matchAll(/class="([^"]+)" data-tip="([^"]+)" data-note="([^"]+)"/g)].map((m) => m.slice(1)), [
    ['done red', 'GW 7 vs T2', '10.0'],
    ['dnp', 'GW 8 @ T3', 'Didn&#39;t play'],
  ]);
  assert.match(strip, /data-note="10.0" data-tier="red"/, 'the hover card colors the score too');
  assert.match(html, /aria-label="Last 5: 15\.0 a game over 2 matches"/);
  assert.match(view.render(state({ recent: null })), /<span class="last5 empty">–<\/span>/, 'still loading');
});

test('players: the Last 5 column sorts by points per match, and back', () => {
  assert.deepEqual(names(view.render(state())), ['f1', 'm1'], 'season points first');
  const sorted = view.render(state({ playersTab: { ...state().playersTab, sort: 'last5' } }));
  assert.deepEqual(names(sorted), ['m1', 'f1']);
  assert.match(sorted, /class="col sort active"[^>]*aria-pressed="true">Last 5 ▾/);
});

test('players: the hover card, escaped', () => {
  assert.equal(view.recentTip({ tip: 'GW 7 vs <b>', note: '10.0', tier: 'green', count: '10.0 a game over 1 match' }),
    '<div class="tip-head"><b>GW 7 vs &lt;b&gt;</b><span class="tip-score green">10.0</span></div><div class="tip-foot">10.0 a game over 1 match</div>');
  assert.match(view.recentTip({ tip: 'GW 8', note: 'No match', count: '' }), /<span class="">No match<\/span>/);
});
