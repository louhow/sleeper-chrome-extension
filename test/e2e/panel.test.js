// Loads the unpacked extension into headless Chromium. sleeper.com redirects logged-out
// visitors away from league pages, so the page document is a stand-in that mirrors the
// markup of Sleeper's empty NBA Team tab; API calls stay live.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = fileURLToPath(new URL('../../test-results/', import.meta.url));
const LEAGUE = process.env.SLEEPER_LEAGUE_ID || '1374952493246611456';
const TEAM_URL = `https://sleeper.com/leagues/${LEAGUE}/team`;
const MATCHUP_URL = `https://sleeper.com/leagues/${LEAGUE}/matchup`;
const PLAYERS_URL = `https://sleeper.com/leagues/${LEAGUE}/players`;
const panel = (sel = '') => `#sleeper-nba-panel ${sel}`;
const dialog = (sel = '') => `#sleeper-nba-dialog ${sel}`;

// Same structure, classes and sizes as the logged-in page (inspected 2026-10-19).
const TEAM_TAB = `<!doctype html><title>Sleeper</title>
<style>
  body { margin: 0; background: rgb(16, 33, 49); font-family: Lato, Arial, sans-serif; color: #fff; }
  .center-panel { position: absolute; left: 264px; top: 100px; width: 800px; height: 698px; display: flex; flex-direction: column; overflow: hidden; background: rgba(58, 70, 91, .5); border-radius: 16px; }
  .league-panel { display: flex; flex-direction: column; height: 696px; overflow: hidden; }
  .league-panel-tabs-wrapper { height: 696px; }
  .postdraft-panel { display: flex; flex-direction: column; height: 696px; }
  .center-tab-selector { display: flex; gap: 16px; height: 40px; padding: 24px; }
  .center-tab-selector div { padding: 10px 16px; border-radius: 10px; background: #3a3f4b; color: #f6b26b; font-weight: 800; }
  .center-tab-selector .selected { background: #f6b26b; color: #1a2233; }
  .empty-panel-container { display: flex; flex-direction: column; align-items: center; height: 242px; }
  .footer { position: absolute; bottom: 0; left: 0; right: 0; height: 95px; text-align: center; }
</style>
<template id="app"><div class="center-panel"><div class="league-panel"><div class="league-panel-tabs-wrapper"><div class="postdraft-panel">
  <div class="center-tab-selector"><div class="item-tab">MATCHUP</div><div class="item-tab selected">TEAM</div><div class="item-tab">LEAGUE</div><div class="item-tab">PLAYERS</div></div>
  <div><div class="empty-panel-container"><p>Team panel not yet available for NBA fantasy.</p><p>Please use the Sleeper mobile app</p><div class="footer">Responsible Play</div></div></div>
</div></div></div></div></template>
<script>
  // Like Sleeper's React app: the tab (and its placeholder) render after load.
  setTimeout(() => document.body.append(document.getElementById('app').content.cloneNode(true)), 150);
</script>`;
// Sleeper's NBA League tab: its own content (the teams list) in .league-tab-container,
// which the week's matchups go on top of. Its MATCHUP tab routes like Sleeper's
// router does, and the Matchup tab shows the placeholder the panel fills.
const LEAGUE_TAB = TEAM_TAB.replace('<template id="app">', `<template id="league"><div class="center-panel"><div class="league-panel"><div class="league-panel-tabs-wrapper"><div class="postdraft-panel">
  <div class="center-tab-selector"><div class="item-tab">MATCHUP</div><div class="item-tab">TEAM</div><div class="item-tab selected">LEAGUE</div><div class="item-tab">PLAYERS</div></div>
  <div class="scrollbar-container" style="flex: 1; overflow: auto"><div class="league-tab-container"><div class="panel-row"><div class="league-members-container"><div class="header"><div>Team</div><div class="text">League is full</div></div></div></div></div></div>
</div></div></div></div></template>
<template id="app">`).replace("setTimeout(() => document.body.append(document.getElementById('app').content.cloneNode(true)), 150);", `setTimeout(() => {
    const onLeague = /\\/league$/.test(location.pathname);
    document.body.append(document.getElementById(onLeague ? 'league' : 'app').content.cloneNode(true));
  }, 150);
  // Sleeper's tabs route: Matchup and Team show the placeholder the panel fills, League its own content.
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.item-tab');
    const page = tab && { MATCHUP: 'matchup', TEAM: 'team', LEAGUE: 'league' }[tab.textContent];
    if (!page) return;
    history.pushState({}, '', location.pathname.replace(/[a-z]+$/, page));
    document.querySelector('.center-panel').replaceWith(document.getElementById(page === 'league' ? 'league' : 'app').content.cloneNode(true));
  });`);
const FAKE_TOKEN = 'e2e-fake-session-token';
const LOGGED_IN = TEAM_TAB.replace('<title>Sleeper</title>', `<title>Sleeper</title><script>localStorage.setItem('token', '${FAKE_TOKEN}')</script>`);
const LOGGED_OUT = TEAM_TAB.replace('<title>Sleeper</title>', "<title>Sleeper</title><script>localStorage.removeItem('token')</script>");
const NO_PLACEHOLDER = '<!doctype html><title>Sleeper</title><body style="margin:0;background:rgb(16,33,49)"></body>';

// Sleeper's Players tab, reduced to what the extension touches: rows with W (waiver)
// and ADD buttons whose React props carry the player id and waiver status, and
// Sleeper's own click handler, which for NBA only shows a "not yet available" toast.
const playersTab = (rows) => `<!doctype html><title>Sleeper</title>
<script>localStorage.setItem('token', '${FAKE_TOKEN}')</script>
<style>
  body { margin: 0; background: rgb(16, 33, 49); font-family: Lato, Arial, sans-serif; color: #fff; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 24px; }
  .player-action-button { padding: 8px 10px; border-radius: 50%; background: #2a3346; cursor: pointer; }
</style>
<div id="list"></div>
<script>
  window.__sleeperToasts = 0;
  window.__sleeperCards = 0;
  // React 16 delegates at the document, after any capture listener on the window.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.player-action-button')) window.__sleeperToasts++;
    if (e.target.closest('.player-meta-container, .player-details')) window.__sleeperCards++;
  });
  // React 16 internals: a fiber chain whose props sit a few fibers up from the element.
  const fiber = (props, depth) => (depth ? { memoizedProps: {}, return: fiber(props, depth - 1) } : { memoizedProps: props });
  for (const p of ${JSON.stringify(rows)}) {
    const row = document.createElement('div');
    row.className = 'row';
    const button = document.createElement('div');
    button.className = 'link-button player-action-button ' + (p.status === 'waiver' ? 'waiver' : 'add');
    button.dataset.player = p.id;
    button.innerHTML = '<span class="button-text">' + (p.status === 'waiver' ? 'W' : 'ADD') + '</span>';
    // The action component's props sit two fibers up; the row's (with the player) three.
    button.__reactInternalInstance$test = fiber({ playerId: p.id, waiverStatus: { status: p.status, clearTime: 0 } }, 2);
    const meta = document.createElement('div');
    meta.className = p.trend ? 'player-details' : 'player-meta-container';
    meta.textContent = p.name;
    meta.__reactInternalInstance$test = fiber({ player: { player_id: p.id } }, 3);
    if (p.trend) {
      row.className = 'trending-list-item';
      row.append(meta);
    } else {
      row.append(button, meta);
    }
    document.getElementById('list').append(row);
  }
</script>`;

// Sleeper's NBA Players table (inspected 2026-10-22), reduced to its stateful
// component: per-player stats keyed by stat (`playerStatsMap`, with FPTS already
// scored as fpts_proj), the stat columns (`statKeys`), headers that toggle the
// sort, and a position filter. Its list component gets the filtered players,
// and each row component its player, as React props. Cells show a stat per game, as Sleeper's do.
// `state` overrides the table's state, e.g. Stats for a week: { statType: 'stat', statInterval: 1 }.
const playersTable = (players, state = {}, props = {}) => `<!doctype html><meta charset="utf-8"><title>Sleeper</title>
<style>
  body { margin: 0; background: rgb(16, 33, 49); font-family: Lato, Arial, sans-serif; color: #fff; }
  .integration-players-panel { position: absolute; left: 264px; top: 100px; width: 798px; }
  .stat-key-header, .player-list-item { display: flex; gap: 8px; padding: 10px 24px; }
  .stat-key-header { padding-left: 184px; }
  .integration-players-panel .stat-key-header { padding-left: 176px; }
  .player-list-item { width: 796px; overflow: hidden; box-sizing: border-box; padding: 0; gap: 0; }
  .owner-cell { flex: 0 0 32px; margin-left: 9px; }
  .player-meta-container { flex: 0 1 auto; min-width: 90px; white-space: nowrap; overflow: hidden; }
  .label, .cell { display: flex; align-items: center; flex: 0 0 60px; margin: 0 2px; cursor: pointer; font-size: 12px; }
  .cell { justify-content: center; }
  .stat-key-header { gap: 0; padding-top: 0; padding-bottom: 0; }
  .label span { text-transform: uppercase; }
  /* Sleeper's labels are 25px: 16px of text over 9px of padding. */
  .stat-key-header > .label { height: 16px; padding-bottom: 9px; line-height: 16px; }
  .name { width: 160px; }
  .filters button { margin: 0 4px 8px 24px; }
  .filter-row { display: flex; align-items: center; gap: 8px; margin: 0 0 8px 24px; }
  .header-top { display: flex; align-items: center; width: 750px; height: 48px; margin-left: 24px; }
  .header-top button { margin: 0 4px 0 0; }
  .player-search-wrapper { margin-left: 8px; }
  .player-search { width: 160px; height: 32px; border-radius: 20px; background: rgb(32, 38, 53); }
  .player-search input { width: 120px; height: 32px; padding-left: 8px; border: 0; background: none; color: #fff; }
  .name { font-weight: 700; }
  .owner { display: flex; gap: 4px; font-size: 9px; }
  .owner i { color: rgb(88, 167, 255); }
  .custom-checkbox-item { display: flex; align-items: center; }
  .custom-checkbox-item .meta { width: 0; margin-left: 10px; }
  .filter-item { display: flex; align-items: center; gap: 6px; }
  .custom-checkbox { width: 14px; height: 14px; border: 1px solid #888; border-radius: 3px; }
  .custom-checkbox.checked { background: #f5b469; }
  /* Sleeper's header is 42px, its labels the bottom 25px. */
  .table-header { height: 42px; padding-top: 16px; box-sizing: border-box; }
  .table-header:has(.section-header) { height: 58px; padding-top: 12px; }
  /* Sleeper's NFL rows: 52px, a position line and a game line under the name; its game line
     is inline-block while its red-zone mark is a flex box, which drops the mark onto a line of its own. */
  .player-list-item.nfl { height: 52px; align-items: center; }
  .player-list-item.nfl .name-container { font-size: 11px; }
  .player-list-item.nfl .name { font-size: 12px; line-height: 12px; }
  .player-list-item.nfl .position-container { font-size: 9px; line-height: 12px; }
  .player-list-item.nfl .game-schedule-live-description { display: inline-block; overflow: hidden; white-space: nowrap; font-size: 11px; min-height: 11px; opacity: 0.6; }
  .player-list-item.nfl .game-schedule-live-description .rz { display: flex; align-items: center; justify-content: center; padding: 2px; border-radius: 3px; background: #ff2a6d; font-weight: bold; font-size: 8px; margin: 0 3px; position: relative; top: -1px; }
  .player-list-item.nfl .owner { font-size: 9px; line-height: 12px; }
  .section-header { display: flex; height: 16px; font-size: 11px; font-weight: 700; }
</style>
<div class="integration-players-panel"><div class="filters"><div class="header-top"><button data-pos="ALL">ALL</button><button data-pos="PG">PG</button>
    <div class="player-search-wrapper"><div class="player-search"><input placeholder="Find player"></div></div></div>
  <div class="filter-panel open"><div class="filter-row"><div class="filter-dropdown"><div class="app-dropdown"></div></div>
    <div class="filter-item"><div class="custom-checkbox-item"><div class="custom-checkbox checked nba"><span class="checkmark"></span></div></div><div class="filter-label">Free agents</div></div>
  </div></div></div>
  <div class="player-table"><div class="table-header"><div class="stat-key-header nba"></div></div><div class="ReactVirtualized__Grid"></div></div></div>
<script>
  // Keys Sleeper has no label for print capitalized (and show uppercase).
  const LABELS = { fpts_proj: 'FPTS', fpts: 'FPTS', sp: 'MIN', pts: 'PTS', tpm: '3PM', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', to: 'TO',
    fgm: 'Fgm', fga: 'Fga', tpa: '3pa', ftm: 'Ftm', fta: 'Fta', GP: 'GP', Week: 'Week',
    rush_att: 'ATT', rush_yd: 'YD', rush_td: 'TD', rec: 'REC', rec_tgt: 'TAR', rec_yd: 'YD', rec_td: 'TD', pass_cmp: 'CMP', pass_att: 'ATT', pass_yd: 'YD', pass_td: 'TD' };
  const PLAYERS = ${JSON.stringify(players)};
  // Rostered players show their owner under the name, which makes the name area wider.
  // Owners are league users (a team name each); ownedPlayers maps player -> owner, as Sleeper's props do.
  const OWNERS = Object.fromEntries(PLAYERS.filter((p) => p.owner).map((p) => [p.id, p.owner]));
  const USERS = Object.fromEntries([...new Set(Object.values(OWNERS))].map((name, i) =>
    ['u' + i, { user_id: 'u' + i, display_name: name.split(' ')[0].toLowerCase(), avatar: null, metadata: { team_name: name } }]));
  const userOf = (name) => Object.values(USERS).find((u) => u.metadata.team_name === name);
  const fiberOf = (props, depth = 0) => (depth ? { memoizedProps: {}, return: fiberOf(props, depth - 1) } : { memoizedProps: props });
  const panel = {
    props: { leagueId: '${LEAGUE}', sport: 'nba', scoringSettings: { pts: 1, reb: 1 },
      usersInLeagueMap: USERS,
      rostersInLeague: Object.values(USERS).map((u, i) => ({ roster_id: i + 1, owner_id: u.user_id, players: Object.keys(OWNERS).filter((id) => OWNERS[id] === u.metadata.team_name) })),
      ownedPlayers: Object.fromEntries(Object.entries(OWNERS).map(([id, name]) => [id, userOf(name)])),
      ...${JSON.stringify(props)} },
    state: {
      playerStatsMap: Object.fromEntries(PLAYERS.map((p) => [p.id, p.stats])),
      // Sleeper's NBA projection columns; the ones a test doesn't set print "-".
      statKeys: ['fpts_proj', 'sp', 'pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'to'], statType: 'proj', sort: 'fpts_proj', positionFilter: 'ALL',
      season: '2026', statInterval: 'season',
      hideOwned: false, filterByUser: false, filterByUserMap: Object.fromEntries(Object.keys(USERS).map((id) => [id, false])),
      ...${JSON.stringify(state)},
    },
    setState(update, then) {
      this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) };
      render();
      this.componentDidUpdate?.();
      then?.();
    },
    fetched: [],
    _fetchData(props, state) {
      this.fetched.push([state.statType, state.statInterval]);
    },
  };
  // Sleeper's week dropdown: it keeps the value it was created with (as a
  // string, while its options are numbers) and shows the placeholder, the
  // season, when nothing matches.
  const OPTIONS = [{ name: 'Season', value: 'season' }, ...[1, 2, 3].map((n) => ({ name: 'Week ' + n, value: n }))];
  const dropdown = {
    state: { selectedValue: String(panel.state.statInterval) },
    setState(update) {
      this.state = { ...this.state, ...update };
      renderDropdown();
    },
  };
  function renderDropdown() {
    document.querySelector('.app-dropdown').textContent = OPTIONS.find((o) => o.value === dropdown.state.selectedValue)?.name || panel.state.season;
  }
  renderDropdown();
  document.querySelector('.app-dropdown').__reactInternalInstance$test = { memoizedProps: { className: 'app-dropdown' }, return: { memoizedProps: { options: OPTIONS }, stateNode: dropdown } };
  function render() {
    const { playerStatsMap: map, statKeys, sort, positionFilter, hideOwned, filterByUser, filterByUserMap } = panel.state;
    const owned = panel.props.ownedPlayers;
    // NFL: group headers over the columns, fixed-width boxes in a row, as Sleeper's are.
    if (panel.props.sections && !document.querySelector('.section-header')) {
      const head = document.createElement('div');
      head.className = 'section-header';
      head.innerHTML = panel.props.sections.map(([name, width], i) => '<div class="' + name + '" style="flex: 0 0 ' + width + 'px;' + (i ? '' : ' margin-left: 156px;') + '">' + name.toUpperCase() + '</div>').join('');
      document.querySelector('.table-header').prepend(head);
    }
    document.querySelector('.stat-key-header').innerHTML = statKeys.map((k) => '<div class="label nba" data-key="' + k + '"><span>' + (LABELS[k] || k) + '</span></div>').join('');
    const view = PLAYERS.filter((p) => positionFilter === 'ALL' || p.pos === positionFilter)
      .filter((p) => !(hideOwned && owned[p.id]) && !(filterByUser && !filterByUserMap[owned[p.id]?.user_id]))
      .map((p) => ({ player_id: p.id, team: p.team }));
    if (sort) view.sort((a, b) => (map[b.player_id][sort] || -1) - (map[a.player_id][sort] || -1));
    const grid = document.querySelector('.ReactVirtualized__Grid');
    grid.__reactInternalInstance$test = fiberOf({ players: view, playerStatsMap: map }, 3);
    const nfl = panel.props.sport === 'nfl';
    const game = (p) => (nfl ? '<div class="position-container">' + p.pos + ' - ' + p.team + '</div><div class="game-schedule-live-description">' + (p.game || 'Sun 1:00 PM') + (p.redZone ? '<span class="rz">RZ</span>' : '') + '</div>' : '');
    grid.innerHTML = view.map(({ player_id: id }) => '<div class="player-list-item' + (nfl ? ' nfl' : '') + '" data-id="' + id + '"><div class="owner-cell"></div><div class="player-meta-container"><div class="name-container"><div class="name">' + id + '</div>' + game(PLAYERS.find((p) => p.id === id)) +
      (OWNERS[id] ? '<div class="owner"><i class="fa fa-arrow-right">→</i><div>' + USERS[owned[id].user_id].display_name + '</div></div>' : '') + '</div></div>' +
      statKeys.map((k) => '<div class="cell nba">' + (map[id][k] == null ? '-' : (map[id][k] / (k === 'sp' ? 60 : 1) / (map[id].gp || 1)).toFixed(1)) + '</div>').join('') + '</div>').join('');
    for (const row of grid.children) row.__reactInternalInstance$test = { memoizedProps: {}, return: { memoizedProps: { player: { player_id: row.dataset.id } } } };
  }
  document.querySelector('.stat-key-header').addEventListener('click', (e) => {
    const key = e.target.closest('.label')?.dataset.key;
    if (key) panel.setState({ sort: panel.state.sort === key ? '' : key });
  });
  document.querySelector('.filters').addEventListener('click', (e) => {
    if (e.target.dataset.pos) panel.setState({ positionFilter: e.target.dataset.pos });
  });
  render();
  // React 16 internals: the panel div's fiber returns to the component's.
  document.querySelector('.integration-players-panel').__reactInternalInstance$test = { memoizedProps: {}, return: { memoizedProps: panel.props, stateNode: panel } };
</script>`;

// Sleeper's left sidebar, reduced to its league links: the item component's props
// (league, selectLeague) and the router's sit a few fibers up from the link, and
// Sleeper's own handler sends every league to /leagues/<id>.
const NFL_LEAGUE = '1354521766382292992';
const leagueNav = `<!doctype html><title>Sleeper</title>
<div id="nav"></div>
<script>
  window.__sleeperNav = [];
  window.__selected = [];
  const router = { push: (path) => history.pushState({}, '', path) };
  const fiber = (props, depth, rest) => (depth ? { memoizedProps: {}, return: fiber(props, depth - 1, rest) } : { memoizedProps: props, return: rest });
  for (const [id, sport] of [['${NFL_LEAGUE}', 'nfl'], ['${LEAGUE}', 'nba']]) {
    const link = document.createElement('a');
    link.className = 'link-button nav-league-item-wrapper';
    link.href = '/';
    link.dataset.sport = sport;
    link.innerHTML = '<div class="nav-league-item"><div class="league-title">' + sport + '</div></div>';
    const item = { league: { league_id: id, sport }, selectLeague: (x) => window.__selected.push(x), closeNavbar: () => {} };
    link.__reactInternalInstance$test = fiber(item, 2, fiber({ router, params: {} }, 5));
    document.getElementById('nav').append(link);
  }
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.nav-league-item-wrapper');
    if (!link) return;
    e.preventDefault();
    window.__sleeperNav.push(link.dataset.sport);
    history.pushState({}, '', '/leagues/' + link.__reactInternalInstance$test.return.return.memoizedProps.league.league_id);
  });
</script>`;

