// The NBA player card's data: bio, real-life draft and contract (ESPN, espn-client.js), game logs,
// career, news, depth chart and transaction history, each part loading on its own and rendering as it
// arrives (card-view.js draws it). Kept for the session in `state.cards`.
(globalThis.SNP ||= {}).nbaCard = ({ state, api, leagueId, schedule }) => {
  const { loaders, espnClient, model } = globalThis.SNP;
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
    // The real-life draft and contract, from ESPN once the bio's name and birth date are in; each shows on its own.
    for (const kind of ['draft', 'contract']) {
      c[kind] = { status: 'loading' };
      bio.then((b) => espnClient[kind](api, { sport: 'nba', playerId, name: [b?.first_name, b?.last_name].filter(Boolean).join(' '), lastName: b?.last_name, birthDate: b?.birth_date, espnId: b?.espn_id }))
        .catch(() => ({ status: 'error' }))
        .then((d) => {
          c[kind] = d;
          schedule();
        });
    }
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
}`, { auth: true }), (data) => {
        c.history = data?.league_transactions_by_player ?? [];
        loadBoards(c.history);
      }, () => { c.historyError = true; });
    } else {
      c.historyError = true;
    }
  }

  // Every pick in the card's trades turns into a player once its draft is done: that draft's slots and picks,
  // one small pair of calls per season, kept for the session in `state.draftBoards` (null: nothing drafted yet).
  function loadBoards(history) {
    const seasons = new Set(history.filter((t) => t.type === 'trade').flatMap((t) => (t.draft_picks || []).map((p) => model.tradedPick(p).season)));
    for (const season of seasons) {
      if (season in state.draftBoards) continue;
      state.draftBoards[season] = undefined; // asked
      draftBoard(season)
        .catch((err) => {
          console.warn('[sleeper-nba-panel] draft board', err);
          return null;
        })
        .then((board) => {
          state.draftBoards[season] = board;
          schedule();
        });
    }
  }

  // A season's finished draft: it lives in the league of that season, found by walking back from this one.
  async function draftBoard(season) {
    let league = state.league;
    for (let hop = 0; league && hop < 5; hop++) {
      if (Number(league.season) < Number(season)) return null;
      if (Number(league.season) === Number(season)) {
        const drafts = (await api.get(`/v1/league/${league.league_id}/drafts`)).filter((d) => d.status === 'complete' && d.season === String(season));
        const draft = drafts.find((d) => d.draft_id === league.draft_id) || drafts[drafts.length - 1];
        if (!draft) return null;
        const [info, picks] = await Promise.all([api.get(`/v1/draft/${draft.draft_id}`), api.get(`/v1/draft/${draft.draft_id}/picks`)]);
        return info?.slot_to_roster_id ? { slotToRoster: info.slot_to_roster_id, picks } : null;
      }
      league = Number(league.previous_league_id) ? await api.get(`/v1/league/${league.previous_league_id}`) : null;
    }
    return null;
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
