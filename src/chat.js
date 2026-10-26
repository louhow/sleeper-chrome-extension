// Sleeper's chat, on every page: a message's emoji reactions (inspected
// 2026-10-25). Sleeper keeps every emoji option in the row, the unused ones at
// width 0, and widens them all while the row is hovered, so the emoji under
// the cursor moves (an unused option before it opens up) and the row grows a
// line or two; the chat, pinned to its bottom, then scrolls by that much as
// soon as the names popup re-renders it, moving everything again. That popup
// sits in its message, which clips it (overflow: hidden), and cuts names at 64px.
// Here an open row is an overlay instead: it opens upward over its own message
// from where it sits, the emoji already there stay put, and the message keeps
// its height, so nothing on the page moves. The names popup comes out of the
// message, as wide as the names. A row is open while hovered, and while Sleeper
// shows its names popup (it lingers a moment after the cursor leaves).
//   chat() -> { destroy }
(globalThis.SNP ||= {}).chat = () => {
  const ROW = '.comment-reactions-container';
  const OPEN = `${ROW}:is([data-snp-open], :has(.reaction-members-container))`;
  // An option nobody picked: its count is empty (Sleeper's `hide` class comes
  // off every option while the names popup shows, so it can't tell them apart).
  const UNUSED = '.reaction:has(.reaction-count:empty)';
  // Only while the extension runs (data-snp-chat on <html>).
  const on = 'html[data-snp-chat]';
  const css = `
    /* Picked emoji first, so the options opening up never come before them. */
    ${on} ${ROW} ${UNUSED} { order: 1; }
    /* Widths change at once (only the pop-in animates), so a closing row never reflows. */
    ${on} ${ROW} .reaction-menu .reaction { transition: transform 0.2s ease, background 0.3s ease; }
    /* Measuring the row as it is closed, even though it's hovered. */
    ${on} ${ROW}[data-snp-measure] .reaction-menu ${UNUSED} { width: 0 !important; }
    ${on} .comment-group:has(${OPEN}) { overflow: visible; }
    ${on} ${OPEN} { position: relative; height: var(--snp-reactions-h); vertical-align: top; }
    ${on} ${OPEN} .reaction-menu {
      position: absolute;
      z-index: 3;
      left: -6px;
      bottom: 0;
      box-sizing: content-box;
      width: max-content;
      max-width: 240px;
      flex-wrap: wrap-reverse;
      padding: 3px 6px !important;
      border-radius: 10px;
      background: rgb(52, 62, 82);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 18px rgba(0, 0, 0, 0.45);
    }
    /* Who picked it: centred over the emoji, as wide as their names. */
    ${on} ${ROW} .reaction-members-container { z-index: 4; left: 50%; transform: translateX(-50%); }
    ${on} ${ROW} .reaction-members { box-sizing: border-box; width: max-content; min-width: 80px; max-width: 220px; border-radius: 8px; }
    ${on} ${ROW} .reaction-members .user { max-width: none; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).append(style);
  document.documentElement.toggleAttribute('data-snp-chat', true);

  // Opens a row from where it sits: its height as it is closed, held while it's open.
  function enter(e) {
    const row = e.target instanceof Element && e.target.closest(ROW);
    if (!row || row.hasAttribute('data-snp-open')) return;
    if (!row.matches(OPEN)) {
      row.toggleAttribute('data-snp-measure', true);
      row.style.setProperty('--snp-reactions-h', `${row.getBoundingClientRect().height}px`);
      row.removeAttribute('data-snp-measure');
    }
    row.toggleAttribute('data-snp-open', true);
  }

  function leave(e) {
    const row = e.target instanceof Element && e.target.closest(ROW);
    if (!row || row.contains(e.relatedTarget)) return;
    row.removeAttribute('data-snp-open');
  }

  // Capture, so the row is held before the hover paints.
  document.addEventListener('mouseover', enter, true);
  document.addEventListener('mouseout', leave, true);

  function destroy() {
    document.removeEventListener('mouseover', enter, true);
    document.removeEventListener('mouseout', leave, true);
    document.documentElement.removeAttribute('data-snp-chat');
    style.remove();
  }

  return { destroy };
};