// Sleeper's own NFL Team tab, reduced to what Optimize lineup touches: the header's
// WAIVER and TRADE buttons, and a Team component whose React-style props hold the
// lineup and save actions, with one projection per roster row. updateMatchupLeg is
// recorded instead of saved, and can be told to refuse.
const NFL_TEAM_URL = `https://sleeper.com/leagues/${NFL_LEAGUE}/team`;
const NFL_PLAYERS = {
  qbA: ['Alpha QB', 'QB', 'KC', 22], rbPlayed: ['Early RB', 'RB', 'DET', 5], wrA: ['Alpha WR', 'WR', 'SEA', 9],
  rbB: ['Beta RB', 'RB', 'NYJ', 7], wrB: ['Beta WR', 'WR', 'MIA', 8],
  qbB: ['Beta QB', 'QB', 'LAR', 18, 'Questionable'], wrC: ['Gamma WR', 'WR', 'GB', 14],
  teOut: ['Hurt TE', 'TE', 'NYG', 20, 'Out'], rbBye: ['Bye RB', 'RB', 'CHI', null],
};
// Sleeper's own NFL League tab, reduced to its matchup cards (inspected
// 2026-10-25): each row's markup as Sleeper draws it, with the live numbers it
// works out; React-style props give the roster ids and, up the tree, the rosters
// and your user id. Clicking a card's header opens it (recorded in __nflOpened).
const NFL_LEAGUE_URL = `https://sleeper.com/leagues/${NFL_LEAGUE}/league`;
const nflLeagueTab = () => {
  const side = (t, flip) => `<div class="user${flip ? ' reverse' : ''}"><div class="matchup-owner-item"><div class="owner-container">
    <div class="row space-between"><div class="row"><div class="avatar-container"><div class="avatar" style="background-image: url(&quot;https://sleepercdn.com/avatars/thumbs/${t.av}&quot;)"></div></div>
    <div class="meta"><div class="team-name">@${t.owner}</div><div class="name">${t.team}</div></div></div>
    <div class="roster-score-and-projection-matchup"><div class="score">${t.score}</div></div></div>
    <div class="win-bar"><div style="height: 4px; width: ${t.win}%;"></div></div></div>
    <div class="bottom-row space-between"><div class="row"><div class="win-percentage-number">${t.win}%</div><div class="description">${t.record}</div></div>
    <div class="roster-score-and-projection-matchup"><div class="projections">${t.proj}</div></div></div></div></div>`;
  const pairs = [
    [{ r: 3, owner: 'someone', team: 'Moore\'s Law', score: '20.12', win: 31, record: '5-7', proj: '100.65', av: 'a3' }, { r: 4, owner: 'kjenn', team: 'KyKy', score: '-', win: 69, record: '7-5', proj: '110.04', av: 'a4' }],
    [{ r: 1, owner: 'louhow', team: 'Lou Point Conversion', score: '19.40', win: 90, record: '8-4', proj: '122.23', av: 'a1' }, { r: 2, owner: 'kalviar', team: 'Tank you, Jeremiah', score: '6.60', win: 10, record: '3-9', proj: '71.77', av: 'a2' }],
  ];
  return `<!doctype html><title>Sleeper</title>
<style>body { margin: 0; background: rgb(16, 33, 49); color: #fff; font-family: Lato, Arial, sans-serif; } /* Sleeper nests its cards' list in another. */ .league-tab-container { position: absolute; left: 264px; top: 100px; width: 750px; } .league-matchup-row-item { padding: 8px; border: 1px solid #456; margin: 4px 0; }</style>
<div class="league-tab-container"><div class="row"><div class="title">Matchups</div></div><div class="panel-row"><div class="league-matchups"><div class="league-matchups">
${pairs.map(([a, b]) => `<div class="league-matchup-row-item"><div class="matchup-header"><div class="matchup-row">${side(a)}<div class="vs-label"><div class="label">VS</div></div>${side(b, true)}</div></div></div>`).join('')}
</div></div><div class="league-tab-standings">Standings</div></div></div>
<script>
  window.__nflOpened = [];
  const league = { rosters: [1, 2, 3, 4].map((r) => ({ roster_id: r, owner_id: 'u' + r })), userId: 'u1' };
  const pairs = ${JSON.stringify(pairs.map(([a, b]) => [a.r, b.r]))};
  document.querySelectorAll('.league-matchup-row-item').forEach((row, i) => {
    row.__reactInternalInstance$test = { memoizedProps: {}, return: { memoizedProps: { rosterId1: pairs[i][0], rosterId2: pairs[i][1] }, return: { memoizedProps: league } } };
    const header = row.querySelector('.matchup-header');
    const open = () => window.__nflOpened.push(i);
    header.__reactInternalInstance$test = { memoizedProps: { onClick: open } };
    header.addEventListener('click', open);
  });
</script>`;
};

// `wrapped`: inside Sleeper's tab frame (its tab row and scroll container), which
// the extension's own Team and Matchup tabs take the place of. `token`: logged in.
const nflTeamTab = ({ wrapped = false, rosterId = 4, round = 7, token = false } = {}) => `<!doctype html><title>Sleeper</title>
${token ? `<script>localStorage.setItem('token', '${FAKE_TOKEN}')</script>` : "<script>localStorage.removeItem('token')</script>"}
<style>
  body { margin: 0; background: rgb(16, 33, 49); font-family: Lato, Arial, sans-serif; color: #fff; }
  .user-tab-menu { width: 680px; margin: 40px; padding: 20px; background: rgb(36, 45, 60); border-radius: 12px; }
  .user-tab-menu .row { display: flex; justify-content: space-between; align-items: center; }
  .actions { display: flex; }
  .btn-container { display: flex; flex-direction: column; align-items: center; width: 40px; height: 54px; margin-left: 16px; cursor: pointer; }
  .btn { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 40px; background: rgb(58, 70, 91); }
  .btn-text { margin-top: 4px; font-size: 10px; }
  .team-roster-item { padding: 6px 0; }
  .postdraft-panel { display: flex; flex-direction: column; width: 800px; height: 760px; margin: 20px 0 0 260px; background: rgb(36, 45, 60); border-radius: 12px; }
  .center-tab-selector { display: flex; gap: 8px; padding: 20px 24px; }
  .scrollbar-container { flex: 1; min-height: 0; overflow: auto; }
</style>
${wrapped ? `<div class="postdraft-panel"><div class="center-tab-selector"><span class="item-tab" onclick="history.pushState({}, '', '/leagues/${NFL_LEAGUE}/matchup')">MATCHUP</span><span class="item-tab" onclick="history.pushState({}, '', '/leagues/${NFL_LEAGUE}/team')">TEAM</span></div><div class="scrollbar-container"><div class="team-panel">` : ''}
<div class="user-tab-menu"><div class="row"><b>Lou Point Conversion</b><div class="actions">
  <div class="btn-container space"><div class="btn">W</div><div class="btn-text">WAIVER</div></div>
  <div class="btn-container space"><div class="btn">T</div><div class="btn-text">TRADE</div></div>
</div></div></div>
<div class="team-roster"></div>
${wrapped ? '</div></div></div>' : ''}
<script>
  window.__nflSaves = [];
  window.__nflFail = null;
  const players = ${JSON.stringify(NFL_PLAYERS)};
  const scoring = { rec_yd: 0.1 };
  const team = {
    memoizedProps: {
      sport: 'nfl', leagueId: '${NFL_LEAGUE}', round: ${round}, rosterId: ${rosterId}, isTeamOwner: true, disableEdit: false,
      league: { status: 'in_season' },
      roster: { roster_id: ${rosterId}, players: Object.keys(players), reserve: [], taxi: [] },
      hasTeamPlayedMap: { DET: 'complete' },
      playersMap: Object.fromEntries(Object.entries(players).map(([id, [name, pos, nflTeam, , injury]]) => [id, {
        first_name: name.split(' ')[0], last_name: name.split(' ')[1], position: pos, fantasy_positions: [pos], team: nflTeam, injury_status: injury || null,
      }])),
      updateMatchupLeg: async (...args) => {
        window.__nflSaves.push(args);
        if (window.__nflFail) return { errors: [window.__nflFail] };
        team.stateNode.state.starters = team.stateNode.state.starters.map((s, i) => ({ ...s, playerId: args[4][i] }));
        return {};
      },
      rosterUpdateStarters: async () => ({ errors: ['not in season'] }),
      // Sleeper's modal layer; the player card it gets is recorded.
      openModal: (el) => window.__nflModals.push({ type: el.type, playerId: el.props.selectedPlayerId, ids: el.props.playerIds, known: Boolean(el.props.playersMap[el.props.selectedPlayerId]) }),
    },
    stateNode: { state: { starters: [['QB', 'qbA'], ['RB', 'rbPlayed'], ['WR', 'wrA'], ['FLEX', 'rbB'], ['SUPER_FLEX', 'wrB']]
      .map(([slotPosition, playerId]) => ({ slotPosition, playerId })) } },
  };
  window.__nflModals = [];
  // Every player Sleeper knows, as its playersMap holds them all.
  team.memoizedProps.playersMap = new Proxy(team.memoizedProps.playersMap, { get: (map, id) => map[id] || (typeof id === 'string' ? { player_id: id, first_name: 'Any', last_name: id } : undefined) });
  // Sleeper's Team component opens its player card for a player id (Sleeper's own _onClickPlayerNews).
  team.stateNode.props = team.memoizedProps;
  team.stateNode._onClickPlayerNews = function (id) {
    this.props.openModal({ type: 'PlayerCard', props: { sport: 'nfl', playerIds: [id], selectedPlayerId: id, playersMap: this.props.playersMap, week: 7 } });
  };
  window.__nflTeam = team;
  const roster = document.querySelector('.team-roster');
  roster.__reactInternalInstance$test = { memoizedProps: {}, return: team };
  for (const [id, [name, , , proj]] of Object.entries(players)) {
    const row = document.createElement('div');
    row.className = 'team-roster-item';
    row.innerHTML = '<span class="player-name">' + name + '</span> <div class="projections">' + (proj ?? '-') + '</div>';
    row.querySelector('.projections').__reactInternalInstance$test = { memoizedProps: {}, return: { memoizedProps: {
      playerId: id, scoringSettings: scoring, proj: proj == null ? undefined : { opponent: 'OPP', stats: { rec_yd: proj * 10 } },
    } } };
    roster.append(row);
  }
</script>`;

let context;
let page;
const pageErrors = [];
let documentBody = LOGGED_OUT;

// Stand-in for Sleeper's authenticated GraphQL: everything that carries the
// session token is answered here and recorded, so tests never touch a real lineup.
const sleeper = {
  me: null, // user id of the roster under test
  legs: {}, // round -> matchup legs
  mutations: [],
  failNextMutation: false,
  rosters: null, // league rosters as the mock's Sleeper currently has them
  rostersLoading: null,
  claims: [], // waiver claims submitted through the mock
  injured: new Set(), // player ids the players feed reports as Out
  // When set, each team's first game of the week is reported as finished a few
  // hours ago, with projections standing in as stats, so Lock-In has something
  // to lock; every other game is still to come, `laterShift` ms later.
  midWeek: false,
  finished: new Set(),
  // When set, the finished games tipped off at this time instead (see seenThroughTipOff).
  tipAt: null,
  laterShift: 0,
  // When set, it is week 1 of the regular season and no game has tipped off yet.
  beforeTipoff: false,
  // When set, rewrites the weekly projection rows (and so mid-week stats, which stand in from them).
  projections: null,
  // When set, the weekly per-game stat rows, as-is.
  weekStats: null,
  // When set, Sleeper turns down the session: every logged-in call gets a 401.
  rejectSession: false,
};

// Picks each team's first game of week 1 up front, since the page loads scores
// and stats in parallel and both mocks need to agree.
async function startMidWeek() {
  const res = await fetch('https://sleeper.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query scores { scores(sport: "nba", season_type: "regular", season: "2026", week: 1) { game_id start_time metadata } }' }),
  });
  const { data } = await res.json();
  const firstByTeam = {};
  for (const g of data.scores.sort((a, b) => a.start_time - b.start_time)) {
    for (const t of [g.metadata?.home_team?.team, g.metadata?.away_team?.team]) firstByTeam[t] ??= g.game_id;
  }
  sleeper.finished = new Set(Object.values(firstByTeam));
  // Once the real week is underway (or over), later games may have been played
  // too: their tip-offs move on together, keeping their order and their days
  // (so they stay in the week), until the first is at least two hours away.
  const later = data.scores.filter((g) => !sleeper.finished.has(g.game_id)).map((g) => g.start_time);
  sleeper.laterShift = Math.max(0, Date.now() + 2 * 3600e3 - Math.min(...later));
  sleeper.midWeek = true;
  sleeper.tipAt = null;
}

// Lock-In needs the player starting when the game tipped off, and Sleeper keeps
// no lineup history, so the extension remembers the lineups it sees. Like a
// real visit, the page already open shows the lineup before the finished games
// tip off; then they tip off and the page is opened again.
async function seenThroughTipOff(ready) {
  await page.locator(panel(ready)).first().waitFor({ timeout: 30000 });
  sleeper.tipAt = Date.now();
  await page.reload();
  await page.locator(panel(ready)).first().waitFor({ timeout: 30000 });
}

function fakeMidWeek(scores) {
  for (const g of scores) {
    if (sleeper.finished.has(g.game_id)) {
      g.status = 'complete';
      g.start_time = sleeper.tipAt ?? Date.now() - 3 * 3600e3;
    } else {
      g.status = 'pre_game';
      g.start_time += sleeper.laterShift;
    }
  }
  return scores;
}

// Every game moves a day past now, keeping their order, and none has a score.
function fakeBeforeTipoff(scores) {
  const shift = Math.max(0, Date.now() + 24 * 3600e3 - Math.min(...scores.map((g) => g.start_time)));
  for (const g of scores) {
    g.status = 'pre_game';
    g.start_time += shift;
  }
  return scores;
}
async function seedLegs(round) {
  if (sleeper.legs[round]) return;
  const res = await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/matchups/${round}`);
  sleeper.legs[round] = (await res.json()).map((m) => ({
    leg: round, round, matchup_id: m.matchup_id, roster_id: m.roster_id, starters: m.starters,
    points: null, proj_points: 157.23, max_points: null, custom_points: null, starters_games: {}, subs: null,
  }));
}
async function answerGraphql(route) {
  const req = route.request();
  const auth = req.headers().authorization;
  if (!auth) {
    // Public queries like scores stay live, optionally doctored for mid-week or before tip-off.
    if (!(sleeper.midWeek || sleeper.beforeTipoff) || !/query scores\b/.test(req.postDataJSON().query)) return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    (sleeper.midWeek ? fakeMidWeek : fakeBeforeTipoff)(body.data.scores);
    return route.fulfill({ response: res, json: body });
  }
  assert.ok(auth.startsWith(FAKE_TOKEN), 'sends the page session token');
  if (sleeper.rejectSession) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"unauthorized"}' });
  const { query, variables } = req.postDataJSON();
  const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  if (/query me\b/.test(query)) return json({ data: { me: { user_id: sleeper.me } } });
  // Rosters live in the mock once fetched, so saves survive a reload like they do on Sleeper.
  // Concurrent calls share one fetch, so a late response can't overwrite a save.
  if (!sleeper.rosters) {
    sleeper.rostersLoading ??= fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/rosters`)
      .then((res) => res.json())
      .then((rosters) => {
        // The tests expect full active rosters with empty IR; the live league can move players to IR.
        for (const r of rosters) r.reserve = [];
        sleeper.rosters = rosters;
        sleeper.rostersLoading = null;
      });
    await sleeper.rostersLoading;
  }
  if (/query league_rosters\b/.test(query) && query.includes(NFL_LEAGUE)) {
    return json({ data: { league_rosters: await (await fetch(`https://api.sleeper.app/v1/league/${NFL_LEAGUE}/rosters`)).json() } });
  }
  if (/query matchup_legs\b/.test(query) && query.includes(NFL_LEAGUE)) return json({ data: { matchup_legs: null } });
  if (/query league_rosters\b/.test(query)) return json({ data: { league_rosters: sleeper.rosters } });
  if (/query league_transactions_filtered\b/.test(query)) {
    return json({ data: { league_transactions_filtered: sleeper.claims.filter((c) => c.status === 'pending') } });
  }
  const pairs = (keys = [], values = []) => (keys.length ? Object.fromEntries(keys.map((k, i) => [k, values[i]])) : null);
  if (/mutation (submit_waiver_claim|league_create_transaction)\b/.test(query)) {
    sleeper.mutations.push({ query, variables });
    const tx = {
      transaction_id: String(1000 + sleeper.mutations.length), leg: 1, roster_ids: variables.v_adds,
      adds: pairs(variables.k_adds, variables.v_adds), drops: pairs(variables.k_drops, variables.v_drops),
      settings: pairs(variables.k_settings, variables.v_settings),
    };
    if (/submit_waiver_claim/.test(query)) {
      sleeper.claims.push({ ...tx, type: 'waiver', status: 'pending' });
      return json({ data: { submit_waiver_claim: tx } });
    }
    const roster = sleeper.rosters.find((r) => r.roster_id === variables.v_adds[0]);
    roster.players = [...roster.players.filter((id) => !variables.k_drops.includes(id)), ...variables.k_adds];
    return json({ data: { league_create_transaction: { ...tx, type: 'free_agent', status: 'complete' } } });
  }
  if (/mutation (update|cancel)_waiver_claim\b/.test(query)) {
    sleeper.mutations.push({ query, variables });
    const claim = sleeper.claims.find((c) => c.transaction_id === query.match(/transaction_id: "(\d+)"/)[1]);
    if (/update_waiver_claim/.test(query)) claim.settings = pairs(variables.k_settings, variables.v_settings);
    else claim.status = 'cancelled';
    return json({ data: { [/update/.test(query) ? 'update_waiver_claim' : 'cancel_waiver_claim']: claim } });
  }
  if (/mutation roster_update_reserve\b/.test(query)) {
    sleeper.mutations.push({ query, variables });
    const roster = sleeper.rosters.find((r) => r.roster_id === Number(query.match(/roster_id: (\d+)/)[1]));
    roster.reserve = JSON.parse(query.match(/reserve: (\[[^\]]*\])/)[1]);
    return json({ data: { roster_update_reserve: roster } });
  }
  if (/mutation roster_update_taxi\b/.test(query)) {
    sleeper.mutations.push({ query, variables });
    const rosterId = Number(query.match(/roster_id: (\d+)/)[1]);
    const roster = sleeper.rosters.find((r) => r.roster_id === rosterId);
    roster.taxi = JSON.parse(query.match(/taxi: (\[[^\]]*\])/)[1]);
    return json({ data: { roster_update_taxi: roster } });
  }
  if (/query league_transactions_by_player\b/.test(query)) return json({ data: { league_transactions_by_player: [] } });
  const round = Number(query.match(/round: (\d+)/)?.[1]);
  if (!round) return json({ errors: [{ message: `unmocked: ${query.slice(0, 60)}` }] });
  await seedLegs(round);
  if (/query matchup_legs\b/.test(query)) return json({ data: { matchup_legs: sleeper.legs[round] } });
  if (/mutation update_matchup_leg\b/.test(query)) {
    sleeper.mutations.push({ query, variables });
    if (sleeper.failNextMutation) {
      sleeper.failNextMutation = false;
      return json({ errors: [{ message: 'Player is locked', path: ['update_matchup_leg'] }], data: null });
    }
    const rosterId = Number(query.match(/roster_id: (\d+)/)[1]);
    const leg = sleeper.legs[round].find((l) => l.roster_id === rosterId);
    leg.starters = JSON.parse(query.match(/starters: (\[[^\]]*\])/)[1]);
    if (variables.starters_games) leg.starters_games = JSON.parse(variables.starters_games);
    return json({ data: { update_matchup_leg: leg } });
  }
  return json({ errors: [{ message: `unmocked: ${query.slice(0, 60)}` }] });
}

before(async () => {
  mkdirSync(OUT, { recursive: true });
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await context.route('https://sleeper.com/**', (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: documentBody })
      : route.continue());
  await context.route('https://sleeper.com/graphql', answerGraphql);
  await context.route('https://api.sleeper.app/v1/players/nba', async (route) => {
    if (!sleeper.injured.size) return route.continue();
    const res = await route.fetch();
    const players = await res.json();
    for (const id of sleeper.injured) players[id].injury_status = 'Out';
    return route.fulfill({ response: res, json: players });
  });
  // Player card game logs arrive late, as on a slow connection, so tests see the loading state.
  await context.route(/api\.sleeper\.app\/(stats|projections)\/nba\/player\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return route.fallback();
  });
  await context.route('https://api.sleeper.app/v1/state/nba', async (route) => {
    // Both doctored weeks are week 1, whatever week it really is.
    if (!(sleeper.midWeek || sleeper.beforeTipoff)) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, json: { ...(await res.json()), season_type: 'regular', week: 1, display_week: 1 } });
  });
  await context.route(/api\.sleeper\.app\/projections\/nba\/\d+\/\d+/, async (route) => {
    if (!sleeper.projections) return route.continue();
    const res = await route.fetch();
    return route.fulfill({ response: res, json: sleeper.projections(await res.json()) });
  });
  await context.route('https://api.sleeper.app/stats/nba/**', async (route) => {
    // Only the weekly stats are doctored; the player card's own stats go through.
    if (!/\/stats\/nba\/\d+\/\d+/.test(route.request().url())) return route.fallback();
    // The doctored weeks are week 1; the weeks before (last season's, for score colors) are Sleeper's.
    if (!/\/stats\/nba\/\d+\/1(\?|$)/.test(route.request().url())) return route.continue();
    if (sleeper.weekStats) return route.fulfill({ json: sleeper.weekStats });
    if (sleeper.beforeTipoff) return route.fulfill({ json: [] });
    if (!sleeper.midWeek) return route.continue();
    const url = route.request().url().replace('/stats/', '/projections/');
    const raw = await (await fetch(url)).json();
    const projections = sleeper.projections ? sleeper.projections(raw) : raw;
    const stats = projections.filter((p) => sleeper.finished.has(p.game_id)).map((p) => ({ ...p, category: 'stat' }));
    return route.fulfill({ json: stats });
  });
  // Checks every frame what the user would see: Sleeper's placeholder, or a
  // half-built panel (anything before the first full render).
  await context.addInitScript(() => {
    window.__paint = { placeholder: false, partial: false, full: false };
    const tick = () => {
      const ph = document.querySelector('.empty-panel-container');
      if (ph && ph.offsetParent !== null) window.__paint.placeholder = true;
      const root = document.getElementById('sleeper-nba-panel')?.shadowRoot;
      if (root && !window.__paint.full) {
        if (root.querySelector('.card, .mu-head, .msg.error')) window.__paint.full = true;
        else if (root.querySelector('.root')?.childElementCount) window.__paint.partial = true;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (e) => pageErrors.push(String(e)));
});

after(async () => {
  await context?.close();
  assert.deepEqual(pageErrors, [], 'no uncaught page errors');
});

test('fills the empty Team tab in place', async () => {
  await page.goto(TEAM_URL);
  await page.locator(panel('.card .days')).first().waitFor({ timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => window.__paint), { placeholder: false, partial: false, full: true },
    "never paints Sleeper's placeholder or a half-built panel");
  assert.equal(await page.locator('.empty-panel-container').isVisible(), false, 'placeholder hidden');
  const box = await page.locator('#sleeper-nba-panel').boundingBox();
  const tabs = await page.locator('.center-tab-selector').boundingBox();
  assert.ok(box.y >= tabs.y + tabs.height - 1 && box.x >= 264 && box.x + box.width <= 1064, 'sits under the tab bar inside the center panel');
  assert.ok(box.y + box.height <= 798 + 1, 'does not overflow the center panel');
});

test('shows starters with a full week of days and real projections', async () => {
  const headings = await page.locator(panel('h3')).allTextContents();
  assert.deepEqual(headings.slice(0, 2), ['Starters', 'Bench']);
  for (const h of ['Injured Reserve', 'Taxi Squad', 'Draft Picks']) assert.ok(headings.includes(h), `missing ${h}`);
  const firstDays = page.locator(panel('.card')).first().locator('.day');
  assert.equal(await firstDays.count(), 7);
  const values = await page.locator(panel('.card .cell .v')).allTextContents();
  assert.ok(values.some((v) => /^\d+\.\d\d$/.test(v)), 'some game cells show projected points');
  const times = await page.locator(panel('.time')).allTextContents();
  assert.ok(times.some((t) => /^\d{1,2}:\d\d(am|pm)$/.test(t)), 'game times come from the scores query');
  assert.match(await page.locator(panel('.week-label')).textContent(), /Week \d+\s*[A-Z]{3} \d+-/);
  assert.match(await page.locator(panel('.team-card')).textContent(), /proj \d+\.\d\d/);
  assert.match(await page.locator(panel('.line2')).first().textContent(), /\d+% Start\s*\|\s*\d+% Rostered/);
  await page.screenshot({ path: `${OUT}team.png` });
  await page.locator(panel('.body')).evaluate((b) => { b.scrollTop = b.scrollHeight; });
  await page.screenshot({ path: `${OUT}team-bottom.png` });
});

test('team picker: every team A to Z with its avatar, switches roster and persists across reloads', async () => {
  const button = page.locator(panel('.team-pick .tp-button'));
  const names = await page.locator(panel('.tp-menu [data-pick-roster] b')).allTextContents();
  assert.ok(names.length > 1);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'alphabetical');
  assert.equal(await page.locator(panel('.tp-menu')).isVisible(), false);
  await button.click();
  await page.locator(panel('.tp-menu')).waitFor();
  await page.screenshot({ path: `${OUT}team-picker.png` });
  const ids = await page.locator(panel('.tp-menu [data-pick-roster]')).evaluateAll((els) => els.map((el) => el.dataset.pickRoster));
  const current = await button.getAttribute('data-roster');
  const other = ids.find((id) => id !== current);
  const before = await page.locator(panel('.team-name')).textContent();
  await page.locator(panel(`.tp-menu [data-pick-roster="${other}"]`)).click();
  await page.waitForFunction((b) => document.querySelector('#sleeper-nba-panel').shadowRoot.querySelector('.team-name').textContent !== b, before);
  await page.locator(panel('.tp-menu')).waitFor({ state: 'hidden' });
  await page.reload();
  await page.locator(panel('.card .days')).first().waitFor();
  assert.equal(await page.locator(panel('.team-pick .tp-button')).getAttribute('data-roster'), other);
});

