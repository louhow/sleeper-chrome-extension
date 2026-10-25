// Player card, laid out like Sleeper's NFL player card: a team-colored hero
// (bio, rankings), then game logs, career and transaction history on the left
// and latest news and the depth chart on the right. Pure: state -> HTML.
(globalThis.SNP ||= {}).card = (() => {
  const { esc, f2, CDN, teamLogo, shortName, scoringOf, adminScoring, whatIfOn, whatIfBanner, playerOf, playerName, pct: share, tierClass,
    dash, num, height, ago, heat, scaler } = globalThis.SNP.ui;
  const { scoreStats } = globalThis.SNP.scoring;
  const { scoreTier } = globalThis.SNP.model;

  // NBA team nicknames and primary colors, for the hero ("KINGS #9").
  const TEAMS = {
    ATL: ['Hawks', '#e03a3e'], BOS: ['Celtics', '#007a33'], BKN: ['Nets', '#444444'], CHA: ['Hornets', '#1d1160'],
    CHI: ['Bulls', '#ce1141'], CLE: ['Cavaliers', '#860038'], DAL: ['Mavericks', '#00538c'], DEN: ['Nuggets', '#0e2240'],
    DET: ['Pistons', '#c8102e'], GSW: ['Warriors', '#1d428a'], HOU: ['Rockets', '#ce1141'], IND: ['Pacers', '#002d62'],
    LAC: ['Clippers', '#c8102e'], LAL: ['Lakers', '#552583'], MEM: ['Grizzlies', '#5d76a9'], MIA: ['Heat', '#98002e'],
    MIL: ['Bucks', '#00471b'], MIN: ['Timberwolves', '#0c2340'], NOP: ['Pelicans', '#0c2340'], NYK: ['Knicks', '#006bb6'],
    OKC: ['Thunder', '#007ac1'], ORL: ['Magic', '#0077c0'], PHI: ['76ers', '#006bb6'], PHX: ['Suns', '#1d1160'],
    POR: ['Trail Blazers', '#e03a3e'], SAC: ['Kings', '#5a2d81'], SAS: ['Spurs', '#6b6e70'], TOR: ['Raptors', '#ce1141'],
    UTA: ['Jazz', '#002b5c'], WAS: ['Wizards', '#002b5c'],
  };
  const DEPTH_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];
  const NEWS_SOURCES = { fantasy_pros: 'Fantasy Pros', rotowire: 'Rotowire', rotoworld: 'Rotoworld' };

  const seasonLabel = (season) => `'${String(season).slice(2)}-'${String(Number(season) + 1).slice(2)}`;

  function age(bio) {
    if (!bio?.birth_date) return bio?.age ?? null;
    const born = new Date(`${bio.birth_date}T12:00:00`);
    const now = new Date();
    const had = now.getMonth() > born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() >= born.getDate());
    return now.getFullYear() - born.getFullYear() - (had ? 0 : 1);
  }

  const pct = (made, att) => (att ? made / att : null);

  // One row per game of a season: played games from stats, upcoming ones from projections.
  // Projections use `scoring`; played games `fpts` (the league's), plus `admin` (what-if) when given.
  function gameLog(log, scoring, { fpts = scoring, admin = null } = {}) {
    const byGame = new Map();
    const rows = (data) => Object.values(data || {}).flat().filter(Boolean);
    for (const r of rows(log?.proj)) byGame.set(r.game_id || r.date, { ...base(r), proj: scoreStats(scoring, r.stats || {}) });
    for (const r of rows(log?.stats)) {
      const s = r.stats || {};
      if (!Object.keys(s).length) continue;
      const key = r.game_id || r.date;
      byGame.set(key, {
        ...byGame.get(key), ...base(r), played: true,
        fpts: scoreStats(fpts, s),
        ...(admin && { adminFpts: scoreStats(admin, s) }),
        min: s.sp != null ? s.sp / 60 : null,
        pts: s.pts ?? 0, reb: s.reb ?? 0, ast: s.ast ?? 0, stl: s.stl ?? 0, blk: s.blk ?? 0, to: s.to ?? 0,
        fgm: s.fgm ?? 0, fga: s.fga ?? 0, tpm: s.tpm ?? 0, tpa: s.tpa ?? 0, ftm: s.ftm ?? 0, fta: s.fta ?? 0,
      });
    }
    return [...byGame.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function base(r) {
    return { week: r.week, date: r.date, opp: r.opponent, away: Boolean(r.is_away_team) };
  }

  // Season totals -> a career row with per-game averages.
  function careerRow(season, s, scoring) {
    const gp = s.gp || 0;
    const per = (k) => (gp ? (s[k] || 0) / gp : null);
    return {
      season, gp,
      fpts: scoreStats(scoring, s),
      rank: s.pos_rank_std ?? null,
      min: gp && s.sp != null ? s.sp / 60 / gp : null,
      pts: per('pts'), reb: per('reb'), ast: per('ast'), stl: per('stl'), blk: per('blk'), to: per('to'),
      fgp: pct(s.fgm || 0, s.fga || 0), tpm: per('tpm'), ftp: pct(s.ftm || 0, s.fta || 0),
    };
  }

  function render(s) {
    const m = s.modal;
    const id = m.playerId;
    const c = s.cards?.[id] || {};
    const p = playerOf(s.players, id);
    const bio = c.bio;
    const team = bio?.team || p.team;
    const [nick, color] = TEAMS[team] || ['Free Agent', '#3a4256'];
    const position = (bio?.fantasy_positions || p.positions || [])[0] || p.position || '';
    const owner = s.rosters?.find((r) => (r.players || []).includes(id));
    const ownerName = owner ? s.usersById?.[owner.owner_id]?.display_name || `Team ${owner.roster_id}` : null;
    const latest = (c.career || []).find((r) => r.stats?.rank_std != null);
    const research = s.weeks?.[s.currentWeek]?.research?.[id];

    return `<div class="modal pc-modal">
      <div class="backdrop" data-action="close-modal"></div>
      <div class="pc${whatIfOn(s) ? ' whatif' : ''}" role="dialog" aria-modal="true" aria-label="${esc(p.name)}" style="--team:${color}">
        <div class="pc-top">
          <div class="pc-tab">
            <div><b>${esc(shortName(p))}</b><span>${esc((p.positions || []).join(', '))} - ${esc(team || 'FA')}</span></div>
            <button class="close" data-action="close-modal" aria-label="Close">✕</button>
          </div>
        </div>
        <div class="pc-panel">
          ${whatIfBanner(s)}
          <header class="pc-hero">
            <div class="pc-photo">
              ${team ? `<img class="pc-logo" src="${teamLogo(team)}" alt="">` : ''}
              <img class="pc-shot" src="${CDN}/content/nba/players/${encodeURIComponent(id)}.jpg" alt="">
            </div>
            <div class="pc-number"><span class="pc-pos ${esc(position.toLowerCase())}">${esc(position)}</span>
              <b>${esc(nick.toUpperCase())}${bio?.number != null ? ` #${esc(bio.number)}` : ''}</b></div>
            <div class="pc-info">
              <div class="pc-owner">${ownerName ? `<span class="arrow">➔</span> ${esc(ownerName)}` : '<span class="arrow">➔</span> Free Agent'}</div>
              <h2 class="pc-name">${esc(p.name)}</h2>
              <div class="pc-bio">
                ${item('Age', age(bio) ?? '-')}
                ${item('Height', height(bio?.height))}
                ${item('Weight', bio?.weight ? `${esc(bio.weight)}<small>lbs</small>` : '-', true)}
                ${item('Exp', bio?.years_exp ?? p.years_exp ?? '-')}
                ${item('College', esc(bio?.college || '-'), true)}
              </div>
              <div class="pc-label">Player Rankings</div>
              <div class="pc-ranks">
                <span><b>${latest ? `#${latest.stats.pos_rank_std}` : '–'}</b>${esc(position)}</span>
                <span><b>${latest ? `#${latest.stats.rank_std}` : '–'}</b>Overall</span>
                <span><b>${share(research?.owned)}</b>Rostered</span>
                <span><b>${share(research?.started)}</b>Started</span>
              </div>
            </div>
          </header>
          <div class="pc-body">
            <div class="pc-main" data-scroll="main">
              ${gameLogSection(s, c, m)}
              ${careerSection(s, c)}
              ${historySection(s, c)}
            </div>
            <aside class="pc-side" data-scroll="side">
              ${newsSection(s, c)}
              ${depthSection(s, c, id, team)}
            </aside>
          </div>
        </div>
      </div>
    </div>`;
  }

  function item(label, value, raw = false) {
    return `<div class="pc-item"><div class="pc-item-label">${label}</div><div class="pc-item-value">${raw ? value : esc(value)}</div></div>`;
  }

  // Placeholders hold a section's size while it loads, so nothing below jumps:
  // blank rows like the loaded ones, as many as are known (or usual).
  const SKELETON_ROWS = 15;
  const skeleton = (rows, cols) => Array.from({ length: rows }, () => `<tr class="skeleton">${'<td>&nbsp;</td>'.repeat(cols)}</tr>`).join('');
  const blank = (n, html) => Array.from({ length: n }, () => html).join('');

  function gameLogSection(s, c, m) {
    const seasons = c.seasons || [];
    const season = m.season ?? seasons[0] ?? Number(s.league?.season);
    const tabs = seasons.map((y) => `<button class="${y === season ? 'on' : ''}" data-card-season="${y}">${seasonLabel(y)}</button>`).join('');
    // Switching seasons keeps the previous season on screen, dimmed, until the new one arrives.
    const stale = !c.logs?.[season] && m.prevSeason != null && c.logs?.[m.prevSeason];
    const log = c.logs?.[season] || stale;
    // With admin tools on, Fpts is the league's and adminFPTS the what-if values, side by side.
    const admin = adminScoring(s);
    const rows = log ? gameLog(log, scoringOf(s), { fpts: s.league?.scoring_settings || {}, admin }) : null;
    const width = admin ? 16 : 15;
    const played = (rows || []).filter((r) => r.played);
    const cols = [
      ['min', false], ['pts', false], ['reb', false], ['ast', false], ['stl', false], ['blk', false], ['to', true],
    ];
    const scale = Object.fromEntries(cols.map(([k, inv]) => [k, scaler(played, k, inv)]));
    const shoot = {
      fg: scaler(played.map((r) => ({ v: pct(r.fgm, r.fga) })), 'v'),
      tp: scaler(played.map((r) => ({ v: pct(r.tpm, r.tpa) })), 'v'),
      ft: scaler(played.map((r) => ({ v: pct(r.ftm, r.fta) })), 'v'),
    };
    const md = (date) => (date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}` : '');
    const body = !rows ? skeleton(SKELETON_ROWS, width)
      : !rows.length ? `<tr><td colspan="${width}"><p class="pc-empty">No games this season.</p></td></tr>`
      : rows.map((r) => {
        const cell = (k, digits = 0) => `<td${r.played ? heat(scale[k](r[k])) : ''}>${r.played ? num(r[k], digits) : '-'}</td>`;
        const ratio = (made, att, key) => `<td${r.played ? heat(shoot[key](pct(r[made], r[att]))) : ''}>${r.played ? `${r[made]}-${r[att]}` : '-'}</td>`;
        return `<tr>
          <td class="dim">${dash(r.week)}</td><td class="dim">${md(r.date)}</td><td class="opp">${r.away ? '@' : ''}${esc(r.opp || '')}</td>
          <td class="dim">${r.proj != null ? f2(r.proj) : '-'}</td>
          <td class="fpts${r.played ? tierClass(scoreTier(r.fpts, s.tiers)) : ''}">${r.played ? f2(r.fpts) : '-'}</td>
          ${admin ? `<td class="fpts admin${r.played ? tierClass(scoreTier(r.adminFpts, s.tiers)) : ''}">${r.played ? f2(r.adminFpts) : '-'}</td>` : ''}
          ${cell('min')}${cell('pts')}${cell('reb')}${cell('ast')}${cell('stl')}${cell('blk')}${cell('to')}
          ${ratio('fgm', 'fga', 'fg')}${ratio('tpm', 'tpa', 'tp')}${ratio('ftm', 'fta', 'ft')}
        </tr>`;
      }).join('');
    return `<section class="pc-section">
      <div class="pc-section-head"><h2>Game Logs</h2>${tabs ? `<div class="pc-seasons" role="tablist">${tabs}</div>` : ''}</div>
      <table class="pc-table log${stale ? ' stale' : ''}" aria-busy="${!c.logs?.[season]}">
        <thead>
          <tr class="group"><th colspan="3"></th><th colspan="${admin ? 3 : 2}">Fantasy</th><th colspan="7">Stats</th><th colspan="3">Shooting</th></tr>
          <tr><th>Wk</th><th>Date</th><th>Opp</th><th>Proj</th><th class="fpts">Fpts</th>${admin ? '<th class="fpts admin">adminFPTS</th>' : ''}<th>Min</th>
            <th>Pts</th><th>Reb</th><th>Ast</th><th>Stl</th><th>Blk</th><th>To</th><th>Fg</th><th>3pt</th><th>Ft</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
  }

  function careerSection(s, c) {
    const scoring = scoringOf(s);
    const rows = c.career ? c.career.filter((r) => r.stats?.gp).map((r) => ({ ...careerRow(r.season, r.stats, scoring), team: r.team })) : null;
    const keys = [['fpts'], ['rank', true], ['gp'], ['min'], ['pts'], ['reb'], ['ast'], ['stl'], ['blk'], ['to', true], ['fgp'], ['tpm'], ['ftp']];
    const scale = Object.fromEntries(keys.map(([k, inv]) => [k, scaler(rows || [], k, inv)]));
    const cell = (r, k, fmt) => `<td${heat(scale[k](r[k]))}>${r[k] == null ? '-' : fmt(r[k])}</td>`;
    const one = (v) => v.toFixed(1);
    const three = (v) => v.toFixed(3).replace(/^0/, '');
    const body = !rows ? skeleton(c.careerYears || 1, 15)
      : !rows.length ? '<tr><td colspan="15"><p class="pc-empty">No career stats yet.</p></td></tr>'
      : rows.map((r) => `<tr>
          <td class="dim">${seasonLabel(r.season)}</td><td class="opp">${esc(r.team || '-')}</td>${cell(r, 'gp', String)}
          <td class="fpts">${one(r.fpts)}</td>${cell(r, 'rank', String)}
          ${cell(r, 'min', one)}${cell(r, 'pts', one)}${cell(r, 'reb', one)}${cell(r, 'ast', one)}${cell(r, 'stl', one)}${cell(r, 'blk', one)}${cell(r, 'to', one)}
          ${cell(r, 'fgp', three)}${cell(r, 'tpm', one)}${cell(r, 'ftp', three)}
        </tr>`).join('');
    return `<section class="pc-section">
      <div class="pc-section-head"><h2>Career</h2></div>
      <table class="pc-table career">
        <thead>
          <tr class="group"><th colspan="3"></th><th>Fantasy</th><th>Pos Rank</th><th colspan="8">Per Game</th><th colspan="3">Shooting</th></tr>
          <tr><th>Yr</th><th>Tm</th><th>Gm</th><th class="fpts">Fpts</th><th>Rank</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>Stl</th><th>Blk</th><th>To</th>
            <th>Fg%</th><th>3pm</th><th>Ft%</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </section>`;
  }

  // Transaction history in this league, newest first, worded like Sleeper's card.
  function historySection(s, c) {
    // Loading: one transaction's row (a rostered player has at least their add or draft pick).
    if (!c.history) {
      return `<section class="pc-section" aria-busy="${!c.historyError}"><div class="pc-section-head"><h2>Transaction History</h2></div>${c.historyError ? '<p class="pc-empty">Log in to Sleeper to see this league\'s transactions.</p>'
        : '<ul class="pc-history"><li class="pc-tx skeleton"><span class="pc-tx-label">&nbsp;</span><span class="pc-tx-text">&nbsp;</span><span class="pc-tx-date">&nbsp;</span></li></ul>'}</section>`;
    }
    const id = s.modal.playerId;
    const byRoster = Object.fromEntries((s.rosters || []).map((r) => [r.roster_id, s.usersById?.[r.owner_id]?.display_name || `Team ${r.roster_id}`]));
    const user = (uid) => s.usersById?.[uid]?.display_name;
    const date = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).replace(',', '');
    const who = (rid) => `<b>${esc(byRoster[rid] || `Team ${rid}`)}</b>`;
    // A transaction can both add and drop this player (e.g. a commissioner move), so each gets its own line.
    const lines = (t) => {
      const to = t.adds?.[id];
      const from = t.drops?.[id];
      if (t.type === 'draft_pick') {
        const md = t.metadata || {};
        const pick = `${md.round}.${String(md.round_pick_no).padStart(2, '0')}`;
        return [['drafted', 'Drafted', `by <b>${esc(user(md.picked_by) || byRoster[to] || '')}</b> with pick ${esc(pick)}`]];
      }
      if (t.type === 'trade') return [['traded', 'Traded', `to ${who(to)} from ${who(from)}`]];
      const bid = t.type === 'waiver' && t.settings?.waiver_bid != null ? ` for $${esc(t.settings.waiver_bid)}` : '';
      return [
        ...(to != null ? [['added', t.type === 'waiver' ? 'Claimed' : 'Added', `by ${who(to)}${bid}`]] : []),
        ...(from != null ? [['dropped', 'Dropped', `to Waivers by ${who(from)}`]] : []),
      ];
    };
    const items = c.history
      .filter((t) => t.status === 'complete')
      .sort((a, b) => b.created - a.created)
      .flatMap((t) => lines(t).map(([cls, label, text]) => `<li class="pc-tx ${cls}">
        <span class="pc-tx-label">${label}</span><span class="pc-tx-text">${text}</span><span class="pc-tx-date">${date(t.created)}</span>
      </li>`))
      .join('');
    return `<section class="pc-section">
      <div class="pc-section-head"><h2>Transaction History</h2></div>
      ${items ? `<ul class="pc-history">${items}</ul>` : '<p class="pc-empty">No transactions in this league.</p>'}
    </section>`;
  }

  function newsSection(s, c) {
    const items = (c.news || []).map((n) => {
      const md = n.metadata || {};
      return `<article class="pc-news">
        <h3>${esc(md.title || '')}</h3>
        <div class="pc-news-meta">${esc(ago(n.published, s.now))} via ${esc(NEWS_SOURCES[n.source] || n.source || '')}</div>
        ${md.description ? `<p>${esc(md.description)}</p>` : ''}
        ${md.analysis ? `<p><b>Analysis:</b> ${esc(md.analysis)}</p>` : ''}
      </article>`;
    }).join('');
    // Loading: a blank news card (a two-line title and a paragraph).
    const card = `<article class="pc-news skeleton"><h3>&nbsp;<br>&nbsp;</h3><div class="pc-news-meta">&nbsp;</div><p>${blank(6, '&nbsp;<br>')}</p></article>`;
    return `<section class="pc-section" aria-busy="${!c.news}">
      <div class="pc-section-head"><h2>Latest News</h2></div>
      ${!c.news ? card : items || '<p class="pc-empty">No recent news.</p>'}
    </section>`;
  }

  function depthSection(s, c, id, team) {
    if (!team) return '';
    const chart = c.depth;
    const groups = chart ? DEPTH_ORDER.filter((pos) => chart[pos]?.length).map((pos) => `<div class="pc-depth-row">
        <span class="pos ${pos.toLowerCase()}">${pos}</span>
        <ol>${chart[pos].map((pid) => `<li class="${pid === id ? 'me' : ''}">${esc(playerName(s.players, pid))}</li>`).join('')}</ol>
      </div>`).join('') : '';
    // Loading: a row per position, as many lines as the team has players there.
    const teamAt = (pos) => Object.values(s.players || {}).filter((p) => p.team === team && p.position === pos).length;
    const rows = DEPTH_ORDER.map((pos) => `<div class="pc-depth-row skeleton">
        <span class="pos ${pos.toLowerCase()}">${pos}</span>
        <ol>${blank(Math.max(1, teamAt(pos)), '<li>&nbsp;</li>')}</ol>
      </div>`).join('');
    return `<section class="pc-section" aria-busy="${!chart}">
      <div class="pc-section-head"><h2>Depth Chart</h2></div>
      ${!chart ? rows : groups || '<p class="pc-empty">No depth chart.</p>'}
    </section>`;
  }

  // The stat table helpers live in ui.js; they're here too for the cards that share them.
  return { render, gameLog, careerRow, seasonLabel, dash, num, height, ago, heat, scaler };
})();
