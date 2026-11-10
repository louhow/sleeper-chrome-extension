// The NFL League tab's matchup cards (src/nfl/league.js puts them on the page).
(globalThis.SNP ||= {}).nflLeagueView = (() => {
  const { esc, matchupPair, medianBanner } = globalThis.SNP.ui;
  const { medianOn, leagueMedian, medianStanding, winProbability } = globalThis.SNP.model;

  // Sleeper's text as a number: null for its "-" (no points yet) or nothing.
  const num = (text) => (Number.isFinite(parseFloat(text)) ? parseFloat(text) : null);

  // Once both sides' projections are their scores (every game played), the
  // result is settled: 100% and 0% (or 50/50 on a tie), as the Matchup tab has
  // it, where Sleeper's card stops at 99% and 1%. Otherwise Sleeper's own numbers.
  function finalWins(a, b) {
    const n = [a?.score, a?.proj, b?.score, b?.proj].map(num);
    const r2 = (x) => Number(x.toFixed(2));
    if (n.some((x) => x == null) || r2(n[0]) !== r2(n[1]) || r2(n[2]) !== r2(n[3])) return [null, null];
    return winProbability(n[0], n[1], n[2], n[3]);
  }

  // League tab: the week's matchups as the NBA League tab draws them, with
  // Sleeper's own numbers (text read off its cards, which stay hidden). Yours
  // first. When the league plays the median that week, the week's median
  // (worked out from every card's numbers) comes first and every team over it
  // wears a medallion.
  //   reply: page-hook's { cards, round }; `failed`: avatar URLs that didn't load, drawn as the plain circle.
  function render({ cards = [], round = null } = {}, league = null, failed) {
    if (!cards.length) return '';
    const order = cards.map((c, i) => ({ ...c, i })).sort((a, b) => b.own - a.own || a.i - b.i);
    const med = round != null && medianOn(league, round)
      ? leagueMedian(cards.flatMap((c) => c.sides).filter(Boolean).map((t) => ({ points: num(t.score), proj: num(t.proj) })))
      : null;
    const team = (t, win) => t && {
      avatar: t.avatar, owner: t.owner, team: t.team, points: t.score, win: win ?? (num(t.win) == null ? null : num(t.win) / 100), bar: t.bar, record: t.record, proj: t.proj,
      median: medianStanding({ points: num(t.score), proj: num(t.proj) }, med),
    };
    return `<div class="app league nfl-league">${med ? medianBanner(med) : ''}<div class="lg-list">${order.map((c) => {
      const [a, b] = c.sides;
      const [winA, winB] = finalWins(a, b);
      const label = `Open ${a?.team || 'matchup'}${b ? ` vs ${b.team}` : ''}`;
      return matchupPair(team(a, winA), team(b, winB), {
        cls: `lg-match${c.own ? ' own' : ''}`,
        attrs: `role="button" tabindex="0" data-nfl-matchup="${c.i}" aria-label="${esc(label)}"`,
        failed,
      });
    }).join('')}</div></div>`;
  }

  return { render };
})();