test('week navigation loads the next week', async () => {
  const label = page.locator(panel('.week-label b'));
  const before = await label.textContent();
  await page.locator(panel('[data-action="next"]')).click();
  await page.waitForFunction((b) => document.querySelector('#sleeper-nba-panel').shadowRoot.querySelector('.week-label b').textContent !== b, before);
  await page.locator(panel('.card .days')).first().waitFor();
  await page.locator(panel('[data-action="prev"]')).click();
  await page.waitForFunction((b) => document.querySelector('#sleeper-nba-panel').shadowRoot.querySelector('.week-label b').textContent === b, before);
});

test('logs every API call, including the GraphQL query', async () => {
  await page.locator(panel('[data-tab="api"]')).click();
  await page.locator(panel('ol.calls code')).first().waitFor();
  const paths = await page.locator(panel('ol.calls code')).allTextContents();
  for (const p of [`/v1/league/${LEAGUE}/rosters`, '/v1/players/nba', '/projections/nba/', '/stats/nba/', '/players/nba/research/', 'graphql scores', '/traded_picks']) {
    assert.ok(paths.some((x) => x.includes(p)), `missing ${p}`);
  }
  assert.ok(!(await page.locator(panel('.status.bad')).count()), 'no failed calls');
  await page.locator(panel('ol.calls summary')).filter({ hasText: 'graphql scores' }).first().click();
  await page.locator(panel('pre.request')).waitFor();
  await page.screenshot({ path: `${OUT}api.png` });
  await page.locator(panel('[data-tab="page"]')).click();
});

test('unmounts on other league tabs and restores the placeholder', async () => {
  await page.evaluate((id) => history.pushState({}, '', `/leagues/${id}/trend`), LEAGUE);
  await page.locator('#sleeper-nba-panel').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.empty-panel-container').isVisible(), true);
  await page.evaluate(() => history.back());
  await page.locator(panel('.card')).first().waitFor();
});

test('floats when the page has no placeholder to fill', async () => {
  documentBody = NO_PLACEHOLDER;
  await page.goto(TEAM_URL);
  await page.locator('#sleeper-nba-panel.floating').waitFor({ timeout: 10000 });
  await page.locator(panel('.card .days')).first().waitFor();
  await page.screenshot({ path: `${OUT}floating.png` });
  documentBody = LOGGED_OUT;
});

const shadowText = (sel) => page.locator(panel(sel)).textContent();

test('logged in: swaps a bench player into the lineup', async () => {
  documentBody = LOGGED_IN;
  const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/rosters`)).json();
  const users = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/users`)).json();
  const mine = users.find((u) => u.display_name === 'louhow');
  sleeper.me = mine.user_id;
  const myRoster = rosters.find((r) => r.owner_id === mine.user_id);

  await page.goto(TEAM_URL);
  await pickRoster(myRoster.roster_id);
  await page.locator(panel('button.slot')).first().waitFor({ timeout: 30000 });
  assert.match(await shadowText('.rhead:first-of-type .hint'), /Tap a position to update your lineup/);
  assert.match(await shadowText('.team-card'), /proj 157\.23/, 'uses the server projection from matchup_legs');

  // Pick the first bench player, then the first highlighted starter slot.
  const benchSpot = page.locator(panel('.card button.slot.bn')).first();
  const benchId = (await benchSpot.getAttribute('data-spot')).slice(2);
  await benchSpot.click();
  await page.locator(panel('.card.selected')).waitFor();
  const target = page.locator(panel('.card.target button.slot[data-spot^="s:"]')).first();
  assert.ok(await target.count(), 'some starter slot accepts the bench player');
  assert.ok(await page.locator(panel('.card.dim')).count(), 'ineligible spots are dimmed');
  await page.screenshot({ path: `${OUT}swap-picking.png` });
  const slotIndex = Number((await target.getAttribute('data-spot')).slice(2));
  await target.click();

  await page.locator(panel('.notice.ok')).waitFor();
  const mutation = sleeper.mutations.at(-1);
  assert.match(mutation.query, new RegExp(`roster_id: ${myRoster.roster_id}, leg: 1, round: 1`));
  const saved = JSON.parse(mutation.query.match(/starters: (\[[^\]]*\])/)[1]);
  assert.equal(saved[slotIndex], benchId, 'bench player saved into the chosen slot');
  assert.deepEqual(mutation.variables, {}, 'no Lock-In picks are sent with a plain swap');
  await page.locator(panel(`button.slot[data-spot="s:${slotIndex}"]`)).waitFor();
  const starterNames = await page.locator(panel('.card button.slot[data-spot^="s:"]')).evaluateAll((els) =>
    els.map((el) => el.closest('.card').querySelector('.name').textContent));
  const players = await (await fetch('https://api.sleeper.app/v1/players/nba')).json();
  assert.equal(starterNames[slotIndex], players[benchId].full_name, 'refetched lineup shows the new starter');
  await page.screenshot({ path: `${OUT}swap-saved.png` });
  await page.locator(panel('.notice.ok')).waitFor({ state: 'detached', timeout: 5000 });
});

test('logged in: a refused save shows the error and Escape cancels a pick', async () => {
  sleeper.failNextMutation = true;
  await page.locator(panel('.card button.slot.bn')).first().click();
  await page.locator(panel('.card.target button.slot')).first().click();
  await page.locator(panel('.notice.error')).waitFor();
  assert.match(await shadowText('.notice.error'), /Player is locked/);

  await page.locator(panel('.card button.slot.bn')).first().click();
  await page.locator(panel('.card.selected')).waitFor();
  await page.keyboard.press('Escape');
  await page.locator(panel('.card.selected')).waitFor({ state: 'detached' });
});

test('logged in: the API log tags authenticated calls and never shows the token', async () => {
  await page.locator(panel('[data-tab="api"]')).click();
  await page.locator(panel('ol.calls code')).first().waitFor();
  const paths = await page.locator(panel('ol.calls code')).allTextContents();
  for (const p of ['graphql me', 'graphql matchup_legs (week 1)', 'graphql update_matchup_leg (week 1)']) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
  assert.ok(await page.locator(panel('.auth')).count());
  await page.locator(panel('ol.calls summary')).filter({ hasText: 'update_matchup_leg' }).first().click();
  await page.locator(panel('pre.request')).first().waitFor();
  const html = await page.locator('#sleeper-nba-panel').evaluate((h) => h.shadowRoot.innerHTML);
  assert.ok(!html.includes(FAKE_TOKEN), 'token never rendered');
  await page.locator(panel('[data-tab="page"]')).click();
  documentBody = LOGGED_OUT;
});

test('matchup: fills the Matchup tab with both teams', async () => {
  documentBody = LOGGED_OUT;
  await page.goto(MATCHUP_URL);
  await page.locator(panel('.mu-head')).waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.empty-panel-container').isVisible(), false);
  assert.match(await page.locator(panel('[data-tab="page"]')).textContent(), /Matchup/);
  const head = await shadowText('.mu-head');
  assert.match(head, /\d+% WIN.*VS.*\d+% WIN/s);
  assert.match(head, /\(#\d+\)/, 'standings rank');
  assert.equal(await page.locator(panel('.mu-row')).first().locator('.mp').count(), 2);
  assert.ok(await page.locator(panel('.chip img')).count(), 'team logos for the week');
  assert.ok(!(await page.locator(panel('[data-lock]')).count()), 'no lock controls when logged out');
  await page.screenshot({ path: `${OUT}matchup.png` });
  // The picker picks a matchup: both teams, each with its avatar and name.
  const pick = page.locator(panel('.pair-pick'));
  const names = async (el) => (await el.locator('.tp-name').allTextContents()).map((x) => x.trim());
  const left = (await page.locator(panel('.mu-team.mine .team-name')).textContent()).trim();
  const right = (await page.locator(panel('.mu-team.theirs .team-name')).textContent()).trim();
  assert.deepEqual(await names(pick.locator('.tp-button')), [left, right], 'the matchup shown, left team first');
  await pick.locator('.tp-button').click();
  const options = pick.locator('.tp-menu [data-pick-roster]');
  const matchups = (await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/matchups/1`)).json()).filter((m) => m.matchup_id != null);
  assert.equal(await options.count(), new Set(matchups.map((m) => m.matchup_id)).size, 'one entry a matchup');
  for (let i = 0; i < await options.count(); i++) assert.equal((await names(options.nth(i))).length, 2, 'two teams an entry');
  assert.equal(await options.locator('.tp-avatar').count(), 2 * await options.count());
  await page.screenshot({ path: `${OUT}matchup-picker.png` });
  const [first] = await names(options.nth(0));
  const other = options.nth(1);
  const [a, b] = await names(other);
  await other.click();
  await page.locator(panel('.mu-team.mine .team-name')).filter({ hasText: a }).waitFor();
  assert.equal((await page.locator(panel('.mu-team.theirs .team-name')).textContent()).trim(), b);
  // Arrow keys go through the matchups and stop at the ends.
  await page.keyboard.press('ArrowUp');
  await page.locator(panel('.mu-team.mine .team-name')).filter({ hasText: first }).waitFor();
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  assert.equal((await page.locator(panel('.mu-team.mine .team-name')).textContent()).trim(), first, 'the first matchup stays');
});

test('matchup: switching to Team keeps the session and data', async () => {
  const calls = await page.locator(panel('[data-tab="api"] .count')).textContent();
  await page.evaluate((id) => history.pushState({}, '', `/leagues/${id}/team`), LEAGUE);
  await page.locator(panel('.team-card')).waitFor();
  assert.equal(await page.locator(panel('[data-tab="api"] .count')).textContent(), calls, 'no refetch');
});

test('matchup: locks in a finished game for your starter', async () => {
  documentBody = LOGGED_IN;
  await startMidWeek();
  sleeper.legs = {};
  const users = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/users`)).json();
  const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/rosters`)).json();
  sleeper.me = users.find((u) => u.display_name === 'louhow').user_id;
  const myRoster = rosters.find((r) => r.owner_id === sleeper.me);

  await page.goto(MATCHUP_URL);
  await seenThroughTipOff('.tp-button');
  await pickRoster(myRoster.roster_id);
  const open = page.locator(panel('.mp.mine button.lk.open:not(.maybe)'));
  await open.first().waitFor({ timeout: 30000 });
  assert.ok(!(await page.locator(panel('.mp.theirs button.lk')).count()), "no lock buttons on the opponent's side");
  await page.screenshot({ path: `${OUT}lock-open.png` });

  const ref = await open.first().getAttribute('data-lock');
  const [rosterId, playerId] = ref.split(':');
  assert.equal(Number(rosterId), myRoster.roster_id);
  const before = sleeper.mutations.length;
  // The header is Sleeper's running total: each starter's locked game, else their latest finished one.
  const headerPts = async () => Number((await page.locator(panel('.mu-team.mine .mu-pts')).textContent()).match(/\d+\.\d\d/)[0]);
  const headerBefore = await headerPts();
  await open.first().click();
  const go = page.locator(panel(`[data-lock-confirm="${ref}"]`));
  assert.match(await go.textContent(), /^Lock \d+\.\d\d$/);
  assert.notEqual(await go.textContent(), 'Lock 0.00', 'the finished game has stats');
  assert.equal(sleeper.mutations.length, before, 'nothing saved before confirming');
  await page.screenshot({ path: `${OUT}lock-confirm.png` });
  await go.click();

  await page.locator(panel('.notice.ok')).waitFor();
  assert.match(await shadowText('.notice.ok'), /^Locked .+: \d+\.\d\d$/);
  assert.equal(sleeper.mutations.length, before + 1);
  const { query, variables } = sleeper.mutations.at(-1);
  const locks = JSON.parse(variables.starters_games);
  assert.ok(sleeper.finished.has(locks[playerId]), 'locks the finished game');
  const leg = sleeper.legs[1].find((l) => l.roster_id === myRoster.roster_id);
  assert.match(query, new RegExp(`starters: ${JSON.stringify(leg.starters).replace(/[[\]]/g, '\\$&')}`), 'lineup unchanged');
  const card = page.locator(panel('.mp.mine.is-locked'));
  await card.first().waitFor();
  assert.equal(await card.first().locator('.lk.locked').count(), 1, 'shows the lock');
  assert.ok(Number((await card.first().locator('.mp-pts b').textContent()).trim()) > 0, 'the locked game counts');
  assert.ok(Math.abs(await headerPts() - headerBefore) < 0.01, `the finished game already counted, so the lock keeps the total (${headerBefore})`);
  await page.screenshot({ path: `${OUT}lock-done.png` });
  sleeper.midWeek = false;
  documentBody = LOGGED_OUT;
});

test('league tab: every matchup of the week on top of Sleeper\'s own content; a matchup opens on the Matchup tab, a team on its Team tab', async () => {
  documentBody = LEAGUE_TAB.replace('<title>Sleeper</title>', `<title>Sleeper</title><script>localStorage.setItem('token', '${FAKE_TOKEN}')</script>`);
  await startMidWeek();
  sleeper.legs = {};
  const users = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/users`)).json();
  sleeper.me = users.find((u) => u.display_name === 'louhow').user_id;
  await page.goto(`https://sleeper.com/leagues/${LEAGUE}/league`);
  const cards = page.locator(panel('.lg-match'));
  await cards.first().waitFor({ timeout: 30000 });
  const legs = sleeper.legs[1];
  assert.equal(await cards.count(), new Set(legs.map((l) => l.matchup_id)).size, 'one card per matchup');
  // Yours first, marked; each card is the Matchup tab's header: two teams, scores, win chances.
  const mine = legs.find((l) => sleeper.rosters?.find((r) => r.roster_id === l.roster_id)?.owner_id === sleeper.me) ?? legs[0];
  assert.match(await cards.first().getAttribute('class'), /\bown\b/);
  assert.equal(await cards.first().getAttribute('data-open-matchup'), String(mine.roster_id));
  for (const card of await cards.all()) {
    assert.equal(await card.locator('.mu-team').count(), 2);
    assert.match(await card.innerText(), /\d+% WIN[\s\S]*VS[\s\S]*\d+% WIN/);
  }
  // Sleeper's own League tab content stays, under the matchups.
  assert.equal(await page.evaluate(() => {
    const host = document.querySelector('#sleeper-nba-panel');
    return host.parentElement.className === 'league-tab-container' && host.nextElementSibling.className === 'panel-row';
  }), true);
  assert.equal(await page.locator('.league-members-container').isVisible(), true);
  // A 14-team league's 7 matchups fit in Sleeper's tab without scrolling.
  const fit = await page.evaluate(() => {
    const host = document.querySelector('#sleeper-nba-panel');
    const list = host.shadowRoot.querySelector('.lg-list');
    const box = document.querySelector('.scrollbar-container').getBoundingClientRect();
    return { bottom: list.getBoundingClientRect().bottom - box.top, room: box.height, cards: list.children.length };
  });
  assert.equal(fit.cards, 7);
  assert.ok(fit.bottom <= fit.room, `all ${fit.cards} fit (${Math.round(fit.bottom)} of ${Math.round(fit.room)}px)`);
  await page.screenshot({ path: `${OUT}league-matchups.png` });
  // A team's name (or avatar, or owner) opens its Team tab; "My team" comes back.
  const theirName = (await cards.nth(1).locator('.mu-team.theirs .team-name').textContent()).trim();
  await cards.nth(1).locator('.mu-team.theirs .team-name .team-link').click();
  await page.waitForURL(`**/leagues/${LEAGUE}/team`);
  await page.locator(panel('.team-card .team-name')).filter({ hasText: theirName }).waitFor({ timeout: 30000 });
  const back = page.locator(panel('.tools .my-team'));
  assert.match(await back.innerText(), /^←\s*My team$/);
  await page.screenshot({ path: `${OUT}team-someone-else.png` });
  // Arrow keys go through every team, A to Z, yours too, and stop at the first and the last.
  const teams = await page.evaluate(() => {
    const root = document.querySelector('#sleeper-nba-panel').shadowRoot;
    return [...root.querySelectorAll('.tp-menu [data-pick-roster]')].map((b) => b.querySelector('b').textContent.trim());
  });
  const shown = async () => (await page.locator(panel('.team-card .team-name')).textContent()).trim();
  const showing = (name) => page.locator(panel('.team-card .team-name')).filter({ hasText: name }).waitFor();
  const at = teams.indexOf(await shown());
  for (let i = at; i < teams.length - 1; i++) {
    await page.keyboard.press('ArrowDown');
    await showing(teams[i + 1]);
  }
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  assert.equal(await shown(), teams.at(-1), 'the last team stays');
  for (let i = teams.length - 1; i > 0; i--) {
    await page.keyboard.press('ArrowUp');
    await showing(teams[i - 1]);
  }
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  assert.equal(await shown(), teams[0], 'the first team stays');
  // Yours is on the way; from someone else's team, "My team" goes back.
  const myName = await page.evaluate((id) => document.querySelector('#sleeper-nba-panel').shadowRoot.querySelector(`.tp-menu [data-pick-roster="${id}"] b`).textContent.trim(), String(mine.roster_id));
  assert.ok(teams.includes(myName));
  if (teams[0] === myName) {
    await page.keyboard.press('ArrowDown');
    await showing(teams[1]);
  }
  await back.click();
  await page.locator(panel('.tools .my-team')).waitFor({ state: 'detached' });
  assert.equal(await page.locator(panel('.team-pick .tp-button')).getAttribute('data-roster'), String(mine.roster_id), 'your own team again');
  // Anywhere else on a matchup opens it on the Matchup tab, with that team on the left.
  await page.locator('.item-tab', { hasText: 'LEAGUE' }).click();
  await cards.first().waitFor({ timeout: 30000 });
  const other = cards.nth(1);
  const name = (await other.locator('.mu-team.mine .team-name').textContent()).trim();
  await other.locator('.mu-pts').first().click();
  await page.waitForURL(`**/leagues/${LEAGUE}/matchup`);
  const head = (sel) => panel(`.mu-head:not(.lg-match) ${sel}`);
  await page.locator(head('.mu-team.mine .team-name')).filter({ hasText: name }).waitFor({ timeout: 30000 });
  // On the Matchup tab too, the opponent's avatar opens their Team tab.
  const opponent = (await page.locator(head('.mu-team.theirs .team-name')).textContent()).trim();
  await page.locator(head('.mu-team.theirs .avatar.team-link')).click();
  await page.waitForURL(`**/leagues/${LEAGUE}/team`);
  await page.locator(panel('.team-card .team-name')).filter({ hasText: opponent }).waitFor({ timeout: 30000 });
  sleeper.midWeek = false;
  documentBody = LOGGED_OUT;
});

test('team: locks a finished game from its cell, after asking', async () => {
  documentBody = LOGGED_IN;
  await startMidWeek();
  sleeper.legs = {};
  const myRoster = await openMyTeam(TEAM_URL);
  // Opened after the finished games, the extension never saw who was starting then: maybe lockable, dashed.
  await page.locator(panel('.day.game.lockable.maybe button.cell[data-lock]')).first().waitFor({ timeout: 30000 });
  assert.equal(await page.locator(panel('.day.game.lockable:not(.maybe)')).count(), 0);
  assert.match(await page.locator(panel('.day.game.lockable.maybe')).first().getAttribute('title'), /only if they were starting at tip-off/);
  await page.screenshot({ path: `${OUT}team-lock-unseen.png` });
  // Seen before and after tip-off: lockable for sure.
  await seenThroughTipOff('.card');
  const cell = page.locator(panel('.day.game.lockable:not(.maybe) button.cell[data-lock]')).first();
  await cell.waitFor({ timeout: 30000 });
  assert.equal(await page.locator(panel('.day.game.lockable.maybe')).count(), 0);
  const ref = await cell.getAttribute('data-lock');
  const [rosterId, playerId] = ref.split(':');
  assert.equal(Number(rosterId), myRoster.roster_id);
  const card = page.locator(panel('.card')).filter({ has: page.locator(`img.headshot[data-player="${playerId}"]`) });
  // Hovering asks.
  assert.equal(await cell.locator('.ask').isVisible(), false);
  await cell.hover();
  assert.equal(await cell.locator('.ask').innerText(), 'Lock?');
  assert.equal(await cell.locator('.when').isVisible(), false);
  await page.screenshot({ path: `${OUT}team-lock-hover.png` });
  // Clicking confirms in the cell; No backs out without saving.
  const before = sleeper.mutations.length;
  await cell.click();
  const confirming = page.locator(panel('.day.confirming'));
  const score = (await confirming.locator('.ask').innerText()).match(/^Lock\s+(\d+\.\d\d)\?$/)[1];
  assert.notEqual(score, '0.00', 'the finished game has stats');
  await page.screenshot({ path: `${OUT}team-lock-confirm.png` });
  await confirming.locator('button.no').click();
  await confirming.waitFor({ state: 'detached' });
  assert.equal(sleeper.mutations.length, before, 'nothing saved');
  // Yes locks it.
  await page.locator(panel(`button.cell[data-lock="${ref}"]`)).click();
  await page.locator(panel(`.day.confirming [data-lock-confirm="${ref}"]`)).click();
  await page.locator(panel('.notice.ok')).waitFor();
  assert.match(await shadowText('.notice.ok'), new RegExp(`^Locked .+: ${score.replace('.', '\\.')}$`));
  assert.equal(sleeper.mutations.length, before + 1);
  const locks = JSON.parse(sleeper.mutations.at(-1).variables.starters_games);
  assert.ok(sleeper.finished.has(locks[playerId]), 'locks the finished game');
  await card.locator('.day.locked').waitFor();
  assert.equal(await card.locator('button.cell[data-lock]').count(), 0, 'nothing left to lock for them');
  // The PTS column: the locked score once, boxed in gold like its day cell.
  assert.equal((await card.locator('.week-pts.locked').textContent()).trim(), score);
  assert.equal(await card.locator('.week-pts.locked b').evaluate((el) => getComputedStyle(el).borderTopColor), 'rgb(255, 207, 58)');
  await page.screenshot({ path: `${OUT}team-lock-done.png` });
  sleeper.midWeek = false;
  documentBody = LOGGED_OUT;
});

