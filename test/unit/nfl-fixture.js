// An NFL league's state as nfl/panel.js builds it for nfl/panel-view.js: two teams in
// one matchup, a game finished, one live, one still to kick off, and a bye.
const at = (iso) => Date.parse(iso);
export const NOW = at('2026-10-25T18:30:00Z');

const games = {
  KC: { id: 'g1', home: 'KC', away: 'BUF', status: 'complete', start: at('2026-10-23T00:15:00Z'), homeScore: 27, awayScore: 20, left: 0 },
  BUF: null,
  DAL: { id: 'g2', home: 'DAL', away: 'PHI', status: 'in_game', start: at('2026-10-25T17:00:00Z'), homeScore: 7, awayScore: 10, clock: 'Q2 4:12', left: 0.6, redZone: 'DAL' },
  SF: { id: 'g3', home: 'SEA', away: 'SF', status: 'pre_game', start: at('2026-10-25T20:25:00Z') },
};
games.BUF = games.KC;
games.PHI = games.DAL;
games.SEA = games.SF;

export const week = () => ({
  matchups: [
    { roster_id: 1, matchup_id: 3, starters: ['qb1', 'rb1', 'wr1', '0'], points: 30.5 },
    { roster_id: 2, matchup_id: 3, starters: ['qb2', 'rb2', 'wr2', 'te2'], points: 12 },
  ],
  teamOf: {},
  days: ['2026-10-22', '2026-10-25'],
  games,
  actual: { qb1: 24.5, rb1: 6, qb2: 12 },
  proj: { qb1: 21.2, rb1: 14, wr1: 11.5, bn1: 8, bn2: 3, qb2: 18, rb2: 9.5, wr2: 10, te2: 7 },
  stats: { qb1: { pass_att: 30, pass_cmp: 21, pass_yd: 260, pass_td: 2 }, rb1: { rush_att: 8, rush_yd: 41 } },
  research: { qb1: { started: 88.2, owned: 99.1 } },
});

const player = (name, position, team, extra = {}) => {
  const [first, ...rest] = name.split(' ');
  return { name, first, last: rest.join(' '), position, positions: [position], team, ...extra };
};

export const state = (overrides = {}) => ({
  page: 'team',
  tab: 'page',
  now: NOW,
  week: 7,
  minWeek: 1,
  maxWeek: 18,
  editableWeek: 7,
  optimizable: false,
  tiers: { all: [8, 16], positions: {} },
  league: { roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'BN'], settings: { reserve_slots: 2, taxi_slots: 1 } },
  usersById: {
    u1: { display_name: 'louhow', metadata: { team_name: 'Gridiron <Gang>' }, avatar: 'abc' },
    u2: { display_name: 'rival', metadata: { team_name: 'Blitz' } },
  },
  rosters: [
    { roster_id: 1, owner_id: 'u1', settings: { wins: 4, losses: 2 }, players: ['qb1', 'rb1', 'wr1', 'bn1', 'bn2', 'bn3', 'ir1'], reserve: ['ir1'], taxi: [] },
    { roster_id: 2, owner_id: 'u2', settings: { wins: 3, losses: 3 }, players: ['qb2', 'rb2', 'wr2', 'te2'], reserve: [], taxi: [] },
  ],
  rosterId: 1,
  players: {
    qb1: player('Patrick Mahomes', 'QB', 'KC'),
    rb1: player('CeeDee Lamb', 'RB', 'DAL', { injury: 'Questionable' }),
    wr1: player('Brandon Aiyuk', 'WR', 'SF'),
    bn1: player('Bench Kicker', 'K', 'SF'),
    bn2: player('Mystery Man', 'XX', 'DAL'),
    bn3: { name: 'Buffalo Bills', position: 'DEF', positions: ['DEF'], team: 'BUF' },
    ir1: player('Hurt Back', 'RB', 'BUF', { injury: 'IR' }),
    qb2: player('Josh Allen', 'QB', 'BUF'),
    rb2: player('Saquon Barkley', 'RB', 'PHI'),
    wr2: player('Jaxon Smith', 'WR', 'SEA'),
    te2: player('George Kittle', 'TE', 'SF'),
  },
  weeks: { 7: week() },
  failedAvatars: new Set(),
  openCalls: new Set(),
  ...overrides,
});
