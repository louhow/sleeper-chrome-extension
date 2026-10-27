import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';
import { state } from './nfl-fixture.js';

const { nflChopView, nflPanelView, ui } = loadSnp();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// The NFL fixture as a chopped league: a third team chopped in week 5.
function chopped({ me = 'u1' } = {}) {
  const s = state();
  s.me = me;
  s.currentWeek = 7;
  s.league.settings = { ...s.league.settings, type: 3, start_week: 1, last_scored_leg: 6, last_chopped_leg: 5, waiver_budget: 1000 };
  s.usersById.u3 = { display_name: 'ghost', metadata: { team_name: 'Gone Team' } };
  s.rosters[0].settings = { ...s.rosters[0].settings, fpts: 600, fpts_decimal: 0, waiver_budget_used: 939 };
  s.rosters.push({ roster_id: 3, owner_id: 'u3', settings: { eliminated: 5, fpts: 400, fpts_decimal: 50, waiver_budget_used: 312 }, players: [] });
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
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ui.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th']);
});

test('team tab card: points per week and FAAB left in place of the record, and the safe chance for the week on now', () => {
  const card = (s) => text(nflPanelView.render(s, [])).split('Starters')[0];
  assert.match(card(chopped()), /Gridiron &lt;Gang&gt; 100\.00 avg fpts · \$61 faab 90% safe 30\.50 proj 50\.40/);
  assert.doesNotMatch(card(chopped()), /4-2|vs Blitz/);
  // Another week: no safe chance, which is for the week on now.
  assert.doesNotMatch(card({ ...chopped(), currentWeek: 8 }), /% safe/);
  const gone = chopped();
  gone.rosterId = 3;
  gone.weeks[7].matchups.push({ roster_id: 3, matchup_id: null, starters: [], points: 0 });
  assert.match(card(gone), /Gone Team Chopped · wk 5 · 80\.10 avg fpts · \$688 faab/);
  // Other leagues keep the record and opponent.
  const s = chopped();
  s.league.settings.type = 0;
  assert.match(card(s), /louhow · 4-2 · vs Blitz/);
});

test('icons: each zone header its mark, and a chopped team its lock, halo or horns and axe badge', () => {
  const html = nflChopView.render(chopped());
  assert.match(html, /chop-zone chop"><svg class="ico axe"[^]*Chop zone/);
  assert.match(html, /chop-zone safe"><svg class="ico"[^]*Safe/);
  // Gone Team's 80.10 a week beats the league's (1000.5 points over 6 + 6 + 5 weeks: 58.85), so a halo.
  assert.match(html, /grave-row[^]*<span class="chop-av"><svg class="halo"[^]*<span class="chop-badge" title="Chopped"><svg class="ico axe"/);
  assert.match(html, /<svg class="ico lock"[^]*<\/svg>@ghost/);
  const s = chopped();
  s.rosters[2].settings.fpts = 100;
  assert.match(nflChopView.render(s), /grave-row[^]*<svg class="horns"/, 'at 20.10 a week, horns');
  assert.match(nflPanelView.render({ ...s, rosterId: 3 }, []), /team-card">\s*<span class="chop-av"><svg class="horns"/, 'on the Team tab card too');
});

