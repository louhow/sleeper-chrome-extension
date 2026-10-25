// The panel shell: tab bar (Match, Team, Players, League, API), team picker,
// and the body for the shown tab. Pure: (state, api log) -> HTML.
(globalThis.SEP ||= {}).view = (() => {
  const { esc, teamName, notice } = globalThis.SEP.ui;
  // The API tab is the same as NBA and NFL's.
  const { apiView } = globalThis.SNP.view;
  const PAGES = [['match', 'Match'], ['team', 'Team'], ['players', 'Players'], ['league', 'League']];

  function render(s, log) {
    const body = s.tab === 'api' ? apiView(s, log)
      : s.page === 'match' ? globalThis.SEP.matchup.render(s)
      : s.page === 'players' ? globalThis.SEP.players.render(s)
      : s.page === 'league' ? globalThis.SEP.league.render(s)
      : globalThis.SEP.team.render(s);
    return `<div class="app">${toolbar(s, log)}<div class="body" data-scroll="body">${body}</div>${s.tab === 'api' || s.modal ? '' : notice(s)}</div>`;
  }

  function toolbar(s, log) {
    const tab = (id, label) =>
      `<button role="tab" data-page="${id}" aria-selected="${s.tab === 'page' && s.page === id}" class="${s.tab === 'page' && s.page === id ? 'active' : ''}">${label}</button>`;
    const options = (s.rosters || [])
      .map((r) => `<option value="${r.roster_id}" ${r.roster_id === s.rosterId ? 'selected' : ''}>${esc(teamName(s, r))}${r.roster_id === s.myRosterId ? ' (you)' : ''}</option>`)
      .join('');
    return `<nav class="toolbar">
      <div class="tabs" role="tablist">${PAGES.map(([id, label]) => tab(id, label)).join('')}<button role="tab" data-tab="api" aria-selected="${s.tab === 'api'}" class="api-tab ${s.tab === 'api' ? 'active' : ''}">API <span class="count">${log.length}</span></button></div>
      <div class="tools">
        ${s.loggedIn ? '' : '<span class="sub" title="Log in to Sleeper to edit your lineup and add players">Logged out</span>'}
        ${options ? `<select data-action="roster" aria-label="Team to show">${options}</select>` : ''}
        <button class="icon" data-action="refresh" title="Refetch everything" aria-label="Refresh">↻</button>
      </div>
    </nav>`;
  }

  return { render };
})();
