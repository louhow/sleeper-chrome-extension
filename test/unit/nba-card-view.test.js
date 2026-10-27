import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { nbaCardView: card, ui } = loadSnp();
const scoring = { pts: 1, reb: 1.2 };

test('game log merges projections with played games, in date order', () => {
  const log = {
    proj: { 1: [
      { game_id: 'g2', date: '2026-10-24', week: 1, opponent: 'MIN', is_away_team: true, stats: { pts: 20 } },
      { game_id: 'g1', date: '2026-10-21', week: 1, opponent: 'GSW', is_away_team: false, stats: { pts: 30, reb: 5 } },
    ] },
    stats: { 1: [{ game_id: 'g1', date: '2026-10-21', week: 1, opponent: 'GSW', stats: { pts: 40, reb: 10, sp: 2160, fgm: 15, fga: 25 } }] },
  };
  const rows = card.gameLog(log, scoring);
  assert.deepEqual(Array.from(rows, (r) => r.opp), ['GSW', 'MIN']);
  const [played, upcoming] = rows;
  assert.equal(played.played, true);
  assert.equal(played.proj, 36);
  assert.equal(played.fpts, 52);
  assert.equal(played.min, 36);
  assert.equal(played.fgm, 15);
  assert.equal(upcoming.played, undefined);
  assert.equal(upcoming.away, true);
  assert.equal(upcoming.proj, 20);
});

test('career rows turn season totals into per-game averages and percentages', () => {
  const r = card.careerRow(2025, { gp: 50, pts: 1000, reb: 400, sp: 108000, fgm: 400, fga: 800, ftm: 90, fta: 100, tpm: 100, pos_rank_std: 3 }, scoring);
  assert.equal(r.fpts, 1480);
  assert.equal(r.pts, 20);
  assert.equal(r.min, 36);
  assert.equal(r.fgp, 0.5);
  assert.equal(r.ftp, 0.9);
  assert.equal(r.tpm, 2);
  assert.equal(r.rank, 3);
});

test('labels: NBA seasons span two years, heights in feet and inches', () => {
  assert.equal(card.seasonLabel(2026), "'26-'27");
  assert.equal(ui.height('79'), '6\'7"');
  assert.equal(ui.height(null), '-');
  assert.deepEqual([ui.newsSource('fantasy_pros'), ui.newsSource('rotowire'), ui.newsSource('espn'), ui.newsSource(null)], ['FantasyPros', 'RotoWire', 'espn', '']);
});

