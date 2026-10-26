// The NBA player card's data: bio, real-life draft (ESPN, draft.js), game logs,
// career, news, depth chart and transaction history, each part loading on its own and rendering as it
// arrives (card-view.js draws it). Kept for the session in `state.cards`.
(globalThis.SNP ||= {}).nbaCard = ({ state, api, leagueId, schedule }) => {
  const { loaders, draft } = globalThis.SNP;
  // Career seasons fetched for the player card (one request each).
  const CAREER_SEASONS = 10;
  const CARD_SEASON_TABS = 6;
  let pending = null; // a card asked for before the league finished loading

  // Opens a player's card. `back` is a dialog the card opens over, shown again when the card closes.
  function open(playerId, back = null) {
    if (!state.ready) {
      // Clicked from the Players or Trend tab before the league loaded: open once it has.
      pending = playerId;
      return;
    }
    state.modal = { kind: 'player', playerId, season: null, back };
    state.notice = null;
    schedule();
    if (state.cards[playerId]) return;
    const c = (state.cards[playerId] = { logs: {} });
    const player = state.players[playerId] || {};
    const current = Number(state.league.season);
    const seasonsBack = Math.min(Math.max(Number(player.years_exp) || 0, 0), CAREER_SEASONS - 1);
    const years = Array.from({ length: seasonsBack + 1 }, (_, i) => current - i);
    c.careerYears = years.length;
    const id = encodeURIComponent(playerId);
    const part = (promise, apply, fallback) => promise
      .then(apply)
      .catch((err) => {
        console.warn('[sleeper-nba-panel] player card', err);
        fallback?.();
      })
      .finally(schedule);

    const bio = api.get(`/players/nba/${id}`);
    part(bio, (b) => { c.bio = b; });
    // The real-life draft, from ESPN once the bio's name and birth date are in; it shows on its own.
    c.draft = { status: 'loading' };
    bio.then((b) => draft.lookup(api, { sport: 'nba', playerId, name: [b?.first_name, b?.last_name].filter(Boolean).join(' '), lastName: b?.last_name, birthDate: b?.birth_date, espnId: b?.espn_id }))
      .catch(() => ({ status: 'error' }))
      .then((d) => {
        c.draft = d;
        schedule();
      });
    part(Promise.all(years.map((season) => api.get(`/stats/nba/player/${id}?season_type=regular&season=${season}`)
      .then((row) => ({ season, team: row?.team, stats: row?.stats || null }))
      .catch(() => ({ season, stats: null })))), (rows) => {
      c.career = rows;
      c.seasons = [current, ...rows.filter((r) => r.season !== current && r.stats?.gp).map((r) => r.season)].slice(0, CARD_SEASON_TABS);
    }, () => { c.career = []; c.seasons = [current]; });
    loadLog(playerId, current);
    part(api.graphql('get_player_news', `query get_player_news {
  get_player_news(sport: "nba", player_id: ${JSON.stringify(playerId)}, limit: 10) { metadata player_id published source source_key sport }
}`), (data) => { c.news = data?.get_player_news ?? []; }, () => { c.news = []; });
    if (player.team) {
      part(api.get(`/players/nba/${encodeURIComponent(player.team)}/depth_chart`), (chart) => { c.depth = chart || {}; }, () => { c.depth = {}; });
    }
    if (api.loggedIn()) {
      part(api.graphql('league_transactions_by_player', `query league_transactions_by_player {
  league_transactions_by_player(league_id: ${JSON.stringify(leagueId)}, player_id: ${JSON.stringify(playerId)}) {
    ${loaders.TRANSACTION_FIELDS} metadata draft_picks
  }
}`, { auth: true }), (data) => { c.history = data?.league_transactions_by_player ?? []; }, () => { c.historyError = true; });
    } else {
      c.historyError = true;
    }
  }

  // One season of a player's game log: played games plus projections.
  function loadLog(playerId, season) {
    const c = state.cards[playerId];
    if (!c || c.logs[season] || c.pendingLogs?.has(season)) return;
    (c.pendingLogs ||= new Set()).add(season);
    const query = `?season_type=regular&season=${Number(season)}&grouping=week`;
    const id = encodeURIComponent(playerId);
    Promise.all([api.get(`/stats/nba/player/${id}${query}`), api.get(`/projections/nba/player/${id}${query}`).catch(() => null)])
      .then(([stats, proj]) => { c.logs[season] = { stats, proj }; })
      .catch((err) => {
        console.warn('[sleeper-nba-panel] game log', err);
        c.logs[season] = { stats: {}, proj: {} };
      })
      .finally(() => {
        c.pendingLogs.delete(season);
        schedule();
      });
  }

  // A season tab on the open card; the season on screen stays until the new one loads.
  function showSeason(season) {
    const m = state.modal;
    const c = state.cards[m.playerId];
    const shown = m.season ?? c?.seasons?.[0] ?? Number(state.league.season);
    if (c?.logs[shown]) m.prevSeason = shown;
    m.season = season;
    loadLog(m.playerId, season);
    schedule();
  }

  // The league is in: the card asked for meanwhile opens.
  function ready() {
    if (pending) open(pending);
    pending = null;
  }

  return { open, showSeason, ready };
};
