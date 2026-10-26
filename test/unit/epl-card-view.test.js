import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSep } from './load.js';

const { SEP } = loadSep();

test('card: the career table names each season\'s clubs, in order, abbreviated where known', () => {
  const s = {
    league: { scoring_settings: { pos_f_g: 10 } },
    players: { 9: { name: 'Nine', team: '1040', position: 'F', positions: ['F'] } },
    rosters: [],
    usersById: {},
    teams: { 1040: { abbr: 'MCI', name: 'Manchester City' }, 1030: { abbr: 'BOU' } },
    modal: { kind: 'player', playerId: '9', tab: 'history' },
    cards: { 9: { history: [], career: [
      { season: 2026, clubs: ['1040'], stats: { gp: 8, pos_f_g: 9 } },
      { season: 2025, clubs: ['1030', '1040'], stats: { gp: 30 } },
      { season: 2024, clubs: ['1099'], stats: { gp: 3 } },
      { season: 2023, clubs: [], stats: { gp: 1 } },
    ] } },
  };
  const html = SEP.cardView.render(s);
  assert.match(html, /<th>Season<\/th><th>Club<\/th>/);
  const cells = [...html.matchAll(/<td class="clubs">(.*?)<\/td>/g)].map((m) => m[1].replace(/<img [^>]*>/g, '[logo]').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.deepEqual(cells, ['[logo]MCI', '[logo]BOU → [logo]MCI', '[logo]', '-']);
  assert.match(html, /title="Manchester City"><img src="[^"]*\/clubsoccer\/1040\.png"/);
});
