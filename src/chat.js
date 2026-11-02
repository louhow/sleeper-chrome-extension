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
// A trade (inspected in Sleeper's bundle 2026-11-01) is a card that shows two of
// a side's players and a VIEW button. page-hook.js reads the whole trade off the
// card's props and it's written out inside the card instead (chat-view.js), as
// Sleeper's mobile app shows it. Sleeper's card stays underneath, hidden: without
// its props nothing changes, and a click still opens its trade dialog. A trade
// Sleeper hasn't loaded has no card, just rows of each team's adds and drops,
// written out the same way from the message's own data (no dialog to open then).
//   chat() -> { destroy }
(globalThis.SNP ||= {}).chat = () => {
  const { bridge, chatView, shared } = globalThis.SNP;
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
  const report = `${list} :is(.weekly-report-owner-item, .weekly-report-player-item)`;
  const TRADE = '.trade-list-item.is-chat';
  const trade = `${list} ${TRADE}:has(> .snp-trade)`;
  const css = `
    /* A trade written out: Sleeper's card and its wrapper give up their fixed size, and all it drew. */
    ${list} .trade-list-item-attachment-wrapper:has(> ${TRADE} > .snp-trade) { height: auto; max-height: none; width: auto; max-width: 100%; margin-top: 4px; background: none; }
    ${trade} { height: auto; min-height: 0; max-height: none; width: auto; max-width: 100%; padding: 0; background: none; }
    ${list} [data-snp-trade]:has(> .snp-trade) > :not(.snp-trade) { display: none; }
    .snp-tr-title { margin: 0 0 6px; font-weight: 700; font-size: 14px; line-height: 18px; color: #fff; }
    .snp-tr-body { padding: 8px 12px; border: 1px solid rgba(255, 255, 255, 0.1); border-left: 3px solid #59a7ff; border-radius: 8px; background: rgba(0, 0, 0, 0.14); }
    .snp-tr-side + .snp-tr-side { margin-top: 8px; }
    .snp-tr-team { margin: 0 0 6px; font-weight: 700; font-size: 13px; color: #a3bbd3; overflow-wrap: anywhere; }
    .snp-tr-assets { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(140px, 100%), 1fr)); gap: 6px 10px; }
    .snp-tr-asset { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .snp-tr-asset.player { cursor: pointer; }
    .snp-tr-asset.player:hover .snp-tr-name { text-decoration: underline; }
    .snp-tr-face { position: relative; flex: none; display: flex; align-items: center; justify-content: center; box-sizing: border-box; width: 36px; height: 36px; border: 2px solid #a3bbd3; border-radius: 50%; background: #4a5870; font-size: 11px; color: #fff; }
    .snp-tr-face.token { border-color: #4a5870; }
    .snp-tr-face.qb { border-color: #fc2b6d; }
    .snp-tr-face.rb { border-color: #20ceb8; }
    .snp-tr-face.wr { border-color: #59a7ff; }
    .snp-tr-face.te { border-color: #feae58; }
    .snp-tr-face.k { border-color: #c96cff; }
    .snp-tr-face.def { border-color: #bf5f40; }
    .snp-tr-face.dl { border-color: #fd5c01; }
    .snp-tr-face.lb { border-color: #a3acff; }
    .snp-tr-face.db { border-color: #fd7db6; }
    .snp-tr-shot { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
    .snp-tr-shot.missing { visibility: hidden; }
    .snp-tr-sign { position: absolute; right: -4px; bottom: -3px; width: 14px; height: 14px; border-radius: 50%; background: #20ceb8; color: #022047; font: 700 12px/14px Arial, sans-serif; text-align: center; }
    .snp-tr-sign.drop { background: #fc2b6d; color: #fff; }
    .snp-tr-meta { display: flex; flex-direction: column; min-width: 0; }
    .snp-tr-name { font-weight: 700; font-size: 13px; line-height: 16px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .snp-tr-sub { font-size: 11px; line-height: 14px; color: #a3bbd3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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
    /* The weekly report (a card for each manager, and a player for each position in football). */
    ${list} .embed-league-report { margin: 6px 0 0; }
    ${report} { margin: 8px 0; padding: 10px 14px 12px; }
    ${report} .tagline { margin: 3px 0 0; }
    ${report} .owner-row { margin: 8px 0 0; align-items: center; }
    ${report} .owner-row :is(.avatar, img.avatar-player) { width: 36px !important; height: 36px !important; min-width: 36px !important; flex: 0 0 36px !important; }
    ${report} .owner-row .avatar img { width: 36px !important; height: 36px !important; }
    ${report} .owner-meta { height: auto; }
    ${report} .username { height: auto; line-height: 17px; }
    ${report} .team-name { margin: 0; line-height: 15px; }
    ${report} .stat-text { margin: 2px 0 0; line-height: 14px; }

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

  // Writes a trade out in its card or rows (page-hook.js marked them with the trade's id).
  // The new height mustn't take a chat at its latest message away from there.
  const images = {};
  const trades = {};
  const offTrade = bridge.on('snp:chat-trade', (t) => {
    for (const card of document.querySelectorAll(`[data-snp-trade="${CSS.escape(t.id)}"]`)) {
      const box = scroller(card.closest('.comment-group') ?? card);
      const latest = box.scrollHeight - box.scrollTop - box.clientHeight < 2;
      let block = card.querySelector(':scope > .snp-trade');
      if (!block) {
        block = document.createElement('div');
        block.className = 'snp-trade';
        shared.markMissingImages(block, images, () => {});
        card.append(block);
      }
      trades[t.id] = t;
      block.innerHTML = chatView.tradeHtml(t);
      if (latest) box.scrollTop = box.scrollHeight;
    }
  });

  // A player in a trade opens their card (a click there never reaches Sleeper's trade dialog):
  // the extension's own for NBA (any league page it's mounted on), Sleeper's for NFL.
  function openPlayer(e) {
    const asset = e.target instanceof Element && e.target.closest('.snp-tr-asset.player');
    if (!asset) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const id = asset.dataset.player;
    const t = trades[asset.closest('[data-snp-trade]')?.dataset.snpTrade];
    const p = t?.players?.[id] || {};
    if (p.sport === 'nba') bridge.tell('snp:player-card', { playerId: id });
    else shared.nflPlayerCard(id, { first: p.first_name, last: p.last_name, position: p.position, team: p.team });
  }

  // Capture, so the row is held before the hover paints.
  document.addEventListener('click', openPlayer, true);
  document.addEventListener('mouseover', enter, true);
  document.addEventListener('mouseout', leave, true);
  document.addEventListener('scroll', follow, true);

  function destroy() {
    document.removeEventListener('click', openPlayer, true);
    document.removeEventListener('mouseover', enter, true);
    document.removeEventListener('mouseout', leave, true);
    document.removeEventListener('scroll', follow, true);
    offTrade();
    for (const block of document.querySelectorAll('.snp-trade')) block.remove();
    document.documentElement.removeAttribute('data-snp-chat');
    style.remove();
  }

  return { destroy };
};
