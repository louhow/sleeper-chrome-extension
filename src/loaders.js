// League data both sports load the same way: rosters, who is logged in, a
// week's matchup legs and games, and the league's own score colors.
(globalThis.SNP ||= {}).loaders = (() => {
  const { model, scoring, ui } = globalThis.SNP;
  const TRANSACTION_FIELDS = 'adds drops leg roster_ids settings status transaction_id type created creator';

  // The logged-in user's roster (as owner or co-owner), or null.
  const myRoster = (rosters, me) => ui.myRoster({ rosters, me });

  // League users by user id.
  const usersById = (users) => Object.fromEntries(users.map((u) => [u.user_id, u]));

  // GraphQL `scores`: a week's games, with `fields` of each.
  const scoresQuery = (sport, seasonType, season, week, fields) => `query scores {
  scores(sport: ${JSON.stringify(sport)}, season_type: ${JSON.stringify(seasonType)}, season: ${JSON.stringify(String(season))}, week: ${Number(week)}) {
    ${fields}
  }
}`;

  // A league's loads; `tag` prefixes their console warnings.
  function leagueData(api, leagueId, tag) {
    const league = JSON.stringify(leagueId);
    return {
      // Rosters straight from Sleeper when logged in. The public REST endpoint is
      // cached at the CDN for up to ~10 minutes, so it can lag a save the user just made.
      async rosters() {
        if (api.loggedIn()) {
          try {
            const data = await api.graphql('league_rosters', `query league_rosters {
  league_rosters(league_id: ${league}) {
    roster_id owner_id co_owners players starters reserve taxi settings metadata
  }
}`, { auth: true });
            if (data?.league_rosters?.length) return data.league_rosters;
          } catch (err) {
            console.warn(`[${tag}] league_rosters unavailable, using the public endpoint`, err);
          }
        }
        return api.get(`/v1/league/${leagueId}/rosters`);
      },

      // Who is logged in, if anyone. Only used to decide which roster can be edited.
      async me() {
        if (!api.loggedIn()) return null;
        try {
          const data = await api.graphql('me', 'query me { me { user_id } }', { auth: true });
          return data?.me?.user_id ?? null;
        } catch (err) {
          console.warn(`[${tag}] could not identify the logged-in user`, err);
          return null;
        }
      },

      // A week's matchup legs (lineups, Sleeper's points and projections), with
      // `fields` of each. Needs the logged-in session; null when logged out or refused.
      async legs(week, fields) {
        if (!api.loggedIn()) return null;
        try {
          const data = await api.graphql(`matchup_legs (week ${week})`, `query matchup_legs {
  matchup_legs(league_id: ${league}, round: ${Number(week)}) {
    ${fields}
  }
}`, { auth: true });
          return data?.matchup_legs ?? null;
        } catch (err) {
          console.warn(`[${tag}] matchup_legs unavailable`, err);
          return null;
        }
      },
    };
  }

  // Score colors from the league itself (see model.scoreTiers): its starters'
  // games in the weeks just finished, latest first, this season and then the
  // last (the league's previous_league_id), scored with the league's settings,
  // until there are enough games (NFL: enough at every position), at most
  // TIER_WEEKS weeks. Kept in the extension's storage until a week finishes or
  // the scoring changes, so it's one load a week.
  const TIER_WEEKS = 8;
  const TIER_GAMES = 300;
  const TIER_VERSION = 1;
  async function loadTiers(api, league, currentWeek) {
    const sport = league.sport;
    const byPosition = sport === 'nfl';
    const settings = league.scoring_settings || {};
    const key = `tiers:${league.league_id}`;
    const sig = JSON.stringify([TIER_VERSION, league.season, currentWeek, Object.entries(settings).filter(([, v]) => v).sort()]);
    const { [key]: hit } = await chrome.storage.local.get(key);
    if (hit?.sig === sig) return hit.tiers;
    // Finished weeks, latest first: this season's, then the last regular season's.
    const weeks = [];
    for (let w = currentWeek - 1; w >= (league.settings?.start_week || 1); w--) weeks.push({ league, week: w });
    if (weeks.length < TIER_WEEKS && league.previous_league_id) {
      const prev = await api.get(`/v1/league/${league.previous_league_id}`).catch(() => null);
      const last = (prev?.settings?.playoff_week_start || 1) - 1;
      for (let w = last; w >= (prev?.settings?.start_week || 1) && weeks.length < TIER_WEEKS; w--) weeks.push({ league: prev, week: w });
    }
    const positionOf = (id, row) => row.player?.fantasy_positions?.[0] || row.player?.position || null;
    const enough = (samples) => {
      if (samples.length < TIER_GAMES) return false;
      if (!byPosition) return true;
      const counts = {};
      for (const x of samples) counts[x.position] = (counts[x.position] || 0) + 1;
      return Object.values(counts).every((n) => n >= model.TIER_MIN_GAMES);
    };
    const samples = [];
    let failed = false;
    // NBA weeks hold hundreds of games each; NFL weeks one a starter, so a few at a time.
    const batch = byPosition ? 4 : 1;
    for (let i = 0; i < weeks.length && !enough(samples); i += batch) {
      const loads = await Promise.all(weeks.slice(i, i + batch).map(({ league: l, week }) => Promise.all([
        api.get(`/v1/league/${l.league_id}/matchups/${week}`),
        api.get(`/stats/${sport}/${l.season}/${week}?season_type=regular`),
      ]).catch(() => {
        failed = true;
        return [[], []];
      })));
      for (const [matchups, rows] of loads) {
        const starters = new Set((matchups || []).flatMap((m) => m.starters || []).filter(ui.real));
        samples.push(...model.tierSamples(rows, starters, settings, scoring.scoreStats, positionOf));
      }
    }
    const tiers = model.scoreTiers(samples, { byPosition });
    // A week that didn't load is tried again next time, not kept for a week.
    if (tiers && !failed) chrome.storage.local.set({ [key]: { sig, tiers } });
    return tiers;
  }

  return { TRANSACTION_FIELDS, myRoster, usersById, scoresQuery, leagueData, loadTiers };
})();
