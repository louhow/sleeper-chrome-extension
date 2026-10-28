import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';
import { state } from './nfl-fixture.js';

const { nflPanelView, nflOptimizeView, nflLeagueView } = loadSnp();
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (overrides) => nflPanelView.render(state(overrides), []);

test('team card: record, opponent, points so far and the live projection', () => {
  const out = text(render());
  // Mahomes's 24.5 and Lamb's 6 so far; Aiyuk still projects 11.5, Lamb 6 + 14 x 0.6 to come.
  assert.match(out, /Gridiron &lt;Gang&gt; louhow · 4-2 · vs Blitz 30\.50 proj 50\.40/);
  assert.match(out, /Week 7/);
});

test('team card: – before any starter kicks off, as on NBA', () => {
  const s = state();
  s.weeks[7].matchups[0].starters = ['wr1'];
  assert.match(text(nflPanelView.render(s, [])), /vs Blitz – proj 11\.50/);
});

test('rows: game state, box score, research and points in their score color', () => {
  const html = render();
  const out = text(html);
  assert.match(out, /QB Patrick Mahomes QB - KC 89% Start \| 100% Rostered vs BUF · Final W 27-20 21\/30 CMP, 260 YD, 2 TD 24\.50 proj 21\.20/);
  assert.match(out, /RB CeeDee Lamb RB - DAL Q .* vs PHI · Q2 4:12 · 7-10 · RZ 8 CAR, 41 YD 6\.00 proj 14\.00/);
  assert.match(out, /WR Brandon Aiyuk WR - SF .* @ SEA · Sun 4:25pm – proj 11\.50/);
  assert.match(html, /<b class="tier tier-green">24\.50<\/b>/, 'a finished game in its tier color');
  assert.match(out, /W R T Empty Bench/, 'an open FLEX');
});

test('bench by position, unknown positions last; IR and taxi keep the league\'s slots', () => {
  const out = text(render());
  assert.match(out, /Bench .* BN Bench Kicker .* BN Buffalo Bills .* BN Mystery Man/);
  assert.match(out, /Injured Reserve Game Pts IR Hurt Back .* IR Empty Taxi Squad Game Pts TX Empty/);
  assert.doesNotMatch(out, /No one on/);
});

test('your lineup is editable: badges move players whose game has not kicked off', () => {
  assert.doesNotMatch(render(), /data-spot=/, 'logged out');
  const html = render({ me: 'u1', optimizable: true });
  assert.match(html, /<button class="optimize" data-action="optimize"/);
  assert.match(html, /data-spot="s:2"/, 'Aiyuk has yet to play');
  assert.doesNotMatch(html, /data-spot="s:0"/, 'Mahomes has played');
  assert.match(text(html), /Tap a position to update your lineup/);
  const picking = render({ me: 'u1', swap: 's:2' });
  assert.match(picking, /<article class="card nfl selected">/);
  assert.match(text(picking), /Pick a player to swap with Brandon Aiyuk · Esc to cancel/);
  assert.match(text(render({ me: 'u1', swap: 's:3' })), /Pick a player for this slot · Esc to cancel/, 'an open slot');
  assert.doesNotMatch(render({ me: 'u1', editableWeek: 8 }), /data-spot=/, 'another week');
});

test('a healthy player on IR: a red banner, and the only moves take him off IR', () => {
  const stuck = (extra = {}) => {
    const s = state({ me: 'u1', ...extra });
    s.players.ir1 = { ...s.players.ir1, injury: null };
    s.players.bn1 = { ...s.players.bn1, injury: 'Out' };
    s.league = { ...s.league, settings: { ...s.league.settings, reserve_allow_out: 1 } };
    return s;
  };
  const html = nflPanelView.render(stuck(), []);
  assert.match(text(html), /You have 1 player no longer eligible in IR \(H\. Back\)\. Please move them out of IR\./);
  assert.match(html, /<article class="card nfl ir-bad">/, 'his row is marked');
  assert.match(html, /data-spot="r:ir1"/, 'he can be picked');
  assert.doesNotMatch(html, /data-spot="s:2"/, 'a starter has nowhere to go');
  assert.doesNotMatch(html, /data-spot="re:0"/);
  assert.match(text(html), /Move H\. Back off IR first/);
  const picking = nflPanelView.render(stuck({ swap: 'r:ir1' }), []);
  assert.match(picking, /data-spot="be:0"/, 'the open bench spot is a target');
  assert.match(picking, /data-spot="b:bn1"/, 'so is an Out bench player, who goes onto IR');
  assert.doesNotMatch(render({ me: 'u1' }), /ir-alert/, 'nothing stuck, no banner');
});

