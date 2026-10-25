import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

// The extension's storage, in memory.
function memoryStorage() {
  const items = {};
  return {
    items,
    local: {
      get: async (key) => (key in items ? { [key]: items[key] } : {}),
      set: async (obj) => Object.assign(items, obj),
    },
  };
}

// An API client that answers from `routes` and counts what it was asked.
function fakeApi({ loggedIn = true, routes = {}, graphql = () => ({}) } = {}) {
  const calls = [];
  return {
    calls,
    loggedIn: () => loggedIn,
    get: async (path) => {
      calls.push(['get', path]);
      return routes[path];
    },
    cached: (path) => calls.push(['cached', path]),
    graphql: async (label, query) => {
      calls.push(['graphql', query]);
      return graphql(query);
    },
    graphqlAny: async (label, queries) => {
      for (const query of queries) {
        calls.push(['graphql', query]);
        try {
          return graphql(query);
        } catch {
          // The next fields.
        }
      }
      throw new Error('none took');
    },
  };
}

test('players: fetched once, then kept until forced', async () => {
  const storage = memoryStorage();
  const { loaders } = loadSnp({ chrome: { storage } });
  const api = fakeApi({ routes: { '/v1/players/nba': { 1: { full_name: 'A B', team: 'BOS' } } } });
  const toPlayer = (p) => ({ name: p.full_name, team: p.team });
  assert.deepEqual({ ...(await loaders.players(api, 'nba', 'players:nba:v4', toPlayer)) }, { 1: { name: 'A B', team: 'BOS' } });
  assert.ok(storage.items['players:nba:v4'].savedAt > 0);
  await loaders.players(api, 'nba', 'players:nba:v4', toPlayer);
  await loaders.players(api, 'nba', 'players:nba:v4', toPlayer, true);
  assert.deepEqual(api.calls.map(([kind]) => kind), ['get', 'cached', 'get']);
});

test('legs: one set of fields, or the first of a list Sleeper takes; null logged out', async () => {
  const { loaders } = loadSnp();
  const legs = [{ roster_id: 1 }];
  const api = fakeApi({
    graphql: (query) => {
      if (query.includes('max_points')) throw new Error('Cannot query field "max_points"');
      return { matchup_legs: legs };
    },
  });
  const data = loaders.leagueData(api, '42', 'test');
  assert.equal(await data.legs(3, ['leg max_points', 'leg points']), legs);
  assert.equal(api.calls.length, 2);
  assert.match(api.calls[1][1], /matchup_legs\(league_id: "42", round: 3\) \{\n    leg points\n  \}/);
  assert.equal(await data.legs(3, 'leg points'), legs);
  assert.equal(await loaders.leagueData(fakeApi({ loggedIn: false }), '42', 'test').legs(3, 'leg points'), null);
});
