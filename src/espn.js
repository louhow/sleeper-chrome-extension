// ESPN's public API, for the one thing Sleeper doesn't carry: a player's
// real-life draft (year, round, pick, team). Pure: URLs, matching and text.
// background.js makes the calls (ESPN refuses ones from sleeper.com), and
// both player cards show draftParts.
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

  // A lookup's result as the cards show it: the year large and the rest small
  // (as "lbs" after a weight), { main: '2018', detail: 'Rd 1, Pk 1 (CLE)' }, or
  // { main: 'Undrafted' }; null without one (no match, or ESPN didn't answer).
  function draftParts(result) {
    if (result?.status === 'undrafted') return { main: 'Undrafted', detail: '' };
    const d = result?.status === 'found' ? result.draft : null;
    if (!d?.year) return null;
    const slot = [d.round != null && `Rd ${d.round}`, d.pick != null && `Pk ${d.pick}`].filter(Boolean).join(', ');
    return { main: String(d.year), detail: [slot, d.team && `(${d.team})`].filter(Boolean).join(' ') };
  }

  // The same in a line: "2018 · Rd 1, Pk 1 (CLE)", "Undrafted", or null.
  function draftText(result) {
    const parts = draftParts(result);
    return parts && [parts.main, parts.detail].filter(Boolean).join(' · ');
  }

  return { LEAGUES, MAX_CANDIDATES, searchUrl, athleteUrl, https, candidates, sameBirthday, queries, draftOf, draftParts, draftText };
})();