async function openMyTeam(url) {
  const users = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/users`)).json();
  const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/rosters`)).json();
  sleeper.me = users.find((u) => u.display_name === 'louhow').user_id;
  const myRoster = rosters.find((r) => r.owner_id === sleeper.me);
  await page.goto(url);
  await pickRoster(myRoster.roster_id);
  await page.locator(panel('.taxi-head .hint')).waitFor({ timeout: 30000 });
  return myRoster;
}

// Shows a roster through the panel's team picker.
async function pickRoster(id) {
  await page.locator(panel('.team-pick .tp-button')).click();
  await page.locator(panel(`.tp-menu [data-pick-roster="${id}"]`)).click();
}

// Clicks bench players until one can trade with a taxi player; returns its id.
async function pickTaxiEligibleBenchPlayer() {
  const bench = page.locator(panel('.card button.slot.bn[data-spot^="b:"]'));
  for (let i = 0; i < await bench.count(); i++) {
    const ref = await bench.nth(i).getAttribute('data-spot');
    await bench.nth(i).click();
    await page.locator(panel(`.card.selected [data-spot="${ref}"]`)).waitFor();
    if (await page.locator(panel('.card.target button.slot.tx')).count()) return ref.slice(2);
    await page.keyboard.press('Escape');
    await page.locator(panel('.card.selected')).waitFor({ state: 'detached' });
  }
  return null;
}

test('taxi: before the season, an eligible bench player trades places with a taxi player', async () => {
  documentBody = LOGGED_IN;
  sleeper.midWeek = false;
  sleeper.beforeTipoff = true;
  const myRoster = await openMyTeam(TEAM_URL);
  assert.match(await shadowText('.taxi-head .hint'), /can move to taxi until the first game of the regular season tips off/);

  const benchId = await pickTaxiEligibleBenchPlayer();
  assert.ok(benchId, 'some bench player is taxi-eligible');
  const target = page.locator(panel('.card.target button.slot.tx[data-spot^="t:"]')).first();
  const taxiId = (await target.getAttribute('data-spot')).slice(2);
  await page.screenshot({ path: `${OUT}taxi-picking.png` });
  const before = sleeper.mutations.length;
  await target.click();

  await page.locator(panel('.notice.ok')).waitFor();
  const saved = sleeper.mutations.slice(before);
  assert.equal(saved.length, 1, 'only taxi changes; starters untouched');
  assert.match(saved[0].query, new RegExp(`roster_update_taxi\\(league_id: "${LEAGUE}", roster_id: ${myRoster.roster_id}, taxi: `));
  const taxi = JSON.parse(saved[0].query.match(/taxi: (\[[^\]]*\])/)[1]);
  assert.ok(taxi.includes(benchId) && !taxi.includes(taxiId), 'bench player in, taxi player out');
  assert.equal(taxi.length, myRoster.taxi.length);
  assert.ok(await page.locator(panel(`[data-spot="t:${benchId}"]`)).count(), 'shows on taxi');
  assert.ok(await page.locator(panel(`[data-spot="b:${taxiId}"]`)).count(), 'displaced player is on the bench');
  const message = await shadowText('.notice.ok');
  assert.match(message, /^Saved: /);
  assert.match(message, / to taxi\b/, 'says who went to taxi');
  assert.match(message, / to bench\b/, 'says who went to the bench');
  await page.screenshot({ path: `${OUT}taxi-saved.png` });

  // A reload reads rosters from Sleeper itself, not the CDN-cached public endpoint.
  await page.reload();
  await page.locator(panel(`[data-spot="t:${benchId}"]`)).waitFor({ timeout: 30000 });
  assert.ok(await page.locator(panel(`[data-spot="b:${taxiId}"]`)).count(), 'still on the bench after reload');
  sleeper.beforeTipoff = false;
  documentBody = LOGGED_OUT;
});

test('taxi: after the season tips off, nothing moves onto taxi', async () => {
  documentBody = LOGGED_IN;
  sleeper.rosters = null;
  await startMidWeek();
  await openMyTeam(TEAM_URL);
  assert.match(await shadowText('.taxi-head .hint'), /Taxi is locked for the season: players can only move up to the active roster/);
  assert.equal(await pickTaxiEligibleBenchPlayer(), null, 'no bench player can go to taxi');
  assert.equal(await page.locator(panel('.card button.slot.tx')).count(), 0, 'roster is full, so taxi players have nowhere to go');
  assert.equal(await page.locator(panel('.card span.slot.tx')).count(), 3);
  await page.locator('#sleeper-nba-panel').evaluate((h) => {
    const head = h.shadowRoot.querySelector('.taxi-head');
    h.shadowRoot.querySelector('.body').scrollTop = head.offsetTop - 120;
  });
  await page.screenshot({ path: `${OUT}taxi-locked.png` });
  sleeper.midWeek = false;
  documentBody = LOGGED_OUT;
});

// Free agents for the Players tab stand-in: active NBA players on no roster in the league.
async function freeAgents(n) {
  const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/rosters`)).json();
  const rostered = new Set(rosters.flatMap((r) => r.players || []));
  const players = await (await fetch('https://api.sleeper.app/v1/players/nba')).json();
  return Object.entries(players)
    .filter(([id, p]) => p.active && p.team && p.fantasy_positions?.length && !rostered.has(id))
    .slice(0, n)
    .map(([id, p]) => ({ id, name: p.full_name }));
}

const dialogText = (sel) => page.locator(dialog(sel)).textContent();

test('waivers: W on the Players tab opens a bid dialog and places a FAAB bid', async () => {
  sleeper.midWeek = false;
  sleeper.rosters = null;
  sleeper.claims = [];
  const users = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/users`)).json();
  sleeper.me = users.find((u) => u.display_name === 'louhow').user_id;
  const [waiverPlayer, freeAgent] = await freeAgents(2);
  documentBody = playersTab([{ ...waiverPlayer, status: 'waiver' }, { ...freeAgent, status: 'free_agent' }]);
  await page.goto(PLAYERS_URL);
  await page.waitForFunction((id) => document.documentElement.dataset.snpNbaLeague === id, LEAGUE, { timeout: 30000 });
  assert.equal(await page.locator('#sleeper-nba-panel').count(), 0, 'no panel on the Players tab');

  await page.locator(`[data-player="${waiverPlayer.id}"] .button-text`).click();
  await page.locator(dialog('.dp-row[data-drop]')).first().waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => window.__sleeperToasts), 0, "Sleeper's own handler never sees the click");
  assert.match(await dialogText('.dialog-head'), new RegExp(`Make Waiver Bid\\s*Bid for ${waiverPlayer.name}`));
  assert.match(await dialogText('.banner'), /Your roster is full, please select a player to drop/);
  assert.match(await dialogText('.bid-form'), /\(\$\d+ remaining\)/);
  // This failed once in a full run and never again in 35 more; if it recurs, the message says where focus was.
  const focus = await page.locator(dialog('[data-bid]')).evaluate((el) => ({
    focused: el === el.getRootNode().activeElement,
    pageHasFocus: document.hasFocus(),
    documentActive: `${document.activeElement?.tagName}#${document.activeElement?.id}`,
    layerActive: el.getRootNode().activeElement?.outerHTML?.slice(0, 80) ?? null,
    layers: document.querySelectorAll('#sleeper-nba-dialog').length,
  }));
  assert.equal(focus.focused, true, `bid input focused: ${JSON.stringify(focus)}`);

  await page.locator(dialog('[data-action="submit-claim"]')).click();
  assert.match(await dialogText('.dialog-errors'), /You must select 1 player to drop/);

  const drop = page.locator(dialog('.dp-row[data-drop]')).filter({ has: page.locator('.slot.bn') }).first();
  const dropId = await drop.getAttribute('data-drop');
  await drop.click();
  await page.locator(dialog(`.dp-row.selected[data-drop="${dropId}"]`)).waitFor();
  await page.locator(dialog('[data-bid]')).fill('7');
  await page.screenshot({ path: `${OUT}waiver-bid.png` });
  const before = sleeper.mutations.length;
  await page.locator(dialog('[data-bid]')).press('Enter');

  await page.locator(dialog('.notice.ok')).waitFor();
  assert.equal(await page.locator(dialog('.dialog')).count(), 0, 'dialog closes');
  assert.match(await dialogText('.notice.ok'), new RegExp(`^\\$7 bid placed for ${waiverPlayer.name} \\(dropping .+\\)$`));
  const { query, variables } = sleeper.mutations[before];
  assert.match(query, new RegExp(`submit_waiver_claim\\(league_id: "${LEAGUE}", k_adds: \\$k_adds`));
  const myRoster = sleeper.rosters.find((r) => r.owner_id === sleeper.me);
  assert.deepEqual(variables, {
    k_adds: [waiverPlayer.id], v_adds: [myRoster.roster_id],
    k_drops: [dropId], v_drops: [myRoster.roster_id],
    k_settings: ['waiver_bid'], v_settings: [7],
  });
  await page.screenshot({ path: `${OUT}waiver-placed.png` });
});

test('waivers: the Team tab lists pending claims to rebid or cancel', async () => {
  documentBody = LOGGED_IN;
  await page.goto(TEAM_URL);
  const myRoster = sleeper.rosters.find((r) => r.owner_id === sleeper.me);
  await pickRoster(myRoster.roster_id);
  const button = page.locator(panel('button.waivers'));
  await page.waitForFunction(() => /1/.test(document.querySelector('#sleeper-nba-panel')?.shadowRoot.querySelector('button.waivers .count')?.textContent), null, { timeout: 30000 });
  await button.click();
  await page.locator(dialog('.claim')).waitFor();
  assert.match(await dialogText('.claim'), /\+.+−/s, 'shows the add and the drop');
  const [claim] = sleeper.claims;
  assert.equal(await page.locator(dialog(`[data-claim-bid="${claim.transaction_id}"]`)).inputValue(), '7');
  await page.screenshot({ path: `${OUT}waiver-claims.png` });

  await page.locator(dialog(`[data-claim-bid="${claim.transaction_id}"]`)).fill('9');
  await page.locator(dialog(`[data-claim-save="${claim.transaction_id}"]`)).click();
  await page.locator(dialog('.notice.ok')).waitFor();
  assert.match(await dialogText('.notice.ok'), /is now \$9$/);
  const update = sleeper.mutations.at(-1);
  assert.match(update.query, new RegExp(`update_waiver_claim\\(league_id: "${LEAGUE}", transaction_id: "${claim.transaction_id}", leg: 1,`));
  assert.deepEqual(update.variables, { k_settings: ['waiver_bid'], v_settings: [9] });
  assert.equal(await page.locator(dialog(`[data-claim-bid="${claim.transaction_id}"]`)).inputValue(), '9');

  const before = sleeper.mutations.length;
  await page.locator(dialog(`[data-claim-cancel="${claim.transaction_id}"]`)).click();
  await page.locator(dialog('[data-claim-cancel-keep]')).click();
  await page.locator(dialog(`[data-claim-cancel="${claim.transaction_id}"]`)).waitFor();
  assert.equal(sleeper.mutations.length, before, 'Keep leaves the claim alone');
  await page.locator(dialog(`[data-claim-cancel="${claim.transaction_id}"]`)).click();
  assert.match(await dialogText('.claim-actions.confirm'), /Cancel this claim\?/);
  await page.screenshot({ path: `${OUT}waiver-cancel-confirm.png` });
  await page.locator(dialog(`[data-claim-cancel-confirm="${claim.transaction_id}"]`)).click();
  await page.locator(dialog('.dialog-body')).filter({ hasText: 'No pending claims' }).waitFor();
  assert.match(sleeper.mutations.at(-1).query, new RegExp(`cancel_waiver_claim\\(league_id: "${LEAGUE}", leg: 1, transaction_id: "${claim.transaction_id}"\\)`));
  await page.keyboard.press('Escape');
  await page.locator(dialog('.dialog')).waitFor({ state: 'detached' });
  assert.equal(await page.locator(panel('button.waivers .count')).count(), 0, 'no pending claims left');
});

test('waivers: ADD on a free agent adds them right away, with a drop', async () => {
  const [, freeAgent] = await freeAgents(2);
  documentBody = playersTab([{ ...freeAgent, status: 'free_agent' }]);
  await page.goto(PLAYERS_URL);
  await page.waitForFunction((id) => document.documentElement.dataset.snpNbaLeague === id, LEAGUE, { timeout: 30000 });
  await page.locator(`[data-player="${freeAgent.id}"]`).click();
  await page.locator(dialog('.dp-row[data-drop]')).first().waitFor({ timeout: 30000 });
  assert.match(await dialogText('.dialog-head'), new RegExp(`Add Player\\s*Add ${freeAgent.name} to your roster`));
  assert.equal(await page.locator(dialog('[data-bid]')).count(), 0, 'no bid for a free agent');
  const drop = page.locator(dialog('.dp-row[data-drop]:not(:disabled)')).filter({ has: page.locator('.slot.bn') }).first();
  const dropId = await drop.getAttribute('data-drop');
  await drop.click();
  await page.locator(dialog('[data-action="submit-claim"]')).click();
  await page.locator(dialog('.notice.ok')).waitFor();
  assert.match(await dialogText('.notice.ok'), new RegExp(`^Added ${freeAgent.name} \\(dropping .+\\)$`));
  const { query, variables } = sleeper.mutations.at(-1);
  assert.match(query, /league_create_transaction\(league_id: "\d+", type: "free_agent", k_adds: \$k_adds/);
  assert.deepEqual(variables.k_adds, [freeAgent.id]);
  assert.deepEqual(variables.k_drops, [dropId]);
  const myRoster = sleeper.rosters.find((r) => r.owner_id === sleeper.me);
  assert.ok(myRoster.players.includes(freeAgent.id) && !myRoster.players.includes(dropId), 'roster updated');
  documentBody = LOGGED_OUT;
});

test('IR: Out players move onto IR from the bench or the lineup', async () => {
  documentBody = LOGGED_IN;
  sleeper.midWeek = false;
  sleeper.rosters = null;
  sleeper.legs = {};
  const users = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/users`)).json();
  sleeper.me = users.find((u) => u.display_name === 'louhow').user_id;
  const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}/rosters`)).json();
  const myRoster = rosters.find((r) => r.owner_id === sleeper.me);
  await seedLegs(1);
  const starters = sleeper.legs[1].find((l) => l.roster_id === myRoster.roster_id).starters;
  const benchId = myRoster.players.find((id) => !starters.includes(id) && !(myRoster.taxi || []).includes(id));
  const starterId = starters[0];
  sleeper.injured = new Set([benchId, starterId]);

  await page.goto(TEAM_URL);
  await pickRoster(myRoster.roster_id);
  await page.locator(panel('[data-action="refresh"]')).click(); // refetch players with the injuries
  await page.locator(panel('.ir-head .hint')).waitFor({ timeout: 30000 });
  assert.match(await shadowText('.ir-head .hint'), /IR, Out, DTD and DNR players can move to IR\./);

  const before = sleeper.mutations.length;
  await page.locator(panel(`[data-spot="b:${benchId}"]`)).click();
  await page.locator(panel('.card.target button.slot.ir[data-spot="re:0"]')).click();
  await page.locator(panel('.notice.ok')).waitFor();
  assert.match(await shadowText('.notice.ok'), / to IR$/);
  const benchMoves = sleeper.mutations.slice(before);
  assert.equal(benchMoves.length, 1, 'bench to IR only saves IR');
  assert.match(benchMoves[0].query, new RegExp(`roster_update_reserve\\(league_id: "${LEAGUE}", roster_id: ${myRoster.roster_id}, reserve: \\["${benchId}"\\]\\)`));
  await page.locator(panel(`[data-spot="r:${benchId}"]`)).waitFor();
  await page.locator(panel('.notice.ok')).waitFor({ state: 'detached', timeout: 5000 });

  const mid = sleeper.mutations.length;
  await page.locator(panel('[data-spot="s:0"]')).click();
  await page.locator(panel('.card.target button.slot.ir[data-spot="re:0"]')).click();
  await page.locator(panel('.notice.ok')).waitFor();
  const starterMoves = sleeper.mutations.slice(mid);
  assert.deepEqual(starterMoves.map((m) => m.query.match(/mutation (\w+)/)[1]), ['update_matchup_leg', 'roster_update_reserve'],
    'the starter leaves the lineup before going on IR');
  assert.match(starterMoves[0].query, /starters: \["0",/);
  await page.locator(panel(`[data-spot="r:${starterId}"]`)).waitFor();
  await page.locator(panel(".ir-head")).evaluate((h) => h.scrollIntoView());
  await page.screenshot({ path: `${OUT}ir-moved.png` });

  await page.reload();
  await page.locator(panel(`[data-spot="r:${starterId}"]`)).waitFor({ timeout: 30000 });
  assert.ok(await page.locator(panel(`[data-spot="r:${benchId}"]`)).count(), 'both stay on IR after reload');
  sleeper.injured = new Set();
  documentBody = LOGGED_OUT;
});

test('player card: clicking a player opens bio, game logs, career, news and depth chart', async () => {
  documentBody = LOGGED_OUT;
  await page.goto(TEAM_URL);
  const name = page.locator(panel('.card button.name')).first();
  await name.waitFor({ timeout: 30000 });
  const playerName = await name.textContent();
  await name.click();
  await page.locator(dialog('.pc')).waitFor();
  // Loading must not move what's on screen. The card re-renders from fresh HTML, which the
  // layout-shift API can't see, so track where the Career heading sits whenever it's visible.
  await page.evaluate(() => {
    // Moves where the heading was on screen before or after: [from, to] in px from the top of the column.
    window.__careerMoves = [];
    let last = null;
    const tick = () => {
      const root = document.querySelector('#sleeper-nba-dialog')?.shadowRoot;
      const main = root?.querySelector('.pc-main');
      const head = [...(root?.querySelectorAll('.pc-main h2') || [])].find((h) => h.textContent === 'Career');
      if (main && head) {
        const top = Math.round(head.getBoundingClientRect().top - main.getBoundingClientRect().top);
        const visible = (y) => y < main.clientHeight;
        if (last != null && top !== last && (visible(last) || visible(top))) window.__careerMoves.push([last, top]);
        last = top;
      }
      if (window.__careerMoves) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  assert.equal(await page.locator(dialog('h2.pc-name')).textContent(), playerName);
  await page.locator(dialog('.pc-item-value')).first().filter({ hasText: /^\d+$/ }).waitFor({ timeout: 15000 });
  const bio = await page.locator(dialog('.pc-bio')).textContent();
  assert.match(bio, /Age\s*\d+\s*Height\s*\d'\d+"\s*Weight\s*\d+\s*lbs\s*Exp\s*\d+\s*College/);
  assert.match(await page.locator(dialog('.pc-number')).textContent(), /[A-Z0-9 ]+( #\d+)?/);

  // This season: upcoming games with projections; last season: played games, heat-shaded.
  await page.locator(dialog('.pc-table.log tbody tr td.opp')).first().waitFor({ timeout: 15000 });
  assert.match(await page.locator(dialog('.pc-table.log tbody tr')).first().textContent(), /\d+\.\d\d/);
  const tabs = page.locator(dialog('.pc-seasons button'));
  await page.waitForFunction(() => document.querySelector('#sleeper-nba-dialog').shadowRoot.querySelectorAll('.pc-seasons button').length > 1, null, { timeout: 15000 });
  await tabs.nth(1).click();
  await page.locator(dialog('.pc-seasons button.on')).filter({ hasText: await tabs.nth(1).textContent() }).waitFor();
  await page.locator(dialog('.pc-table.log td[style*="background"]')).first().waitFor({ timeout: 15000 });
  assert.ok(await page.locator(dialog('.pc-table.career tbody tr td.fpts')).count() >= 1, 'career has at least one season');
  const moves = await page.evaluate(() => { const m = window.__careerMoves; window.__careerMoves = null; return m; });
  assert.deepEqual(moves, [], 'nothing on screen moves while game logs load');

  await page.locator(dialog('.pc-news h3')).first().waitFor({ timeout: 15000 });
  await page.locator(dialog('.pc-depth-row li.me')).waitFor({ timeout: 15000 });
  assert.equal(await page.locator(dialog('.pc-depth-row li.me')).textContent(), playerName);
  assert.match(await page.locator(dialog('.pc-main')).textContent(), /Transaction History\s*Log in to Sleeper/);
  await page.screenshot({ path: `${OUT}player-card.png` });
  await page.locator(dialog('.pc-main')).evaluate((m) => { m.scrollTop = m.scrollHeight; });
  await page.screenshot({ path: `${OUT}player-card-bottom.png` });

  await page.keyboard.press('Escape');
  await page.locator(dialog('.pc')).waitFor({ state: 'detached' });
});

test('player card: opens from the Players and Trend tabs instead of Sleeper\'s card', async () => {
  documentBody = LOGGED_OUT;
  const [first, second] = await freeAgents(2);
  documentBody = playersTab([{ ...first, status: 'waiver' }, { ...second, status: 'free_agent', trend: true }]);
  await page.goto(PLAYERS_URL);
  await page.waitForFunction((id) => document.documentElement.dataset.snpNbaLeague === id, LEAGUE, { timeout: 30000 });
  for (const p of [first, second]) {
    await page.locator('.player-meta-container, .player-details').filter({ hasText: p.name }).click();
    await page.locator(dialog('h2.pc-name')).filter({ hasText: p.name }).waitFor({ timeout: 30000 });
    await page.keyboard.press('Escape');
    await page.locator(dialog('.pc')).waitFor({ state: 'detached' });
  }
  assert.equal(await page.evaluate(() => window.__sleeperCards), 0, "Sleeper's own card never opens");
  documentBody = LOGGED_OUT;
});


test('sidebar: each league opens on the tab you were last on in it, any sport', async () => {
  documentBody = leagueNav;
  const path = () => new URL(page.url()).pathname;
  // Each visit is remembered within half a second.
  const visit = async (url) => {
    await page.goto(url);
    await page.waitForTimeout(700);
  };
  await page.goto(`https://sleeper.com/leagues/${NFL_LEAGUE}/matchup`);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('snp:league-page:')).forEach((k) => localStorage.removeItem(k)));
  await visit(`https://sleeper.com/leagues/${NFL_LEAGUE}/matchup`);
  // Never been on the NBA league: from a Matchup tab it opens on its Matchup tab.
  await page.locator('[data-sport=nba] .league-title').click();
  assert.equal(path(), `/leagues/${LEAGUE}/matchup`);
  assert.deepEqual(await page.evaluate(() => [window.__selected, window.__sleeperNav]), [[LEAGUE], []], 'through Sleeper\'s router, not its link');
  await visit(`https://sleeper.com/leagues/${LEAGUE}/players`);
  // Back and forth: each league where you left it, NFL included.
  await page.locator('[data-sport=nfl]').click();
  assert.equal(path(), `/leagues/${NFL_LEAGUE}/matchup`);
  await page.waitForTimeout(700);
  await page.locator('[data-sport=nba]').click();
  assert.equal(path(), `/leagues/${LEAGUE}/players`);
  await visit(`https://sleeper.com/leagues/${NFL_LEAGUE}/trend`);
  await page.locator('[data-sport=nba]').click();
  assert.equal(path(), `/leagues/${LEAGUE}/players`);
  await page.waitForTimeout(700);
  await page.locator('[data-sport=nfl]').click();
  assert.equal(path(), `/leagues/${NFL_LEAGUE}/trend`);
  assert.deepEqual(await page.evaluate(() => window.__sleeperNav), [], 'never Sleeper\'s own link');
  // Nothing remembered, and not from a Matchup tab: Sleeper's own navigation.
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('snp:league-page:')).forEach((k) => localStorage.removeItem(k)));
  await page.goto(`https://sleeper.com/leagues/${NFL_LEAGUE}/league`);
  await page.evaluate(() => localStorage.removeItem('snp:league-page:${LEAGUE}'));
  await page.locator('[data-sport=nba]').click();
  assert.equal(path(), `/leagues/${LEAGUE}`);
  assert.deepEqual(await page.evaluate(() => window.__sleeperNav), ['nba']);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('snp:league-page:')).forEach((k) => localStorage.removeItem(k)));
  documentBody = LOGGED_OUT;
});

