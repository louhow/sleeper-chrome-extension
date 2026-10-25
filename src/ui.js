// Rendering helpers and widgets shared by every view: the NBA and NFL Team,
// Matchup and League tabs, the dialogs and the player card. Pure: state -> HTML.
(globalThis.SNP ||= {}).ui = (() => {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
  const f2 = (n) => (n == null || Number.isNaN(n) ? '–' : Number(n).toFixed(2));
  const CDN = 'https://sleepercdn.com';
  // Combo slots take the colors of the positions they accept.
  const SLOT_PARTS = { G: ['pg', 'sg'], F: ['sf', 'pf'] };
  const INJURY_SEVERE = /^(out|ir|sus|na|dnr)/i;
  // Sleeper's apps list bench players by primary position in this order.
  const POSITION_ORDER = ['PG', 'SG', 'SF', 'PF', 'C'];
  // Avatar URLs that failed to load, when the state keeps none (see avatarImg).
  const NO_FAILED = new Set();

  // Lineups mark an open spot with '0' (or leave it empty).
  const real = (id) => Boolean(id) && id !== '0';
  const playerOf = (players, id) => players?.[id] || { name: `Player #${id}`, positions: [] };
  const playerName = (players, id) => playerOf(players, id).name;
  // Where `order` doesn't list a player's position, they sort last.
  const rankIn = (order) => (p) => (p && order.includes(p.position) ? order.indexOf(p.position) : order.length);
  // The ids, padded with open spots ('0') up to `count` (a league's IR or taxi slots).
  const padTo = (ids, count) => [...ids, ...Array(Math.max(0, (count || 0) - ids.length)).fill('0')];
  // A share of leagues, as Sleeper rounds it (up).
  const pct = (n) => (n == null ? '–' : `${Math.ceil(n)}%`);

  const headshot = (id) => `${CDN}/content/nba/players/thumb/${encodeURIComponent(id)}.jpg`;
  const teamLogo = (team) => `${CDN}/images/team_logos/nba/${encodeURIComponent(String(team).toLowerCase())}.webp`;

  // Team helpers take a missing roster too (a bye, a matchup not loaded yet).
  function teamName(s, roster) {
    const user = roster && s.usersById?.[roster.owner_id];
    return user?.metadata?.team_name || user?.display_name || `Team ${roster?.roster_id ?? '?'}`;
  }

  const ownerName = (s, roster) => s.usersById?.[roster?.owner_id]?.display_name || '';

  function avatar(s, roster) {
    const owner = s.usersById?.[roster?.owner_id];
    return owner?.metadata?.avatar || (owner?.avatar && `${CDN}/avatars/thumbs/${owner.avatar}`) || null;
  }

  function record(roster) {
    const st = roster?.settings || {};
    return `${st.wins ?? 0}-${st.losses ?? 0}${st.ties ? `-${st.ties}` : ''}`;
  }

  // "L. Dončić", falling back to the full name when first/last are missing.
  // A team defense goes by its full name ("Buffalo Bills").
  function shortName(p) {
    if (!p) return 'Unknown';
    return p.first && p.last && p.position !== 'DEF' ? `${p.first[0]}. ${p.last}` : p.name;
  }

  function injuryTag(p) {
    return p?.injury ? `<span class="inj ${INJURY_SEVERE.test(p.injury) ? 'severe' : ''}">${esc(p.injury)}</span>` : '';
  }

  function positions(p) {
    return (p?.positions || []).map((pos) => `<span class="pos ${esc(pos.toLowerCase())}">${esc(pos)}</span>`).join(' ');
  }

  // Position and team after a name: "PG SG - LAL" with position chips, "QB - KC" as text.
  function teamTag(p, { chips = false, sep = '-' } = {}) {
    const team = `${sep} ${esc(p?.team || 'FA')}`;
    return chips ? `${positions(p)} <span class="team">${team}</span>` : `<span class="team">${esc(p?.position || '')} ${team}</span>`;
  }

  const gameTime = (ms) =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
  // A date ("2026-10-24", read at noon so no time zone moves it) or a time in ms; '' for none.
  const weekday = (date, style = 'short') => (date == null || date === '' ? '' :
    (typeof date === 'number' ? new Date(date) : new Date(`${date}T12:00:00`)).toLocaleDateString(undefined, { weekday: style }));
  // A game from a player's side, e.g. "Thu @ MIA".
  const gameLabel = (d) => `${weekday(d.date)} ${d.home ? 'vs' : '@'} ${d.opponent}`;

  // A slot badge doubles as the lineup button when the lineup is editable.
  function slotBadge(slot, spot) {
    const parts = SLOT_PARTS[slot];
    const cls = parts ? `split ${parts.join(' ')}` : slot.toLowerCase();
    const style = parts ? ` style="--a:var(--${parts[0]});--b:var(--${parts[1]})"` : '';
    return spot
      ? `<button class="slot ${esc(cls)}"${style} data-spot="${esc(spot)}" aria-label="Move ${esc(slot)}">${esc(slot)}</button>`
      : `<span class="slot ${esc(cls)}"${style}>${esc(slot)}</span>`;
  }

  // A padlock, shut for a locked-in game, open for one that can still be locked.
  function lockIcon(open = false) {
    const shackle = open ? 'M5 7V5a3 3 0 0 1 5.8-1.1' : 'M5 7V5a3 3 0 0 1 6 0v2';
    return `<svg class="lock-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="${shackle}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="2.5" y="7" width="11" height="8" rx="2" fill="currentColor"/></svg>`;
  }

  // A player's next game this week, e.g. "Thu @ MIA 7:30pm".
  function nextGame(days) {
    const d = days.find((x) => x.game && x.game.status !== 'complete');
    if (!d) return days.some((x) => x.game) ? 'No games left this week' : 'No games this week';
    const time = d.game.status === 'in_game' ? 'Live' : d.game.start ? gameTime(d.game.start) : '';
    return `${gameLabel(d)}${time ? ` ${time}` : ''}`;
  }

  // A dialog over the page; the backdrop and ✕ close it. `extra` sits beside the title.
  function dialog(title, description, body, extra = '') {
    return `<div class="modal">
      <div class="backdrop" data-action="close-modal"></div>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <header class="dialog-head">
          <div><h2 id="dialog-title">${esc(title)}${extra}</h2>${description ? `<div class="sub">${esc(description)}</div>` : ''}</div>
          <button class="icon close" data-action="close-modal" aria-label="Close">✕</button>
        </header>
        ${body}
      </div>
    </div>`;
  }

  function dialogErrors(list) {
    return list?.length ? `<div class="dialog-errors" role="alert">${list.map((e) => `<p>${esc(e)}</p>`).join('')}</div>` : '';
  }

  function weekNav(s, week) {
    const range = week?.days.length ? dateRange(week.days[0], week.days.at(-1)) : '';
    return `<div class="week-nav">
      <button class="icon" data-action="prev" aria-label="Previous week" ${s.week <= s.minWeek ? 'disabled' : ''}>‹</button>
      <div class="week-label"><b>Week ${s.week ?? ''}</b><span>${range}</span></div>
      <button class="icon" data-action="next" aria-label="Next week" ${s.week >= s.maxWeek ? 'disabled' : ''}>›</button>
    </div>`;
  }

  function dateRange(from, to) {
    const fmt = (d, opts) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, opts).toUpperCase();
    const sameMonth = from.slice(0, 7) === to.slice(0, 7);
    return `${fmt(from, { month: 'short', day: 'numeric' })}-${fmt(to, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
  }

  function notice(s) {
    return s.notice ? `<p class="notice ${esc(s.notice.kind)}" role="status">${esc(s.notice.text)}</p>` : '';
  }

  // In place of a view while it loads, or when it can't.
  const loading = (text = 'Loading…') => `<p class="msg">${esc(text)}</p>`;
  const errorMsg = (text) => `<p class="msg error">${esc(text)}</p>`;

  const owns = (s, roster) => s.me != null && roster != null && (roster.owner_id === s.me || (roster.co_owners || []).includes(s.me));

  // Where one roster's players are for the shown week: starters by slot, then
  // bench (by primary position in `order`), IR and taxi. The logged-in matchup
  // leg is authoritative; the public matchup and the roster are fallbacks.
  function rosterParts(s, rosterId, order = POSITION_ORDER) {
    const roster = s.rosters?.find((r) => r.roster_id === rosterId);
    if (!roster) return null;
    const week = s.weeks?.[s.week];
    const slots = (s.league.roster_positions || []).filter((p) => p !== 'BN');
    const leg = week?.legs?.find((l) => l.roster_id === roster.roster_id);
    const matchup = week?.matchups.find((m) => m.roster_id === roster.roster_id);
    const starters = leg?.starters ?? matchup?.starters ?? roster.starters ?? [];
    const taxi = roster.taxi || [];
    const reserve = roster.reserve || [];
    const placed = new Set([...starters, ...taxi, ...reserve]);
    const rank = rankIn(order);
    const bench = (roster.players || [])
      .filter((id) => !placed.has(id))
      .sort((a, b) => rank(s.players?.[a]) - rank(s.players?.[b]));
    return { roster, week, slots, leg, matchup, starters, bench, taxi, reserve };
  }

  // The opponent's roster id in a lineup's matchup (from rosterParts), or null.
  function opponentOf(l) {
    const own = l.leg ?? l.matchup;
    if (own?.matchup_id == null) return null;
    const pool = l.leg ? l.week.legs : l.week.matchups;
    return pool.find((m) => m.matchup_id === own.matchup_id && m.roster_id !== l.roster.roster_id)?.roster_id ?? null;
  }

  // Everything about one roster's NBA lineup for the shown week, with what the owner can change.
  function lineup(s, rosterId = s.rosterId) {
    const parts = s.players ? rosterParts(s, rosterId) : null;
    if (!parts) return null;
    const { roster, week, leg, taxi, reserve } = parts;
    const inSeason = s.league.status === 'in_season';
    const current = Boolean(week) && s.week >= (s.currentWeek ?? s.week);
    const mine = owns(s, roster);
    const editable = mine && current && (!inSeason || Boolean(leg));
    const settings = s.league.settings || {};
    // Active roster = everyone not on IR or taxi; it can hold one player per roster position.
    const active = (roster.players || []).length - reserve.length - taxi.length;
    return {
      ...parts, players: s.players, settings,
      tiers: s.tiers,
      locks: leg?.starters_games || {},
      // Your own lineup: whether a player was starting at a game's tip-off, from
      // the lineups the extension has seen (Sleeper keeps no history). Others: unknown, assumed so.
      started: mine && leg ? (id, game) => globalThis.SNP.model.startedAt(s.lineupHistory?.[s.week]?.[roster.roster_id], id, game.start) : null,
      mine,
      editable,
      // Locks only exist on an in-season matchup leg. A lock is real points, so not under what-if scoring.
      lockable: mine && current && inSeason && Boolean(leg) && !whatIfOn(s),
      // Taxi belongs to the roster, not a week, so it's edited from the current week.
      taxiEditable: editable && (settings.taxi_slots || 0) > 0 && s.week === s.currentWeek,
      taxiOpen: globalThis.SNP.model.taxiOpen(settings, s.seasonType, s.currentWeek, weekStarted(s)),
      taxiRoom: Math.max(0, (settings.taxi_slots || 0) - taxi.length),
      // IR also belongs to the roster, so it's edited from the current week too.
      reserveEditable: editable && (settings.reserve_slots || 0) > 0 && s.week === s.currentWeek,
      reserveRoom: Math.max(0, (settings.reserve_slots || 0) - reserve.length),
      benchRoom: Math.max(0, (s.league.roster_positions || []).length - active),
    };
  }

  // Whether any game of the current week has tipped off.
  function weekStarted(s) {
    const games = s.weeks?.[s.currentWeek]?.games || [];
    return games.some((g) => g.status !== 'pre_game' || (g.start != null && g.start <= s.now));
  }

  // One-line summary of the league's taxi rules and whether taxi is open now.
  function taxiRule(l) {
    const { settings } = l;
    const limit = settings.taxi_years === 0 ? 'any experience'
      : `${settings.taxi_years || 0} or fewer years of experience`;
    const who = settings.taxi_allow_vets ? `Players with ${limit}` : 'Rookies only';
    if (!l.taxiOpen) {
      return `Taxi is locked for the season: players can only move up to the active roster${l.benchRoom ? '' : ' (roster is full)'}.`;
    }
    const until = settings.taxi_deadline === 0 ? 'any time'
      : settings.taxi_deadline === 4 ? 'until the first game of the regular season tips off'
      : `through preseason week ${settings.taxi_deadline || 1}`;
    return `${who} can move to taxi ${until}.`;
  }

  // Which injury statuses the league lets onto IR, e.g. "Out, DTD and DNR players can move to IR."
  function reserveRule(settings) {
    const allowed = ['Out', 'Sus', 'Doubtful', 'DTD', 'DNR', 'COV', 'NA']
      .filter((status) => settings[`reserve_allow_${status.toLowerCase()}`]);
    const list = ['IR', ...allowed];
    const names = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
    return `${names} players can move to IR.`;
  }

  // What-if scoring (see whatif.js) applies once the admin tools are enabled
  // (?snp-admin=1), a value differs from the league's, and it's switched on.
  const whatIfOn = (s) => Boolean(s.whatIf?.enabled && s.whatIf.on && Object.keys(s.whatIf.overrides || {}).length);

  // The scoring settings every fantasy number on screen uses.
  function scoringOf(s) {
    const league = s.league?.scoring_settings || {};
    return whatIfOn(s) ? globalThis.SNP.scoring.withOverrides(league, s.whatIf.overrides) : league;
  }

  // The what-if values whenever the admin tools are on, switched on or not
  // (the Players tab's and game log's adminFPTS); null when they're off.
  function adminScoring(s) {
    if (!s.whatIf?.enabled) return null;
    return globalThis.SNP.scoring.withOverrides(s.league?.scoring_settings || {}, s.whatIf.overrides || {});
  }

  // The what-if changes in a few words, e.g. "Points Scored 0.5 → 1, Blocks 2 → 3".
  function whatIfChanges(s, max = 3) {
    const league = s.league?.scoring_settings || {};
    const labels = Object.fromEntries(globalThis.SNP.scoring.settingsList(league));
    const list = Object.entries(s.whatIf?.overrides || {}).map(([key, value]) => `${labels[key] || key} ${league[key] ?? 0} → ${value}`);
    return list.length > max ? `${list.slice(0, max).join(', ')} and ${list.length - max} more` : list.join(', ');
  }

  // Shown over the Team and Matchup tabs and the player card while what-if scoring is on.
  function whatIfBanner(s) {
    if (!whatIfOn(s)) return '';
    return `<div class="whatif-banner" role="status">
      <span class="tag">What-if scoring</span>
      <span class="what">${esc(whatIfChanges(s))}. Fantasy points here aren't your league's; Lock-In and Optimize are off.</span>
      <button data-action="whatif-off">Use league scoring</button>
    </div>`;
  }

  // ---- Stat tables (the player cards) ----

  const dash = (v) => (v == null || v === '' ? '-' : v);
  const num = (v, digits = 0) => (v == null || Number.isNaN(v) ? '-' : Number(v).toFixed(digits));

  function height(inches) {
    const n = Number(inches);
    return n ? `${Math.floor(n / 12)}'${n % 12}"` : '-';
  }

  // Where a news item comes from, as its source spells itself.
  const NEWS_SOURCES = { fantasy_pros: 'FantasyPros', rotowire: 'RotoWire', rotoworld: 'Rotoworld' };
  const newsSource = (source) => NEWS_SOURCES[source] || source || '';

  function ago(ms, now) {
    const s = Math.max(0, (now - ms) / 1000);
    const [n, unit] = s < 3600 ? [Math.round(s / 60), 'minute'] : s < 86400 ? [Math.round(s / 3600), 'hour'] : [Math.round(s / 86400), 'day'];
    if (unit === 'minute' && n < 1) return 'just now';
    return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  }

  // Heat color for a cell, as Sleeper shades stat tables: red (low) through olive to green (high).
  function heat(t) {
    if (t == null || Number.isNaN(t)) return '';
    const stops = [[150, 72, 96], [128, 122, 78], [84, 132, 100]];
    const x = Math.min(1, Math.max(0, t)) * 2;
    const [a, b] = x <= 1 ? [stops[0], stops[1]] : [stops[1], stops[2]];
    const f = x <= 1 ? x : x - 1;
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * f));
    return ` style="background:rgba(${c.join(',')},.5)"`;
  }

  // Scales each column's values to 0..1 across the rows that have them.
  function scaler(rows, key, invert = false) {
    const vals = rows.map((r) => r[key]).filter((v) => v != null && !Number.isNaN(v));
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return (v) => {
      if (v == null || Number.isNaN(v) || !vals.length) return null;
      const t = hi === lo ? 0.5 : (v - lo) / (hi - lo);
      return invert ? 1 - t : t;
    };
  }

  // Classes for fantasy points filled with their score tier's color, as the game
  // logs show them; `tier` from model.scoreTier ('green', 'yellow', 'red', '' for none).
  const tierClass = (tier) => (tier ? ` tier tier-${tier}` : '');

  // ---- Teams ----

  // A team's avatar, or the plain circle when it has none or the image failed
  // to load (`failed`: the URLs that did, s.failedAvatars). With `initial`, the
  // circle holds the team's first letter (the team pickers).
  function avatarImg(url, cls, failed = NO_FAILED, { attrs = '', initial = null } = {}) {
    const extra = attrs ? ` ${attrs}` : '';
    if (url && !failed.has(url)) return `<img class="${cls}" src="${esc(url)}" alt=""${extra}>`;
    return initial == null ? `<div class="${cls}"${extra}></div>` : `<span class="${cls} blank"${extra}>${esc(initial)}</span>`;
  }
  const failedOf = (s) => s.failedAvatars || NO_FAILED;

  // The Team tab's summary: the team, its record and opponent, points (– until
  // there are any) and projection, then `extra` (e.g. the Waivers button) and the week.
  function teamCard(s, roster, { points = null, proj = null, opponent = null, week = null, extra = '' } = {}) {
    const owner = s.usersById?.[roster.owner_id];
    const name = teamName(s, roster);
    return `<section class="team-card">
      ${avatarImg(avatar(s, roster), 'avatar', failedOf(s))}
      <div class="who">
        <div class="team-name">${esc(name)}</div>
        <div class="sub">${owner && owner.display_name !== name ? `${esc(owner.display_name)} · ` : ''}${record(roster)}${opponent ? ` · vs ${esc(teamName(s, opponent))}` : ''}</div>
      </div>
      <div class="score">
        <div class="pts">${points == null ? '–' : f2(points)}</div>
        <div class="sub">proj ${f2(proj)}</div>
      </div>
      ${extra}
      ${weekNav(s, week)}
    </section>`;
  }

  // What a Matchup or League tab team card shows, from the roster and its numbers.
  function teamSideOf(s, roster, numbers) {
    return {
      rosterId: roster.roster_id,
      avatar: avatar(s, roster),
      owner: ownerName(s, roster),
      team: teamName(s, roster),
      record: record(roster),
      ...numbers,
    };
  }

  // One team of a matchup: avatar, owner and team name, points, the win-chance
  // bar, then win %, record (and rank), yet to play and projection.
  // `t`: { avatar, owner, team, points, win (0..1), bar (%, default the win %),
  // record, rank, yetToPlay, proj, rosterId }; numbers print as points, text
  // (Sleeper's own, read off its page) as it is, and nothing as –. With
  // `rosterId`, the avatar, owner and team name open that team on the Team tab.
  function teamSide(t, cls, failed = NO_FAILED) {
    const shown = (v) => (typeof v === 'number' ? f2(v) : esc(v || '–'));
    const pct = t.win == null ? null : Math.round(t.win * 100);
    const trend = pct == null ? '' : pct >= 50 ? 'up' : 'down';
    const link = t.rosterId != null ? `data-open-team="${esc(t.rosterId)}" role="link" tabindex="0" title="${esc(`${t.team}'s team`)}"` : '';
    const linked = (html) => (link ? `<span class="team-link" ${link}>${html}</span>` : html);
    return `<div class="mu-team ${cls}">
      ${avatarImg(t.avatar, link ? 'avatar team-link' : 'avatar', failed, { attrs: link })}
      <div class="mu-who">
        <div class="sub">${linked(`@${esc(t.owner || 'unknown')}`)}</div>
        <div class="team-name">${linked(esc(t.team))}</div>
      </div>
      <div class="mu-pts">${shown(t.points)}</div>
      <div class="mu-bar"><span class="${trend}" style="width:${Math.max(0, Math.min(100, t.bar ?? pct ?? 0))}%"></span></div>
      <div class="mu-meta">
        ${pct == null ? '' : `<b class="${trend}">${pct}% WIN</b>`}
        <span>${esc(t.record)}${t.rank ? ` (#${t.rank})` : ''}</span>
        ${t.yetToPlay == null ? '' : `<span class="ytp">Yet to play (${t.yetToPlay})</span>`}
        <span class="proj">${shown(t.proj)}</span>
      </div>
    </div>`;
  }

  // Two teams face to face (teamSide data; `b` null without an opponent).
  // `cls`/`attrs` on the wrapper: the League tab's cards open their matchup.
  function matchupPair(a, b, { tag = 'div', cls = '', attrs = '', failed = NO_FAILED } = {}) {
    return `<${tag} class="mu-head${cls ? ` ${cls}` : ''}"${attrs ? ` ${attrs}` : ''}>
        ${teamSide(a, 'mine', failed)}
        <span class="vs">VS</span>
        ${b ? teamSide(b, 'theirs', failed) : '<div class="mu-team theirs bye"><span class="sub">No opponent this week</span></div>'}
      </${tag}>`;
  }

  // ---- Team tab rows ----

  // A section's header row, aligned with its player rows: title (and hint),
  // `middle` (the NBA week's days, or NFL's game column) and points.
  function rowHead(title, { hint = '', cls = '', middle = '' } = {}) {
    return `<div class="rhead${cls ? ` ${cls}` : ''}">
      <div class="rtitle"><h3>${esc(title)}</h3>${hint ? `<div class="hint">${hint}</div>` : ''}</div>
      ${middle}
      <div class="week-pts">Pts</div>
    </div>`;
  }

  // The Starters hint on an editable lineup; `picked`: the name of the player in the spot being moved.
  function swapHint(s, editable, picked) {
    if (!editable) return '';
    return s.saving ? 'Saving lineup…'
      : picked ? `Pick a player to swap with ${esc(picked)} · Esc to cancel`
      : s.swap ? 'Pick a player for this slot · Esc to cancel'
      : 'Tap a position to update your lineup';
  }

  // While picking a swap: the spot picked, the spots it can go to, and the rest dimmed.
  function swapClass(s, editable, spot, targets) {
    if (!editable || !spot) return '';
    if (s.swap === spot) return ' selected';
    if (s.swap) return targets.has(spot) ? ' target' : ' dim';
    return '';
  }

  // An open spot's row; `swap`: its swapClass, `sport`: e.g. 'nfl'.
  function emptyCard(badge, swap = '', sport = '') {
    return `<article class="card${sport ? ` ${sport}` : ''} empty${swap}">${badge}<div class="headshot"></div><div class="info"><span class="name">Empty</span></div></article>`;
  }

  // Started and rostered in leagues like this one, under a player's name.
  function researchLine(research) {
    return `<div class="line2" title="Started and rostered in leagues like this one"><b>${pct(research?.started)}</b> Start<span class="bar">|</span><b>${pct(research?.owned)}</b> Rostered</div>`;
  }

  // ---- Matchup tab rows ----

  // A slot of both lineups: our player, the slot, theirs (`right` null: no opponent).
  function muRow(left, badge, right) {
    return `<div class="mu-row">
      ${left}
      ${badge}
      ${right ?? '<div class="mp theirs empty"></div>'}
    </div>`;
  }

  // An open spot on one side; `cls`: the side ('mine' or 'theirs') and any sport class.
  const muEmpty = (cls) => `<div class="mp ${cls} empty"><div class="headshot"></div><div class="mp-id"><span class="name">Empty</span></div></div>`;

  // Starters' header: the hint under the title, and the week.
  function muStarters(hint, week) {
    return `<div class="mu-starters">
        <div>
          <h3>Starters</h3>
          ${hint ? `<div class="hint">${hint}</div>` : ''}
        </div>
        ${week}
      </div>`;
  }

  // A section below the starters, a row per spot of the longer side, at least
  // `count` (the league's IR or taxi slots, so an empty section keeps its place).
  function muSection(title, a, b, count, row) {
    const n = Math.max(a.length, b.length, count || 0);
    return n ? `<h3 class="mu-title">${esc(title)}</h3>${Array.from({ length: n }, (_, i) => row(a[i], b[i])).join('')}` : '';
  }

  // ---- The panel: toolbar, team pickers, shell ----

  const PAGES = { team: 'Team', matchup: 'Matchup' };
  const pageTitle = (s) => PAGES[s.page] || 'Team';

  // The tab, the API log, then Optimize lineup (`optimize`: shown), the picker,
  // any `tools` and refresh.
  function toolbar(s, log, { optimize = false, tools = '' } = {}) {
    const tab = (id, label) =>
      `<button role="tab" data-tab="${id}" aria-selected="${s.tab === id}" class="${s.tab === id ? 'active' : ''}">${label}</button>`;
    const picker = !s.rosters?.length || s.sessionExpired ? '' : s.page === 'matchup' ? matchupPicker(s) : teamPicker(s);
    const button = !optimize ? ''
      : whatIfOn(s) ? '<button class="optimize" disabled title="Optimize uses your league\'s scoring. Switch what-if scoring off to use it.">Optimize lineup</button>'
      : `<button class="optimize" data-action="optimize" title="Propose the best starting lineup for this week" ${s.saving ? 'disabled' : ''}>Optimize lineup</button>`;
    return `<nav class="toolbar">
      <div class="tabs" role="tablist">${tab('page', pageTitle(s))}${tab('api', `API calls <span class="count">${log.length}</span>`)}</div>
      <div class="tools">
        ${button}
        ${picker}
        ${tools}
        <button class="icon" data-action="refresh" title="Refetch everything" aria-label="Refresh">↻</button>
      </div>
    </nav>`;
  }

  // The Team and Matchup tabs' panel around `body`. The notice floats over the
  // panel so showing or clearing it never shifts the cards being clicked; while
  // a dialog is open it shows over the dialog instead.
  function shell(s, log, body, { cls = '', ...tools } = {}) {
    const whatIf = s.tab !== 'api' && whatIfOn(s);
    return `<div class="app${cls ? ` ${cls}` : ''}${whatIf ? ' whatif' : ''}">${toolbar(s, log, tools)}${whatIf ? whatIfBanner(s) : ''}<div class="body">${body}</div>${s.tab === 'api' || s.modal ? '' : notice(s)}</div>`;
  }

  // The team shown: a picker with each team's avatar, name and owner, A to Z,
  // and, while it's someone else's, a one-click way back to your own.
  function teamPicker(s) {
    const pic = (r) => avatarImg(r && avatar(s, r), 'tp-avatar', failedOf(s), { initial: r ? teamName(s, r).slice(0, 1).toUpperCase() : '' });
    const teams = [...s.rosters].sort((a, b) => teamName(s, a).localeCompare(teamName(s, b)));
    const current = s.rosters.find((r) => r.roster_id === s.rosterId);
    const mine = s.rosters.find((r) => owns(s, r));
    const back = mine && current && mine.roster_id !== current.roster_id
      ? `<button class="my-team" data-pick-roster="${mine.roster_id}" title="Back to ${esc(teamName(s, mine))}"><span aria-hidden="true">←</span>My team</button>` : '';
    return `${back}<div class="team-pick${s.rosterMenu ? ' open' : ''}">
      <button class="tp-button" data-action="roster-menu" data-roster="${current?.roster_id ?? ''}" aria-haspopup="listbox" aria-expanded="${Boolean(s.rosterMenu)}" aria-label="Team to show">
        ${pic(current)}<span class="tp-name">${esc(current ? teamName(s, current) : 'Pick a team')}</span><span class="tp-chevron" aria-hidden="true"></span>
      </button>
      <div class="tp-menu" role="listbox">${teams.map((r) => {
        const owner = s.usersById?.[r.owner_id];
        return `<button role="option" data-pick-roster="${r.roster_id}" aria-selected="${r.roster_id === s.rosterId}">${pic(r)}
          <span class="tp-label"><b>${esc(teamName(s, r))}</b><small>@${esc(owner?.display_name || 'unknown')}${mine?.roster_id === r.roster_id ? ' · you' : ''}</small></span></button>`;
      }).join('')}</div>
    </div>`;
  }

  // The Matchup tab picks a matchup, not a team: the week's pairs, each with
  // both teams' avatars and names (yours first, then A to Z by the left team),
  // and, while it's someone else's, a one-click way back to yours.
  function matchupPicker(s) {
    const pairs = matchupPairs(s);
    if (!pairs.length) return teamPicker(s);
    const half = (r) => (r ? `${avatarImg(avatar(s, r), 'tp-avatar', failedOf(s), { initial: teamName(s, r).slice(0, 1).toUpperCase() })}<span class="tp-name">${esc(teamName(s, r))}</span>`
      : '<span class="tp-name bye">No opponent</span>');
    const current = pairs.find((p) => p.some((r) => r?.roster_id === s.rosterId));
    // The shown team stays on the left.
    const shown = current && (current[0]?.roster_id === s.rosterId ? current : [current[1], current[0]]);
    const mine = pairs.find((p) => p.some((r) => r && owns(s, r)));
    const back = mine && mine !== current
      ? `<button class="my-team" data-pick-roster="${mine[0].roster_id}" title="Back to your matchup"><span aria-hidden="true">←</span>My matchup</button>` : '';
    return `${back}<div class="team-pick pair-pick${s.rosterMenu ? ' open' : ''}">
      <button class="tp-button" data-action="roster-menu" data-roster="${s.rosterId ?? ''}" aria-haspopup="listbox" aria-expanded="${Boolean(s.rosterMenu)}" aria-label="Matchup to show">
        ${shown ? `<span class="tp-pair">${half(shown[0])}<span class="tp-vs">vs</span>${half(shown[1])}</span>` : '<span class="tp-name">Pick a matchup</span>'}<span class="tp-chevron" aria-hidden="true"></span>
      </button>
      <div class="tp-menu" role="listbox">${pairs.map((p) => (p === current ? shown : p)).map((p) => `<button role="option" data-pick-roster="${p[0].roster_id}" aria-selected="${p === shown}">
          <span class="tp-pair">${half(p[0])}<span class="tp-vs">vs</span>${half(p[1])}</span></button>`).join('')}</div>
    </div>`;
  }

  // The shown week's matchups as pairs of rosters ([a, b], b null without an
  // opponent): yours first, yours on the left, then A to Z by the left team.
  function matchupPairs(s) {
    const week = s.weeks?.[s.week];
    const pool = week?.legs?.length ? week.legs : week?.matchups || [];
    const byId = Object.fromEntries((s.rosters || []).map((r) => [r.roster_id, r]));
    const groups = new Map();
    for (const m of pool) {
      const roster = byId[m.roster_id];
      if (!roster) continue;
      const key = m.matchup_id ?? `solo:${m.roster_id}`;
      groups.set(key, [...(groups.get(key) || []), roster]);
    }
    const name = (r) => teamName(s, r);
    const pairs = [...groups.values()].map((list) => {
      const [a, b = null] = [...list].sort((x, y) => (owns(s, y) - owns(s, x)) || name(x).localeCompare(name(y)));
      return [a, b];
    });
    return pairs.sort((x, y) => (owns(s, y[0]) - owns(s, x[0])) || name(x[0]).localeCompare(name(y[0])));
  }

  // ---- Optimize lineup (NBA optimize.js, NFL nfl.js) ----

  // The "How it picks" tag beside the title; `how`: its tooltip, plain text.
  const howTip = (how) => `<span class="how" tabindex="0" aria-describedby="how-tip">How it picks<span class="how-tip" id="how-tip" role="tooltip">${esc(how)}</span></span>`;

  // The starters' projection now and after the plan's changes.
  function planSummary(plan, label, sub) {
    const gain = plan.after - plan.before;
    return `<div class="op-sum">
      <span class="label">${esc(label)}<span class="sub">${esc(sub)}</span></span>
      <span class="nums"><b>${f2(plan.before)}</b><span class="arrow">→</span><b class="after">${f2(plan.after)}</b>
        ${plan.changes.length ? `<span class="gain${gain < 0 ? ' down' : ''}">${gain >= 0 ? '+' : ''}${f2(gain)}</span>` : ''}</span>
    </div>`;
  }

  // The dialog: summary, what the last row saved (until the next save), `notes`
  // (warnings), then a row per slot; Cancel and `apply` (applyAll) below.
  // Without anything to apply, it says the lineup is already the best.
  function optimizeDialog(m, { week, how, summary, notes = '', rows, actionable, apply }) {
    const done = m.done ? `<p class="op-done" role="status">${esc(m.done)}</p>` : '';
    const body = actionable ? `${summary}${done}${notes}${rows}`
      : `${summary}${done}<p class="msg">This is already your best lineup for week ${esc(week)}.</p>${rows}`;
    return dialog('Optimize Lineup', `Week ${week}`, `
      <div class="dialog-body">
        ${dialogErrors(m.errors)}
        ${body}
      </div>
      <footer class="dialog-foot op-foot">
        <button data-action="close-modal" ${m.saving ? 'disabled' : ''}>${actionable ? 'Cancel' : 'Close'}</button>
        ${actionable ? apply : ''}
      </footer>`, howTip(how));
  }

  // The footer's button that saves the whole plan; `title` says why it's held back.
  function applyAll(m, label, { risky = false, held = false, title = '' } = {}) {
    return `<button class="primary${risky ? ' risky' : ''}" data-action="apply-lineup" ${m.saving || held ? 'disabled' : ''}${title ? ` title="${esc(title)}"` : ''}>${m.busy === 'all' ? 'Saving…' : esc(label)}</button>`;
  }

  // A changed slot's own Apply button (slots tied to it, `others`, apply with it).
  function applyChange(m, i, others, { held = false, title = '' } = {}) {
    const why = title || (others.length ? `Also changes ${others.join(', ')}` : '');
    return `<button class="os-apply" data-op-row="${i}" ${m.saving || held ? 'disabled' : ''}${why ? ` title="${esc(why)}"` : ''}>${m.busy === `row:${i}` ? 'Saving…' : 'Apply change'}</button>
          ${others.length ? `<span class="os-with">with ${esc(others.join(', '))}</span>` : ''}`;
  }

  // One player in a slot row: headshot (`photo`), name, `tags` (position, team,
  // injury) and the sub lines given. Name and headshot open the player card.
  function slotPlayer(id, p, kind, sub, { photo, tags }) {
    if (!real(id)) return `<span class="os-p ${kind} empty"><span class="headshot blank"></span><span class="dp-info"><span class="dp-name">Empty</span></span></span>`;
    return `<span class="os-p ${kind}">
      <span class="os-face"><img class="headshot" src="${esc(photo)}" alt="" data-player="${esc(id)}">${subArrow(kind)}</span>
      <span class="dp-info">
        <span class="dp-name"><button class="name" data-player="${esc(id)}">${esc(p.name)}</button> ${tags}</span>
        ${sub}
      </span>
    </span>`;
  }

  // A substitution mark on the headshot, as soccer apps show them: a green arrow
  // up for who comes in, a red arrow down for who goes out.
  function subArrow(kind) {
    if (kind !== 'in' && kind !== 'out') return '';
    const path = kind === 'in' ? 'M6 2.5 10 7H7.6v3.5H4.4V7H2z' : 'M6 9.5 2 5h2.4V1.5h3.2V5H10z';
    return `<span class="os-arrow ${kind}" aria-label="${kind === 'in' ? 'Coming in' : 'Going out'}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="${path}"/></svg></span>`;
  }

  return {
    reserveRule, whatIfOn, scoringOf, adminScoring, whatIfChanges, whatIfBanner,
    esc, f2, CDN, headshot, teamLogo, teamName, ownerName, avatar, record, shortName, injuryTag, positions, teamTag,
    gameTime, weekday, gameLabel, nextGame, lockIcon, dialog, dialogErrors, slotBadge, weekNav, notice, loading, errorMsg,
    lineup, rosterParts, opponentOf, taxiRule, owns, real, playerOf, playerName, padTo, pct, researchLine,
    dash, num, height, ago, newsSource, heat, scaler, tierClass,
    avatarImg, teamCard, teamSideOf, teamSide, matchupPair, rowHead, swapHint, swapClass, emptyCard,
    muRow, muEmpty, muStarters, muSection,
    PAGES, pageTitle, toolbar, shell, teamPicker, matchupPicker, matchupPairs,
    howTip, planSummary, optimizeDialog, applyAll, applyChange, slotPlayer, subArrow,
  };
})();
