// An NFL league's week, loaded as the Team and Matchup tabs read it (panel.js)
// and as the sidebar does for a chopped league that isn't open (nba/nav.js):
// who's starting (the logged-in legs, else the public matchups), Sleeper's
// projections and stats scored with the league's settings, each team's game,
// and rostered and started percentages. Players' names, positions, teams and
// injuries come with the projection and stat rows.
//   load(api, data, league, week, currentWeek, { research }) -> { players, week: { matchups, legs, teamOf, proj, actual, stats, games, days, research } }
//   data: loaders.leagueData for the league (its legs).
(globalThis.SNP ||= {}).nflWeek = (() => {
  const LEG_FIELDS = 'leg matchup_id roster_id round starters points proj_points custom_points';

  async function load(api, data, league, week, currentWeek, { research: withResearch = true } = {}) {
    const { model, scoring, loaders } = globalThis.SNP;
    const season = league.season;
    const type = league.settings?.type ?? 0;
    const [matchups, projRows, statRows, scores, research, legs] = await Promise.all([
      api.get(`/v1/league/${league.league_id}/matchups/${week}`),
      api.get(`/projections/nfl/${season}/${week}?season_type=regular`),
      week <= currentWeek ? api.get(`/stats/nfl/${season}/${week}?season_type=regular`) : [],
      api.graphql(`scores (week ${week})`, loaders.scoresQuery('nfl', 'regular', season, week, 'game_id metadata status start_time'))
        .then((d) => d?.scores || []).catch(() => []),
      withResearch ? api.get(`/players/nfl/research/regular/${season}/${week}?league_type=${type}`).catch(() => ({})) : {},
      data.legs(week, LEG_FIELDS),
    ]);
    const { players, teamOf, proj, actual, stats } = model.nflWeekPoints(projRows || [], statRows || [], league.scoring_settings || {}, scoring.scoreStats);
    const { games, days } = model.nflGames(scores);
    return { players, week: { matchups: matchups || [], legs, teamOf, proj, actual, stats, games, days, research: research || {} } };
  }

  return { load, LEG_FIELDS };
})();
