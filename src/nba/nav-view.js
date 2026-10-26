// An NBA league's line in Sleeper's left sidebar: your matchup this week, in
// the markup Sleeper draws for an NFL league there (inspected 2026-10-25), so
// Sleeper's own styles draw it. Pure: numbers -> HTML.
(globalThis.SNP ||= {}).nbaNavView = (() => {
  const { esc, f2 } = globalThis.SNP.ui;

  // The inside of a `.nav-league-matchup`: both team names, then each side's
  // points (– until it has any) and projection.
  //   m: { mine: { team, points, proj }, theirs: { team, points, proj } }
  function render(m) {
    const score = (t, flip) => `<div class="roster-score-and-projection-matchup${flip ? ' flip' : ''} row"><div class="score">${t.points == null ? '–' : f2(t.points)}</div><div class="projections">${f2(t.proj)}</div></div>`;
    return `<div class="team-name-container"><div class="small-text">${esc(m.mine.team)}</div><div class="vs">vs.</div><div class="small-text right">${esc(m.theirs.team)}</div></div>`
      + `<div class="score-container"><div class="left-score">${score(m.mine)}</div><div class="win-bar-wrapper"></div><div class="right-score">${score(m.theirs, true)}</div></div>`;
  }

  return { render };
})();
