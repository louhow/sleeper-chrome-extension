// A player's real-life draft and contract for the player cards, from ESPN
// through the service worker (background.js). It never throws: ESPN slow, down
// or without a match comes back as a status the card shows quietly. The
// worker's calls go in the API tab's log.
//   draft(api, player) / contract(api, player), player: { sport, playerId, name, lastName, birthDate, espnId }
//     -> { status: 'found' | 'undrafted' | 'none' | 'error', text, main, detail }
//        (espn.draftParts / contractParts; text null without one)
(globalThis.SNP ||= {}).espnClient = (() => {
  const { espn } = globalThis.SNP;
  const PARTS = { draft: espn.draftParts, contract: espn.contractParts };

  async function ask(kind, api, player) {
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: 'snp:espn', kind, ...player });
    } catch (err) {
      result = { status: 'error', error: String(err.message || err) };
    }
    for (const call of result?.calls || []) api?.external(call);
    if (result?.cached) api?.external({ label: `espn ${kind} ${player.sport} ${player.playerId}`, url: 'chrome.storage.local', status: 'cache', ms: 0 });
    const parts = PARTS[kind](result);
    return { status: result?.status || 'error', text: parts && [parts.main, parts.detail].filter(Boolean).join(' · '), main: parts?.main ?? null, detail: parts?.detail ?? '' };
  }

  return { draft: (api, player) => ask('draft', api, player), contract: (api, player) => ask('contract', api, player) };
})();
