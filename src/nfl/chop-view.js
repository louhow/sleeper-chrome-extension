// A chopped league's League tab (src/nfl/chop.js puts it on the page), as
// Sleeper's app draws it: your own safe status, the week's chopping block
// (chop zone, danger, safe) and the graveyard of chopped teams. Pure: state -> HTML.
(globalThis.SNP ||= {}).nflChopView = (() => {
  const { esc, f2, avatar, avatarImg, teamName, ownerName, owns, loading, ordinal } = globalThis.SNP.ui;
  const { chopTeamStats, graveyard } = globalThis.SNP.model;
  const { chopBlockOf, chopBar: bar } = globalThis.SNP.nflPanelView;
  const { LOCK, ZONE_ICONS, chopAvatar } = globalThis.SNP.nflUi;
  // Sleeper's app's wording.
  const ZONES = { chop: 'Chop zone', danger: 'Danger', safe: 'Safe' };

  const safeText = (safe) => `${Math.round(safe * 100)}%`;

  //   s: the NFL panel's data for the week on now (nflPanel.weekView).
  function render(s) {
    if (!s) return `<div class="app league chop-tab">${loading()}</div>`;
    const block = chopBlockOf(s);
    return `<div class="app league chop-tab">
      ${mine(s, block)}
      ${blockView(s, block)}
      ${graveyardView(s)}
    </div>`;
  }

  // Your team: its rank and safe chance, or the week it was chopped.
  function mine(s, block) {
    const roster = s.rosters.find((r) => owns(s, r));
    if (!roster) return '';
    const { avg, faab } = chopTeamStats(s.league, roster);
    const stats = `${avg == null ? '–' : f2(avg)} avg fpts · $${faab} faab`;
    const head = (sub, score = '', angel = null) => `<div class="chop-me-row">
        ${angel == null ? avatarImg(avatar(s, roster), 'avatar', s.failedAvatars) : chopAvatar(avatarImg(avatar(s, roster), 'avatar', s.failedAvatars), angel)}
        <div class="who"><div class="team-name">${esc(teamName(s, roster))}</div><div class="sub">${sub}</div></div>
        ${score}
      </div>`;
    if (roster.settings?.eliminated) {
      const angel = graveyard(s.league, s.rosters).find((d) => d.roster === roster)?.angel;
      return `<section class="chop-me chopped">${head(`<b class="chop-tag">Chopped</b> · wk ${esc(roster.settings.eliminated)} · ${stats}`, '', angel)}</section>`;
    }
    const t = block.find((x) => x.rosterId === roster.roster_id);
    if (!t) return '';
    return `<section class="chop-me ${t.zone}" data-open-team="${esc(roster.roster_id)}" role="link" tabindex="0" title="Your team">
      ${head(`${ordinal(t.rank)} of ${block.length} · ${stats}`, score(t))}
      <div class="chop-me-safe"><b class="${t.zone}">${safeText(t.safe)} safe</b>${bar(t.safe, t.zone)}</div>
    </section>`;
  }

  const score = (t) => `<div class="chop-score"><b>${t.points == null ? '–' : f2(t.points)}</b><span>${f2(t.proj)}</span></div>`;

  // The teams still alive, worst first, under their zone's header: safe chance, starters played, FAAB left, points and projection.
  function blockView(s, block) {
    let zone = null;
    const rows = block.map((t) => {
      const header = t.zone === zone ? '' : `<div class="chop-zone ${t.zone}">${ZONE_ICONS[t.zone]}${ZONES[t.zone]}</div>`;
      zone = t.zone;
      const label = `${teamName(s, t.roster)}'s team`;
      return `${header}<div class="chop-row ${t.zone}${owns(s, t.roster) ? ' own' : ''}" data-open-team="${esc(t.rosterId)}" role="link" tabindex="0" title="${esc(label)}">
        <span class="chop-rank">${t.rank}</span>
        ${avatarImg(avatar(s, t.roster), 'avatar', s.failedAvatars)}
        <div class="who"><div class="team-name">${esc(teamName(s, t.roster))}</div><div class="sub">@${esc(ownerName(s, t.roster) || 'unknown')}</div></div>
        <div class="chop-safe">${bar(t.safe, t.zone)}<span>${safeText(t.safe)}</span></div>
        <span class="chop-played">${t.played}/${t.starters}</span>
        <span class="chop-faab">$${esc(chopTeamStats(s.league, t.roster).faab)}</span>
        ${score(t)}
      </div>`;
    }).join('');
    return `<section class="chop-card">
      <div class="lg-head"><h3>Chopping Block</h3><span class="sub">Week ${esc(s.week)}</span></div>
      <div class="chop-row chop-cols"><span>Rank</span><span></span><span>Team</span><span>Safe %</span><span>Played</span><span>FAAB</span><span>Pts · Proj</span></div>
      ${rows}
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
        ${chopAvatar(avatarImg(avatar(s, d.roster), 'avatar', s.failedAvatars), d.angel)}
        <div class="who"><div class="team-name">${esc(teamName(s, d.roster))}</div><div class="sub">${LOCK}@${esc(ownerName(s, d.roster) || 'unknown')}</div></div>
        <span>$${esc(d.faab)}</span>
        <span>${d.avg == null ? '–' : f2(d.avg)}</span>
      </div>`).join('')}
    </section>`;
  }

  return { render };
})();
