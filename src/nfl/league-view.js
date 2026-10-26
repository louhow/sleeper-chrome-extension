// The NFL League tab's matchup cards (src/nfl/league.js puts them on the page).
(globalThis.SNP ||= {}).nflLeagueView = (() => {
  const { esc, matchupPair, medianPair } = globalThis.SNP.ui;
  const { medianOn, leagueMedian } = globalThis.SNP.model;

  // Sleeper's text as a number: null for its "-" (no points yet) or nothing.
  const num = (text) => (Number.isFinite(parseFloat(text)) ? parseFloat(text) : null);

  // League tab: the week's matchups as the NBA League tab draws them, with
  // Sleeper's own numbers (text read off its cards, which stay hidden). Yours
  // first, after yours against the league median when the league plays one
  // that week (worked out from every card's numbers).
  //   reply: page-hook's { cards, round }; `failed`: avatar URLs that didn't load, drawn as the plain circle.
  function render({ cards = [], round = null } = {}, league = null, failed) {
    if (!cards.length) return '';
    const order = cards.map((c, i) => ({ ...c, i })).sort((a, b) => b.own - a.own || a.i - b.i);
    const team = (t) => t && { avatar: t.avatar, owner: t.owner, team: t.team, points: t.score, win: num(t.win) == null ? null : num(t.win) / 100, bar: t.bar, record: t.record, proj: t.proj };
    return `<div class="app league nfl-league"><div class="lg-list">${medianOf(cards, round, league, failed)}${order.map((c) => {
      const [a, b] = c.sides;
      const label = `Open ${a?.team || 'matchup'}${b ? ` vs ${b.team}` : ''}`;
      return matchupPair(team(a), team(b), {
        cls: `lg-match${c.own ? ' own' : ''}`,
        attrs: `role="button" tabindex="0" data-nfl-matchup="${c.i}" aria-label="${esc(label)}"`,
        failed,
      });
    }).join('')}</div></div>`;
  }

  // Your team against the league median; '' when there's none that week or no team of yours.
  function medianOf(cards, round, league, failed) {
    const own = cards.find((c) => c.mine != null);
    const you = own?.sides[own.mine];
    if (!you || round == null || !medianOn(league, round)) return '';
    const sides = cards.flatMap((c) => c.sides).filter(Boolean);
    const median = leagueMedian(sides.map((t) => ({ points: num(t.score), proj: num(t.proj) })));
    return medianPair({ avatar: you.avatar, owner: you.owner, team: you.team, points: num(you.score), proj: num(you.proj), record: you.record }, median, { failed });
  }

  return { render };
})();
