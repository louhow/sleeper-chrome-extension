// The NBA Players tab's data, answered for page-hook.js (see bridge.js), which
// adds the columns to Sleeper's own table: what-if scoring's adminFPTS and
// adminDelta, the week view's games played and best or worst games, and the
// week strip. Answers come there and then, or null while a week loads
// ('snp:week-games-ready' follows once it has).
(globalThis.SNP ||= {}).nbaPlayers = ({ state, api }) => {
  const { model, scoring, bridge, loaders } = globalThis.SNP;
  const seasonType = (season) => (season === state.league?.season ? state.league.season_type || 'regular' : 'regular');
  const settings = () => state.league?.scoring_settings || {};
  const ready = () => bridge.tell('snp:week-games-ready');

  // A week's per-game stat rows, once per page load; null while they load.
  const statRows = {}; // `${season}|${week}` -> rows, or the load in flight
  function weekStatRows(season, week) {
    const key = `${season}|${week}`;
    statRows[key] ||= api.get(`/stats/nba/${season}/${week}?season_type=${seasonType(season)}`)
      .then((rows) => { statRows[key] = rows || []; })
      .catch(() => { statRows[key] = []; })
      .finally(ready);
    return Array.isArray(statRows[key]) ? statRows[key] : null;
  }

  // A week's games, from a loaded week, else one scores query; undefined while it loads.
  const schedules = {};
  function weekScores(season, week) {
    const key = `${season}|${week}`;
    schedules[key] ||= api.graphql(`scores (week ${week})`, loaders.scoresQuery('nba', seasonType(season), season, week, 'date game_id metadata status start_time'))
      .then((data) => { schedules[key] = data?.scores || []; })
      .catch(() => { schedules[key] = []; })
      .finally(ready);
    return Array.isArray(schedules[key]) ? schedules[key] : undefined;
  }

  const stops = [
    // adminFPTS and adminDelta: what the changed settings add to each player's FPTS, and the rank shifts.
    bridge.answer('snp:admin-scores', ({ stats, view, base }) =>
      model.adminDeltas({ overrides: state.whatIf.overrides, league: settings(), stats, view, base }, scoring.scoreStats)),

    // The week view: for Avg, how many games each player played ('played');
    // for Best and Worst, each player's best or worst game by the league's
    // scoring (as Sleeper's FPTS is).
    bridge.answer('snp:week-games', ({ season, week, mode }) => {
      const rows = weekStatRows(season, week);
      return rows && model.weekPicks(rows, mode, settings(), scoring.scoreStats);
    }),

    // The week strip: per team and day, where each game stands, with each
    // player's fantasy points and score tier per finished game (league scoring).
    bridge.answer('snp:week-schedule', ({ season, week }) => {
      const loaded = season === state.league?.season && state.weeks[week];
      const scores = loaded ? null : weekScores(season, week);
      if (!loaded && !scores) return null;
      return model.weekStrip({
        days: loaded ? loaded.days : model.weekDays(scores),
        byTeam: loaded ? loaded.gamesByTeam : model.gamesByTeam(scores),
        rows: weekStatRows(season, week),
        teams: Object.fromEntries(Object.entries(state.players || {}).filter(([, pl]) => pl.team).map(([id, pl]) => [id, pl.team])),
        settings: settings(),
        tiers: state.tiers,
        now: Date.now(),
      }, scoring.scoreStats);
    }),
  ];

  return { destroy: () => stops.forEach((stop) => stop()) };
};
