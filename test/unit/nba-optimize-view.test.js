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
