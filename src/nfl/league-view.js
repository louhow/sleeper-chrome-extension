// The NFL League tab's matchup cards (src/nfl/league.js puts them on the page).
(globalThis.SNP ||= {}).nflLeagueView = (() => {
  const { esc, matchupPair } = globalThis.SNP.ui;

  // League tab: the week's matchups as the NBA League tab draws them, with
  // Sleeper's own numbers (text read off its cards, which stay hidden). Yours first.
  // `failed`: avatar URLs that didn't load, drawn as the plain circle.
  function render(cards, failed) {
    if (!cards.length) return '';
    const order = cards.map((c, i) => ({ ...c, i })).sort((a, b) => b.own - a.own || a.i - b.i);
    const team = (t) => t && { avatar: t.avatar, owner: t.owner, team: t.team, points: t.score, win: Number.isFinite(parseFloat(t.win)) ? parseFloat(t.win) / 100 : null, bar: t.bar, record: t.record, proj: t.proj };
    return `<div class="app league nfl-league"><div class="lg-list">${order.map((c) => {
      const [a, b] = c.sides;
      const label = `Open ${a?.team || 'matchup'}${b ? ` vs ${b.team}` : ''}`;
      return matchupPair(team(a), team(b), {
        cls: `lg-match${c.own ? ' own' : ''}`,
        attrs: `role="button" tabindex="0" data-nfl-matchup="${c.i}" aria-label="${esc(label)}"`,
        failed,
      });
    }).join('')}</div></div>`;
  }

  return { render };
})();