test('game log colors fantasy points by score tier', () => {
  const game = (id, date, pts) => ({ game_id: id, date, week: 1, opponent: 'GSW', stats: { pts } });
  const s = {
    modal: { kind: 'player', playerId: 'p1', season: 2026 },
    tiers: { all: [15, 24], positions: {} },
    league: { season: '2026', scoring_settings: { pts: 1 } },
    players: { p1: { name: 'Test Player', positions: ['PG'], team: 'LAL' } },
    cards: { p1: { seasons: [2026], logs: { 2026: { stats: { 1: [game('a', '2026-10-21', 30), game('b', '2026-10-22', 18), game('c', '2026-10-23', 9)] } } } } },
  };
  const tiers = [...card.render(s).matchAll(/<td class="fpts tier tier-([a-z]+)">([\d.]+)</g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(tiers, [['30.00', 'green'], ['18.00', 'yellow'], ['9.00', 'red']]);
});

test('with admin tools on, the game log shows league Fpts and what-if adminFPTS side by side', () => {
  const game = (id, date, pts) => ({ game_id: id, date, week: 1, opponent: 'GSW', stats: { pts } });
  const s = (whatIf) => ({
    modal: { kind: 'player', playerId: 'p1', season: 2026 },
    tiers: { all: [15, 24], positions: {} },
    league: { season: '2026', scoring_settings: { pts: 1 } },
    players: { p1: { name: 'Test Player', positions: ['PG'], team: 'LAL' } },
    cards: { p1: { seasons: [2026], logs: { 2026: { stats: { 1: [game('a', '2026-10-21', 20), game('b', '2026-10-22', 10)] } } } } },
    whatIf: { overrides: { pts: 1.5 }, drafts: {}, ...whatIf },
  });
  const cells = (html) => [...html.matchAll(/<td class="fpts( admin)? tier tier-([a-z]+)">([\d.]+)</g)].map((m) => `${m[1] ? 'admin' : 'league'} ${m[3]} ${m[2]}`);

  const off = card.render(s({ enabled: false, on: true }));
  assert.doesNotMatch(off, /adminFPTS/, 'hidden without ?snp-admin=1');
  assert.match(off, /<th colspan="3"><\/th><th colspan="2">Fantasy<\/th><th colspan="7">Stats<\/th>/);

  // Fpts stays the league's even with what-if switched on; adminFPTS always uses the what-if values.
  for (const on of [false, true]) {
    const html = card.render(s({ enabled: true, on }));
    assert.match(html, /<th class="fpts">Fpts<\/th><th class="fpts admin">adminFPTS<\/th><th>Min<\/th>/);
    assert.match(html, /<th colspan="3"><\/th><th colspan="3">Fantasy<\/th><th colspan="7">Stats<\/th>/);
    assert.deepEqual(cells(html), ['league 20.00 yellow', 'admin 30.00 green', 'league 10.00 red', 'admin 15.00 yellow']);
  }
});

test('while loading, every section holds the shape of what it will show', () => {
  const players = { p1: { name: 'Test Player', position: 'PG', positions: ['PG'], team: 'LAL' }, p2: { name: 'Other Guard', position: 'PG', team: 'LAL' }, p3: { name: 'Big', position: 'C', team: 'LAL' } };
  const html = card.render({ modal: { kind: 'player', playerId: 'p1' }, league: { season: '2026' }, players, cards: { p1: { careerYears: 3 } } });
  assert.doesNotMatch(html, /Loading…/);
  assert.equal((html.match(/<tr class="skeleton">/g) || []).length, 15 + 3, 'game log rows, a career row per season');
  assert.match(html, /<li class="pc-tx skeleton">/, 'a transaction row');
  assert.match(html, /<article class="pc-news skeleton">/, 'a news card');
  const depth = [...html.matchAll(/<div class="pc-depth-row skeleton">\s*<span class="pos \w+">(\w+)<\/span>\s*<ol>((?:<li>&nbsp;<\/li>)+)<\/ol>/g)].map((m) => `${m[1]} ${m[2].split('<li>').length - 1}`);
  assert.deepEqual(depth, ['PG 2', 'SG 1', 'SF 1', 'PF 1', 'C 1'], 'a line per teammate at the position');
  assert.equal((html.match(/aria-busy="true"/g) || []).length, 4);
});

test('draft: beside the rankings, a placeholder while ESPN answers, then the real-life draft, Undrafted, or a quiet "–"', () => {
  const html = (draft) => card.render({ modal: { kind: 'player', playerId: 'p1' }, league: { season: '2026' }, players: { p1: { name: 'Test Player', positions: ['PG'], team: 'LAL' } }, cards: { p1: { draft } } });
  const value = (draft) => html(draft).match(/<div class="pc-draft"[^>]*>\s*<div class="pc-label">Draft<\/div>\s*<div class="pc-ranks">(.*?)<\/div>/)[1];
  assert.match(value({ status: 'loading' }), /class="pc-loading"/);
  assert.match(value({ status: 'found', text: 'Rd 1 · Pk 13 · DEN · 2017', main: 'Rd 1 · Pk 13', detail: 'DEN · 2017' }), /<b>Rd 1 · Pk 13<\/b><\/span><span class="pc-sub"[^>]*>DEN · 2017<\/span>/);
  assert.match(value({ status: 'undrafted', text: 'Undrafted', main: 'Undrafted', detail: '' }), /<b>Undrafted<\/b><\/span>/);
  assert.match(value({ status: 'none', text: null }), /title="No draft found on ESPN"><b>–<\/b>/);
  assert.match(value({ status: 'error', text: null }), /title="ESPN didn&#39;t answer"><b>–<\/b>/);
  assert.doesNotMatch(html({ status: 'loading' }), /pc-item[^"]*">\s*<div class="pc-item-label">(Draft|Exp)/, 'in the career strip, not the AGE ... COLLEGE row');
});

test('contract: beside the draft, "FA 2028" with years left, pay and since when, or a quiet "–"', () => {
  const html = (contract) => card.render({ modal: { kind: 'player', playerId: 'p1' }, league: { season: '2026' }, players: { p1: { name: 'Test Player', positions: ['PG'], team: 'LAL' } }, cards: { p1: { contract } } });
  const value = (contract) => html(contract).match(/<div class="pc-contract"[^>]*>\s*<div class="pc-label">Contract<\/div>\s*<div class="pc-ranks">(.*?)<\/div>/)[1];
  assert.match(value({ status: 'loading' }), /class="pc-loading" aria-label="Loading contract"/);
  assert.match(value({ status: 'found', text: 'FA 2028 · 2 yrs left · $50.1M · since 2025-26', main: 'FA 2028', detail: '2 yrs left · $50.1M · since 2025-26' }), /title="Contract, from ESPN: FA 2028 · 2 yrs left · \$50.1M · since 2025-26"><b>FA 2028<\/b><\/span><span class="pc-sub"[^>]*>2 yrs left · \$50.1M · since 2025-26<\/span>/);
  assert.match(value({ status: 'none', text: null }), /title="No contract found on ESPN"><b>–<\/b>/);
});

test('career strip: Exp beside the draft, the pick fading with its age, a contract year flagged', () => {
  const html = (c, bio = { years_exp: 10 }) => card.render({ modal: { kind: 'player', playerId: 'p1' }, league: { season: '2026' }, players: { p1: { name: 'Test Player', positions: ['PG'], team: 'LAL' } }, cards: { p1: { bio, ...c } } });
  const strip = (h) => h.match(/<div class="pc-career">([\s\S]*?)<\/div>\s*<\/div>\s*<\/header>/)[1];
  const order = (h) => [...strip(h).matchAll(/<div class="pc-label">(\w+)<\/div>/g)].map((m) => m[1]);
  assert.deepEqual(order(html({})), ['Exp', 'Draft', 'Contract']);
  assert.match(html({}), /<div class="pc-exp">\s*<div class="pc-label">Exp<\/div>\s*<div class="pc-ranks"><span class="pc-val" title="10 seasons in the league"><b>10<\/b>yrs<\/span>/);
  assert.match(html({}, { years_exp: 0 }), /<b>Rookie<\/b>/);
  assert.match(html({}, { years_exp: 1 }), /<b>1<\/b>yr</);
  const draft = { status: 'found', text: 'Rd 2 · Pk 45 · TEN · 2016', main: 'Rd 2 · Pk 45', detail: 'TEN · 2016', tone: 'old', age: 10 };
  assert.match(html({ draft }), /<div class="pc-draft" data-tone="old">/);
  assert.match(html({ draft }), /title="Real-life draft, from ESPN: Rd 2 · Pk 45 · TEN · 2016 \(10 years ago\)"/);
  const flagged = { status: 'found', text: 'FA 2027 · Contract year · $33M', main: 'FA 2027', flag: 'Contract year', detail: '$33M', tone: 'expiring' };
  assert.match(html({ contract: flagged }), /<div class="pc-contract" data-tone="expiring">[\s\S]*<b>FA 2027<\/b><em class="pc-flag">Contract year<\/em><\/span><span class="pc-sub"[^>]*>\$33M<\/span>/);
});
