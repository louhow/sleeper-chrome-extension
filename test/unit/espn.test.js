import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { espn } = loadSnp();
const plain = (x) => JSON.parse(JSON.stringify(x));

test('candidates: only the sport\'s league, in ESPN\'s order, at most a few', () => {
  const content = (league, id) => ({ defaultLeagueSlug: league, uid: `s:20~l:28~a:${id}` });
  const json = { results: [{ type: 'player', contents: [content('nfl', 1), content('college-football', 2), content(null, 3), content('nfl', 4), content('nba', 5)] }] };
  assert.deepEqual(plain(espn.candidates('nfl', json)), ['1', '4']);
  assert.deepEqual(plain(espn.candidates('nba', json)), ['5']);
  const many = { results: [{ contents: Array.from({ length: 9 }, (_, i) => content('nba', i)) }] };
  assert.equal(espn.candidates('nba', many).length, espn.MAX_CANDIDATES);
  assert.deepEqual(plain(espn.candidates('nfl', null)), []);
});

test('sameBirthday: ESPN\'s timestamp and Sleeper\'s date, the same day or nothing', () => {
  assert.equal(espn.sameBirthday('1996-09-07T07:00Z', '1996-09-07'), true);
  assert.equal(espn.sameBirthday('1996-09-08T07:00Z', '1996-09-07'), false);
  assert.equal(espn.sameBirthday(null, '1996-09-07'), false);
  assert.equal(espn.sameBirthday('1996-09-07T07:00Z', ''), false, 'no birth date on Sleeper: never a match');
});

test('queries: the full name, then the last name alone', () => {
  assert.deepEqual(plain(espn.queries({ name: 'Kenneth Walker', lastName: 'Walker' })), ['Kenneth Walker', 'Walker']);
  assert.deepEqual(plain(espn.queries({ name: 'Walker', lastName: 'Walker' })), ['Walker']);
  assert.deepEqual(plain(espn.queries({})), []);
});

test('draftOf and draftText: round, pick and team, Undrafted, or nothing', () => {
  const athlete = { draft: { year: 2018, round: 1, selection: 1, team: { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2018/teams/5' } } };
  assert.deepEqual(plain(espn.draftOf(athlete)), { year: 2018, round: 1, pick: 1, teamRef: 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2018/teams/5' });
  assert.equal(espn.draftOf({}), null);
  assert.equal(espn.draftText({ status: 'found', draft: { year: 2018, round: 1, pick: 1, team: 'CLE' } }), '2018 · Rd 1 · Pk 1 · CLE');
  assert.equal(espn.draftText({ status: 'found', draft: { year: 2017, round: 1, pick: 13, team: null } }), '2017 · Rd 1 · Pk 13');
  assert.equal(espn.draftText({ status: 'undrafted' }), 'Undrafted');
  for (const status of ['none', 'error']) assert.equal(espn.draftText({ status }), null);
  assert.equal(espn.draftText(null), null);
  assert.deepEqual(plain(espn.draftParts({ status: 'found', draft: { year: 2018, round: 1, pick: 1, team: 'CLE' } })), { main: '2018', detail: 'Rd 1 · Pk 1 · CLE' });
  assert.deepEqual(plain(espn.draftParts({ status: 'undrafted' })), { main: 'Undrafted', detail: '' });
  assert.equal(espn.draftParts({ status: 'none' }), null);
});

test('URLs: the search and each sport\'s athlete record', () => {
  assert.equal(espn.searchUrl('Ja\'Marr Chase'), 'https://site.web.api.espn.com/apis/search/v2?query=Ja\'Marr%20Chase&limit=10&type=player');
  assert.equal(espn.athleteUrl('nba', '3908809'), 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/3908809');
  assert.equal(espn.athleteUrl('nfl', '3052587'), 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/3052587');
});

test('contractSeason: NFL league years from March by the year they start, NBA seasons from July by the year they end', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(espn.contractSeason('nfl', at('2026-10-26T12:00:00Z')), 2026);
  assert.equal(espn.contractSeason('nfl', at('2027-02-10T12:00:00Z')), 2026, 'the Super Bowl is still 2026');
  assert.equal(espn.contractSeason('nfl', at('2027-03-20T12:00:00Z')), 2027);
  assert.equal(espn.contractSeason('nba', at('2026-10-26T12:00:00Z')), 2027, '2026-27');
  assert.equal(espn.contractSeason('nba', at('2027-06-20T12:00:00Z')), 2027);
  assert.equal(espn.contractSeason('nba', at('2027-07-02T12:00:00Z')), 2028);
  assert.equal(espn.seasonLabel('nba', 2026), '2025-26');
  assert.equal(espn.seasonLabel('nfl', 2025), '2025');
});

test('contractOf: when he\'s a free agent and seasons left, from ESPN\'s records', () => {
  // Derrick Henry, 2026: under contract this year and next.
  assert.deepEqual(plain(espn.contractOf('nfl', 2026, { salary: 11000000, bonus: 0, yearsRemaining: 2, signedThrough: 2028 })), { fa: 2028, years: 2, pay: 11000000 });
  assert.deepEqual(plain(espn.contractOf('nfl', 2025, { salary: 14000000, bonus: 1000000, yearsRemaining: 3, signedThrough: 2028 })), { fa: 2028, years: 3, pay: 15000000 });
  // Ja'Marr Chase, 2024: a rookie deal's last year reads "signed through 2024".
  assert.deepEqual(plain(espn.contractOf('nfl', 2024, { salary: 4862679, bonus: 3807679, yearsRemaining: 0, signedThrough: 2024 })), { fa: 2025, years: 1, pay: 8670358 });
  // Donovan Mitchell and Tyrese Maxey, 2026-27 (ESPN's 2027).
  assert.deepEqual(plain(espn.contractOf('nba', 2027, { salary: 50105628, yearsRemaining: 2 })), { fa: 2028, years: 2, pay: 50105628 });
  assert.deepEqual(plain(espn.contractOf('nba', 2027, { salary: 40770520, yearsRemaining: 3 })), { fa: 2029, years: 3, pay: 40770520 });
  // No record (LeBron), or none in force.
  for (const [sport, record] of [['nba', null], ['nba', { yearsRemaining: 0 }], ['nfl', {}]]) assert.equal(espn.contractOf(sport, 2027, record), null);
});

test('contractParts: "FA 2028" with years left, pay and since when', () => {
  const found = (contract) => ({ status: 'found', contract });
  assert.deepEqual(plain(espn.contractParts(found({ fa: 2028, years: 2, pay: 11000000, since: '2025' }))), { main: 'FA 2028', detail: '2 yrs left · $11M · since 2025' });
  assert.deepEqual(plain(espn.contractParts(found({ fa: 2027, years: 1, pay: 50105628, since: '2024-25' }))), { main: 'FA 2027', detail: 'Final year · $50.1M · since 2024-25' });
  assert.equal(espn.contractText(found({ fa: 2029, years: 3, pay: null, since: null })), 'FA 2029 · 3 yrs left');
  for (const status of ['none', 'error']) assert.equal(espn.contractParts({ status }), null);
  assert.deepEqual([12000000, 50105628, 950000, 125000000, 0].map(espn.money), ['$12M', '$50.1M', '$950K', '$125M', '']);
});
