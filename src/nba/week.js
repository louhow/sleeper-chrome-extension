// An NBA league's week, as both the league's session and the sidebar
// (nav.js) load and add it up: its players, the week's matchups, games,
// projections and stats, each team's totals and the league median.
(globalThis.SNP ||= {}).nbaWeek = (() => {
  const { model, scoring, ui, loaders } = globalThis.SNP;
  const PLAYERS_KEY = 'players:nba:v4';
  // A matchup leg's fields: the lineup, Lock-In picks (starters_games) and Sleeper's points.
  const LEG_FIELDS = 'leg matchup_id roster_id round starters points max_points custom_points starters_games subs';

  // The fields the extension keeps of each NBA player.
  const toPlayer = (p) => ({
    name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    first: p.first_name,
    last: p.last_name,
    team: p.team,
    position: p.position,
    positions: p.fantasy_positions || [],
    injury: p.injury_status,
    years_exp: p.years_exp,
  });

  const players = (api, force = false) => loaders.players(api, 'nba', PLAYERS_KEY, toPlayer, force);

  // The week Sleeper is on (its display week), within the league's weeks.
  const currentWeek = (league, nbaState, maxWeek = Infinity) => {
    const min = league.settings?.start_week || 1;
    return Math.min(Math.max(Number(nbaState.display_week || nbaState.week || min), min), maxWeek);
  };

  // A week's matchups, games, projections and stats, scored with `settings`.
  // Raw rows stay so what-if scoring can rescore them.
  async function load(api, league, week, settings) {
    const { league_id: leagueId, season } = league;
    const seasonType = league.season_type || 'regular';
    const [matchups, projections, stats, scores] = await Promise.all([
      api.get(`/v1/league/${leagueId}/matchups/${week}`),
      api.get(`/projections/nba/${season}/${week}?season_type=${seasonType}`),
      api.get(`/stats/nba/${season}/${week}?season_type=${seasonType}`),
      api.graphql(`scores (week ${week})`, loaders.scoresQuery('nba', seasonType, season, week, 'date game_id metadata season season_type sport status start_time week')),
    ]);
    const games = scores?.scores || [];
    return {
      matchups: matchups || [],
      days: model.weekDays(games),
      gamesByTeam: model.gamesByTeam(games),
      games: games.map((g) => ({ start: g.start_time, status: g.status })),
      projRows: projections || [],
      statRows: stats || [],
      proj: model.pointsByGame(projections || [], settings, scoring.scoreStats),
      actual: model.pointsByGame(stats || [], settings, scoring.scoreStats),
    };
  }

  // A lineup's (ui.lineup) totals for its week, with each starter's lockState,
  // added up from Lock-In rules: points are each starter's locked game, else
  // their latest finished one (Sleeper's own leg or matchup points win when it
  // has them); the projection counts each starter's locked game, else the
  // final game of the week, played or projected. Sleeper's leg projection
  // (proj_points) is set before the week and never moves, so it isn't used.
  function side(s, l) {
    const states = {};
    for (const id of l.starters) {
      if (!ui.real(id)) continue;
      const days = model.playerDays(l.week, s.players[id]?.team, id);
      states[id] = { days, ...model.lockState(days, l.locks[id], s.now, l.started ? (game) => l.started(id, game) : null) };
    }
    const all = Object.values(states);
    // Sleeper's running total: each starter's locked game, else their latest finished one.
    const live = all.reduce((sum, st) => sum + st.livePoints, 0);
    const projected = all.reduce((sum, st) => sum + (st.counted ? st.points : model.lockInDefault(st.days) ?? 0), 0);
    // Sleeper's totals use the league's scoring; what-if scoring keeps the ones added up here.
    const server = ui.whatIfOn(s) ? null : l.leg ?? l.matchup;
    // The public matchup is cached for minutes, so with the (fresh) leg the total
    // is added up from its lineup instead; Sleeper's leg points (and custom points) still win.
    const points = !server ? live
      : l.leg ? l.leg.custom_points ?? l.leg.points ?? live
      : l.matchup?.custom_points ?? l.matchup?.points ?? live;
    return {
      l,
      states,
      points: points ?? 0,
      anyPoints: all.some((st) => st.locked || st.games.some((d) => d.game.status === 'complete')) || Boolean(server && (l.leg ? l.leg.points : l.matchup?.points)),
      // Sleeper's total can count what this can't see (logged out, locks are
      // unknown; a commissioner's custom points), so the projection moves with it.
      proj: projected + ((points ?? 0) - live),
      yetToPlay: all.filter((st) => st.yetToPlay).length,
    };
  }

  // The shown week's league median (model.leagueMedian) over every team with a
  // matchup that week; null when the league plays no median that week.
  function median(s) {
    if (!s.weeks?.[s.week] || !model.medianOn(s.league, s.week)) return null;
    const teams = (s.rosters || []).map((r) => ui.lineup(s, r.roster_id)).filter((l) => (l?.leg ?? l?.matchup)?.matchup_id != null)
      .map((l) => side(s, l)).map((sd) => ({ points: sd.anyPoints ? sd.points : null, proj: sd.proj }));
    return teams.length ? model.leagueMedian(teams) : null;
  }

  return { PLAYERS_KEY, LEG_FIELDS, toPlayer, players, currentWeek, load, side, median };
})();