test('matchup: both teams, win chance, rows slot by slot and empty sections held open', () => {
  const html = render({ page: 'matchup' });
  const out = text(html);
  assert.match(out, /@louhow Gridiron &lt;Gang&gt; 30\.50 90% WIN 4-2 50\.40 VS @rival Blitz 12\.00 10% WIN 3-3/);
  assert.match(html, /class="mu-head lg-match nfl-mu-head"/);
  assert.match(html, /data-open-team="2"/, 'the opponent opens on the Team tab');
  assert.match(out, /Starters 1 yet to play · 2 for them/);
  // A row is the player and points, then the game and box score under them, as on Sleeper's own tab.
  assert.match(out, /P\. Mahomes QB • KC 24\.50 proj 21\.20 Final W 27-20 vs BUF 21\/30 CMP, 260 YD, 2 TD QB J\. Allen QB • BUF 12\.00 proj 18\.00 Final L 20-27 @ KC/);
  assert.match(out, /C\. Lamb Q RB • DAL 6\.00 proj 14\.00 Q2 4:12 7-10 vs PHI · RZ 8 CAR, 41 YD/, 'a live game');
  assert.match(html, /<div class="mp-game done"><span class="sub">Final W 27-20 vs BUF<\/span><span class="stats">21\/30 CMP, 260 YD, 2 TD<\/span>/);
  assert.match(out, /Empty W R T G\. Kittle/, 'an open FLEX');
  assert.match(out, /Injured Reserve H\. Back .* IR Empty Empty IR Empty Taxi Squad Empty TX Empty/);
  assert.match(out, /Buffalo Bills DEF • BUF/, 'a defense goes by its full name');
});

test('the toolbar: Sleeper\'s own view a click away, errors and the API log', () => {
  assert.match(render(), /data-action="sleeper-view" title="Show Sleeper's own Team tab"/);
  assert.match(text(render({ error: 'Nope' })), /Nope/);
  assert.match(text(render({ weeks: {} })), /Loading…/);
  assert.match(text(nflPanelView.render(state({ tab: 'api' }), [{ id: 1, at: 0, path: '/v1/state/nfl', status: 200 }])), /\/v1\/state\/nfl/);
});

