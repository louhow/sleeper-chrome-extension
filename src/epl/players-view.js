// Players tab: available players, trending adds and drops, season leaders and
// search, each with an add (or drop) button. Pure: state -> HTML.
(globalThis.SEP ||= {}).playersView = (() => {
  const { playerGames, weekTotals, recentMarks } = globalThis.SEP.model;
  const { esc, f2, f1, pct, teamName, ownerOf, owns, playerLine, loading, errorMsg, weekday, gameTime } = globalThis.SEP.ui;
  const TABS = [['available', 'Available'], ['trending', 'Trending'], ['leaders', 'Leaders'], ['mine', 'My Team'], ['all', 'All']];
  const POSITIONS = ['ALL', 'F', 'M', 'D', 'GK'];
  const PAGE = 50;

  function render(s) {
    if (s.error) return errorMsg(s.error);
    if (!s.players || !s.rosters) return loading();
    const t = s.playersTab;
    const list = listFor(s);
    const shown = list.slice(0, t.shown || PAGE);
    const tabs = TABS.map(([id, label]) => `<button data-ptab="${id}" class="${t.mode === id ? 'active' : ''}" role="tab" aria-selected="${t.mode === id}">${label}</button>`).join('');
    const chips = POSITIONS.map((p) => `<button class="chip-btn${t.position === p ? ' active' : ''}" data-pos="${p}">${p}</button>`).join('');
    const trendToggle = t.mode === 'trending' ? `<div class="chips-row">
        <button class="chip-btn${t.trend === 'add' ? ' active' : ''}" data-trend="add">↑ Adds</button>
        <button class="chip-btn${t.trend === 'drop' ? ' active' : ''}" data-trend="drop">↓ Drops</button>
      </div>` : '';
    const faLabel = t.mode === 'available' ? `<label class="check"><input type="checkbox" data-fa-only ${t.freeAgentsOnly ? 'checked' : ''}> Free agents only</label>` : '';
    return `
      <div class="ptabs" role="tablist">${tabs}</div>
      <div class="pfilters">
        <input class="search" type="search" placeholder="Search players" value="${esc(t.query)}" data-search aria-label="Search players">
        <div class="chips-row">${chips}</div>
        ${trendToggle}${faLabel}
      </div>
      ${s.season == null && (t.mode === 'leaders' || t.mode === 'all') ? loading('Loading season stats…') : ''}
      <div class="plist-head"><span>Player</span><span class="col">Owner</span>${sortHead(t, 'last5', 'Last 5', 'Points per match over the last five gameweeks')}<span class="col num">Proj</span><span class="col num" title="Fantasy points this season">FPTS</span><span class="col num">Own%</span><span class="col act"></span></div>
      ${shown.length ? shown.map((row) => playerRow(s, row)).join('') : '<p class="msg">No players match.</p>'}
      ${list.length > shown.length ? `<button class="more" data-more>Show more (${list.length - shown.length} left)</button>` : ''}`;
  }

  // Players in the EPL player pool: active, with a club, listed for the competition.
  function pool(s) {
    if (!s.pool) {
      s.pool = Object.entries(s.players)
        .filter(([, p]) => p.active && p.team && p.positions.length && (!p.competitions || p.competitions.includes('epl')) && p.position !== 'DEF')
        .map(([id]) => id);
    }
    return s.pool;
  }

  function seasonPts(s, id) {
    return s.season?.stats?.[id]?.pts_std ?? null;
  }

  function projOf(s, id) {
    const week = s.weeks?.[s.currentWeek];
    if (!week) return null;
    const games = playerGames(week, s.players[id]?.team, id);
    return games.length ? weekTotals(games, s.now).proj : null;
  }

  function listFor(s) {
    const t = s.playersTab;
    const owned = new Set(s.rosters.flatMap((r) => r.players || []));
    const mine = new Set(s.rosters.filter((r) => owns(s, r)).flatMap((r) => r.players || []));
    const query = t.query.trim().toLowerCase();
    const byPos = (id) => t.position === 'ALL' || (s.players[id]?.positions || []).includes(t.position);
    const byQuery = (id) => !query || (s.players[id]?.search || '').includes(query);
    let ids;
    let order;
    if (t.mode === 'trending') {
      const trend = s.trending?.[t.trend] || [];
      ids = trend.map((x) => x.player_id).filter((id) => s.players[id] && s.players[id].position !== 'DEF');
      const counts = Object.fromEntries(trend.map((x) => [x.player_id, x.count]));
      order = (a, b) => (counts[b] || 0) - (counts[a] || 0);
      return bySort(s, ids.filter(byPos).filter(byQuery).sort(order)).map((id) => ({ id, count: counts[id] }));
    }
    ids = pool(s);
    if (t.mode === 'available') ids = ids.filter((id) => !owned.has(id));
    if (t.mode === 'mine') ids = ids.filter((id) => mine.has(id));
    if (t.mode === 'available' && t.freeAgentsOnly) ids = ids.filter((id) => waiverStatus(s, id) !== 'waiver');
    ids = ids.filter(byPos).filter(byQuery);
    if (t.mode === 'leaders' || t.mode === 'all' || t.mode === 'available' || t.mode === 'mine') {
      // Season points first; with none yet, by projection, then by Sleeper's search rank.
      const key = (id) => seasonPts(s, id) ?? -1;
      order = (a, b) => key(b) - key(a) || (projOf(s, b) ?? 0) - (projOf(s, a) ?? 0) || (s.players[a].rank ?? 1e9) - (s.players[b].rank ?? 1e9);
      if (query && t.mode !== 'leaders') order = (a, b) => (s.players[a].rank ?? 1e9) - (s.players[b].rank ?? 1e9);
      ids = [...ids].sort(order);
    }
    return bySort(s, ids).map((id) => ({ id }));
  }

  // A column header that sorts the list (best first); tapped again, the list goes back to its own order.
  function sortHead(t, key, label, title) {
    const on = t.sort === key;
    return `<button class="col sort${on ? ' active' : ''}" data-psort="${key}" title="${esc(title)}" aria-pressed="${on}">${label}${on ? ' ▾' : ''}</button>`;
  }

  // The list by the column picked; players with nothing in it last, in the list's own order.
  function bySort(s, ids) {
    if (s.playersTab.sort !== 'last5' || !s.recent) return ids;
    const key = (id) => s.recent.avg[id] ?? -Infinity;
    return [...ids].sort((a, b) => key(b) - key(a));
  }

  // A player's last five gameweeks: a mark each, colored by score, with what
  // the hover card shows (recentTip) in its data attributes.
  function recentStrip(s, id) {
    if (!s.recent) return '<span class="last5 empty">–</span>';
    const p = s.players[id] || {};
    const matches = s.recent.matches[id] || 0;
    const count = matches ? `${f1(s.recent.avg[id])} a game over ${matches} match${matches === 1 ? '' : 'es'}` : 'No matches in these gameweeks';
    const marks = recentMarks(s.recent, id, p.team, p.position, s.now).map((m) => {
      const versus = m.matches.map((x) => `${x.home ? 'vs' : '@'} ${x.opponent}`).join(', ');
      const kickoff = m.matches.find((x) => x.start || x.date);
      const note = m.kind === 'none' ? 'No match'
        : m.kind === 'left' ? (kickoff ? `${weekday(kickoff.date || kickoff.start)}${kickoff.start ? ` ${gameTime(kickoff.start)}` : ''}` : 'Still to play')
        : m.kind === 'live' ? (m.fpts != null ? `${f1(m.fpts)} so far` : 'On now')
        : m.kind === 'done' ? f1(m.fpts)
        : 'Didn\'t play';
      const tier = m.tier && m.kind !== 'left' ? ` data-tier="${m.tier}"` : '';
      return `<i class="${m.kind}${m.kind === 'done' && m.tier ? ` ${m.tier}` : ''}" data-tip="${esc(`GW ${m.week}${versus ? ` ${versus}` : ''}`)}" data-note="${esc(note)}"${tier} data-count="${esc(count)}"></i>`;
    }).join('');
    return `<span class="last5" role="img" aria-label="${esc(`Last 5: ${count}`)}">${marks}</span>`;
  }

  // The hover card for a Last 5 mark, from its data attributes.
  function recentTip({ tip, note, tier, count }) {
    return `<div class="tip-head"><b>${esc(tip)}</b><span class="${tier ? `tip-score ${esc(tier)}` : ''}">${esc(note)}</span></div><div class="tip-foot">${esc(count)}</div>`;
  }

  function waiverStatus(s, id) {
    return s.waiverStatus?.(id) ?? 'free_agent';
  }

  function playerRow(s, { id, count }) {
    const owner = ownerOf(s, id);
    const mine = owner && owns(s, owner);
    const research = s.weeks?.[s.currentWeek]?.research?.[id];
    const status = owner ? null : waiverStatus(s, id);
    const ownerText = owner ? `<span class="owner${mine ? ' mine' : ''}">${esc(teamName(s, owner))}</span>` : status === 'waiver' ? '<span class="owner waiver">Waivers</span>' : '<span class="owner fa">Free agent</span>';
    const action = !s.loggedIn || !s.myRosterId ? ''
      : mine ? `<button class="act drop" data-drop-player="${esc(id)}" title="Drop" aria-label="Drop">−</button>`
      : owner ? `<button class="act trade" disabled title="Rostered by another team (trade in the Sleeper app)">⇄</button>`
      : `<button class="act add" data-add="${esc(id)}" title="${status === 'waiver' ? 'Place a waiver claim' : 'Add player'}" aria-label="Add">+</button>`;
    const sub = count != null ? `<b>${count >= 1000 ? `${(count / 1000).toFixed(1)}K` : count}</b> ${s.playersTab.trend === 'add' ? 'added' : 'dropped'} in 24h` : '';
    return `<article class="prow">
      ${playerLine(s, id, { sub })}
      <span class="col">${ownerText}</span>
      <span class="col">${recentStrip(s, id)}</span>
      <span class="col num">${f2(projOf(s, id))}</span>
      <span class="col num">${f1(seasonPts(s, id))}</span>
      <span class="col num">${pct(research?.owned)}</span>
      <span class="col act">${action}</span>
    </article>`;
  }

  return { render, recentTip, PAGE };
})();
