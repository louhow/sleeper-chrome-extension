// A chopped league's League tab (src/nfl/chop.js puts it on the page), as
// Sleeper's app draws it: your own safe status, the week's chopping block
// (chop zone, danger, safe), the chopped players still on waivers, and the
// graveyard of chopped teams. Pure: state -> HTML.
(globalThis.SNP ||= {}).nflChopView = (() => {
  const { esc, f2, real, avatar, avatarImg, teamName, ownerName, owns, shortName, playerOf, teamTag, loading, errorMsg } = globalThis.SNP.ui;
  const { chopBlock, chopTeamStats, graveyard } = globalThis.SNP.model;
  const { headshot, injury } = globalThis.SNP.nflUi;
  const { lineup, totals } = globalThis.SNP.nflPanelView;
  const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
  // Sleeper's app's wording.
  const ZONES = { chop: 'Chop zone', danger: 'Danger', safe: 'Safe' };
  const SORTS = { proj: 'Proj', week: 'Week', pos: 'Pos' };
  const NONE_YET = 'Check later to see which players hit the waivers after a team is eliminated.';
  const ALL_PICKED = 'All chopped players have been picked up. Check back next week for new players.';

  // 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st.
  function ordinal(n) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    return `${n}${(!teen && { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10]) || 'th'}`;
  }
  const safeText = (safe) => `${Math.round(safe * 100)}%`;
  // A share as a bar, in its zone's color.
  const bar = (safe, zone) => `<span class="chop-bar ${zone}"><span style="width:${Math.round(safe * 100)}%"></span></span>`;

  //   s: the NFL panel's data for the week on now (nflPanel.weekView), plus
  //   `chop`: { players (model.choppedPlayers, null until loaded), sort, error }.
  function render(s) {
    if (!s) return `<div class="app league chop-tab">${loading()}</div>`;
    const teams = (s.rosters || []).filter((r) => !r.settings?.eliminated).map((roster) => {
      const l = lineup(s, roster.roster_id);
      const t = l ? totals(s, l) : { points: null, proj: 0, toPlay: 0 };
      const starters = l ? l.starters.filter(real).length : 0;
      return { rosterId: roster.roster_id, roster, ...t, played: starters - t.toPlay, starters };
    });
    const block = chopBlock(teams);
    return `<div class="app league chop-tab">
      ${mine(s, block)}
      ${blockView(s, block)}
      ${playersView(s)}
      ${graveyardView(s)}
    </div>`;
  }

  // Your team: its rank and safe chance, or the week it was chopped.
  function mine(s, block) {
    const roster = s.rosters.find((r) => owns(s, r));
    if (!roster) return '';
    const { avg, faab } = chopTeamStats(s.league, roster);
    const stats = `${avg == null ? '–' : f2(avg)} avg fpts · $${faab} faab`;
    const head = (sub, score = '') => `<div class="chop-me-row">
        ${avatarImg(avatar(s, roster), 'avatar', s.failedAvatars)}
        <div class="who"><div class="team-name">${esc(teamName(s, roster))}</div><div class="sub">${sub}</div></div>
        ${score}
      </div>`;
    if (roster.settings?.eliminated) {
      return `<section class="chop-me chopped">${head(`<b class="chop-tag">Chopped</b> · wk ${esc(roster.settings.eliminated)} · ${stats}`)}</section>`;
    }
    const t = block.find((x) => x.rosterId === roster.roster_id);
    if (!t) return '';
    return `<section class="chop-me ${t.zone}" data-open-team="${esc(roster.roster_id)}" role="link" tabindex="0" title="Your team">
      ${head(`${ordinal(t.rank)} of ${block.length} · ${stats}`, score(t))}
      <div class="chop-me-safe"><b class="${t.zone}">${safeText(t.safe)} safe</b>${bar(t.safe, t.zone)}</div>
    </section>`;
  }

  const score = (t) => `<div class="chop-score"><b>${t.points == null ? '–' : f2(t.points)}</b><span>${f2(t.proj)}</span></div>`;

  // The teams still alive, worst first, under their zone's header.
  function blockView(s, block) {
    let zone = null;
    const rows = block.map((t) => {
      const header = t.zone === zone ? '' : `<div class="chop-zone ${t.zone}">${ZONES[t.zone]}</div>`;
      zone = t.zone;
      const label = `${teamName(s, t.roster)}'s team`;
      return `${header}<div class="chop-row ${t.zone}${owns(s, t.roster) ? ' own' : ''}" data-open-team="${esc(t.rosterId)}" role="link" tabindex="0" title="${esc(label)}">
        <span class="chop-rank">${t.rank}</span>
        ${avatarImg(avatar(s, t.roster), 'avatar', s.failedAvatars)}
        <div class="who"><div class="team-name">${esc(teamName(s, t.roster))}</div><div class="sub">@${esc(ownerName(s, t.roster) || 'unknown')}</div></div>
        <div class="chop-safe">${bar(t.safe, t.zone)}<span>${safeText(t.safe)}</span></div>
        <span class="chop-played">${t.played}/${t.starters}</span>
        ${score(t)}
      </div>`;
    }).join('');
    return `<section class="chop-card">
      <div class="lg-head"><h3>Chopping Block</h3><span class="sub">Week ${esc(s.week)}</span></div>
      <div class="chop-row chop-cols"><span>Rank</span><span></span><span>Team</span><span>Safe %</span><span>Played</span><span>Pts · Proj</span></div>
      ${rows}
    </section>`;
  }

  // Chopped players no one has picked up yet, sorted as picked.
  function playersView(s) {
    const { players, sort, error } = s.chop;
    const week = s.weeks[s.week];
    const proj = (id) => week.proj[id] ?? 0;
    const sorts = Object.entries(SORTS).map(([key, label]) =>
      `<button data-chop-sort="${key}" class="${key === sort ? 'on' : ''}" aria-pressed="${key === sort}">${label}</button>`).join('');
    let body;
    if (error) body = errorMsg(error);
    else if (!players) body = loading();
    else if (!players.length) body = `<p class="msg">${s.league.settings?.last_chopped_leg ? ALL_PICKED : NONE_YET}</p>`;
    else {
      const rank = (id) => {
        const at = POSITION_ORDER.indexOf(playerOf(s.players, id).position);
        return at < 0 ? POSITION_ORDER.length : at;
      };
      const by = {
        proj: (a, b) => proj(b.id) - proj(a.id),
        week: (a, b) => b.week - a.week || proj(b.id) - proj(a.id),
        pos: (a, b) => rank(a.id) - rank(b.id) || proj(b.id) - proj(a.id),
      }[sort] || (() => 0);
      const from = (rosterId) => s.rosters.find((r) => r.roster_id === rosterId);
      body = [...players].sort(by).map((c) => {
        const p = playerOf(s.players, c.id);
        return `<div class="chop-player">
          <img class="headshot${p.position === 'DEF' ? ' logo' : ''}" src="${headshot(c.id, p)}" alt="" data-player="${esc(c.id)}">
          <div class="who">
            <div class="name"><button data-player="${esc(c.id)}">${esc(shortName(p))}</button>${injury(p)}</div>
            <div class="sub">${teamTag(p, { sep: '•' })}</div>
          </div>
          <div class="chop-from sub">${esc(teamName(s, from(c.rosterId)))}<br>chopped wk ${esc(c.week)}</div>
          <div class="chop-score"><b>${f2(proj(c.id))}</b><span>proj</span></div>
        </div>`;
      }).join('');
    }
    return `<section class="chop-card">
      <div class="lg-head"><h3>Chopped players on waivers</h3><span class="chop-sorts" role="group" aria-label="Sort by">${sorts}</span></div>
      ${body}
    </section>`;
  }

  // Chopped teams, latest first.
  function graveyardView(s) {
    const dead = graveyard(s.league, s.rosters);
    if (!dead.length) return '';
    return `<section class="chop-card">
      <div class="lg-head"><h3>Graveyard</h3></div>
      <div class="grave-row chop-cols"><span>Week</span><span></span><span>Name</span><span>FAAB rem</span><span>FPTS</span></div>
      ${dead.map((d) => `<div class="grave-row${owns(s, d.roster) ? ' own' : ''}">
        <span class="chop-rank">${esc(d.week)}</span>
        ${avatarImg(avatar(s, d.roster), 'avatar', s.failedAvatars)}
        <div class="who"><div class="team-name">${esc(teamName(s, d.roster))}</div><div class="sub">@${esc(ownerName(s, d.roster) || 'unknown')}</div></div>
        <span>$${esc(d.faab)}</span>
        <span>${d.avg == null ? '–' : f2(d.avg)}</span>
      </div>`).join('')}
    </section>`;
  }

  return { render, ordinal };
})();
