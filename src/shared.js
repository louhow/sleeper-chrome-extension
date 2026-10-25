// What the NBA and NFL sessions share in the page: their shadow-root hosts,
// hiding Sleeper's own content while ours stands in for it, save notices,
// keyboard and image handling, the page's storage, and the order the arrow
// keys go through the teams.
(globalThis.SNP ||= {}).shared = (() => {
  const NOTICE_MS = 3000;

  // The stylesheet is inlined into each shadow root, so nothing ever paints unstyled:
  // base.css (what the NBA/NFL and Premier League panels share) first, then the
  // panel's own. One fetch per panel; the EPL entry calls this too.
  const sheets = new Map();
  function stylesheet(path = 'src/panel.css') {
    if (!sheets.has(path)) {
      sheets.set(path, Promise.all(['src/base.css', path].map((p) => fetch(chrome.runtime.getURL(p)).then((r) => r.text())))
        .then((texts) => texts.join('\n')));
    }
    return sheets.get(path);
  }

  // An element with an open shadow root holding the stylesheet and a `.root`
  // to render into: { host, shadow, root, styled }. `onStyled` runs once the
  // stylesheet is in; until then `styled` is false.
  function shadowHost(id, onStyled) {
    const host = document.createElement('div');
    host.id = id;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<style></style><div class="root"></div>';
    const out = { host, shadow, root: shadow.querySelector('.root'), styled: false };
    stylesheet().then((text) => {
      shadow.querySelector('style').textContent = text;
      out.styled = true;
      onStyled?.();
    });
    return out;
  }

  // Hides part of Sleeper's page (`selector`) while the extension's own stands
  // in for it: a stylesheet switched on by an attribute on <html>, so it holds
  // however often React re-renders that part (an inline style goes with the
  // element), and switched on before it exists, it never paints at all.
  function hideSleeper(name, selector) {
    const attr = `data-snp-hide-${name}`;
    const style = document.createElement('style');
    style.textContent = `html[${attr}] ${selector} { display: none !important; }`;
    return {
      set(on) {
        if (on && !style.isConnected) (document.head || document.documentElement).append(style);
        if (document.documentElement.hasAttribute(attr) !== on) document.documentElement.toggleAttribute(attr, on);
      },
      remove() {
        document.documentElement.removeAttribute(attr);
        style.remove();
      },
    };
  }

  // Shows a save notice ({ kind: 'ok' | 'error', text } in `state.notice`) for
  // a few seconds; a newer one replaces it. `rerender` draws the change.
  function flasher(state, rerender) {
    return (text, kind = 'ok') => {
      const notice = { kind, text };
      state.notice = notice;
      rerender();
      setTimeout(() => {
        if (state.notice !== notice) return;
        state.notice = null;
        rerender();
      }, NOTICE_MS);
    };
  }

  // Enter and Space work the `selector` elements under `root` (links and boxes
  // that aren't buttons) from the keyboard; `fn` defaults to a click.
  function activateOnKey(root, selector, fn = (el) => el.click()) {
    const listener = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target.closest?.(selector);
      if (!el) return;
      e.preventDefault();
      fn(el);
    };
    root.addEventListener('keydown', listener);
    return () => root.removeEventListener('keydown', listener);
  }

  // Images the CDN doesn't have, under `root`: a headshot hides (`.missing`),
  // and an avatar (an image whose class names one) draws as the plain circle
  // from then on, through `state.failedAvatars`, a Set of their URLs, which
  // the renders read. Image errors don't bubble, so this listens in the capture phase.
  function markMissingImages(root, state, rerender) {
    state.failedAvatars ||= new Set();
    root.addEventListener('error', (e) => {
      const img = e.target;
      if (img.tagName !== 'IMG') return;
      img.classList.add('missing');
      if (!/avatar/.test(img.className) || state.failedAvatars.has(img.src)) return;
      state.failedAvatars.add(img.src);
      rerender();
    }, true);
  }

  // The page's own storage, which can be switched off: reads give null and
  // writes do nothing then (whatever it held is just for now).
  const safeStore = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage off.
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Storage off.
      }
    },
  };

  // An arrow up or down with no modifier, not while typing: the step it takes
  // through a list (1 down, -1 up), else 0.
  function arrowStep(e) {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return 0;
    if (e.composedPath().some((el) => el instanceof Element && el.matches('input, select, textarea, [contenteditable]'))) return 0;
    return e.key === 'ArrowDown' ? 1 : -1;
  }

  // The order the arrow keys go through the teams (see model.nextTeam): on the
  // Matchup tab the week's matchups (the picker's order, by their left team),
  // else every team A to Z, yours too.
  function teamOrder(state) {
    const { ui, view } = globalThis.SNP;
    const pairs = state.page === 'matchup' ? view.matchupPairs(state) : [];
    if (pairs.length) return pairs;
    return [...state.rosters].sort((a, b) => ui.teamName(state, a).localeCompare(ui.teamName(state, b))).map((r) => [r]);
  }

  // A save notice's list of lineup moves, "Name to SLOT, Name to bench";
  // past `max` moves, just the count, so the notice stays one line.
  //   changes: [{ id, to }]; nameOf(id): how a player is named.
  function movedText(changes, nameOf, max = Infinity) {
    if (changes.length > max) return `${changes.length} lineup changes`;
    return changes.map(({ id, to }) => `${nameOf(id)} to ${to === 'BN' ? 'bench' : to}`).join(', ');
  }

  // Sleeper's own NFL player card for a player (page-hook.js opens it). Sleeper's
  // own map may not have them (a Matchup row knows just that matchup's
  // players), so their basics go along: `p` as the extension keeps players
  // ({ name, first, last, position, positions, team, injury }).
  function nflPlayerCard(id, p = {}) {
    // Players read off Sleeper's Team tab have just a name.
    const [first, ...last] = p.first == null && p.name ? p.name.split(' ') : [p.first, p.last];
    const basics = { player_id: id, sport: 'nfl', first_name: first, last_name: last.join(' ') || undefined, position: p.position, fantasy_positions: p.positions, team: p.team, injury_status: p.injury };
    globalThis.SNP.bridge.tell('snp:nfl-player-card', { playerId: id, player: basics });
  }

  // addEventListener that returns the matching removeEventListener, so a
  // session's teardown is one list of these.
  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    return () => target.removeEventListener(type, fn, options);
  }

  // Opens a league tab through Sleeper's own tab row, so its router follows.
  function openSleeperTab(page) {
    const tabs = [...document.querySelectorAll('.center-tab-selector .item-tab')];
    tabs.find((t) => new RegExp(`^${page}$`, 'i').test(t.textContent.trim()))?.click();
  }

  return { stylesheet, shadowHost, hideSleeper, flasher, activateOnKey, markMissingImages, safeStore, arrowStep, teamOrder, movedText, listen, openSleeperTab, nflPlayerCard };
})();
