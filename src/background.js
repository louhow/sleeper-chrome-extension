// The extension's service worker: looks up a player's real-life draft and
// contract on ESPN for the player cards (src/espn-client.js asks, with
// chrome.runtime messages). It runs here because ESPN turns down calls from
// sleeper.com's pages. Rules and URLs: espn.js.
// Gentle on ESPN: a player is matched to ESPN's once (the id is kept for good,
// a "no match" for a week, as ESPN may add a rookie later), cards asking at the
// same time share one lookup, a draft is kept for good and a contract for a
// day (a contract still ending the same year keeps its start, so only the
// current season is read again), and an error isn't kept, so the next card
// tries again. Every call gives up after TIMEOUT_MS.
importScripts('espn.js');

(() => {
  const { espn } = globalThis.SNP;
  const TIMEOUT_MS = 8000;
  const DAY_MS = 24 * 3600e3;
  const NO_MATCH_MS = 7 * DAY_MS;
  // Earlier seasons read at most, to find when a contract started.
  const MAX_BACK = 6;
  const KINDS = {
    draft: { keep: Infinity, find: findDraft },
    contract: { keep: DAY_MS, find: findContract },
  };
  const running = new Map();

  // message: { type: 'snp:espn', kind: 'draft' | 'contract', sport, playerId, name, lastName, birthDate, espnId }
  // reply: { status: 'found' | 'undrafted' | 'none' | 'error', draft? | contract?, cached?, calls: [{ label, url, status, ms, bytes, error }] }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message?.type !== 'snp:espn') return false;
    lookup(message).then(reply, (err) => reply({ status: 'error', error: String(err.message || err), calls: [] }));
    return true;
  });

  async function lookup(player) {
    const kind = KINDS[player.kind];
    if (!kind || !espn.LEAGUES[player.sport] || !player.playerId) return { status: 'none', calls: [] };
    const key = `${player.kind}:${player.sport}:${player.playerId}`;
    const saved = (await chrome.storage.local.get(key))[key];
    const keep = saved?.status === 'none' ? Math.min(NO_MATCH_MS, kind.keep) : kind.keep;
    if (saved && Date.now() - saved.at < keep) return { ...saved, cached: true, calls: [] };
    if (!running.has(key)) {
      const calls = [];
      const get = (label, url, options) => fetchJson(label, url, calls, options);
      running.set(key, kind.find(player, get, saved)
        .catch((err) => ({ status: 'error', error: String(err.message || err) }))
        .then(async (result) => {
          if (result.status !== 'error') await chrome.storage.local.set({ [key]: { ...result, at: Date.now() } });
          return { ...result, calls };
        })
        .finally(() => running.delete(key)));
    }
    return running.get(key);
  }

  // The player's ESPN id and, when it had to be fetched, ESPN's record of him;
  // null without a match. Sleeper's own espn_id when it has one (a stale one
  // falls back to the search), else ESPN's search, accepted only on the same birthday.
  async function athlete({ sport, playerId, name, lastName, birthDate, espnId }, get) {
    const key = `espn-id:${sport}:${playerId}`;
    const saved = (await chrome.storage.local.get(key))[key];
    if (saved?.id) return { id: saved.id };
    if (saved && Date.now() - saved.at < NO_MATCH_MS) return null;
    let found = espnId ? await get(`espn athlete ${espnId}`, espn.athleteUrl(sport, espnId)).catch(() => null) : null;
    for (const query of birthDate && !found ? espn.queries({ name, lastName }) : []) {
      for (const id of espn.candidates(sport, await get(`espn search "${query}"`, espn.searchUrl(query)))) {
        const record = await get(`espn athlete ${id}`, espn.athleteUrl(sport, id));
        if (espn.sameBirthday(record?.dateOfBirth, birthDate)) {
          found = record;
          break;
        }
      }
      if (found) break;
    }
    const id = found?.id ? String(found.id) : null;
    await chrome.storage.local.set({ [key]: { id, at: Date.now() } });
    return id ? { id, record: found } : null;
  }

  async function findDraft(player, get) {
    const match = await athlete(player, get);
    if (!match) return { status: 'none' };
    const record = match.record ?? await get(`espn athlete ${match.id}`, espn.athleteUrl(player.sport, match.id));
    const draft = espn.draftOf(record);
    if (!draft) return { status: 'undrafted' };
    // The drafting team's abbreviation; the draft stands without it.
    const team = draft.teamRef ? await get('espn team', draft.teamRef).catch(() => null) : null;
    return { status: 'found', draft: { year: draft.year, round: draft.round, pick: draft.pick, team: team?.abbreviation ?? null } };
  }

  // This season's contract, and the season it started: the earliest one in a
  // row that's the same contract (espn.sameContract; read again only when it changes).
  async function findContract(player, get, saved) {
    const { sport } = player;
    const match = await athlete(player, get);
    if (!match) return { status: 'none' };
    const season = espn.contractSeason(sport);
    const read = (s) => get(`espn contract ${s}`, espn.contractUrl(sport, match.id, s), { missing: null });
    const now = espn.contractOf(sport, season, await read(season));
    if (!now) return { status: 'none' };
    // A start found before contracts recorded their team is found again.
    let start = saved?.contract && 'team' in saved.contract && espn.sameContract(saved.contract, now) ? saved.contract.startSeason : null;
    if (start == null) {
      start = season;
      for (let s = season - 1; s >= season - MAX_BACK; s--) {
        if (!espn.sameContract(espn.contractOf(sport, s, await read(s).catch(() => null)), now)) break;
        start = s;
      }
    }
    return { status: 'found', contract: { ...now, startSeason: start, since: espn.seasonLabel(sport, start) } };
  }

  // A GET that gives up after TIMEOUT_MS, noted in `calls` for the extension's
  // API tab. With `missing`, a 404 answers that instead of failing.
  async function fetchJson(label, url, calls, { missing } = {}) {
    const started = Date.now();
    const call = { label, url, status: 'pending' };
    calls.push(call);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: abort.signal });
      const text = await res.text();
      Object.assign(call, { status: res.status, ms: Date.now() - started, bytes: text.length });
      if (res.status === 404 && missing !== undefined) return missing;
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