test('NFL optimize dialog: names open the player card, like NBA', () => {
  const lineup = {
    slots: ['QB', 'FLEX'], starters: ['q1', '0'], bench: ['r1'], round: 7, played: {},
    players: { q1: { name: 'Pat Mahomes', position: 'QB', team: 'KC' }, r1: { name: 'Run Back', position: 'RB', team: 'DAL', injury: 'Questionable' } },
    projections: { r1: { opponent: 'PHI' } },
  };
  const plan = { starters: ['q1', 'r1'], before: 20, after: 29, changes: [{ id: 'r1', to: 'FLEX' }] };
  const html = nflOptimizeView.render({ modal: { lineup, plan, proj: { q1: 20, r1: 9 }, errors: [], saving: false, busy: null } });
  assert.match(html, /<button class="name" data-player="r1">Run Back<\/button> <span class="team">RB - DAL<\/span>/);
  assert.match(html, /<img class="headshot" src="[^"]+" alt="" data-player="q1">/);
  assert.match(text(html), /Run Back is Questionable\. Check the news before kickoff\./);
  assert.match(text(html), /Lineup projection Starters&#39; projected points 20\.00 → 29\.00 \+9\.00/);
});

test('NFL league cards: Sleeper\'s own numbers, broken avatars as the plain circle', () => {
  const side = (team, win, avatar = null) => ({ avatar, owner: team.toLowerCase(), team, score: '25.90', win, record: '1-0', proj: '100.00', bar: 90 });
  const html = nflLeagueView.render({ cards: [{ own: true, sides: [side('Mine', '90%', 'https://x/a.png'), side('Theirs', '10%', 'https://x/b.png')] }], round: 7 }, null, new Set(['https://x/b.png']));
  assert.match(text(html), /@mine Mine 25\.90 90% WIN 1-0 100\.00 VS @theirs Theirs 25\.90 10% WIN/);
  assert.match(html, /<img class="avatar" src="https:\/\/x\/a\.png" alt="">/);
  assert.match(html, /<span class="mu-av"><div class="avatar"><\/div><\/span>\s*<div class="mu-who">\s*<div class="sub">@theirs/);
  assert.match(html, /class="mu-head lg-match own" role="button" tabindex="0" data-nfl-matchup="0"/);
});

test("League tab cards: Sleeper's own text as read, a card with no teams yet, and win text that isn't a number", () => {
  const side = (team, win) => ({ avatar: '', owner: team.toLowerCase(), team, score: '12.30', win, record: '3-3', proj: '40.10' });
  const out = text(nflLeagueView.render({ cards: [
    { own: true, sides: [side('Gridiron', '57%'), side('Blitz', '43%')] },
    { own: false, sides: [] },
    { own: false, sides: [side('Hail', '--'), side('Mary', '')] },
  ], round: 7 }, { settings: { league_average_match: 1 } }, new Set()));
  assert.match(out, /Gridiron 12\.30 57% WIN 3-3 40\.10 VS @blitz Blitz 12\.30 43% WIN/);
  assert.doesNotMatch(out, /NaN/);
});

test('NFL League tab: the week\'s median first and a medallion on every team over it, only in a week that plays one', () => {
  const side = (team, score, proj) => ({ avatar: '', owner: team.toLowerCase(), team, score, win: '50%', record: '3-3', proj });
  const cards = [
    { own: false, sides: [side('Alpha', '80.00', '80.00'), side('Beta', '20.00', '60.00')] },
    { own: true, sides: [side('Gamma', '-', '90.00'), side('Mine', '50.00', '120.00')] },
  ];
  const league = { settings: { league_average_match: 1, playoff_week_start: 15 } };
  const html = nflLeagueView.render({ cards, round: 7 }, league, new Set());
  // Median of 80, 20, 0 (Sleeper's "-": no points yet) and 50 is 35; of the projections 80, 60, 90 and 120, 85.
  assert.match(text(html), /^ M League Median: 35\.00 Proj 85\.00 Win an extra matchup by scoring higher than the league median\. Top 2 of 4 win @gamma/);
  // Alpha is done (80 = its projection) but the median isn't settled: likely, not won; Mine is over now.
  const medals = Object.fromEntries([...html.matchAll(/data-nfl-matchup|class="medal (\w+)"[^>]*>M<\/span><\/span>\s*<div class="mu-who">\s*<div class="sub">@(\w+)/g)].filter((m) => m[1]).map((m) => [m[2], m[1]]));
  assert.deepEqual(Object.keys(medals).sort(), ['alpha', 'mine']);
  // Everyone settled: the medallion turns to won.
  const done = cards.map((c) => ({ ...c, sides: c.sides.map((t) => ({ ...t, proj: t.score === '-' ? '0' : t.score })) }));
  assert.match(nflLeagueView.render({ cards: done, round: 7 }, league, new Set()), /class="medal won" title="Won the league median: an extra win"[^>]*>M<\/span><\/span>\s*<div class="mu-who">\s*<div class="sub">@alpha/);
  assert.doesNotMatch(nflLeagueView.render({ cards, round: 15 }, league, new Set()), /medal|median-bar/, 'not in the playoffs');
  assert.doesNotMatch(nflLeagueView.render({ cards, round: 7 }, { settings: {} }, new Set()), /medal|median-bar/, 'not without median on');
});
