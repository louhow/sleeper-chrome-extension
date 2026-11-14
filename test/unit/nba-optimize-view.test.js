import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { nbaOptimizeView: view } = loadSnp();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// A plan with no change today and one move for Sunday.
const plan = {
  slots: ['F'], current: ['a'], starters: ['a'], changes: [], locks: [], notYet: [], maybe: [], date: '2026-10-24', before: 0, after: 0,
  info: { a: { today: null, perGame: 0, gamesLeft: 0, final: 11.9 } },
  later: [{ slot: 0, out: 'a', id: 'b', gain: 12.15, date: '2026-10-25', tip: Date.parse('2026-10-25T20:00:00Z') }],
};
const state = {
  week: 4, weeks: { 4: { days: [], games: [], gamesByTeam: {} } }, form: {}, tiers: null, league: {}, now: 0,
  players: { a: { name: 'Yaxel Lendeborg', positions: ['SF'], team: 'GSW' }, b: { name: 'Keldon Johnson', positions: ['SF'], team: 'SAS' } },
};

test('a move for a later day is listed with its day and gain, and the dialog says nothing changes today', () => {
  const html = view.render(state, { kind: 'optimize', plan, noLock: [], errors: [], saving: false, busy: null });
  const t = text(html);
  assert.match(t, /Nothing to change Sat\. 1 move later this week\./);
  assert.match(t, /Later this week/);
  assert.match(t, /Keldon Johnson in for Yaxel Lendeborg/);
  assert.match(t, /\+12\.15/);
  assert.ok(html.includes('data-op-later="0"'));
  assert.ok(!t.includes('already your best lineup'));
});