test('optimize lineup: proposes changes, guards green scores, and saves only once applied', async () => {
  documentBody = LOGGED_IN;
  sleeper.rosters = null;
  await startMidWeek();
  const myRoster = await openMyTeam(TEAM_URL);
  const leg = sleeper.legs[1].find((l) => l.roster_id === myRoster.roster_id);
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}`)).json();
  const util = league.roster_positions.filter((p) => p !== 'BN').indexOf('UTIL');
  const victim = leg.starters[util];
  // Stat points that score exactly `fpts` fantasy points under the league's scoring.
  const statPts = (fpts) => fpts / league.scoring_settings.pts;
  // A bench player with a game on the next day of games (what Optimize picks for),
  // after their first (finished) one, becomes a must-start.
  const { data } = await (await fetch('https://sleeper.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query scores { scores(sport: "nba", season_type: "regular", season: "2026", week: 1) { game_id date start_time status metadata } }' }),
  })).json();
  fakeMidWeek(data.scores);
  const players = await (await fetch('https://api.sleeper.app/v1/players/nba')).json();
  const ahead = (team) => data.scores.filter((g) => [g.metadata?.home_team?.team, g.metadata?.away_team?.team].includes(team) &&
    !sleeper.finished.has(g.game_id) && g.status === 'pre_game' && g.start_time > Date.now() + 3600e3);
  const nextDay = myRoster.players.flatMap((id) => ahead(players[id]?.team).map((g) => g.date)).sort()[0];
  const placed = new Set([...leg.starters, ...(myRoster.taxi || []), ...(myRoster.reserve || [])]);
  const bench = myRoster.players.filter((id) => !placed.has(id) && ahead(players[id].team).some((g) => g.date === nextDay));
  assert.ok(bench.length, `a bench player plays on ${nextDay}`);
  const star = bench[0];
  // Another starter with a game left had a big finished game, worth locking over
  // the 10s they're projected after it. Every other starter's finished game
  // scored nothing, so there's nothing else to lock or lose.
  const existing = { ...leg.starters_games };
  const locker = leg.starters.find((id) => id !== victim && id !== '0' && !(id in existing) && ahead(players[id]?.team).length);
  assert.ok(locker, 'a starter with a game left');
  const starting = new Set(leg.starters);
  const quiet = (r) => (starting.has(r.player_id) && sleeper.finished.has(r.game_id) ? { ...r, stats: { pts: 0 } } : r);
  const big = (r) => ({ ...r, stats: { pts: statPts(sleeper.finished.has(r.game_id) ? 70 : 10) } });
  // The UTIL starter scored a little in their finished game and is projected nothing after it.
  sleeper.projections = (rows) => rows.map((r) => {
    if (r.player_id === star) return { ...r, stats: { pts: statPts(50) } };
    if (r.player_id === victim) return { ...r, stats: { pts: sleeper.finished.has(r.game_id) ? statPts(3) : 0 } };
    if (r.player_id === locker) return big(r);
    return quiet(r);
  });
  // The lineup was seen (by openMyTeam) before the finished games tip off now.
  sleeper.tipAt = Date.now();
  await page.reload();
  await page.locator(panel('.taxi-head .hint')).waitFor({ timeout: 30000 });

  // Offered on your own team only.
  await page.locator(panel('button.optimize')).waitFor();
  const other = sleeper.rosters.find((r) => r.roster_id !== myRoster.roster_id);
  await pickRoster(other.roster_id);
  await page.locator(panel('button.optimize')).waitFor({ state: 'detached' });
  await pickRoster(myRoster.roster_id);

  const before = sleeper.mutations.length;
  await page.locator(panel('button.optimize')).click();
  await page.locator(dialog('.os-row')).first().waitFor();
  assert.match(await page.locator(dialog('.op-sum')).textContent(), /(\w{3}) projection\s*Starters playing \1\s*\d+\.\d\d\s*→\s*\d+\.\d\d\s*\+\d+\.\d\d/);
  // The tooltip shows on hover, inside the dialog.
  assert.equal(await page.locator(dialog('.how-tip')).isVisible(), false);
  await page.locator(dialog('.how')).hover();
  assert.match(await page.locator(dialog('.how-tip')).innerText(), /^How it picks:\nStarts your best projected players/);
  await page.screenshot({ path: `${OUT}optimize-how.png` });
  await page.mouse.move(0, 0);
  // One row per starting slot, in lineup order, each showing who's there now.
  const slots = league.roster_positions.filter((p) => p !== 'BN');
  assert.deepEqual(await page.locator(dialog('.os-row .os-slot')).allTextContents(), slots);
  const nowIn = await page.locator(dialog('.os-row')).evaluateAll((rows) =>
    rows.map((r) => r.querySelector('.os-p:not(.in) [data-player]')?.dataset.player ?? '0'));
  assert.deepEqual(nowIn, leg.starters, 'the current lineup, slot by slot');
  // Slots that stay say so, with no button.
  const same = page.locator(dialog('.os-row.same'));
  assert.ok(await same.count() > 0, 'some slots stay');
  assert.equal(await same.locator('button.os-apply').count(), 0);
  assert.match(await same.first().locator('.os-status').textContent(), /^(No change|Locked|Playing|Empty)$/);
  // A small lockable score given up is a soft warning: yellow, and Apply still works.
  const victimRow = page.locator(dialog('.os-row.swap.warning')).filter({ hasText: players[victim].full_name });
  assert.match(await victimRow.locator('.sub.drops.warn').textContent(), /^Drops lock-in 3\.00 \w{3} (vs|@) \w+$/, 'what benching gives up');
  assert.equal(await victimRow.locator('.score.red').textContent(), '3.00', 'the score shows in its tier color');
  // Substitution marks, as soccer apps show them: green up coming in, red down going out.
  assert.equal(await victimRow.locator('.os-p.in .os-arrow.in').getAttribute('aria-label'), 'Coming in');
  assert.equal(await victimRow.locator('.os-p.out .os-arrow.out').getAttribute('aria-label'), 'Going out');
  // Two clear options: apply the change, or keep them and lock their score.
  assert.equal(await victimRow.locator('button.os-apply').innerText(), 'APPLY CHANGE');
  assert.equal(await victimRow.locator('.os-lock-current').innerText(), 'LOCK CURRENT');
  assert.match(await victimRow.locator('.os-lock-current').getAttribute('title'), /^Or keep .+ and lock 3\.00 \(\w{3} (vs|@) \w+\) instead\. Locking is final/);
  assert.match(await page.locator(dialog('.warn-banner')).textContent(), new RegExp(`${players[victim].full_name} 3\\.00.* finished games? you could still lock in`));
  assert.equal(await page.locator(dialog('.lose-banner')).count(), 0, 'no hard stop for a red score');
  assert.equal(await page.locator(dialog('[data-action="apply-lineup"]')).isDisabled(), false);
  // The must-start comes in, on the same row as whoever goes out of that slot.
  const starRow = page.locator(dialog('.os-row.swap')).filter({ has: page.locator(`.os-p.in [data-player="${star}"]`) });
  assert.equal(await starRow.count(), 1, 'the must-start comes in');
  assert.match(await starRow.locator('.os-p.out').innerText(), /^Empty$|\nTo (bench|\w+) · (no game|\w{3} \d+\.\d\d)/, 'whoever it replaces goes somewhere, or the slot was empty');
  assert.match(await starRow.locator('.os-p.in .sub').first().textContent(), /^From bench · /);
  // The big finished game is recommended for locking, with what keeping it open would bring.
  const lockRow = page.locator(dialog('.os-row.lock'));
  assert.equal(await lockRow.count(), 1, 'one game worth locking');
  assert.equal(await lockRow.locator('.os-p [data-player]').first().getAttribute('data-player'), locker);
  assert.match(await lockRow.innerText(), /\w{3} (vs|@) \w+ · open \d+\.\d\d( with \S+ [^\n]+)?\s+Lockable until \w{3} \d{1,2}:\d\d(am|pm) · Keep open/);
  assert.ok(Number(await lockRow.locator('.score.green').textContent()) >= 70, 'the score, in its tier color');
  assert.ok(Number((await lockRow.innerText()).match(/open (\d+\.\d\d)/)[1]) < 20, 'keeping it open is worth far less');
  assert.equal(await lockRow.locator('[data-op-lock-row]').textContent(), 'Lock');
  const applyButton = page.locator(dialog('[data-action="apply-lineup"]'));
  assert.equal(await applyButton.textContent(), 'Lock in 1 game and apply all');
  // Every slot fits on screen, with no scrolling.
  assert.ok(await page.locator(dialog('.dialog-body')).evaluate((el) => el.scrollHeight <= el.clientHeight), 'no scroll');
  await page.screenshot({ path: `${OUT}optimize-dialog.png` });
  // Kept open, it stays listed and the plan goes on without it.
  await lockRow.locator('[data-op-keep]').click();
  await page.locator(dialog('.os-row.lock.off')).waitFor();
  assert.match(await page.locator(dialog('.os-row.lock')).innerText(), /Keeping open · Lock instead/);
  assert.equal(await applyButton.textContent(), 'Apply all');
  await page.locator(dialog('[data-op-relock]')).click();
  await page.locator(dialog('.os-row.lock:not(.off)')).waitFor();

  // A player's card opens over the dialog; closing it comes back to the dialog.
  await page.locator(dialog(`.os-p button.name[data-player="${star}"]`)).click();
  await page.locator(dialog('h2.pc-name')).filter({ hasText: players[star].full_name }).waitFor({ timeout: 30000 });
  assert.equal(await page.locator(dialog('.os-row')).first().isVisible(), true, 'the dialog stays underneath');
  await page.screenshot({ path: `${OUT}optimize-card.png` });
  await page.keyboard.press('Escape');
  await page.locator(dialog('.pc')).waitFor({ state: 'detached' });
  await page.locator(dialog('.os-row')).first().waitFor();

  // Dismissing changes nothing.
  await page.locator(dialog('.op-foot button[data-action="close-modal"]')).click();
  await page.locator(dialog('.modal')).waitFor({ state: 'detached' });
  assert.equal(sleeper.mutations.length, before, 'nothing saved on cancel');

  // One row applies on its own; the dialog stays open on what's left.
  const lineupBefore = [...leg.starters];
  await page.locator(panel('button.optimize')).click();
  await starRow.locator('button.os-apply').click();
  await starRow.waitFor({ state: 'detached' });
  assert.equal(sleeper.mutations.length, before + 1, 'one save');
  assert.match(sleeper.mutations.at(-1).query, /mutation update_matchup_leg/);
  assert.equal(sleeper.mutations.at(-1).variables.starters_games, undefined, 'no lock with it');
  const rowSaved = JSON.parse(sleeper.mutations.at(-1).query.match(/starters: (\[[^\]]*\])/)[1]);
  const moved = rowSaved.map((id, i) => i).filter((i) => rowSaved[i] !== lineupBefore[i]);
  assert.ok(moved.length >= 1 && rowSaved.includes(star), `the star comes in (slots ${moved})`);
  assert.equal(await page.locator(dialog('.os-row.same')).filter({ has: page.locator(`[data-player="${star}"]`) }).count(), 1, 'their slot now stays');
  assert.equal(await page.locator(dialog('.os-row.lock')).count(), 1, 'the lock is still offered');
  assert.match(await page.locator(dialog('.op-done')).textContent(), /^Saved: .*to (bench|\w+)/, 'says what saved, in the dialog');
  await page.screenshot({ path: `${OUT}optimize-row-applied.png` });
  // A lock applies on its own too, keeping the lineup as it stands.
  await page.locator(dialog('[data-op-lock-row]')).click();
  await page.locator(dialog('.os-row.lock')).waitFor({ state: 'detached' });
  const lockSave = sleeper.mutations.at(-1);
  assert.match(lockSave.query, /mutation update_matchup_leg/);
  assert.deepEqual(Object.keys(JSON.parse(lockSave.variables.starters_games)).filter((id) => !(id in existing)), [locker]);
  assert.deepEqual(JSON.parse(lockSave.query.match(/starters: (\[[^\]]*\])/)[1]), rowSaved, 'the lineup as it stands');
  assert.match(await page.locator(dialog('.op-done')).textContent(), /^Locked .+ \d+\.\d\d$/);
  assert.match(await page.locator(dialog('.os-row.same.locked')).filter({ has: page.locator(`[data-player="${locker}"]`) }).textContent(), /Locked\s*$/);
  await page.keyboard.press('Escape');
  await page.locator(dialog('.modal')).waitFor({ state: 'detached' });
  // Back to the starting lineup for the rest of the test.
  leg.starters = lineupBefore;
  leg.starters_games = { ...existing };
  // Sleeper's rule: benched since the game began (the row applied above did) makes it ineligible, even back in the lineup.
  await page.reload();
  await page.locator(panel('button.optimize')).click();
  const victimNow = page.locator(dialog('.os-row.swap')).filter({ has: page.locator(`.os-p.out [data-player="${victim}"]`) });
  await victimNow.waitFor();
  if (!rowSaved.includes(victim)) {
    assert.equal(await victimNow.locator('.os-lock-current').count(), 0, 'nothing to lock: benched since tip-off');
    assert.equal(await victimNow.locator('.sub.drops').count(), 0);
  }
  await page.keyboard.press('Escape');
  // A fresh game for them, started and never benched: Lock current keeps them and locks it, nothing else moves.
  sleeper.tipAt = Date.now();
  await page.reload();
  await page.locator(panel('button.optimize')).click();
  await victimNow.locator('.os-lock-current').click();
  await victimNow.waitFor({ state: 'detached' });
  const lockOut = sleeper.mutations.at(-1);
  assert.deepEqual(Object.keys(JSON.parse(lockOut.variables.starters_games)).filter((id) => !(id in existing)), [victim], 'just that lock');
  assert.deepEqual(JSON.parse(lockOut.query.match(/starters: (\[[^\]]*\])/)[1]), lineupBefore, 'the lineup as it stands');
  assert.match(await page.locator(dialog('.op-done')).textContent(), /^Locked .+ 3\.00$/);
  assert.equal(await page.locator(dialog('.os-row.same.locked')).filter({ has: page.locator(`[data-player="${victim}"]`) }).count(), 1, 'now locked in its slot');
  await page.keyboard.press('Escape');
  await page.locator(dialog('.modal')).waitFor({ state: 'detached' });
  leg.starters_games = { ...existing };
  const beforeGreen = sleeper.mutations.length;

  // Now the UTIL starter's finished game was green (30, over the league's green line) and every bench player is a must-start,
  // the star most of all, so ties among the bench can't leave them out.
  sleeper.projections = (rows) => rows.map((r) => {
    if (r.player_id === star) return { ...r, stats: { pts: statPts(60) } };
    if (bench.includes(r.player_id)) return { ...r, stats: { pts: sleeper.finished.has(r.game_id) ? 0 : statPts(50) } };
    if (r.player_id === victim) return { ...r, stats: { pts: sleeper.finished.has(r.game_id) ? statPts(30) : 0 } };
    if (r.player_id === locker) return big(r);
    return quiet(r);
  });
  await page.reload();
  await page.locator(panel('button.optimize')).click();
  await page.locator(dialog('.lose-banner')).waitFor();
  assert.match(await page.locator(dialog('.lose-banner')).textContent(), new RegExp(players[victim].full_name));
  // Big games earn scoring bonuses too, so the score is at least what was set.
  const given = Number((await page.locator(dialog('.os-row.losing')).filter({ hasText: players[victim].full_name }).textContent()).match(/Drops lock-in (\d+\.\d\d)/)[1]);
  assert.ok(given >= 24, `a green score (${given})`);
  const apply = page.locator(dialog('[data-action="apply-lineup"]'));
  assert.match(await apply.textContent(), /^Lock in 1 game and apply all, losing \d+\.\d\d pts$/);
  assert.equal(await apply.isDisabled(), true, 'giving up a green score needs the tick box');
  await page.screenshot({ path: `${OUT}optimize-green.png` });
  await page.locator(dialog('[data-op-ack]')).check();
  await apply.click();
  await page.locator(dialog('.modal')).waitFor({ state: 'detached' });
  await page.locator(panel('.notice.ok')).waitFor();
  const saved = sleeper.mutations.slice(beforeGreen);
  assert.equal(saved.length, 1, 'the lineup and the lock in one save');
  assert.match(saved[0].query, /mutation update_matchup_leg/);
  const locks = JSON.parse(saved[0].variables.starters_games);
  assert.deepEqual(Object.keys(locks).filter((id) => !(id in existing)), [locker], 'one new lock');
  for (const [id, game] of Object.entries(existing)) assert.equal(String(locks[id]), String(game), 'existing locks are left alone');
  assert.ok(sleeper.finished.has(locks[locker]), 'locks the finished game');
  const starters = JSON.parse(saved[0].query.match(/starters: (\[[^\]]*\])/)[1]);
  assert.ok(starters.includes(star) && !starters.includes(victim) && starters.includes(locker));
  assert.equal(starters.indexOf(locker), leg.starters.indexOf(locker), 'the locked player keeps their slot');
  assert.match(await shadowText('.notice.ok'), /^Locked .+ \d+\.\d\d · Saved: (\d+ lineup changes|.*to bench)$/);
  await page.screenshot({ path: `${OUT}optimize-saved.png` });

  // Applied again, the lineup is already the best one.
  await page.locator(panel('.notice.ok')).waitFor({ state: 'detached', timeout: 5000 });
  await page.locator(panel('button.optimize')).click();
  assert.match(await page.locator(dialog('.dialog-body')).textContent(), /already your best lineup/);
  await page.keyboard.press('Escape');
  sleeper.projections = null;
  sleeper.midWeek = false;
  documentBody = LOGGED_OUT;
});

test('logged in with a session Sleeper turns down: asks to log back in instead of showing wrong numbers', async () => {
  documentBody = LOGGED_IN;
  sleeper.rejectSession = true;
  await page.goto(MATCHUP_URL);
  await page.locator(panel('.session-expired')).waitFor({ timeout: 30000 });
  assert.match(await page.locator(panel('.session-expired')).innerText(), /Log back in to Sleeper[\s\S]*Log out of Sleeper, log back in, then reload this page\./);
  assert.equal(await page.locator(panel('.mu-head, .card, .team-card')).count(), 0, 'no numbers from the logged-out fallbacks');
  await page.screenshot({ path: `${OUT}session-expired.png` });
  // The API log shows what failed.
  await page.locator(panel('[data-tab="api"]')).click();
  await page.locator(panel('.status.bad'), { hasText: '401' }).first().waitFor();
  await page.locator(panel('[data-tab="page"]')).click();

  // Logging back in gives the page a new token; a refresh then loads normally.
  sleeper.rejectSession = false;
  await page.evaluate((t) => localStorage.setItem('token', `${t}-fresh`), FAKE_TOKEN);
  await page.locator(panel('[data-action="refresh"]')).click();
  await page.locator(panel('.mu-head')).waitFor({ timeout: 30000 });
  assert.equal(await page.locator(panel('.session-expired')).count(), 0);
  documentBody = LOGGED_OUT;
});

const corner = (sel = '') => `#sleeper-nba-scoring ${sel}`;

test('what-if scoring: try other values from the corner on the Team, Matchup and player card, then switch back', async () => {
  documentBody = LOGGED_IN;
  sleeper.rosters = null;
  await startMidWeek();
  // Hidden by default: admin tools only show once a URL turns them on.
  await openMyTeam(TEAM_URL);
  await page.waitForTimeout(500);
  assert.equal(await page.locator(corner('.wi-dock')).count(), 0, 'no Scoring control without ?snp-admin=1');
  await openMyTeam(`${TEAM_URL}?snp-admin=1`);
  // Sleeper's router drops the query string as you move around; the choice sticks anyway.
  await page.evaluate(() => history.replaceState({}, '', location.pathname));
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}`)).json();
  const pts = league.scoring_settings.pts;
  const cells = () => page.locator(panel('.card .cell .v')).allTextContents();
  const before = await cells();
  assert.match(await page.locator(panel('.team-card .score .sub')).textContent(), /proj 157\.23/, "Sleeper's own projection");

  // Collapsed: League is on, and What-if waits for a change.
  await page.locator(corner('.wi-dock')).waitFor();
  assert.equal(await page.locator(corner('[data-wi="league"]')).getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator(corner('[data-wi="whatif"]')).isDisabled(), true);

  // Typing applies as you go and keeps the field focused.
  await page.locator(corner('[data-wi="toggle-open"]')).click();
  const input = page.locator(corner('input[data-wi-key="pts"]'));
  assert.equal(await input.inputValue(), String(pts));
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(String(pts * 3), { delay: 30 });
  assert.equal(await input.evaluate((el) => el.getRootNode().activeElement === el), true, 'still typing in the same field');
  assert.equal(await input.inputValue(), String(pts * 3));
  await page.locator(corner('.wi-row.changed .wi-was')).filter({ hasText: `League ${pts}` }).waitFor();
  await page.locator(panel('.app.whatif')).waitFor();
  assert.match(await page.locator(panel('.whatif-banner')).textContent(), new RegExp(`Points Scored ${pts} → ${pts * 3}`));
  assert.notDeepEqual(await cells(), before, 'projections rescored');
  assert.doesNotMatch(await page.locator(panel('.team-card .score .sub')).textContent(), /157\.23/, "Sleeper's league-scored total is set aside");
  assert.equal(await page.locator(panel('button.optimize')).isDisabled(), true, 'Optimize uses league scoring');
  await page.screenshot({ path: `${OUT}whatif-editor.png` });

  // Like a tooltip, a click elsewhere closes the editor; the switch stays on What-if.
  await page.locator(panel('.team-card')).click({ position: { x: 5, y: 5 } });
  await page.locator(corner('.wi-pop')).waitFor({ state: 'detached' });
  assert.equal(await page.locator(corner('[data-wi="whatif"]')).getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator(corner('[data-wi="whatif"] .count')).textContent(), '1');
  await page.screenshot({ path: `${OUT}whatif-on.png` });

  // The player card is rescored too, with the switch still reachable over it.
  await page.locator(panel('.card button.name')).first().click();
  await page.locator(dialog('.pc.whatif .whatif-banner')).waitFor({ timeout: 30000 });
  await page.locator(dialog('.pc-table.log tbody tr:not(.skeleton)')).first().waitFor({ timeout: 30000 });
  // Its game log shows the league's Fpts and the what-if adminFPTS side by side.
  assert.deepEqual(await page.locator(dialog('.pc-table.log thead tr:not(.group) th')).allTextContents(),
    ['Wk', 'Date', 'Opp', 'Proj', 'Fpts', 'adminFPTS', 'Min', 'Pts', 'Reb', 'Ast', 'Stl', 'Blk', 'To', 'Fg', '3pt', 'Ft']);
  const played = page.locator(dialog('.pc-table.log tbody tr')).filter({ has: page.locator('td.fpts.admin:not(:text("-"))') }).first();
  if (await played.count()) {
    const [fpts, adminFpts] = (await played.locator('td.fpts').allTextContents()).map(Number);
    assert.ok(adminFpts > fpts, `adminFPTS (${adminFpts}) beats Fpts (${fpts}) with points worth more`);
  }
  const box = await page.locator(corner('.wi-dock')).boundingBox();
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2]), 'sleeper-nba-scoring');
  await page.screenshot({ path: `${OUT}whatif-card.png` });
  await page.keyboard.press('Escape');
  await page.locator(dialog('.pc')).waitFor({ state: 'detached' });

  // Remembered across reloads and pages (no ?snp-admin here); the Matchup tab sets aside Sleeper's totals and Lock-In.
  await page.goto(MATCHUP_URL);
  await page.locator(panel('.app.whatif .mu-head')).waitFor({ timeout: 30000 });
  assert.doesNotMatch(await page.locator(panel('.mu-head')).textContent(), /157\.23/);
  assert.equal(await page.locator(panel('[data-lock]')).count(), 0, 'no locking real points from what-if numbers');
  await page.screenshot({ path: `${OUT}whatif-matchup.png` });

  // Back to the league's scoring from the switch, and back again.
  await page.locator(corner('[data-wi="league"]')).click();
  await page.locator(panel('.app.whatif')).waitFor({ state: 'detached' });
  assert.match(await page.locator(panel('.mu-head')).textContent(), /157\.23/);
  await page.locator(corner('[data-wi="whatif"]')).click();
  await page.locator(panel('.app.whatif')).waitFor();

  // Reset puts every value back and turns what-if off.
  await page.locator(corner('[data-wi="toggle-open"]')).click();
  await page.locator(corner('[data-wi="reset"]')).click();
  await page.locator(panel('.app.whatif')).waitFor({ state: 'detached' });
  assert.equal(await page.locator(corner('input[data-wi-key="pts"]')).inputValue(), String(pts));
  assert.equal(await page.locator(corner('.wi-row.changed')).count(), 0);
  await page.keyboard.press('Escape');
  await page.locator(corner('.wi-pop')).waitFor({ state: 'detached' });
  assert.equal(await page.locator(corner('[data-wi="whatif"]')).isDisabled(), true);
  sleeper.midWeek = false;
  documentBody = LOGGED_OUT;
});

test('what-if scoring: the Players tab gets sortable adminFPTS and adminDelta columns beside FPTS', async () => {
  documentBody = playersTable([
    { id: 'scorer', pos: 'PG', owner: 'OuiThePeople the longest name', stats: { fpts_proj: 32, pts: 30, reb: 2, gp: 1 } },
    { id: 'guard', pos: 'PG', stats: { fpts_proj: 31, pts: 29, reb: 2, gp: 1 } },
    { id: 'rebounder', pos: 'C', stats: { fpts_proj: 30, pts: 10, reb: 20, gp: 1 } },
    // Two games: Sleeper stores totals and shows them per game (31.0), but sorts on the totals.
    { id: 'veteran', pos: 'SF', stats: { fpts_proj: 62, pts: 60, reb: 2, gp: 2 } },
  ]);
  await page.goto(`${PLAYERS_URL}?snp-admin=1`);
  const labels = () => page.locator('.stat-key-header .label').allTextContents();
  const order = () => page.locator('.player-list-item').evaluateAll((rows) => rows.map((r) => r.dataset.id));
  // FPTS, admin FPTS, admin Delta, then PTS and REB.
  const cells = (id) => page.locator(`.player-list-item[data-id="${id}"] .cell`).evaluateAll((els) => els.map((el) => el.querySelector('.snp-delta, .snp-value')?.textContent ?? el.textContent))
    .then((all) => [...all.slice(0, 3), all[4], all[6]]);
  const badge = (id) => page.locator(`.player-list-item[data-id="${id}"] .snp-delta`);
  const shown = async (id, text) => page.waitForFunction(([i, t]) => document.querySelector(`.player-list-item[data-id="${i}"] .snp-delta`)?.textContent === t, [id, text]);
  await page.waitForFunction(() => [...document.querySelectorAll('.stat-key-header .label')].some((l) => l.textContent === 'admin Delta'), null, { timeout: 30000 });
  assert.deepEqual(await labels(), ['FPTS', 'admin FPTS', 'admin Delta', 'MIN', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO'], 'right after FPTS');
  await shown('rebounder', '0');
  assert.deepEqual(await cells('rebounder'), ['30.0', '30.0', '0', '10.0', '20.0'], 'matches FPTS until a value changes, so nobody moves');
  assert.deepEqual(await cells('veteran'), ['31.0', '31.0', '0', '30.0', '1.0'], 'per game, like every column');
  assert.equal(await page.locator('.stat-key-header .label span').nth(1).evaluate((el) => getComputedStyle(el).textTransform), 'none', 'reads as named');
  // Every row, owner line or not, puts each value where Sleeper's table does
  // (centered under its left-aligned header, 17px left of the header's box),
  // and all 11 columns fit in Sleeper's 796px row.
  const layout = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.stat-key-header .label')].map((l) => l.getBoundingClientRect());
    return [...document.querySelectorAll('.player-list-item')].map((row) => {
      const cellBoxes = [...row.querySelectorAll('.cell')].map((c) => c.getBoundingClientRect());
      return { offsets: [...new Set(labels.map((l, i) => Math.round(cellBoxes[i].x - l.x)))], overflow: Math.round(cellBoxes.at(-1).right - row.getBoundingClientRect().right) };
    });
  });
  for (const row of layout) {
    assert.deepEqual(row.offsets, [0], 'each value right under its label');
    assert.ok(row.overflow <= 0, `the last column fits (${row.overflow}px over)`);
  }

  // The Scoring control is here too; changing a value rescores and reranks.
  await page.locator(corner('[data-wi="toggle-open"]')).click();
  const reb = page.locator(corner('input[data-wi-key="reb"]'));
  await reb.fill(String((await reb.inputValue()) * 1 + 2));
  await shown('rebounder', '+3');
  assert.deepEqual(await cells('rebounder'), ['30.0', '70.0', '+3', '10.0', '20.0']);
  assert.deepEqual(await cells('scorer'), ['32.0', '36.0', '−1', '30.0', '2.0']);
  assert.deepEqual(await cells('veteran'), ['31.0', '33.0', '−2', '30.0', '1.0'], 'ranked per game, not on its two-game total');
  // Both places show under the badge, to check a shift at a glance.
  assert.equal(await page.locator('.player-list-item[data-id="rebounder"] .snp-places').textContent(), '#4→#1');
  assert.equal(await page.locator('.player-list-item[data-id="veteran"] .snp-places').textContent(), '#2→#4');
  assert.equal(await page.locator('.player-list-item[data-id="scorer"] .snp-places').textContent(), '#1→#2');
  assert.match(await page.locator('.player-list-item[data-id="scorer"] [data-snp-delta]').getAttribute('title'), /Rank by FPTS 1, by adminFPTS 2/);
  const color = await page.locator('.player-list-item[data-id="rebounder"] .cell').nth(1).evaluate((el) => getComputedStyle(el).color);
  assert.equal(color, 'rgb(182, 156, 255)', 'adminFPTS in the what-if color once a value changes');
  // Green up, red down, deeper for the bigger move.
  assert.equal(await badge('rebounder').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(52, 168, 83, 0.9)');
  assert.equal(await badge('scorer').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(214, 69, 80, 0.43)');
  await page.keyboard.press('Escape');

  // All three columns sort from their headers, with a thin bar under the sorted one.
  const sortedLabel = () => page.locator('.stat-key-header .label').evaluateAll((els) => els.filter((el) => el.hasAttribute('data-snp-sorted')).map((el) => el.textContent));
  assert.deepEqual(await order(), ['veteran', 'scorer', 'guard', 'rebounder'], "sorted by FPTS (Sleeper's own column sorts on totals)");
  assert.deepEqual(await sortedLabel(), ['FPTS']);
  assert.equal(await page.locator('.stat-key-header .label[data-snp-sorted]').evaluate((el) => getComputedStyle(el, '::after').backgroundColor), 'rgb(0, 206, 184)');
  await page.locator('.stat-key-header .label', { hasText: 'admin FPTS' }).click();
  assert.deepEqual(await order(), ['rebounder', 'scorer', 'guard', 'veteran'], 'sorted by adminFPTS per game, as shown');
  await page.waitForFunction(() => document.querySelector('.stat-key-header .label[data-snp-sorted]')?.textContent === 'admin FPTS');
  await page.locator('.stat-key-header .label', { hasText: 'admin Delta' }).click();
  assert.deepEqual(await order(), ['rebounder', 'scorer', 'guard', 'veteran'], 'sorted by adminDelta, biggest riser first');
  await shown('rebounder', '+3');
  await page.waitForFunction(() => document.querySelector('.stat-key-header .label[data-snp-sorted]')?.textContent === 'admin Delta');
  await page.screenshot({ path: `${OUT}whatif-players.png` });
  await page.locator('.stat-key-header .label', { hasText: /^FPTS$/ }).click();
  assert.deepEqual(await order(), ['veteran', 'scorer', 'guard', 'rebounder']);

  // Ranks are within the list on screen: among guards only, nobody moves.
  await page.locator('.filters [data-pos="PG"]').click();
  await shown('scorer', '0');
  assert.equal(await badge('guard').textContent(), '0');
  await page.locator('.filters [data-pos="ALL"]').click();
  await shown('scorer', '−1');

  // Reset brings adminFPTS back to FPTS.
  await page.locator(corner('[data-wi="toggle-open"]')).click();
  await page.locator(corner('[data-wi="reset"]')).click();
  await shown('rebounder', '0');
  assert.deepEqual(await cells('rebounder'), ['30.0', '30.0', '0', '10.0', '20.0']);
  await page.keyboard.press('Escape');

  // ?snp-admin=0 (here pushed the way Sleeper's router moves) takes the columns and the control away, and it sticks.
  await page.evaluate(() => history.pushState({}, '', `${location.pathname}?snp-admin=0`));
  await page.waitForFunction(() => document.querySelectorAll('.stat-key-header .label').length === 9);
  assert.deepEqual(await labels(), ['FPTS', 'MIN', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO']);
  await page.locator(corner('.wi-dock')).waitFor({ state: 'detached' });
  await page.goto(PLAYERS_URL);
  await page.waitForTimeout(1500);
  assert.equal((await labels()).length, 9, 'still off after a reload');
  assert.equal(await page.locator(corner('.wi-dock')).count(), 0);
  documentBody = LOGGED_OUT;
});

const nflDialog = (sel = '') => `#sleeper-nfl-dialog ${sel}`;
// The Players tab remembers your view per league in the page's storage; each test starts without one.
async function forgetPlayersView() {
  await page.goto(PLAYERS_URL);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('snp:players-view:')).forEach((k) => localStorage.removeItem(k)));
}

