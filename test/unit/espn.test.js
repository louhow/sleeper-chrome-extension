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
  assert.equal(espn.draftText({ status: 'found', draft: { year: 2018, round: 1, pick: 1, team: 'CLE' } }), '2018 · Rd 1, Pk 1 (CLE)');
  assert.equal(espn.draftText({ status: 'found', draft: { year: 2017, round: 1, pick: 13, team: null } }), '2017 · Rd 1, Pk 13');
  assert.equal(espn.draftText({ status: 'undrafted' }), 'Undrafted');
  for (const status of ['none', 'error']) assert.equal(espn.draftText({ status }), null);
  assert.equal(espn.draftText(null), null);
  assert.deepEqual(plain(espn.draftParts({ status: 'found', draft: { year: 2018, round: 1, pick: 1, team: 'CLE' } })), { main: '2018', detail: 'Rd 1, Pk 1 (CLE)' });
  assert.deepEqual(plain(espn.draftParts({ status: 'undrafted' })), { main: 'Undrafted', detail: '' });
  assert.equal(espn.draftParts({ status: 'none' }), null);
});

test('URLs: the search and each sport\'s athlete record', () => {
  assert.equal(espn.searchUrl('Ja\'Marr Chase'), 'https://site.web.api.espn.com/apis/search/v2?query=Ja\'Marr%20Chase&limit=10&type=player');
  assert.equal(espn.athleteUrl('nba', '3908809'), 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/3908809');
  assert.equal(espn.athleteUrl('nfl', '3052587'), 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/3052587');
});
