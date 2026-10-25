// Render helpers the NFL views share: Sleeper's NFL slot badges, headshots
// (team logos for defenses) and injury tags. Pure: data -> HTML.
(globalThis.SNP ||= {}).nflUi = (() => {
  const { esc, CDN } = globalThis.SNP.ui;

  // Sleeper's slot colors; flex slots show the letters of the positions they take.
  const FLEX_LETTERS = { FLEX: ['W', 'R', 'T'], WRRB_FLEX: ['W', 'R'], REC_FLEX: ['W', 'T'], SUPER_FLEX: ['W', 'R', 'T', 'Q'] };
  const LETTER_POSITION = { W: 'wr', R: 'rb', T: 'te', Q: 'qb' };
  const INJURY_SHORT = { Questionable: 'Q', Doubtful: 'D', Out: 'O', Suspended: 'SUS', Sus: 'SUS' };
  // Designations that still let a player suit up, so they're worth a second look when starting.
  const WATCH = new Set(['Questionable', 'Doubtful']);

  // With `spot`, the badge is the lineup button for that spot (see model.spotRefs).
  function slotBadge(slot, spot = null) {
    const letters = FLEX_LETTERS[slot];
    const tag = spot ? 'button' : 'span';
    const button = spot ? ` data-spot="${esc(spot)}" aria-label="Move ${esc(slot)}"` : '';
    if (letters) {
      return `<${tag} class="slot nfl flex"${button || ` aria-label="${esc(slot)}"`}>${letters.map((l) => `<i class="${LETTER_POSITION[l]}">${l}</i>`).join('')}</${tag}>`;
    }
    const cls = slot === 'IDP_FLEX' ? 'idp' : slot.toLowerCase();
    return `<${tag} class="slot nfl ${esc(cls)}"${button}>${esc(slot === 'IDP_FLEX' ? 'IDP' : slot)}</${tag}>`;
  }

  // Team defenses use the team logo; everyone else their headshot.
  const headshot = (id, p) => (p?.position === 'DEF'
    ? `${CDN}/images/team_logos/nfl/${encodeURIComponent(String(id).toLowerCase())}.png`
    : `${CDN}/content/nfl/players/thumb/${encodeURIComponent(id)}.jpg`);

  function injury(p) {
    if (!p?.injury) return '';
    const watch = WATCH.has(p.injury);
    return `<span class="nfl-inj${watch ? ' watch' : ''}" title="${esc(p.injury)}">${esc(INJURY_SHORT[p.injury] || p.injury)}</span>`;
  }

  return { slotBadge, headshot, injury, WATCH };
})();
