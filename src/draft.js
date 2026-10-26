// A player's real-life draft for the player cards, from ESPN through the
// service worker (background.js). It never throws: ESPN slow, down or without
// a match comes back as a status the card shows quietly. The worker's calls go
// in the API tab's log.
//   lookup(api, { sport, playerId, name, lastName, birthDate, espnId })
//     -> { status: 'found' | 'undrafted' | 'none' | 'error', text, main, detail } (espn.draftParts; text null without one)
(globalThis.SNP ||= {}).draft = (() => {
  const { espn } = globalThis.SNP;

  async function lookup(api, player) {
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: 'snp:draft', ...player });
    } catch (err) {
      result = { status: 'error', error: String(err.message || err) };
    }
    for (const call of result?.calls || []) api?.external(call);
    if (result?.cached) api?.external({ label: `espn draft ${player.sport} ${player.playerId}`, url: 'chrome.storage.local', status: 'cache', ms: 0 });
    const status = result?.status || 'error';
    const parts = espn.draftParts(result);
    return { status, text: espn.draftText(result), main: parts?.main ?? null, detail: parts?.detail ?? '' };
  }

  return { lookup };
})();
