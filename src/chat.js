// Sleeper's chat, on every page: a message's emoji reactions (inspected
// 2026-10-25). Sleeper keeps every emoji option in the row, the unused ones at
// width 0, and widens them all while the row is hovered, so the emoji under
// the cursor moves (an unused option before it opens up) and the row grows a
// line or two; the chat, pinned to its bottom, then scrolls by that much as
// soon as the names popup re-renders it, moving everything again. That popup
// sits in its message, which clips it (overflow: hidden), and cuts names at 64px.
// Here an open row is an overlay instead: from where it sits, the emoji already
// picked first and where they were, the rest in rows below, over whatever is
// under the message, which keeps its height, so nothing on the page moves.
// Without room below in the chat (its last message), the rows are pinned to
// the screen there instead and go on below, over the box you type in; only
// without room in the window either do they go above. The names popup comes
// out of the message, as wide as the names.
// A row is open while hovered, and while Sleeper itself shows every option:
// for a moment after the cursor leaves, as its names popup lingers (with or
// without names, which only a picked emoji has). Let go then, Sleeper's own
// wide row would come back in place, under the cursor, and open it again, and so on.
// The messages themselves are tightened too (inspected 2026-10-29): Sleeper
// pads every message group, avatar, embed and report card generously, so the
// chat shows about half as much as it could. Only padding, margins and sizes
// change (smaller avatars, a player's name and position on one line); every
// element stays where Sleeper puts it, and the reaction rows below are untouched.
//   chat() -> { destroy }
(globalThis.SNP ||= {}).chat = () => {
  const ROW = '.comment-reactions-container';
  // An option nobody picked: its count is empty (Sleeper's `hide` class comes
  // off every option while it shows them all, so it can't tell them apart).
  const UNUSED = '.reaction:has(.reaction-count:empty)';
  const OPEN = `${ROW}:is([data-snp-open], :has(.reaction:not(.hide) > .reaction-count:empty), :has(.reaction-members-container))`;
  // The open row's padding either side, and how far left of the row it starts so its emoji stay put.
  const PAD = 6;
  // Only while the extension runs (data-snp-chat on <html>).
  const on = 'html[data-snp-chat]';
  const list = `${on} .comment-list`;
  const tx = `${list} .embed-league-transaction`;
  const report = `${list} .weekly-report-owner-item`;
  const css = `
    /* Compact messages: the group's padding, the avatar and the name line.
       Sleeper sizes every avatar and headshot inline, so those need !important. */
    ${list} .comment-group { padding: 5px 14px 7px; }
    ${list} .comment-group .avatar { width: 32px !important; height: 32px !important; min-width: 32px; }
    ${list} .comment-group .avatar img { width: 32px !important; height: 32px !important; }
    ${list} .content-container { padding: 0 0 0 12px; }
    ${list} .name-container { margin: 0 0 1px; }
    ${list} .name-container .reply { padding: 3px 6px; }
    ${list} .text-container { padding: 2px 0; line-height: 18px; }
    ${list} :is(.embed-gif, .embed-poll, .embed-url) { margin-top: 6px; margin-bottom: 6px; }
    /* Free agent and waiver moves: one line a player, the bid beside them. */
    ${tx} { margin: 5px 0 6px; padding-left: 12px; }
    ${tx} .header-text { margin: 0 0 6px; }
    ${tx} .transaction-body { width: 100%; justify-content: space-between; }
    ${tx} .actions-container { width: auto; flex: 1 1 auto; min-width: 0; }
    ${tx} .transaction-player { height: 36px; margin: 0 0 4px; align-items: center; }
    ${tx} img.avatar-player { width: 30px !important; height: 30px !important; }
    ${tx} .meta { flex-direction: row; align-items: baseline; gap: 6px; height: auto; }
    ${tx} .meta :is(.name, .position) { width: auto; margin: 0; white-space: nowrap; }
    ${tx} :is(.bid-container, .bid-button) { height: 36px; }
    /* The weekly report: tighter cards and a smaller avatar. */
    ${list} .embed-league-report { margin: 6px 0 0; }
    ${report} { margin: 8px 0; padding: 0 0 0 12px; }
    ${report} .tagline { margin: 3px 0 0; }
    ${report} .owner-row { margin: 8px 0 0; align-items: center; }
    ${report} .owner-row .avatar { width: 36px !important; height: 36px !important; min-width: 36px; }
    ${report} .owner-row .avatar img { width: 36px !important; height: 36px !important; }
    ${report} .owner-meta { height: auto; }
    ${report} .username { height: auto; line-height: 17px; }
    ${report} .team-name { margin: 0; line-height: 15px; }

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
      top: 0;
      left: -${PAD}px;
      box-sizing: content-box;
      width: max-content;
      padding: 3px ${PAD}px !important;
      border-radius: 10px;
      background: rgb(52, 62, 82);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 6px 18px rgba(0, 0, 0, 0.45);
    }
    /* No room below in the chat: pinned to the screen where it sits, so it can go on below the chat. */
    ${on} ${OPEN}[data-snp-out] .reaction-menu { position: fixed; top: var(--snp-y); left: var(--snp-x); }
    /* Nor in the window: the rows go above, the picked emoji's row staying put at the bottom. */
    ${on} ${OPEN}[data-snp-up] .reaction-menu { top: auto; bottom: 0; flex-wrap: wrap-reverse; }
    /* Who picked it: centred over the emoji, as wide as their names. */
    ${on} ${ROW} .reaction-members-container { z-index: 4; left: 50%; transform: translateX(-50%); }
    ${on} ${ROW} .reaction-members { box-sizing: border-box; width: max-content; min-width: 80px; max-width: 220px; border-radius: 8px; }
    ${on} ${ROW} .reaction-members .user { max-width: none; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).append(style);
  document.documentElement.toggleAttribute('data-snp-chat', true);

  // The chat's scrolled box around a message: its first ancestor that clips.
  function scroller(el) {
    for (let e = el?.parentElement; e && e !== document.body; e = e.parentElement) {
      if (getComputedStyle(e).overflowY !== 'visible') return e;
    }
    return document.documentElement;
  }

  // Pins an open row's rows to the screen where the row is.
  function pin(row) {
    const box = row.getBoundingClientRect();
    row.style.setProperty('--snp-x', `${box.left - PAD}px`);
    row.style.setProperty('--snp-y', `${box.top}px`);
  }

  // Opens a row from where it sits: its height as it is closed, held while
  // it's open, and its rows below it (pinned to the screen when the chat has no
  // room below), or above when the window has none either.
  function enter(e) {
    const row = e.target instanceof Element && e.target.closest(ROW);
    if (!row || row.hasAttribute('data-snp-open')) return;
    const opening = !row.matches(OPEN);
    if (opening) {
      row.toggleAttribute('data-snp-measure', true);
      row.style.setProperty('--snp-reactions-h', `${row.getBoundingClientRect().height}px`);
      row.removeAttribute('data-snp-measure');
      row.removeAttribute('data-snp-out');
      row.removeAttribute('data-snp-up');
    }
    row.toggleAttribute('data-snp-open', true);
    if (!opening) return;
    // Laid out below first, then moved as needed (no paint in between).
    const menu = row.querySelector('.reaction-menu');
    if (!menu || menu.getBoundingClientRect().bottom <= scroller(row.closest('.comment-group') ?? row).getBoundingClientRect().bottom) return;
    pin(row);
    row.toggleAttribute('data-snp-out', true);
    if (menu.getBoundingClientRect().bottom <= innerHeight) return;
    row.removeAttribute('data-snp-out');
    row.toggleAttribute('data-snp-up', true);
  }

  // A pinned row's rows follow it if the page scrolls while it's open.
  function follow() {
    for (const row of document.querySelectorAll(`${ROW}[data-snp-out]`)) pin(row);
  }

  function leave(e) {
    const row = e.target instanceof Element && e.target.closest(ROW);
    if (!row || row.contains(e.relatedTarget)) return;
    row.removeAttribute('data-snp-open');
  }

  // Capture, so the row is held before the hover paints.
  document.addEventListener('mouseover', enter, true);
  document.addEventListener('mouseout', leave, true);
  document.addEventListener('scroll', follow, true);

  function destroy() {
    document.removeEventListener('mouseover', enter, true);
    document.removeEventListener('mouseout', leave, true);
    document.removeEventListener('scroll', follow, true);
    document.documentElement.removeAttribute('data-snp-chat');
    style.remove();
  }

  return { destroy };
};
