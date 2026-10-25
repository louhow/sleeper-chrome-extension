// The NFL Players tab's Last 5 column, answered for page-hook.js (see
// bridge.js): the five weeks played through the week picked (the week on now
// counts once a game in it has kicked off), each player's score per week
// (league scoring, colored by position), points per game over them, and for
// the week on now, where each team's game stands. Null until the weeks are in
// ('snp:week-games-ready' follows).
//   info: { currentWeek, tiers }, filled in once the session has them.
(globalThis.SNP ||= {}).nflPlayers = ({ api, league, info }) => {
  const { model, scoring, bridge, loaders } = globalThis.SNP;
  // The week on now is read again after this long; finished weeks are kept for the session.
  const LIVE_MS = 2 * 60e3;
  const ready = () => bridge.tell('snp:week-games-ready');
  const rowsCache = {};
  const scoresCache = {};

  // A week's stat rows; null until they first load (a refresh keeps showing what it had meanwhile).
  function weekRows(season, week) {
    const key = `${season}|${week}`;
    const hit = rowsCache[key];
    const live = String(season) === String(league.season) && week >= info.currentWeek;
    if (!hit || (live && Array.isArray(hit.rows) && Date.now() - hit.at > LIVE_MS)) {
      const load = api.get(`/stats/nfl/${season}/${week}?season_type=regular`)
        .then((rows) => { rowsCache[key] = { rows: rows || [], at: Date.now() }; })
        .catch(() => { rowsCache[key] = { rows: hit?.rows || [], at: Date.now() }; })
        .finally(ready);
      rowsCache[key] = { rows: hit?.rows ?? null, at: hit?.at ?? 0, load };
    }
    return rowsCache[key].rows;
  }

  // The week on now: each team's game, live, done or still to come, with its kickoff.
  function weekScores(season, week) {
    const key = `${season}|${week}`;
    const hit = scoresCache[key];
    if (!hit || (Array.isArray(hit.games) && Date.now() - hit.at > LIVE_MS && !hit.loading)) {
      scoresCache[key] = { games: hit?.games ?? null, at: hit?.at ?? 0, loading: true };
      api.graphql(`scores (week ${week})`, loaders.scoresQuery('nfl', 'regular', season, week, 'game_id metadata status start_time'))
        .then((data) => { scoresCache[key] = { games: data?.scores || [], at: Date.now() }; })
        .catch(() => { scoresCache[key] = { games: hit?.games || [], at: Date.now() }; })
        .finally(ready);
    }
    return scoresCache[key].games;
  }

  const stop = bridge.answer('snp:recent-weeks', ({ season, week }) => {
    if (info.currentWeek == null) return null;
    const current = String(season) === String(league.season) ? info.currentWeek : Infinity;
    const thisWeek = Number(week) >= current ? current : Number(week);
    const rowsNow = thisWeek === current ? weekRows(season, current) : [];
    // Before anything kicks off, the week on now has no stat rows yet.
    const end = thisWeek === current && Array.isArray(rowsNow) && !rowsNow.length ? current - 1 : thisWeek;
    const weeks = [];
    for (let w = Math.max(league.settings?.start_week || 1, end - 4); w <= end; w++) weeks.push(w);
    const rows = weeks.map((w) => weekRows(season, w));
    const games = end === current ? weekScores(season, current) : [];
    if (!rows.every(Array.isArray) || !games) return null;
    return model.recentWeeks({ season, weeks, rows, games, current, settings: league.scoring_settings || {}, tiers: info.tiers, now: Date.now() }, scoring.scoreStats);
  });

  return { destroy: stop };
};
