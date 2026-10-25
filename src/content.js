// The content scripts' entry: follows Sleeper's in-page navigation and keeps
// one session per league, an NBA one to start with (nba/session.js), which
// hands an NFL league over to nfl/session.js once its sport is known. Also the
// admin switch (?snp-admin), saved for the whole browser.
(() => {
  const { nbaSession } = globalThis.SNP;
  const ROUTE = /^\/leagues\/(\d+)(?:\/([^/]+))?/;

  let active = null;

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
      active = leagueId ? nbaSession(leagueId, page, { admin }) : null;
    }
    active?.show(page);
    active?.attach();
  }

  // Runs at document_start: watching the DOM puts the panel in place in the
  // same task React inserts Sleeper's tab, before it can paint. Polling is a
  // safety net for route changes that only touch text or attributes.
  new MutationObserver(sync).observe(document, { childList: true, subtree: true });
  addEventListener('popstate', sync);
  setInterval(sync, 500);
  sync();
})();
