// The sidebar's lines (nav.js): an NBA league's matchup this week, in the
// markup Sleeper draws for an NFL league there (inspected 2026-10-25), so
// Sleeper's own styles draw it; the win bar under any league's scores; and a
// chopped league's rank and safe chance. Pure: numbers -> HTML.
(globalThis.SNP ||= {}).nbaNavView = (() => {
  const { esc, f2, ordinal } = globalThis.SNP.ui;
  const { winProbability } = globalThis.SNP.model;

  // The inside of a `.nav-league-matchup`: both team names, then each side's
  // points (– until it has any) and projection, the win bar between them.
  //   m: { mine: { team, points, proj }, theirs: { team, points, proj } }
  function render(m) {
    const score = (t, flip) => `<div class="roster-score-and-projection-matchup${flip ? ' flip' : ''} row"><div class="score">${t.points == null ? '–' : f2(t.points)}</div><div class="projections">${f2(t.proj)}</div></div>`;
    const [win] = winProbability(m.mine.points ?? 0, m.mine.proj, m.theirs.points ?? 0, m.theirs.proj);
    return `<div class="team-name-container"><div class="small-text">${esc(m.mine.team)}</div><div class="vs">vs.</div><div class="small-text right">${esc(m.theirs.team)}</div></div>`
      + `<div class="score-container"><div class="left-score">${score(m.mine)}</div><div class="win-bar-wrapper"></div><div class="right-score">${score(m.theirs, true)}</div></div>`
      + winBar(win);
  }

  // Your chance of winning as the mobile app's home screen shows it, on a row
  // of its own under the scores: the percent, then a bar, green when you're
  // ahead, red when you're behind.
  function winBar(chance) {
    const pct = Math.round(chance * 100);
    return `<div class="snp-win ${chance >= 0.5 ? 'up' : 'down'}" title="${esc(`${pct}% to win`)}"><span>${pct}%</span><i><b style="width:${pct}%"></b></i></div>`;
  }

  // A chopped league's line: the bar is your safe chance, and your rank goes
  // where an opponent's score would be ("2nd / 12"); a chopped team, the week it went.
  //   c: { rank, of, safe, zone } or { out: week }
  function chopBar(c) {
    if (c.out != null) return `<div class="snp-win down"><span>Chopped wk ${esc(c.out)}</span></div>`;
    const pct = Math.round(c.safe * 100);
    return `<div class="snp-win ${c.zone === 'safe' ? 'up' : c.zone === 'danger' ? 'warn' : 'down'}" title="${esc(`${pct}% safe from the chop`)}"><span>${pct}% safe</span><i><b style="width:${pct}%"></b></i></div>`;
  }
  const chopRank = (c) => (c.out != null ? '' : `<div class="snp-chop-rank ${esc(c.zone)}">${esc(ordinal(c.rank))} / ${esc(c.of)}</div>`);


  return { render, winBar, chopBar, chopRank };
})();