test('players tab opens on Projection for the current week, then on whatever you had on last', async () => {
  const STAT_KEYS = ['fpts', 'sp', 'pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'to'];
  const players = [{ id: 'guard', pos: 'PG', team: 'LAL', stats: { fpts: 10, fpts_proj: 12, pts: 10 } }];
  const dropdown = page.locator('.app-dropdown');
  documentBody = playersTable(players, { statType: 'stat', statInterval: 'season', statKeys: STAT_KEYS, sort: 'fpts' }, { leg: 2 });
  await forgetPlayersView();
  await page.goto(PLAYERS_URL);
  await page.waitForFunction(() => panel.state.statType === 'proj' && panel.state.statInterval === 2, null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => panel.fetched), [['proj', 2]], 'loaded the way Sleeper\'s own dropdown loads a week');
  await page.waitForFunction(() => document.querySelector('.app-dropdown').textContent === 'Week 2');
  // What the user picks next sticks.
  await page.evaluate(() => panel.setState({ statType: 'stat', statInterval: 'season' }));
  await page.waitForTimeout(1200);
  assert.deepEqual(await page.evaluate(() => [panel.state.statType, panel.state.statInterval, panel.fetched.length]), ['stat', 'season', 1]);
  assert.equal(await dropdown.textContent(), 'Season');
  // And comes back next time: Stats for the season.
  await page.goto(PLAYERS_URL);
  await page.waitForFunction(() => panel.state.statType === 'stat' && panel.state.statInterval === 'season', null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => panel.fetched), [], 'already what Sleeper opened on');
  // Stats for this week, on Worst with Shooting: all of it comes back.
  await page.waitForFunction(() => panel.snpOpenedFor);
  await page.evaluate(() => panel.setState({ statInterval: 2, leg: 2 }));
  await page.locator('.snp-week-pick button', { hasText: 'Worst' }).click();
  await page.locator('.snp-shot-toggle').click();
  await page.waitForFunction(() => panel.state.statKeys.includes('fta'));
  // From the first frame: the table is never seen until it's the view you had, with our columns in.
  await page.addInitScript(() => {
    if (!localStorage.getItem('snp-test-frames')) return;
    window.__frames = [];
    const sample = () => {
      const el = document.querySelector('.integration-players-panel');
      // The stand-in's panel is a top-level const: reachable by name, not on window.
      // eslint-disable-next-line no-undef
      if (el && typeof panel !== 'undefined') {
        window.__frames.push({ visible: getComputedStyle(el).visibility === 'visible', type: panel.state.statType, interval: panel.state.statInterval, keys: panel.state.statKeys.join() });
      }
      if (window.__frames.length < 600) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.evaluate(() => localStorage.setItem('snp-test-frames', '1'));
  await page.goto(PLAYERS_URL);
  await page.waitForFunction(() => panel.state.statType === 'stat' && panel.state.statInterval === 2, null, { timeout: 30000 });
  await page.locator('.snp-week-pick [aria-checked="true"]', { hasText: 'Worst' }).waitFor();
  await page.waitForFunction(() => window.__frames.some((f) => f.visible));
  const frames = await page.evaluate(() => { localStorage.removeItem('snp-test-frames'); return window.__frames; });
  const early = frames.filter((f) => f.visible && !(f.type === 'stat' && f.interval === 2 && f.keys.includes('Week') && f.keys.includes('fta')));
  assert.deepEqual(early, [], 'shown only once settled');
  assert.ok(frames.some((f) => !f.visible), 'hidden while it settled');
  await page.waitForFunction(() => panel.state.statKeys.includes('fta'));
  assert.equal(await page.locator('.snp-shot-toggle').getAttribute('aria-pressed'), 'true');
  // That was the current week, so when the next one starts, it opens on that one.
  documentBody = playersTable(players, { statType: 'stat', statInterval: 'season', statKeys: STAT_KEYS, sort: 'fpts' }, { leg: 3 });
  await page.goto(PLAYERS_URL);
  await page.waitForFunction(() => panel.state.statType === 'stat' && panel.state.statInterval === 3, null, { timeout: 30000 });
  // A past week stays that week.
  await page.waitForFunction(() => panel.snpOpenedFor);
  await page.evaluate(() => panel.setState({ statType: 'proj', statInterval: 1, leg: 1 }));
  await page.waitForTimeout(700);
  await page.goto(PLAYERS_URL);
  await page.waitForFunction(() => panel.state.statType === 'proj' && panel.state.statInterval === 1, null, { timeout: 30000 });

  // Already on this week: nothing to load, but Sleeper's dropdown reads "2026" until fixed.
  documentBody = playersTable(players, { statInterval: 1 }, { leg: 1 });
  await forgetPlayersView();
  await page.goto(PLAYERS_URL);
  await page.waitForFunction(() => document.querySelector('.app-dropdown').textContent === 'Week 1', null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => panel.fetched), []);
  await forgetPlayersView();
  documentBody = LOGGED_OUT;
});
test('players tab in Stats: games played, games left, shooting at the end, and a week\'s best or worst game', async () => {
  // Each team's first game is final; the shooter's big game and the steady one are those.
  await startMidWeek();
  const { data } = await (await fetch('https://sleeper.com/graphql', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'query scores { scores(sport: "nba", season_type: "regular", season: "2026", week: 1) { game_id date status start_time metadata } }' }),
  })).json();
  fakeMidWeek(data.scores);
  const plays = (team) => (g) => [g.metadata?.home_team?.team, g.metadata?.away_team?.team].includes(team);
  const first = (team) => data.scores.find((g) => plays(team)(g) && sleeper.finished.has(g.game_id)).game_id;
  sleeper.weekStats = [
    { player_id: 'shooter', game_id: first('LAL'), stats: { sp: 2000, pts: 30, fgm: 12, fga: 20, tpa: 6, ftm: 4, fta: 5 } },
    { player_id: 'shooter', game_id: 'g2', stats: { sp: 1500, pts: 6, fgm: 3, fga: 14, tpa: 2 } },
    // A game sat out comes back with no stats, and is nobody's worst (and not a game played).
    { player_id: 'shooter', game_id: 'g3', stats: {} },
    { player_id: 'steady', game_id: first('BOS'), stats: { sp: 1800, pts: 20, fgm: 8, fga: 15, tpa: 1, ftm: 4, fta: 4 } },
  ];
  const STAT_KEYS = ['fpts', 'sp', 'pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'to'];
  documentBody = playersTable([
    // Sleeper's week stats are per game already, with no games-played count.
    // Projected the other way round from how they scored.
    { id: 'shooter', pos: 'SG', team: 'LAL', stats: { fpts: 18, fpts_proj: 30, sp: 1750, pts: 18, fgm: 7.5, fga: 17, tpa: 4, ftm: 2, fta: 2.5 } },
    { id: 'steady', pos: 'C', team: 'BOS', stats: { fpts: 20, fpts_proj: 10, sp: 1800, pts: 20, fgm: 8, fga: 15, tpa: 1, ftm: 4, fta: 4 } },
  ], { statType: 'stat', statInterval: 1, statKeys: STAT_KEYS, sort: 'fpts_proj' });
  await forgetPlayersView();
  await page.goto(PLAYERS_URL);
  const labels = () => page.locator('.stat-key-header .label').allTextContents();
  // A cell as it reads: our number when one is drawn over Sleeper's.
  await page.evaluate(() => {
    window.readCell = (id, key) => {
      const el = document.querySelectorAll(`.player-list-item[data-id="${id}"] .cell`)[panel.state.statKeys.indexOf(key)];
      return el && (el.querySelector('.snp-value')?.textContent ?? el.textContent);
    };
  });
  const cell = (id, key) => page.evaluate(([i, k]) => readCell(i, k), [id, key]);
  const cellIs = (id, key, text) => page.waitForFunction(([i, k, t]) => readCell(i, k) === t, [id, key, text]);
  await page.waitForFunction(() => panel.state.statKeys.includes('GP') && panel.state.statKeys.includes('Week'), null, { timeout: 30000 });
  assert.deepEqual(await labels(), ['FPTS', 'GP', 'Week', 'MIN', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO'], 'shooting stays out until asked for');
  // The week at a glance: a mark a day, played, on now, still to play, from each team's schedule.
  const strip = (id) => page.evaluate((i) => {
    const el = document.querySelectorAll(`.player-list-item[data-id="${i}"] .cell`)[panel.state.statKeys.indexOf('Week')]?.querySelector('.snp-week');
    return el && { marks: [...el.children].map((m) => m.className), count: el.getAttribute('aria-label') };
  }, id);
  await page.waitForFunction(() => document.querySelectorAll('.snp-week i').length === 14, null, { timeout: 30000 });
  // The strip's week: Monday of the first game day, for seven days (later games the fake moved past it drop out).
  const firstDay = data.scores.map((g) => g.date).sort()[0];
  const monday = Date.parse(`${firstDay}T12:00:00Z`) - ((new Date(`${firstDay}T12:00:00Z`).getUTCDay() + 6) % 7) * 864e5;
  const inWeek = (g) => Date.parse(`${g.date}T12:00:00Z`) < monday + 7 * 864e5;
  const lal = data.scores.filter((g) => plays('LAL')(g) && inWeek(g));
  // A game played wears its score's color, by the league's scoring.
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE}`)).json();
  const fpts = (stats) => Object.entries(stats).reduce((sum, [k, v]) => sum + v * (league.scoring_settings[k] ?? 0), 0);
  // Score colors are the league's own (the thirds of its starters' recent games), as the extension worked them out.
  const tiers = await page.evaluate(() => {
    let out = null;
    const take = (e) => { out = JSON.parse(e.detail)?.tiers; };
    document.addEventListener('snp:week-schedule', take);
    document.dispatchEvent(new CustomEvent('snp:week-schedule-request', { detail: JSON.stringify({ season: '2026', week: 1 }) }));
    document.removeEventListener('snp:week-schedule', take);
    return out;
  });
  assert.ok(tiers?.all[0] > 5 && tiers.all[1] > tiers.all[0], `score colors from the league's games: ${JSON.stringify(tiers)}`);
  const tier = (points) => (points >= tiers.all[1] ? 'green' : points >= tiers.all[0] ? 'yellow' : 'red');
  const big = fpts(sleeper.weekStats[0].stats);
  await page.waitForFunction((t) => document.querySelector('.player-list-item[data-id="shooter"] .snp-week i.done')?.classList.contains(t), tier(big), { timeout: 30000 });
  const marks = (await strip('shooter')).marks;
  assert.equal(marks.length, 7);
  assert.equal(marks.filter((m) => m !== 'none').length, lal.length, 'one mark per Lakers game');
  assert.deepEqual(marks.filter((m) => m.startsWith('done')), [`done ${tier(big)}`], 'their one game played, in its color');
  assert.ok((await strip('steady')).marks.includes(`done ${tier(fpts(sleeper.weekStats[3].stats))}`));
  const left = marks.filter((m) => m === 'left').length;
  assert.equal((await strip('shooter')).count, `${left} game${left === 1 ? '' : 's'} left this week`);
  // Hovering a mark says the game and its score; one still to play, its tip-off.
  const cardOf = async (selector) => {
    await page.locator(selector).first().hover();
    const card = page.locator('.snp-week-tip');
    await card.waitFor();
    return card.innerText();
  };
  const whole = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const played = await cardOf('.player-list-item[data-id="shooter"] .snp-week i.done');
  assert.match(played, new RegExp(`^\\w{3} (vs|@) \\w+\\s+${whole(big).replace('.', '\\.')}\\n${left} games? left this week$`));
  assert.equal(await page.locator('.snp-week-tip .snp-tip-score').getAttribute('class'), `snp-tip-score ${tier(big)}`);
  await page.screenshot({ path: `${OUT}players-week-hover.png` });
  if (left) assert.match(await cardOf('.player-list-item[data-id="shooter"] .snp-week i.left'), /^\w{3} (vs|@) \w+\s+\d{1,2}:\d\d\s?[AP]M\n/);
  await page.mouse.move(0, 0);
  await page.locator('.snp-week-tip').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => panel.state.playerStatsMap.shooter.Week), left, 'sorts by games left');
  // Shooting: shot volume, which doesn't score, at the end of the table and dimmed,
  // from a +/- at the end of the column header (Sleeper's filter row has no room).
  const shootingBox = page.locator('.table-header .snp-shot-toggle');
  assert.equal(await shootingBox.textContent(), '+');
  assert.equal(await shootingBox.getAttribute('aria-pressed'), 'false');
  assert.match(await shootingBox.getAttribute('title'), /^Show shooting: FGM, FGA, 3PA, FTM, FTA/);
  assert.equal(await page.locator('.filter-row .snp-shooting').count(), 0, 'nothing added to the filter row');
  await shootingBox.click();
  await page.waitForFunction(() => panel.state.statKeys.includes('fta'));
  assert.deepEqual(await labels(), ['FPTS', 'GP', 'Week', 'MIN', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO', 'Fgm', 'Fga', '3pa', 'Ftm', 'Fta']);
  assert.equal(await shootingBox.textContent(), '−');
  assert.equal(await shootingBox.getAttribute('aria-pressed'), 'true');
  await cellIs('shooter', 'GP', '2');
  assert.equal(await cell('steady', 'GP'), '1');
  // Sleeper leaves Stats sorted by the projection, which isn't a column; it sorts by the FPTS shown instead.
  const order = () => page.locator('.player-list-item').evaluateAll((rows) => rows.map((r) => r.dataset.id));
  // Highest first by what a column shows (picked games included).
  const byShown = (key) => page.evaluate((k) => Object.keys(panel.state.playerStatsMap)
    .sort((a, b) => (panel.state.playerStatsMap[b][k] || -1) - (panel.state.playerStatsMap[a][k] || -1)), key);
  await page.waitForFunction(() => panel.state.sort === 'fpts');
  assert.deepEqual(await order(), ['steady', 'shooter']);
  assert.deepEqual([await cell('shooter', 'pts'), await cell('shooter', 'fga'), await cell('shooter', 'fta')], ['18.0', '17.0', '2.5'], 'the week average, as Sleeper shows it');
  // They don't score, so they're dimmed; Sleeper's own columns and GP aren't.
  const opacity = (id, key) => page.evaluate(([i, k]) =>
    getComputedStyle(document.querySelectorAll(`.player-list-item[data-id="${i}"] .cell`)[panel.state.statKeys.indexOf(k)]).opacity, [id, key]);
  assert.equal(await page.locator('.stat-key-header .label[data-key="fga"]').evaluate((el) => getComputedStyle(el).opacity), '0.5');
  assert.deepEqual([await opacity('shooter', 'fga'), await opacity('shooter', 'pts'), await opacity('shooter', 'GP')], ['0.5', '1', '1']);
  // All 16 columns fit: no sideways scroll, each value under its header.
  const layout = () => page.evaluate(() => {
    const header = document.querySelector('.stat-key-header');
    const labels = [...header.querySelectorAll('.label')].map((l) => l.getBoundingClientRect());
    const box = document.querySelector('.integration-players-panel');
    return {
      header: Math.round(labels.at(-1).right + 2 - header.getBoundingClientRect().right),
      scroll: box.scrollWidth - box.clientWidth,
      rows: [...document.querySelectorAll('.player-list-item')].map((row) => {
        const cells = [...row.querySelectorAll('.cell')].map((c) => c.getBoundingClientRect());
        return { offsets: [...new Set(labels.map((l, i) => Math.round(cells[i].x - l.x)))], overflow: Math.round(cells.at(-1).right + 2 - row.getBoundingClientRect().right) };
      }),
    };
  });
  const fits = async () => {
    const { header, scroll, rows } = await layout();
    assert.ok(header <= 0, `the last header fits (${header}px over)`);
    assert.ok(scroll <= 0, `no sideways scroll (${scroll}px)`);
    for (const row of rows) {
      assert.deepEqual(row.offsets, [0], 'each value right under its label');
      assert.ok(row.overflow <= 0, `the last column fits (${row.overflow}px over)`);
    }
  };
  await fits();

  // The week's switch sits in the table's corner; Best and Worst swap in a single game, in whole numbers.
  const pick = page.locator('.table-header .snp-week-pick');
  assert.deepEqual(await pick.locator('button').allTextContents(), ['Avg', 'Best', 'Worst']);
  assert.equal(await pick.locator('[aria-checked="true"]').textContent(), 'Avg');
  // Centered on the labels' text, not their padded box, and inside the header.
  const centers = await page.evaluate(() => {
    const mid = (el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2; };
    const header = document.querySelector('.table-header').getBoundingClientRect();
    const box = document.querySelector('.snp-week-pick').getBoundingClientRect();
    return { pick: mid(document.querySelector('.snp-week-pick')), text: mid(document.querySelector('.stat-key-header > .label > span')), inside: box.top >= header.top && box.bottom <= header.bottom };
  });
  assert.ok(Math.abs(centers.pick - centers.text) <= 1, `centered on the labels (${centers.pick} vs ${centers.text})`);
  assert.ok(centers.inside, 'within the header');
  await page.screenshot({ path: `${OUT}players-stats-week.png` });
  await pick.locator('button', { hasText: 'Best' }).click();
  await cellIs('shooter', 'pts', '30');
  assert.ok(!(await labels()).includes('GP'), 'one game each');
  assert.deepEqual(await order(), await byShown('fpts'), 'sorted by the best game\'s FPTS');
  assert.deepEqual([await cell('shooter', 'sp'), await cell('shooter', 'fga'), await cell('shooter', 'fta'), await cell('steady', 'pts')], ['33', '20', '5', '20']);
  assert.equal(await pick.locator('[aria-checked="true"]').textContent(), 'Best');
  await fits();
  await page.screenshot({ path: `${OUT}players-stats-best.png` });
  await pick.locator('button', { hasText: 'Worst' }).click();
  await cellIs('shooter', 'pts', '6');
  assert.deepEqual(await order(), ['steady', 'shooter'], 'the shooter\'s worst game sinks them');
  assert.deepEqual([await cell('shooter', 'fga'), await cell('shooter', 'fta')], ['14', '0'], 'no free throws that game');
  // A column sort carries over: by PTS, then the best games.
  await page.locator('.stat-key-header .label[data-key="pts"]').click();
  await pick.locator('button', { hasText: 'Best' }).click();
  await cellIs('shooter', 'pts', '30');
  assert.equal(await page.evaluate(() => panel.state.sort), 'pts');
  assert.deepEqual(await order(), ['shooter', 'steady'], '30 points beats 20');
  await pick.locator('button', { hasText: 'Avg' }).click();
  await cellIs('shooter', 'pts', '18.0');
  await cellIs('shooter', 'GP', '2');
  assert.equal(await page.locator('.player-list-item [data-snp-cell]').count(), 4, 'only GP and the week are drawn over');
  assert.deepEqual(await order(), ['steady', 'shooter'], 'back to the averages, still by PTS');
  // Sorted by GP, Best drops the column, so FPTS takes over; back on Avg it stays FPTS.
  await page.locator('.stat-key-header .label[data-key="GP"]').click();
  assert.deepEqual(await order(), ['shooter', 'steady']);
  await pick.locator('button', { hasText: 'Best' }).click();
  await page.waitForFunction(() => panel.state.sort === 'fpts');
  assert.deepEqual(await order(), await byShown('fpts'));
  await pick.locator('button', { hasText: 'Avg' }).click();
  await cellIs('shooter', 'pts', '18.0');

  // The whole season has no switch or GP, and Projection has no volume columns.
  await page.locator('.table-header .snp-week-pick button', { hasText: 'Best' }).click();
  await cellIs('shooter', 'pts', '30');
  await page.evaluate(() => panel.setState({ statInterval: 'season' }));
  await pick.waitFor({ state: 'detached' });
  await cellIs('shooter', 'pts', '18.0');
  assert.ok(!(await labels()).includes('GP'));
  assert.ok(!(await labels()).includes('Week'), 'no week strip for a season');
  assert.equal(await page.locator('.player-list-item [data-snp-cell]').count(), 0, 'Sleeper\'s numbers again');
  await page.evaluate(() => panel.setState({ statType: 'proj', statInterval: 1, statKeys: ['fpts_proj', 'sp', 'pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'to'], sort: 'fpts_proj' }));
  await page.waitForFunction(() => !panel.state.statKeys.includes('fga'));
  assert.deepEqual(await labels(), ['FPTS', 'Week', 'MIN', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO'], 'a week\'s projection: games left, no shooting');
  assert.equal(await shootingBox.count(), 0, 'Shooting is a Stats thing');
  await fits();
  await page.screenshot({ path: `${OUT}players-proj-week.png` });
  await forgetPlayersView();
  sleeper.weekStats = null;
  sleeper.midWeek = false;
  documentBody = LOGGED_OUT;
});

test('players tab: a team picker beside the search, and rostered players show their team', async () => {
  const STAT_KEYS = ['fpts', 'sp', 'pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'to'];
  documentBody = playersTable([
    { id: 'mine', pos: 'PG', team: 'LAL', owner: 'Cookie Monster', stats: { fpts: 30, pts: 30 } },
    { id: 'theirs', pos: 'SG', team: 'BOS', owner: 'Cling Kong', stats: { fpts: 25, pts: 25 } },
    { id: 'alsoTheirs', pos: 'C', team: 'MIA', owner: 'Cling Kong', stats: { fpts: 20, pts: 20 } },
    { id: 'free', pos: 'SF', team: 'NYK', stats: { fpts: 15, pts: 15 } },
  ], { statType: 'stat', statInterval: 1, statKeys: STAT_KEYS, sort: 'fpts' });
  await forgetPlayersView();
  await page.goto(PLAYERS_URL);
  const rows = () => page.locator('.player-list-item').evaluateAll((els) => els.map((r) => r.dataset.id));
  const picker = page.locator('.header-top .snp-team-pick');
  await picker.waitFor({ timeout: 30000 });
  await page.waitForFunction(() => panel.state.statKeys.includes('Week'));
  assert.equal(await page.evaluate(() => document.querySelector('.snp-team-pick').previousElementSibling.className), 'player-search-wrapper', 'right after Find player');
  assert.equal(await picker.locator('.snp-team-button').innerText(), 'All teams');
  // Rostered players carry their team: its avatar (or initial) and name, in place of Sleeper's arrow and username.
  const owner = page.locator('.player-list-item[data-id="theirs"] .owner');
  await owner.locator('.snp-owner').waitFor();
  assert.equal(await owner.locator('.snp-owner > span:last-child').textContent(), 'Cling Kong');
  assert.equal(await owner.locator('.snp-owner .snp-owner-avatar').evaluate((el) => el.getBoundingClientRect().width), 16, 'big enough to tell teams apart');
  assert.equal(await owner.locator('i.fa-arrow-right').isVisible(), false);
  assert.equal(await page.locator('.player-list-item[data-id="free"] .snp-owner').count(), 0, 'free agents have none');
  // Picking a team narrows the list to its players, through Sleeper's own owner filter.
  await picker.locator('.snp-team-button').click();
  assert.deepEqual(await picker.locator('.snp-team-menu button b').allTextContents(), ['All teams', 'Cling Kong', 'Cookie Monster']);
  await page.screenshot({ path: `${OUT}players-team-menu.png` });
  await picker.locator('.snp-team-menu button', { hasText: 'Cling Kong' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.player-list-item').length === 2);
  assert.deepEqual(await rows(), ['theirs', 'alsoTheirs']);
  assert.equal(await picker.locator('.snp-team-button .snp-team-name').textContent(), 'Cling Kong');
  assert.equal(await picker.locator('.snp-team-menu').isVisible(), false, 'the menu closes');
  assert.deepEqual(await page.evaluate(() => [panel.state.filterByUser, panel.state.hideOwned]), [true, false]);
  // Arrow keys go through the teams, A to Z, and stop at the last and the first; not while typing in Find player.
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.snp-team-button .snp-team-name')?.textContent === 'Cookie Monster');
  assert.deepEqual(await rows(), ['mine']);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  assert.equal(await picker.locator('.snp-team-button .snp-team-name').textContent(), 'Cookie Monster', 'the last team stays');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('.snp-team-button .snp-team-name')?.textContent === 'Cling Kong');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  assert.equal(await picker.locator('.snp-team-button .snp-team-name').textContent(), 'Cling Kong', 'the first team stays');
  await page.locator('.player-search input').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  assert.equal(await picker.locator('.snp-team-button .snp-team-name').textContent(), 'Cling Kong', 'typing keeps the team');
  await page.locator('.player-search input').blur();
  await page.screenshot({ path: `${OUT}players-team-picked.png` });
  // It comes back next time, with the rest of the view.
  await page.waitForTimeout(700);
  await page.goto(PLAYERS_URL);
  await page.waitForFunction(() => document.querySelectorAll('.player-list-item').length === 2, null, { timeout: 30000 });
  assert.equal(await picker.locator('.snp-team-button .snp-team-name').textContent(), 'Cling Kong');
  // Free agents (Sleeper's hideOwned) and a team can't both hold: the team pick lets go.
  await page.evaluate(() => panel.setState({ hideOwned: true }));
  await page.waitForFunction(() => document.querySelector('.snp-team-button .snp-team-name')?.textContent === 'All teams');
  assert.deepEqual(await rows(), ['free']);
  // All teams again.
  await page.evaluate(() => panel.setState({ hideOwned: false }));
  await picker.locator('.snp-team-button').click();
  await picker.locator('.snp-team-menu button', { hasText: 'All teams' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.player-list-item').length === 4);
  await forgetPlayersView();
  documentBody = LOGGED_OUT;
});

test('NFL players tab: a Last 5 column of weekly scores in the league\'s colors, a team picker and team lines', async () => {
  const NFL_KEYS = ['fpts', 'rush_att', 'rush_yd', 'rush_td', 'rec', 'rec_tgt', 'rec_yd', 'rec_td', 'pass_cmp', 'pass_att', 'pass_yd', 'pass_td'];
  // Three made-up players' games, added to Sleeper's real weekly stats (which the score colors come from).
  // The QB throws for 300 and 2 TDs some weeks, 150 and none others; the TE has a bye in week 4 and sat week 5.
  const games = {
    qbx: { 2: { pass_yd: 300, pass_td: 2 }, 3: { pass_yd: 150 }, 4: { pass_yd: 300, pass_td: 2 }, 5: { pass_yd: 150 }, 6: { pass_yd: 225, pass_td: 1 } },
    tex: { 2: { rec: 6, rec_yd: 80, rec_td: 1 }, 3: { rec: 2, rec_yd: 15 }, 6: { rec: 4, rec_yd: 40 } },
    rbx: { 2: { rush_yd: 20 }, 3: { rush_yd: 20 }, 4: { rush_yd: 20 }, 5: { rush_yd: 20 }, 6: { rush_yd: 120, rush_td: 1 } },
  };
  const info = { qbx: ['QB', 'DET'], tex: ['TE', 'KC'], rbx: ['RB', 'SF'] };
  await context.route(/api\.sleeper\.app\/stats\/nfl\/2026\/\d+/, async (route) => {
    const week = Number(route.request().url().match(/\/2026\/(\d+)/)[1]);
    const res = await route.fetch();
    const rows = await res.json();
    for (const [id, byWeek] of Object.entries(games)) {
      if (byWeek[week]) rows.push({ player_id: id, team: info[id][1], opponent: 'XXX', week, player: { position: info[id][0], fantasy_positions: [info[id][0]] }, stats: { gp: 1, ...byWeek[week] } });
    }
    return route.fulfill({ response: res, json: rows });
  });
  await context.route('https://api.sleeper.app/v1/state/nfl', (route) => route.fulfill({ json: { season: '2026', season_type: 'regular', week: 7, display_week: 7, leg: 7 } }));
  const schedule = (byWeek) => Object.fromEntries(Object.entries(byWeek).map(([w, opp]) => [`week_${w}`, opp]));
  const schedulesMap = {
    DET: schedule({ 2: '@BUF', 3: 'NYJ', 4: '@CAR', 5: '@ARI', 6: 'BYE', 7: 'GB' }),
    KC: schedule({ 2: 'LV', 3: '@DEN', 4: 'BYE', 5: 'LAC', 6: '@NYJ', 7: 'SEA' }),
    SF: schedule({ 2: 'NO', 3: '@LAR', 4: 'ARI', 5: '@SEA', 6: 'DAL', 7: '@ATL' }),
  };
  // DET's week 6 is a bye here, so the QB's week 6 game above is someone else's (it doesn't show).
  delete games.qbx[6];
  const stats = (fpts) => ({ fpts, rush_att: 1 });
  documentBody = playersTable([
    // Live, in the red zone, as Sleeper marks it.
    { id: 'qbx', pos: 'QB', team: 'DET', owner: 'Cookie Monster', stats: stats(20), game: '5:28 4th 13-43 vs TB', redZone: true },
    { id: 'tex', pos: 'TE', team: 'KC', owner: 'Cling Kong', stats: stats(12) },
    { id: 'rbx', pos: 'RB', team: 'SF', stats: stats(8) },
  ], { statType: 'stat', statInterval: 6, statKeys: NFL_KEYS, sort: 'fpts' }, {
    leagueId: NFL_LEAGUE, sport: 'nfl', leg: 7, schedulesMap,
    sections: [['fantasy', 96], ['rushing', 160], ['receiving', 197], ['passing', 55]],
  });
  const NFL_PLAYERS_URL = `https://sleeper.com/leagues/${NFL_LEAGUE}/players`;
  await page.goto(NFL_PLAYERS_URL);
  // Last on week 6 in Stats (else it would open on Projection for the current week).
  await page.evaluate((id) => localStorage.setItem(`snp:players-view:${id}`, JSON.stringify({ statType: 'stat', season: '2026', interval: 6, current: false })), NFL_LEAGUE);
  await page.goto(NFL_PLAYERS_URL);
  await page.waitForFunction(() => panel.state.statKeys.includes('Last 5'), null, { timeout: 30000 });
  assert.deepEqual(await page.evaluate(() => panel.state.statKeys), ['fpts', 'Last 5', ...NFL_KEYS.slice(1)], 'right after FPTS; no NBA extras');
  // Shown once it's all in, with no layout shift.
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-snp-players-pending'), null, { timeout: 30000 });
  assert.equal(await page.locator('.snp-week-pick, .snp-shot-toggle').count(), 0);
  await page.waitForFunction(() => document.querySelectorAll('.snp-recent i').length === 15, null, { timeout: 30000 });
  // The extension's numbers: the weeks shown, everyone's scores, and the league's colors.
  const recent = await page.evaluate(() => {
    let out = null;
    const take = (e) => { out = JSON.parse(e.detail); };
    document.addEventListener('snp:recent-weeks', take);
    document.dispatchEvent(new CustomEvent('snp:recent-weeks-request', { detail: JSON.stringify({ season: '2026', week: 6 }) }));
    document.removeEventListener('snp:recent-weeks', take);
    return out;
  });
  assert.deepEqual(recent.weeks, [2, 3, 4, 5, 6], 'the five weeks through the one picked');
  for (const pos of ['QB', 'TE', 'RB']) {
    const [lo, hi] = recent.tiers.positions[pos];
    assert.ok(lo > 0 && hi > lo, `${pos} has its own colors: ${lo} / ${hi}`);
  }
  // Scored with the league's settings (as Sleeper's own FPTS are).
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${NFL_LEAGUE}`)).json();
  const fpts = (s) => Object.entries(s).reduce((sum, [k, v]) => sum + v * (league.scoring_settings[k] ?? 0), 0);
  const tier = (pos, points) => {
    const [lo, hi] = recent.tiers.positions[pos];
    return points >= hi ? 'green' : points >= lo ? 'yellow' : 'red';
  };
  const marks = (id) => page.locator(`.player-list-item[data-id="${id}"] .snp-recent i`).evaluateAll((els) => els.map((m) => m.className));
  const expect = (id, byes = []) => recent.weeks.map((w) => (byes.includes(w) ? 'none' : games[id][w] ? `done ${tier(info[id][0], fpts(games[id][w]))}` : 'done dnp'));
  assert.deepEqual(await marks('qbx'), expect('qbx', [6]), 'a bye is a faint mark');
  assert.deepEqual(await marks('tex'), expect('tex', [4]), 'a week sat out is gray');
  assert.deepEqual(await marks('rbx'), expect('rbx'));
  assert.equal(new Set(await marks('qbx')).size > 1, true, 'good and bad weeks read apart');
  // Hovering a mark: the week, the opponent and the score, in its color.
  await page.locator('.player-list-item[data-id="qbx"] .snp-recent i').nth(3).hover();
  const tip = page.locator('.snp-week-tip');
  await tip.waitFor();
  assert.equal(await tip.locator('b').textContent(), 'Week 5 @ ARI');
  assert.equal(await tip.locator('.snp-tip-score').textContent(), String(fpts(games.qbx[5])));
  assert.match(await tip.locator('.snp-tip-foot').textContent(), /a game over 4 weeks$/);
  await page.locator('.player-list-item[data-id="tex"] .snp-recent i').nth(2).hover();
  assert.deepEqual([await tip.locator('b').textContent(), await tip.locator('.snp-tip-head span').textContent()], ['Week 4', 'Bye']);
  // The Fantasy group header spans FPTS and Last 5, centered over them; the others follow their own columns.
  const spans = await page.evaluate(() => {
    const box = (el) => el.getBoundingClientRect();
    const labels = [...document.querySelectorAll('.stat-key-header > .label')].map(box);
    const at = (cls) => box(document.querySelector(`.section-header > .${cls}`));
    return { fantasy: [at('fantasy'), labels[0], labels[1]], rushing: [at('rushing'), labels[2], labels[4]], passing: [at('passing'), labels[9], labels[12]] };
  });
  for (const [name, [group, first, last]] of Object.entries(spans)) {
    assert.ok(Math.abs(group.left - first.left) <= 1 && Math.abs(group.right - last.right) <= 1, `${name} spans its columns`);
  }
  // Each row's name, position, game and team lines fit its 52px; the RZ mark stays on the game line.
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.player-list-item')].filter((row) => {
    const box = row.getBoundingClientRect();
    return [...row.querySelectorAll('.name-container > *')].some((el) => el.getBoundingClientRect().bottom > box.bottom + 0.5);
  }).map((row) => row.dataset.id));
  assert.deepEqual(overflow, [], 'nothing spills out of a row');
  const rz = await page.evaluate(() => {
    const line = document.querySelector('.player-list-item[data-id="qbx"] .game-schedule-live-description');
    const mark = line.querySelector('.rz').getBoundingClientRect();
    return { mark: [mark.width, mark.height], line: line.getBoundingClientRect().height };
  });
  assert.ok(rz.mark[0] < 24 && rz.mark[1] <= 12 && rz.line <= 13, `a small mark on the game line: ${JSON.stringify(rz)}`);
  // Values line up under their labels.
  const misaligned = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('.stat-key-header > .label')];
    const cells = [...document.querySelector('.player-list-item').querySelectorAll(':scope > .cell')];
    return labels.map((l, i) => Math.abs((l.getBoundingClientRect().left + l.getBoundingClientRect().right) / 2 - (cells[i].getBoundingClientRect().left + cells[i].getBoundingClientRect().right) / 2)).filter((d) => d > 1);
  });
  assert.deepEqual(misaligned, []);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}players-nfl.png` });
  // Sorting by Last 5 sorts by points a game over those weeks.
  await page.locator('.stat-key-header > .label', { hasText: 'Last 5' }).click();
  const avg = (id) => recent.avg[id];
  const order = await page.locator('.player-list-item').evaluateAll((els) => els.map((r) => r.dataset.id));
  assert.deepEqual(order, ['qbx', 'tex', 'rbx'].sort((a, b) => avg(b) - avg(a)));
  // The team picker and team lines, as on the NBA Players tab.
  const picker = page.locator('.header-top .snp-team-pick');
  await picker.locator('.snp-team-button').click();
  await picker.locator('.snp-team-menu button', { hasText: 'Cling Kong' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.player-list-item').length === 1);
  assert.equal(await page.locator('.player-list-item[data-id="tex"] .snp-owner > span:last-child').textContent(), 'Cling Kong');
  await context.unroute(/api\.sleeper\.app\/stats\/nfl\/2026\/\d+/);
  await context.unroute('https://api.sleeper.app/v1/state/nfl');
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('snp:players-view:')).forEach((k) => localStorage.removeItem(k)));
  documentBody = LOGGED_OUT;
});

const nflPanel = (sel = '') => `#sleeper-nfl-panel ${sel}`;

test('NFL team tab: the compact NBA layout in place of Sleeper\'s, any team from the picker, and Sleeper\'s own view a click away', async () => {
  documentBody = nflTeamTab({ wrapped: true });
  await page.goto(NFL_TEAM_URL);
  await page.locator(nflPanel('.team-card')).waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.postdraft-panel > .scrollbar-container').isVisible(), false, "Sleeper's own tab is hidden, still on the page");
  assert.equal(await page.locator('.team-roster').count(), 1);
  const [rosters, users, league] = await Promise.all(['rosters', 'users', ''].map(async (x) => (await fetch(`https://api.sleeper.app/v1/league/${NFL_LEAGUE}${x ? `/${x}` : ''}`)).json()));
  const slots = league.roster_positions.filter((p) => p !== 'BN');
  // A row per starter, slot by slot, then the bench; every player named.
  const starters = page.locator(nflPanel('.card.nfl')).filter({ has: page.locator('.slot:not(.bn):not(.ir):not(.tx)') });
  assert.equal(await starters.count(), slots.length);
  assert.equal(await page.locator(nflPanel('.card.nfl .name')).filter({ hasText: /^Player #/ }).count(), 0, 'names from Sleeper\'s rows');
  // Compact: a row is two short lines.
  const heights = await page.locator(nflPanel('.card.nfl')).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  assert.ok(Math.max(...heights) <= 48, `rows at most 48px, as on NBA (${Math.max(...heights)})`);
  assert.match(await page.locator(nflPanel('.card.nfl .line2')).first().textContent(), /\d+% Start\s*\|\s*\d+% Rostered/);
  await page.screenshot({ path: `${OUT}nfl-team.png` });
  // Last week: every game final, points in their score colors.
  await page.locator(nflPanel('.week-nav [data-action="prev"]')).click();
  await page.locator(nflPanel('.week-label b')).filter({ hasText: 'Week 6' }).waitFor({ timeout: 30000 });
  await page.locator(nflPanel('.nfl-game.done')).first().waitFor({ timeout: 30000 });
  assert.match(await page.locator(nflPanel('.nfl-game.done b')).first().textContent(), /· Final [WLT] \d+-\d+$/);
  assert.ok(await page.locator(nflPanel('.week-pts b[class^="tier-"]')).count() > 0, 'finished games in their score colors');
  // Any team from the picker, with its avatar and name, A to Z; arrow keys go through them.
  const name = (r) => users.find((u) => u.user_id === r.owner_id)?.metadata?.team_name || users.find((u) => u.user_id === r.owner_id)?.display_name;
  const teams = rosters.map(name).sort((a, b) => a.localeCompare(b)).map((x) => x.trim());
  await page.locator(nflPanel('.tp-button')).click();
  assert.deepEqual((await page.locator(nflPanel('.tp-menu [data-pick-roster] b')).allTextContents()).map((x) => x.trim()), teams);
  await page.locator(nflPanel('.tp-menu [data-pick-roster]')).nth(2).click();
  await page.locator(nflPanel('.team-card .team-name')).filter({ hasText: teams[2] }).waitFor();
  await page.keyboard.press('ArrowDown');
  await page.locator(nflPanel('.team-card .team-name')).filter({ hasText: teams[3] }).waitFor();
  // A player's name opens Sleeper's own player card, for that player.
  const firstId = await page.locator(nflPanel('.card.nfl .line1 button.name')).first().getAttribute('data-player');
  await page.locator(nflPanel('.card.nfl .line1 button.name')).first().click();
  await page.waitForFunction(() => window.__nflModals.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__nflModals[0]), { type: 'PlayerCard', playerId: firstId, ids: [firstId], known: true });
  // Logged out, nothing to edit.
  assert.equal(await page.locator(nflPanel('button.slot, .optimize')).count(), 0);
  // Sleeper's own tab, and back.
  await page.locator(nflPanel('[data-action="sleeper-view"]')).click();
  await page.locator('.postdraft-panel > .scrollbar-container').waitFor();
  assert.equal(await page.locator('#sleeper-nfl-panel').count(), 0);
  await page.reload();
  await page.locator('#snp-nfl-back').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('#sleeper-nfl-panel').count(), 0, 'remembered');
  await page.locator('#snp-nfl-back').click();
  await page.locator(nflPanel('.team-card')).waitFor();
  assert.equal(await page.locator('.postdraft-panel > .scrollbar-container').isVisible(), false);
  documentBody = LOGGED_OUT;
});

test('NFL team tab, logged in: your lineup swaps from its slot badges and Optimize lineup sits in the toolbar, as on NBA', async () => {
  const users = await (await fetch(`https://api.sleeper.app/v1/league/${NFL_LEAGUE}/users`)).json();
  const rosters = await (await fetch(`https://api.sleeper.app/v1/league/${NFL_LEAGUE}/rosters`)).json();
  const me = users.find((u) => u.display_name === 'louhow');
  const mine = rosters.find((r) => r.owner_id === me.user_id);
  sleeper.me = me.user_id;
  // Sleeper's Team tab on next week, when nobody has kicked off.
  await context.route('https://api.sleeper.app/v1/state/nfl', (route) => route.fulfill({ json: { season: '2026', season_type: 'regular', week: 7, display_week: 7, leg: 7 } }));
  documentBody = nflTeamTab({ wrapped: true, rosterId: mine.roster_id, round: 8, token: true });
  await page.goto(NFL_TEAM_URL);
  await page.locator(nflPanel('.team-card')).waitFor({ timeout: 30000 });
  assert.match(await page.locator(nflPanel('.team-card .team-name')).textContent(), new RegExp(me.metadata?.team_name || me.display_name));
  // Week 7 isn't the one Sleeper's Team tab shows, so it can't be edited from here.
  assert.equal(await page.locator(nflPanel('button.slot')).count(), 0);
  await page.locator(nflPanel('.week-nav [data-action="next"]')).click();
  await page.locator(nflPanel('.week-label b')).filter({ hasText: 'Week 8' }).waitFor();
  await page.locator(nflPanel('button.slot')).first().waitFor({ timeout: 30000 });
  // Optimize lineup, in the toolbar as on the NBA Team tab, opens the dialog.
  const optimize = page.locator(nflPanel('.tools button.optimize'));
  assert.equal(await optimize.textContent(), 'Optimize lineup');
  await optimize.click();
  await page.locator(nflDialog('.os-row')).first().waitFor();
  await page.keyboard.press('Escape');
  await page.locator(nflDialog('.modal')).waitFor({ state: 'detached' });
  // A swap: a starter's badge, then one of the highlighted players.
  await page.locator(nflPanel('.card.nfl button.slot')).first().click();
  await page.locator(nflPanel('.card.nfl.target')).first().waitFor();
  assert.match(await page.locator(nflPanel('.rhead .hint')).first().textContent(), /Pick a player to swap with .+ · Esc to cancel/);
  await page.screenshot({ path: `${OUT}nfl-team-swap.png` });
  const before = await page.evaluate(() => window.__nflSaves.length);
  await page.locator(nflPanel('.card.nfl.target button.slot')).first().click();
  await page.locator(nflPanel('.notice.ok')).waitFor({ timeout: 30000 });
  const saves = await page.evaluate(() => window.__nflSaves);
  assert.equal(saves.length, before + 1);
  const [leagueId, rosterId, round] = saves.at(-1);
  assert.deepEqual([leagueId, rosterId, round], [NFL_LEAGUE, mine.roster_id, 8], "through Sleeper's own updateMatchupLeg");
  assert.notDeepEqual(saves.at(-1)[4], mine.starters, 'the lineup changed');
  await context.unroute('https://api.sleeper.app/v1/state/nfl');
  sleeper.me = null;
  documentBody = LOGGED_OUT;
});

test('NFL matchup tab: the League tab\'s card on top, the picker picks a matchup, rows slot by slot', async () => {
  documentBody = nflTeamTab({ wrapped: true });
  await page.goto(`https://sleeper.com/leagues/${NFL_LEAGUE}/matchup`);
  const head = page.locator(nflPanel('.lg-match.nfl-mu-head'));
  await head.waitFor({ timeout: 30000 });
  assert.equal(await head.locator('.mu-team').count(), 2, 'both teams, as on the League tab');
  assert.match(await head.locator('.mu-meta').first().textContent(), /\d+% WIN/);
  const league = await (await fetch(`https://api.sleeper.app/v1/league/${NFL_LEAGUE}`)).json();
  const slots = league.roster_positions.filter((p) => p !== 'BN');
  assert.ok(await page.locator(nflPanel('.mu-row')).count() >= slots.length);
  assert.equal(await page.locator(nflPanel('.mu-row')).first().locator('.mp.nfl').count(), 2);
  await page.screenshot({ path: `${OUT}nfl-matchup.png` });
  // The picker lists matchups, both teams each.
  const pick = page.locator(nflPanel('.pair-pick'));
  await pick.locator('.tp-button').click();
  const options = pick.locator('.tp-menu [data-pick-roster]');
  assert.equal(await options.count(), league.settings.num_teams / 2);
  const [a, b] = (await options.nth(3).locator('.tp-name').allTextContents()).map((x) => x.trim());
  await options.nth(3).click();
  await head.locator('.mu-team.mine .team-name').filter({ hasText: a }).waitFor();
  assert.equal((await head.locator('.mu-team.theirs .team-name').textContent()).trim(), b);
  // A player's name opens Sleeper's player card, whoever's side they're on.
  const theirId = await page.locator(nflPanel('.mp.nfl.theirs .name button')).first().getAttribute('data-player');
  await page.locator(nflPanel('.mp.nfl.theirs .name button')).first().click();
  await page.waitForFunction(() => window.__nflModals.length === 1);
  assert.equal(await page.evaluate(() => window.__nflModals[0].playerId), theirId);
  // A team's name, owner or avatar opens it on the Team tab, as on NBA.
  await head.locator('.mu-team.theirs .team-name .team-link').click();
  await page.waitForURL(`**/leagues/${NFL_LEAGUE}/team`);
  await page.locator(nflPanel('.team-card .team-name')).filter({ hasText: b }).waitFor({ timeout: 30000 });
  documentBody = LOGGED_OUT;
});

test('NFL league tab: the week\'s matchups as the NBA League tab draws them, with Sleeper\'s own live numbers', async () => {
  documentBody = nflLeagueTab();
  await page.goto(NFL_LEAGUE_URL);
  const cards = page.locator('#sleeper-nfl-league .lg-match');
  await cards.first().waitFor({ timeout: 30000 });
  assert.equal(await cards.count(), 2);
  assert.deepEqual(await page.locator('.league-matchup-row-item').evaluateAll((els) => els.map((el) => el.checkVisibility())), [false, false], 'Sleeper\'s own cards stay, hidden');
  // Nothing of Sleeper's list takes room under ours.
  const gap = await page.evaluate(() => document.querySelector('.league-tab-standings').getBoundingClientRect().top - document.querySelector('#sleeper-nfl-league').getBoundingClientRect().bottom);
  assert.ok(gap < 24, `the standings follow the cards (${gap}px)`);
  assert.equal(await page.locator('.league-tab-standings').isVisible(), true, 'the rest of the tab stays');
  // Yours first, framed; each side as Sleeper shows it: owner, team, score, win chance and bar, record, projection.
  const first = cards.first();
  assert.match(await first.getAttribute('class'), /\bown\b/);
  assert.match(await first.innerText(), /^@louhow\s+Lou Point Conversion\s+19\.40\s+90% WIN\s+8-4\s+122\.23\s+VS\s+@kalviar\s+Tank you, Jeremiah\s+6\.60\s+10% WIN\s+3-9\s+71\.77$/);
  assert.equal(await first.locator('.mu-team.mine .mu-bar span').evaluate((el) => el.style.width), '90%');
  // Sleeper's avatar; one the CDN doesn't have (as here) draws as the plain circle, never a broken image.
  await page.waitForFunction(() => !document.querySelector('#sleeper-nfl-league').shadowRoot.querySelector('img.avatar'));
  assert.equal(await first.locator('div.avatar').count(), 2);
  const read = await page.evaluate(() => {
    let out = null;
    const take = (e) => { out = JSON.parse(e.detail); };
    document.addEventListener('snp:nfl-league', take);
    document.dispatchEvent(new CustomEvent('snp:nfl-league-request'));
    document.removeEventListener('snp:nfl-league', take);
    return out.cards[1].sides.map((t) => t.avatar);
  });
  assert.deepEqual(read, ['https://sleepercdn.com/avatars/thumbs/a1', 'https://sleepercdn.com/avatars/thumbs/a2'], 'read off Sleeper\'s card');
  await page.screenshot({ path: `${OUT}nfl-league.png` });
  // Sleeper's numbers move during games; ours follow.
  await page.evaluate(() => { document.querySelectorAll('.league-matchup-row-item')[1].querySelector('.score').textContent = '25.90'; });
  await first.locator('.mu-team.mine .mu-pts').filter({ hasText: '25.90' }).waitFor();
  // A card opens that matchup the way Sleeper's own card does.
  await cards.nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.__nflOpened), [0], 'the other matchup is Sleeper\'s first card');
  documentBody = LOGGED_OUT;
});

test('NFL optimize lineup: an OPTIMIZE button beside WAIVER and TRADE proposes and saves through Sleeper', async () => {
  documentBody = nflTeamTab();
  await page.goto(NFL_TEAM_URL);
  const button = page.locator('.user-tab-menu .actions > #snp-optimize');
  await button.waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.user-tab-menu .actions > .btn-container').first().getAttribute('id'), 'snp-optimize', 'first, left of WAIVER');
  assert.equal(await button.locator('.btn-text').textContent(), 'OPTIMIZE');
  assert.equal(await page.locator('#sleeper-nba-panel').count(), 0, 'no NBA panel on an NFL league');
  await page.locator('.user-tab-menu').screenshot({ path: `${OUT}nfl-button.png` });

  await button.click();
  await page.locator(nflDialog('.os-row')).first().waitFor();
  assert.match(await page.locator(nflDialog('.op-sum')).textContent(), /51\.00\s*→\s*68\.00\s*\+17\.00/);
  // One row per slot, in lineup order, like the NBA dialog: who comes in leads, beside who they replace.
  assert.equal(await page.locator(nflDialog('.os-row')).count(), 5);
  const names = (sel) => page.locator(nflDialog(`.os-row.swap ${sel} .dp-name b`)).allTextContents();
  // Alpha WR keeping WR with Gamma WR at FLEX adds up the same as swapping them, so nobody else moves.
  assert.deepEqual(await names('.os-p.in'), ['Gamma WR', 'Beta QB']);
  assert.deepEqual(await names('.os-p.out'), ['Beta RB', 'Beta WR']);
  // Questionable can start, flagged; Out and bye-week players don't; kicked-off players stay put.
  const questionable = page.locator(nflDialog('.os-row.swap.warning')).filter({ hasText: 'Beta QB' });
  assert.equal(await questionable.locator('.nfl-inj.watch').textContent(), 'Q');
  assert.match(await questionable.innerText(), /Questionable: check the news/);
  assert.match(await page.locator(nflDialog('.warn-banner')).textContent(), /Beta QB is Questionable/);
  const started = page.locator(nflDialog('.os-row.same')).filter({ hasText: 'Early RB' });
  assert.equal(await started.locator('.os-status').textContent(), 'Started');
  assert.equal(await page.locator(nflDialog('.os-row.same button')).count(), 0, 'slots that stay have no button');
  assert.equal(await page.locator(nflDialog('.lose-banner, [data-op-ack]')).count(), 0, 'no warnings to confirm');
  await page.locator(nflDialog('.how')).hover();
  assert.match(await page.locator(nflDialog('.how-tip')).innerText(), /^How it picks:\n1\. Every player gets a number: their projected points/);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}nfl-dialog.png` });
  assert.equal(await page.locator(nflDialog('[data-action="apply-lineup"]')).textContent(), 'Apply all');

  // Cancel saves nothing.
  await page.locator(nflDialog('.op-foot button[data-action="close-modal"]')).click();
  await page.locator(nflDialog('.modal')).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__nflSaves.length), 0);

  // A refused save keeps the dialog open with Sleeper's error.
  await page.evaluate(() => { window.__nflFail = 'Player is locked'; });
  await button.click();
  await page.locator(nflDialog('[data-action="apply-lineup"]')).click();
  assert.match(await page.locator(nflDialog('.dialog-errors')).textContent(), /Player is locked/);
  await page.evaluate(() => { window.__nflFail = null; });

  // One row on its own: the FLEX swap, and the dialog stays open on what's left.
  const flex = page.locator(nflDialog('.os-row.swap')).filter({ has: page.locator('.os-p.in', { hasText: 'Gamma WR' }) });
  await flex.locator('button.os-apply').click();
  await flex.waitFor({ state: 'detached' });
  let saves = await page.evaluate(() => window.__nflSaves);
  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1], [NFL_LEAGUE, 4, 7, 7, ['qbA', 'rbPlayed', 'wrA', 'wrC', 'wrB']], "Sleeper's own updateMatchupLeg, in season, just that slot");
  assert.match(await page.locator(nflDialog('.op-done')).textContent(), /^Saved: Gamma WR to FLEX, Beta RB to bench$/);
  assert.equal(await page.locator(nflDialog('.os-row.swap')).count(), 1, 'the SUPER_FLEX change is left');
  await page.screenshot({ path: `${OUT}nfl-row-applied.png` });
  // Apply all saves the rest.
  await page.locator(nflDialog('[data-action="apply-lineup"]')).click();
  await page.locator(nflDialog('.modal')).waitFor({ state: 'detached' });
  assert.match(await page.locator(nflDialog('.notice.ok')).textContent(), /^Saved: Beta QB to SUPER_FLEX, Beta WR to bench$/);
  saves = await page.evaluate(() => window.__nflSaves);
  assert.equal(saves.length, 3);
  assert.deepEqual(saves[2], [NFL_LEAGUE, 4, 7, 7, ['qbA', 'rbPlayed', 'wrA', 'wrC', 'qbB']]);
  await page.screenshot({ path: `${OUT}nfl-saved.png` });

  // The saved lineup is the best one now; and the button is only for your own team.
  await button.click();
  assert.match(await page.locator(nflDialog('.dialog-body')).textContent(), /already your best lineup for week 7/);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__nflTeam.memoizedProps.isTeamOwner = false; });
  await button.waitFor({ state: 'detached' });
  documentBody = LOGGED_OUT;
});

// The Premier League panel (src/epl/) loads on every league page too, and waits for the sport the core publishes.
test('the Premier League panel never mounts on an NBA league page', async () => {
  documentBody = LOGGED_OUT;
  await page.addInitScript(() => {
    window.__eplMounted = false;
    new MutationObserver(() => {
      if (document.querySelector('#sleeper-epl-panel, #sleeper-epl-dialog')) window.__eplMounted = true;
    }).observe(document, { childList: true, subtree: true });
  });
  // A slow league call, so Sleeper's placeholder is up well before anyone knows the sport.
  const slow = async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return route.fallback();
  };
  await page.route(`https://api.sleeper.app/v1/league/${LEAGUE}`, slow);
  await page.goto(TEAM_URL);
  await page.locator(panel('.card .days')).first().waitFor({ timeout: 30000 });
  await page.unroute(`https://api.sleeper.app/v1/league/${LEAGUE}`, slow);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.snpLeagueSport), `${LEAGUE}:nba`);
  assert.equal(await page.evaluate(() => window.__eplMounted), false);
});
