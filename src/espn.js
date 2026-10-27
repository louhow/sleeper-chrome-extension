// ESPN's public API, for what Sleeper doesn't carry: a player's real-life
// draft (year, round, pick, team) and contract (when he's a free agent, years
// left, this season's pay, since when). Pure: URLs, matching, contract rules
// and text. background.js makes the calls (ESPN refuses ones from
// sleeper.com), and both player cards show draftParts and contractParts.
// Matching: Sleeper's espn_id when it has one (a quarter of NFL players, no
// NBA); else ESPN's player search, only that sport's league, accepted on an
// exact birth-date match. No match is no draft, never a guess.
(globalThis.SNP ||= {}).espn = (() => {
  const LEAGUES = { nfl: 'football/leagues/nfl', nba: 'basketball/leagues/nba' };
  const SEARCH = 'https://site.web.api.espn.com/apis/search/v2';
  const CORE = 'https://sports.core.api.espn.com/v2/sports';
  // Search results checked against the birth date, at most, so a common name never fans out.
  const MAX_CANDIDATES = 4;

  const searchUrl = (query) => `${SEARCH}?query=${encodeURIComponent(query)}&limit=10&type=player`;
  const athleteUrl = (sport, id) => `${CORE}/${LEAGUES[sport]}/athletes/${encodeURIComponent(id)}`;
  // ESPN links its own records over http.
  const https = (url) => String(url).replace(/^http:/, 'https:');

  // The ESPN ids in a search response that play in `sport`'s league, ESPN's order, at most MAX_CANDIDATES.
  function candidates(sport, json) {
    return (json?.results || []).flatMap((r) => r.contents || [])
      .filter((c) => c.defaultLeagueSlug === sport)
      .map((c) => String(c.uid || '').match(/~a:(\d+)$/)?.[1])
      .filter(Boolean)
      .slice(0, MAX_CANDIDATES);
  }

  // ESPN's "1996-09-07T07:00Z" against Sleeper's "1996-09-07": the same day.
  const sameBirthday = (espnDate, sleeperDate) => Boolean(espnDate && sleeperDate) && String(espnDate).slice(0, 10) === String(sleeperDate).slice(0, 10);

  // What to search for: the full name, then the last name alone (ESPN's "III"
  // or an accent can keep the full name from finding them).
  function queries({ name, lastName }) {
    return [...new Set([name, lastName].map((q) => String(q || '').trim()).filter(Boolean))];
  }

  // An ESPN athlete's draft: { year, round, pick, teamRef }, or null when it has none (undrafted).
  function draftOf(athlete) {
    const d = athlete?.draft;
    if (!d?.year) return null;
    return { year: d.year, round: d.round ?? null, pick: d.selection ?? null, teamRef: d.team?.$ref ? https(d.team.$ref) : null };
  }

  // A lookup's result as the cards show it, the pick large and the rest small
  // beside it (as "#7 RB" in the rankings): { main: 'Rd 1 · Pk 1', detail: 'CLE · 2018' }.
  // The round and pick carry the value; the year is context (Exp already says how
  // long ago), so it rides last. Without a round or pick the year leads. Or
  // { main: 'Undrafted' }; null without one (no match, or ESPN didn't answer).
  function draftParts(result) {
    if (result?.status === 'undrafted') return { main: 'Undrafted', detail: '' };
    const d = result?.status === 'found' ? result.draft : null;
    if (!d?.year) return null;
    const pick = [d.round != null && `Rd ${d.round}`, d.pick != null && `Pk ${d.pick}`].filter(Boolean).join(' · ');
    if (!pick) return { main: String(d.year), detail: d.team || '' };
    return { main: pick, detail: [d.team, d.year].filter(Boolean).join(' · ') };
  }

  // The same in a line: "Rd 1 · Pk 1 · CLE · 2018", "Undrafted", or null.
  function draftText(result) {
    const parts = draftParts(result);
    return parts && [parts.main, parts.detail].filter(Boolean).join(' · ');
  }

  // ---- Contracts ----

  // The season whose contracts are in force on `now`, as ESPN labels it: an
  // NFL league year starts in March and goes by the year it starts; an NBA
  // season starts in July and goes by the year it ends (2027 is 2026-27).
  function contractSeason(sport, now = Date.now()) {
    const d = new Date(now);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    return sport === 'nfl' ? (month >= 2 ? year : year - 1) : (month >= 6 ? year + 1 : year);
  }
  const contractUrl = (sport, id, season) => `${athleteUrl(sport, id)}/contracts/${encodeURIComponent(season)}`;
  // "2025" for NFL, "2025-26" for NBA's 2026.
  const seasonLabel = (sport, season) => (sport === 'nba' ? `${season - 1}-${String(season).slice(2)}` : String(season));

  // One season's contract record: { fa, years, pay, team }, or null for none.
  //   fa: the year he's a free agent (NFL's signedThrough, at least next year;
  //     NBA: the summer after the last season, the year that season ends).
  //   years: seasons left counting this one. pay: salary plus bonus this season.
  //   team: ESPN's id for the team it's with (null if ESPN doesn't say).
  function contractOf(sport, season, record) {
    if (!record) return null;
    const pay = (Number(record.salary) || 0) + (Number(record.bonus) || 0) || null;
    const team = String(record.team?.$ref || '').match(/\/teams\/(\d+)/)?.[1] ?? null;
    if (sport === 'nfl') {
      const through = Number(record.signedThrough);
      if (!through) return null;
      // A rookie deal's last year reads "signed through" that same year.
      const fa = Math.max(through, season + 1);
      return { fa, years: fa - season, pay, team };
    }
    const years = Number(record.yearsRemaining);
    if (!(years >= 1)) return null;
    return { fa: season + years - 1, years, pay, team };
  }

  // Whether an earlier season's record is the same contract: it ends the same
  // year, with the same team (a new team's deal can end the same year as the
  // old one's, as Kirk Cousins's Raiders deal does his Falcons one).
  const sameContract = (a, b) => Boolean(a && b) && a.fa === b.fa && (a.team == null || b.team == null || a.team === b.team);

  // "$11M", "$50.1M", "$950K".
  function money(n) {
    if (!n) return '';
    if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace(/\.0$/, '')}M`;
    return `$${Math.round(n / 1e3)}K`;
  }

  // A contract lookup as the cards show it: { main: 'FA 2028', detail: '2 yrs left · $11M · since 2025' },
  // "Final year" in its last; null without one (no contract on ESPN, or ESPN didn't answer).
  function contractParts(result) {
    const c = result?.status === 'found' ? result.contract : null;
    if (!c?.fa) return null;
    const left = c.years === 1 ? 'Final year' : `${c.years} yrs left`;
    return { main: `FA ${c.fa}`, detail: [left, money(c.pay), c.since && `since ${c.since}`].filter(Boolean).join(' · ') };
  }
  const contractText = (result) => {
    const parts = contractParts(result);
    return parts && `${parts.main} · ${parts.detail}`;
  };

  return {
    LEAGUES, MAX_CANDIDATES, searchUrl, athleteUrl, https, candidates, sameBirthday, queries, draftOf, draftParts, draftText,
    contractSeason, contractUrl, seasonLabel, contractOf, sameContract, money, contractParts, contractText,
  };
})();
