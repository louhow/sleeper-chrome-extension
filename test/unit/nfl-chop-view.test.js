import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';
import { state } from './nfl-fixture.js';

const { nflChopView } = loadSnp();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// The NFL fixture as a chopped league: a third team chopped in week 5, its
// players dropped to waivers, one of them picked up since.
function chopped({ me = 'u1', sort = 'proj', players = [{ id: 'fa1', rosterId: 3, week: 5 }, { id: 'fa2', rosterId: 3, week: 5 }] } = {}) {
  const s = state();
  s.me = me;
  s.league.settings = { ...s.league.settings, type: 3, start_week: 1, last_scored_leg: 6, last_chopped_leg: 5, waiver_budget: 1000 };
  s.usersById.u3 = { display_name: 'ghost', metadata: { team_name: 'Gone Team' } };
  s.rosters[0].settings = { ...s.rosters[0].settings, fpts: 600, fpts_decimal: 0, waiver_budget_used: 939 };
  s.rosters.push({ roster_id: 3, owner_id: 'u3', settings: { eliminated: 5, fpts: 400, fpts_decimal: 50, waiver_budget_used: 312 }, players: [] });
  s.players.fa1 = { name: 'Kalif Raymond', first: 'Kalif', last: 'Raymond', position: 'WR', positions: ['WR'], team: 'CHI' };
  s.players.fa2 = { name: 'Jalon Daniels', first: 'Jalon', last: 'Daniels', position: 'QB', positions: ['QB'], team: 'TB' };
  s.weeks[7].proj.fa1 = 7;
  s.weeks[7].proj.fa2 = 2;
  s.chop = { players, sort, error: null };
  return s;
}

test('your status: rank among the teams alive, points per week, FAAB left and safe chance', () => {
  // Blitz projects 34.7 to your 50.4, so you rank 1st of 2.
  const out = text(nflChopView.render(chopped()));
  assert.match(out, /Gridiron &lt;Gang&gt; 1st of 2 · 100\.00 avg fpts · \$61 faab 30\.50 50\.40 \d+% safe/);
});

test('chopping block: worst first under its zone, played starters and points over projection', () => {
  const out = text(nflChopView.render(chopped()));
  assert.match(out, /Chopping Block Week 7/);
  // Blitz: Allen's game is over and Barkley's on, Smith's and Kittle's still to come.
  assert.match(out, /Chop zone 2 Blitz @rival 10% 2\/4 12\.00 34\.70 Safe 1 Gridiron &lt;Gang&gt; @louhow 90% 2\/3 30\.50 50\.40/);
  assert.doesNotMatch(out.split('Graveyard')[0], /Gone Team.*Chop zone/, 'chopped teams are not on the block');
});

test('chopped players: who they came from and when, sorted as picked', () => {
  const byProj = text(nflChopView.render(chopped()));
  assert.match(byProj, /K\. Raymond WR • CHI Gone Team chopped wk 5 7\.00 proj J\. Daniels/);
  const byPos = text(nflChopView.render(chopped({ sort: 'pos' })));
  assert.match(byPos, /J\. Daniels .* K\. Raymond/, 'QB before WR');
  assert.match(nflChopView.render(chopped({ sort: 'pos' })), /data-chop-sort="pos" class="on" aria-pressed="true"/);
  assert.match(text(nflChopView.render(chopped({ players: [] }))), /All chopped players have been picked up/);
});

test('graveyard: week, team, FAAB left and points per week played', () => {
  assert.match(text(nflChopView.render(chopped())), /Graveyard Week Name FAAB rem FPTS 5 Gone Team @ghost \$688 80\.10/);
});

test('a chopped team of yours says so instead of a safe chance', () => {
  const out = text(nflChopView.render(chopped({ me: 'u3' })));
  assert.match(out, /Gone Team Chopped · wk 5 · 80\.10 avg fpts · \$688 faab/);
  assert.doesNotMatch(out, /% safe/);
});

test('loading until the week is in; ordinals', () => {
  assert.match(nflChopView.render(null), /chop-tab/);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(nflChopView.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th']);
});
