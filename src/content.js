// The content scripts' entry: follows Sleeper's in-page navigation and keeps
// one session per league, an NBA one to start with (nba/session.js), which
// hands an NFL league over to nfl/session.js once its sport is known; the
// sidebar's lines for NBA leagues (nba/nav.js), the chat's emoji reactions
// (chat.js), Sleeper's My Waivers dialog (claims.js), the settings dialog (settings.js) and the NFL player card's draft and contract (espn-client.js), on every page. Also the admin switch (?snp-admin), saved for the whole browser.
(() => {
  const { nbaSession, nbaNav, chat, claims, bridge, espnClient, loaders, model } = globalThis.SNP;
  const settings = globalThis.SNP.settings();
  const ROUTE = /^\/leagues\/(\d+)(?:\/([^/]+))?/;

  let active = null;
  const nav = nbaNav();
  chat();
  claims();
  // Sleeper's NFL player card asks for the player's real-life draft and contract
  // (page-hook.js); the ESPN calls go in the open league's API tab.
  bridge.answerLater('snp:espn', ({ kind, ...player }) => (espnClient[kind] ? espnClient[kind](active?.api ?? null, player) : { status: 'none' }));
  // The trades in Sleeper's NFL player card (page-hook.js) ask what each traded pick turned into, once its
  // draft is done: two small calls per season, in the open league's API tab, kept for the page's life.
  const boards = new Map();
  bridge.answerLater('snp:trade-picks', async ({ leagueId, picks }) => {
    const api = active?.api;
    const results = {};
    if (!api) return { results };
    const league = await api.get(`/v1/league/${encodeURIComponent(leagueId)}`).catch(() => null);
    for (const pick of picks || []) {
      const key = `${leagueId}:${pick.season}`;
      if (!boards.has(key)) boards.set(key, loaders.draftBoard(api, league, pick.season).catch(() => null));
      const board = await boards.get(key);
      if (!board) {
        boards.delete(key);
        continue;
      }
      const made = model.pickBecame({ original: Number(pick.original), round: Number(pick.round) }, board);
      const meta = made && board.picks.find((x) => x.pick_no === made.pickNo)?.metadata;
      if (made) results[`${pick.season}:${pick.round}:${pick.original}`] = { playerId: made.playerId, label: made.label, first_name: meta?.first_name, last_name: meta?.last_name, position: meta?.position, team: meta?.team };
    }
    return { results };
  });
  // A setting changed: each league's session starts over with it.
  settings.onChange(() => {
    active?.destroy();
    active = null;
    sync();
  });

  // Admin tools (what-if scoring: the Scoring control and the Players tab's
  // adminFPTS and adminDelta columns) are hidden unless turned on with
  // ?snp-admin=1 (off again with ?snp-admin=0). Sleeper's own navigation drops
  // the query string, between tabs and between leagues alike, so the choice is
  // saved for the whole browser the first time a URL carries it, and every
  // page, league, reload and tab follows the saved choice from then on.
  const ADMIN_PARAM = 'snp-admin';
  const ADMIN_STORE = 'admin';
  let admin = false;
  let adminFromUrl = false; // a URL decided it, so the saved choice loading late mustn't undo that
  function adminParam() {
    const value = new URLSearchParams(location.search).get(ADMIN_PARAM);
    return value == null ? null : !['0', 'off', 'false', 'no'].includes(value.toLowerCase());
  }
  function setAdmin(on) {
    if (on === admin) return;
    admin = on;
    active?.setAdmin(on);
  }
  chrome.storage.local.get(ADMIN_STORE).then((saved) => {
    if (!adminFromUrl) setAdmin(Boolean(saved[ADMIN_STORE]));
  });
  // Another tab turned it on or off.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ADMIN_STORE in changes) setAdmin(Boolean(changes[ADMIN_STORE].newValue));
  });

  // Sleeper is a single-page app, so route changes don't reload content scripts.
  // Polling also re-attaches the panel if React re-renders the tab.
  function sync() {
    const param = adminParam();
    if (param != null && (param !== admin || !adminFromUrl)) {
      adminFromUrl = true;
      chrome.storage.local.set({ [ADMIN_STORE]: param });
      setAdmin(param);
    }
    const [, leagueId = null, page = null] = location.pathname.match(ROUTE) ?? [];
    // One session per league, kept across its tabs; the panel only shows on Team and Matchup.
    if (leagueId !== (active?.leagueId ?? null)) {
      active?.destroy();
      active = leagueId ? nbaSession(leagueId, page, { admin, nav, settings }) : null;
    }
    active?.show(page);
    active?.attach();
    nav.attach(active?.leagueId ?? null);
  }

  // Runs at document_start: watching the DOM puts the panel in place in the
  // same task React inserts Sleeper's tab, before it can paint. Polling is a
  // safety net for route changes that only touch text or attributes.
  new MutationObserver(sync).observe(document, { childList: true, subtree: true });
  addEventListener('popstate', sync);
  setInterval(sync, 500);
  sync();
})();
