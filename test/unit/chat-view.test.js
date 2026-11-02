import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { chatView } = loadSnp();

const trade = {
  status: 'complete',
  rosterIds: [1, 2],
  adds: { 10: 1, 20: 2, DAL: 2 },
  drops: { 10: 2, 20: 1, DAL: 1, 30: 1 },
  picks: ['3,2027,1,1,2', '2,2028,2,2,1'],
  budget: ['1,2,15'],
  players: {
    10: { first_name: 'Sam', last_name: 'Ace', position: 'WR', team: 'LAC', sport: 'nfl' },
    20: { first_name: 'Jo', last_name: 'Bee', position: 'TE', team: 'SF', sport: 'nfl' },
    DAL: { first_name: 'Dallas', last_name: 'Cowboys', position: 'DEF', team: 'DAL', sport: 'nfl' },
    30: { first_name: 'Cut', last_name: 'Player', position: 'K', team: 'NO', sport: 'nfl' },
  },
  names: { 1: 'alpha', 2: 'beta', 3: 'gamma' },
};

test('sides: each team gets what is added to it, picks and FAAB included, and a drop with no add is a drop', () => {
  const [alpha, beta] = chatView.sides(trade);
  assert.equal(alpha.name, 'alpha');
  assert.deepEqual(JSON.parse(JSON.stringify(alpha.assets)), [
    { type: 'player', id: '10', add: true },
    { type: 'player', id: '30', add: false },
    { type: 'pick', season: '2027', round: 1, via: 'gamma' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(beta.assets)), [
    { type: 'player', id: '20', add: true },
    { type: 'player', id: 'DAL', add: true },
    { type: 'pick', season: '2028', round: 2, via: null },
    { type: 'faab', amount: '15' },
  ]);
});

test('sides: a team whose owner has not loaded falls back to its roster number', () => {
  assert.equal(chatView.sides({ ...trade, names: {} })[0].name, 'Team 1');
});

test('tradeHtml: names each team and writes out every asset, a defense by its logo', () => {
  const html = chatView.tradeHtml(trade);
  assert.match(html, /A trade has been completed\./);
  for (const text of ['@alpha', '@beta', 'S\\. Ace', 'WR - LAC', 'J\\. Bee', 'Dallas Cowboys', '2027 1st', 'via gamma', '2028 2nd', 'Draft pick', 'FAAB']) {
    assert.match(html, new RegExp(text));
  }
  assert.match(html, /content\/nfl\/players\/thumb\/10\.jpg/);
  assert.match(html, /team_logos\/nfl\/dal\.png/);
  assert.equal(html.match(/snp-tr-sign drop/g).length, 1);
});

test('tradeHtml: other sports use their own headshots, and text is escaped', () => {
  const html = chatView.tradeHtml({ status: 'pending', rosterIds: [1], adds: { 5: 1 }, players: { 5: { last_name: '<b>Lee', sport: 'nba', position: 'PG' } }, names: { 1: '<i>x' } });
  assert.match(html, /waiting to process/);
  assert.match(html, /content\/nba\/players\/thumb\/5\.jpg/);
  assert.ok(!html.includes('<b>Lee') && !html.includes('<i>x'));
});

test('tradeHtml: Sleeper\'s own message text wins, and only a trade with a dialog says it opens one', () => {
  const rows = chatView.tradeHtml({ title: 'The trade went through.', status: 'complete', rosterIds: [1], adds: {}, names: {} });
  assert.match(rows, /The trade went through\./);
  assert.doesNotMatch(rows, /View this trade/);
  assert.match(chatView.tradeHtml({ status: 'complete', opens: true, rosterIds: [1], adds: {}, names: {} }), /title="View this trade"/);
});

test('tradeHtml: a player the trade has no details for still shows', () => {
  assert.match(chatView.tradeHtml({ status: 'complete', rosterIds: [1], adds: { 7: 1 }, players: {} }), /Player 7/);
});
