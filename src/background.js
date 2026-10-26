// The extension's service worker: looks up a player's real-life draft on
// ESPN for the player cards (src/draft.js asks, with chrome.runtime messages).
// It runs here because ESPN turns down calls from sleeper.com's pages.
// Gentle on ESPN: each player is looked up once (cards asking at the same time
// share it), a draft is kept for good, a "no match" for a week (ESPN may add a
// rookie later), and an error not at all, so the next card tries again.
// Every call gives up after TIMEOUT_MS. Rules and URLs: espn.js.
importScripts('espn.js');

(() => {
  const { espn } = globalThis.SNP;
  const TIMEOUT_MS = 8000;
  const NO_MATCH_MS = 7 * 24 * 3600e3;
  const running = new Map();

  // message: { type: 'snp:draft', sport, playerId, name, lastName, birthDate, espnId }
  // reply: { status: 'found' | 'undrafted' | 'none' | 'error', draft?, cached?, calls: [{ label, url, status, ms, bytes, error }] }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'snp:draft') return false;
    lookup(message).then(reply, (err) => reply({ status: 'error', error: String(err.message || err), calls: [] }));
    return true;
  });

  async function lookup(player) {
    if (!espn.LEAGUES[player.sport] || !player.playerId) return { status: 'none', calls: [] };
    const key = `draft:${player.sport}:${player.playerId}`;
    const saved = (await chrome.storage.local.get(key))[key];
    if (saved && (saved.status !== 'none' || Date.now() - saved.at < NO_MATCH_MS)) return { ...saved, cached: true, calls: [] };
    if (!running.has(key)) {
      running.set(key, find(player).then(async (result) => {
        if (result.status !== 'error') await chrome.storage.local.set({ [key]: { status: result.status, draft: result.draft ?? null, at: Date.now() } });
        return result;
      }).finally(() => running.delete(key)));
    }
    return running.get(key);
  }

  async function find({ sport, name, lastName, birthDate, espnId }) {
    const calls = [];
    const get = (label, url) => fetchJson(label, url, calls);
    try {
      // Sleeper's own link to ESPN, when it has one (a stale one falls back to the search).
      let athlete = espnId ? await get(`espn athlete ${espnId}`, espn.athleteUrl(sport, espnId)).catch(() => null) : null;
      // Else ESPN's search, accepted only on the same birthday.
      for (const query of birthDate && !athlete ? espn.queries({ name, lastName }) : []) {
        for (const id of espn.candidates(sport, await get(`espn search "${query}"`, espn.searchUrl(query)))) {
          const found = await get(`espn athlete ${id}`, espn.athleteUrl(sport, id));
          if (espn.sameBirthday(found?.dateOfBirth, birthDate)) {
            athlete = found;
            break;
          }
        }
        if (athlete) break;
      }
      if (!athlete) return { status: 'none', calls };
      const draft = espn.draftOf(athlete);
      if (!draft) return { status: 'undrafted', calls };
      // The drafting team's abbreviation; the draft stands without it.
      const team = draft.teamRef ? await get('espn team', draft.teamRef).catch(() => null) : null;
      return { status: 'found', draft: { year: draft.year, round: draft.round, pick: draft.pick, team: team?.abbreviation ?? null }, calls };
    } catch (err) {
      return { status: 'error', error: String(err.message || err), calls };
    }
  }

  // A GET that gives up after TIMEOUT_MS, noted in `calls` for the extension's API tab.
  async function fetchJson(label, url, calls) {
    const started = Date.now();
    const call = { label, url, status: 'pending' };
    calls.push(call);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: abort.signal });
      const text = await res.text();
      Object.assign(call, { status: res.status, ms: Date.now() - started, bytes: text.length });
      if (!res.ok) throw new Error(`${res.status} from ${label}`);
      return text ? JSON.parse(text) : null;
    } catch (err) {
      if (call.status === 'pending') Object.assign(call, { status: 'error', ms: Date.now() - started });
      call.error = abort.signal.aborted ? `no answer in ${TIMEOUT_MS / 1000}s` : String(err.message || err);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
})();
