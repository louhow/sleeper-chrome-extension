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

  // Chopped leagues' little icons, as Sleeper's app draws them (currentColor
  // unless they have their own): the axe, the zone headers' danger and safe
  // marks, the lock before a chopped team's owner, and over its avatar a halo
  // or devil's horns, with the axe in a badge (chopAvatar).
  const AXE = '<svg class="ico axe" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(35 12 12)"><path d="M10.6 2.5h4.2c2.2 0 4.2-.9 5.8-2.3v11.2c-1.6-1.4-3.6-2.3-5.8-2.3h-4.2z" fill="currentColor"/><path d="M12.2 3v20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></g></svg>';
  const DANGER = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor"/><rect x="7" y="3.4" width="2" height="6.2" rx="1" fill="#0d1421"/><circle cx="8" cy="12.2" r="1.2" fill="#0d1421"/></svg>';
  const SAFE = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.4 8.3 6.9 10.8l4.7-5.2" fill="none" stroke="#0d1421" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const LOCK = '<svg class="ico lock" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="7" width="11" height="8.5" rx="1.8" fill="currentColor"/><path d="M5 7.5V5a3 3 0 0 1 6 0v2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const HALO = '<svg class="halo" viewBox="0 0 26 8" aria-hidden="true"><ellipse cx="13" cy="4" rx="10.5" ry="2.6" fill="none" stroke="#ffe14d" stroke-width="1.8"/></svg>';
  const HORNS = '<svg class="horns" viewBox="0 0 32 12" aria-hidden="true"><path d="M3.5 12C2 7.5 2.5 3 6 0c-.3 4 1.4 7 4.5 9.2z" fill="#ff3d5f"/><path d="M28.5 12C30 7.5 29.5 3 26 0c.3 4-1.4 7-4.5 9.2z" fill="#ff3d5f"/></svg>';
  const ZONE_ICONS = { chop: AXE, danger: DANGER, safe: SAFE };
  // A chopped team's avatar (`img`): halo when `angel`, else horns, and the axe badge.
  const chopAvatar = (img, angel) => `<span class="chop-av">${angel ? HALO : HORNS}${img}<span class="chop-badge" title="Chopped">${AXE}</span></span>`;

  return { slotBadge, headshot, injury, WATCH, AXE, LOCK, ZONE_ICONS, chopAvatar };
})();
