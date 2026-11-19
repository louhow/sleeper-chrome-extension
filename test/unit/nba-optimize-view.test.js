import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { nbaOptimizeView: view } = loadSnp();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// A plan whose one change brings in a player for a later day.
const plan = {
  slots: ['F'], current: ['a'], starters: ['b'], locks: [], notYet: [], maybe: [], date: '2026-10-24', before: 0, after: 0,
  week: { before: 11.9, after: 24.05 },
  changes: [{ id: 'a', from: 'F', to: 'BN' }, { id: 'b', from: 'BN', to: 'F' }],
  info: { a: { today: null, perGame: 0, gamesLeft: 0, final: 11.9 }, b: { today: null, perGame: 24.05, gamesLeft: 1 } },
  future: { b: { date: '2026-10-25', tip: 0, gain: 12.15 } },
};
const state = {
  week: 4, weeks: { 4: { days: [], games: [], gamesByTeam: {} } }, form: {}, tiers: null, league: {}, now: 0,
  players: { a: { name: 'Yaxel Lendeborg', positions: ['SF'], team: 'GSW' }, b: { name: 'Keldon Johnson', positions: ['SF'], team: 'SAS' } },
};

test('a move for a later day is an ordinary row with its gain, under the week projection', () => {
  const t = text(view.render(state, { kind: 'optimize', plan, noLock: [], errors: [], saving: false, busy: null }));
  assert.match(t, /Week projection/);
  assert.match(t, /Keldon Johnson/);
  assert.match(t, /\+12\.15/);
});

test('lock rows and not-yet rows say when the game is unconfirmed, and flag a close call', () => {
  const p = (id, name) => [id, { name, positions: ['SF'], team: 'ORL' }];
  const s = { ...state, players: Object.fromEntries([p('f', 'Jeremiah Fears'), p('w', 'Franz Wagner')]) };
  const game = (id, actual) => ({ actual, game: { id, home: 'ORL', away: 'BOS', start: 0, status: 'complete' }, home: false, opponent: 'BOS' });
  const info = { today: null, perGame: 30, gamesLeft: 3, open: 40 };
  const lock = { id: 'f', on: true, unsure: true, close: false, game: game('g1', 43.5), actual: 43.5, open: 36.2, gamesLeft: 3, until: null };
  const notYet = { id: 'w', unsure: true, close: true, openGame: { date: '2026-10-24', home: false, opponent: 'WAS' }, game: game('g2', 42.1), actual: 42.1, open: 43.49 };
  const pl = { ...plan, slots: ['G', 'SF'], current: ['f', 'w'], starters: ['f', 'w'], changes: [], locks: [lock], notYet: [notYet], future: {}, info: { f: info, w: { ...info, open: 43.49, close: true, openGame: { date: '2026-10-24', home: false, opponent: 'WAS' } } } };
  const html = view.render(s, { kind: 'optimize', plan: pl, noLock: [], errors: [], saving: false, busy: null });
  const t = text(html);
  assert.match(t, /Lockable if they started/);
  assert.match(t, /lockable if started/);
  assert.equal((t.match(/close call/g) || []).length, 1, 'only the near one is flagged');
  assert.match(html, /os-row nba same close/);
  assert.match(t, /proj 43\.49 Sat/, 'the projection, with its day');
  assert.match(html, /dp-open close-call"><span class="open-val">43\.49<\/span><span class="open-tip"><b>Franz Wagner<\/b>, Saturday at WAS<\/span>/, 'the slot\'s own player and game');
  const backed = { ...pl, info: { ...pl.info, w: { ...pl.info.w, openBy: 'f', openGame: { date: '2026-10-23', home: true, opponent: 'SAC' } } } };
  assert.match(view.render(s, { kind: 'optimize', plan: backed, noLock: [], errors: [], saving: false, busy: null }), /<span class="open-tip"><b>Jeremiah Fears<\/b>, Friday vs SAC<\/span>/, 'a bench player\'s game');
  assert.doesNotMatch(html.split('os-row nba lock')[1].split('</div>')[0], /close call/);
});
