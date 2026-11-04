// Sleeper's My Waivers dialog (its pending claims, any sport; inspected in
// Sleeper's bundle 2026-11-04), on every page. Sleeper draws each claim as a
// league-activity row inside a sortable one, padded three times over (the
// sortable row, the activity row and the claim in it), with a 36px avatar, the
// owner's name at 16px and the clear time and bid stacked three lines high in
// a pill that floats over the players, so a claim stands some 115px tall and
// four fit the dialog before it scrolls. Here a claim is two lines, the add
// and the drop, with the pill on the add's line and the bid shown once
// (Sleeper writes it twice, in the pill and after it). Only padding, margins,
// sizes and where the pill sits change; every element stays Sleeper's, so
// dragging, Edit and Cancel work as before. Switched on by `data-snp-claims`
// on <html>, so it holds however often React redraws the dialog.
//   claims() -> { destroy }
(globalThis.SNP ||= {}).claims = () => {
  const on = 'html[data-snp-claims]';
  const panel = `${on} .waivers-panel`;
  // A claim's row, in the dialog and while it's dragged (its copy goes in <body>).
  const row = `${on} :is(.waivers-panel .trans-item, .trans-item.sortable-list-waiver-item)`;
  const claim = `${row} .league-transaction-item-waiver`;
  const owner = `${claim} > .meta .team-owner-with-description`;
  const css = `
    ${panel} .channel-settings-header { flex-basis: auto; padding: 12px 16px 10px; }
    ${panel} .waiver-channel-settings-body { padding: 0 16px; }
    ${panel} .default-text { padding: 8px 10px 12px; }
    ${row} { display: flex; align-items: center; padding: 5px 0; }
    ${row} .fa-bars { padding-right: 12px; font-size: 16px; }
    /* The activity row and the claim give up their own padding and rule: the sortable row has both. */
    ${row} .league-transaction-item-waiver-container { padding-bottom: 0; border-bottom: none; }
    ${claim} { align-items: center; padding-top: 0; }
    /* The owner: a fixed column, so the players line up from row to row. */
    ${claim} > .meta { flex: 0 0 170px; min-width: 0; }
    ${owner} { padding-top: 0; }
    ${owner} .avatar-container { margin-right: 8px; }
    /* Sleeper sizes the avatar inline (width, height and flex basis), hence !important. */
    ${owner} .avatar-container .avatar { width: 32px !important; height: 32px !important; flex-basis: 32px !important; }
    ${owner} > .meta { min-width: 0; }
    ${owner} > .meta > :is(.name, .description) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    ${owner} > .meta > .name { font-size: 13px; line-height: 16px; }
    ${owner} > .meta > .description { margin: 1px 0 0; font-size: 11px; line-height: 14px; }
    /* The players take the rest of the row (Sleeper fixes them at 290px), a line each. */
    ${claim} .transactions { flex: 1 1 auto; width: auto; min-width: 0; margin-left: 8px; }
    ${claim} .transactions > * { margin-top: 0; min-height: 20px; }
    ${claim} .transactions > * + * { margin-top: 2px; }
    ${claim} .transactions .name { flex: 0 1 auto; min-width: 0; white-space: nowrap; text-overflow: ellipsis; }
    ${claim} .transactions .position { flex: none; white-space: nowrap; }
    /* The clear time and bid: one line, at the end of the add's line instead of floating over it. */
    ${claim} .clear { position: static; flex: none; margin-left: auto; padding: 2px 8px; line-height: 14px; }
    ${claim} .clear .waiver-clear { display: flex; align-items: baseline; gap: 4px; white-space: nowrap; }
    ${claim} .clear:has(.waiver-clear .bid) > .bid { display: none; }
    ${claim} .clear > .bid .status-text { padding: 0; }
    ${row} .action-btns { margin-left: 12px; white-space: nowrap; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).append(style);
  document.documentElement.toggleAttribute('data-snp-claims', true);
  return {
    destroy() {
      document.documentElement.removeAttribute('data-snp-claims');
      style.remove();
    },
  };
};
