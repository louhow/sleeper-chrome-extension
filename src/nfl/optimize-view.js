// NFL "Optimize lineup": the dialog for the lineup model.bestNflLineup
// proposes on Sleeper's own NFL Team tab, laid out like the NBA one (a row per
// slot, each change applied on its own or all at once), and the OPTIMIZE
// button. NFL has one game a week and no Lock-In; players with an injury
// designation moving into the lineup are flagged. Pure: state -> HTML.
(globalThis.SNP ||= {}).nflOptimizeView = (() => {
  const { esc, f2, real, playerOf, playerName, teamTag, optimizeDialog, planSummary, applyAll, applyChange, slotPlayer } = globalThis.SNP.ui;
  const { slotBadge, headshot, injury, WATCH } = globalThis.SNP.nflUi;
  const { applySlot } = globalThis.SNP.model;

  // Plain text for the "How it picks" tooltip.
  const HOW = [
    'How it picks:',
    '1. Every player gets a number: their projected points for this week\'s game, with your league\'s scoring. A bye week, or a player ruled Out, means 0.',
    '2. It tries every way to fit your players into the starting slots and keeps the lineup whose numbers add up highest. Players who fit only one slot end up there, and the FLEX spots go to whoever is left.',
    '3. Anyone whose game has kicked off stays where they are.',
    '4. When two lineups add up the same, it keeps the one that moves the fewest players.',
    '5. Questionable and Doubtful players can still start; they are highlighted so you can check the news first.',
  ].join('\n');

  // The dialog over Sleeper's page: like the NBA one, one row per starting
  // slot in lineup order. A change leads with who comes in, beside who they
  // replace, with an Apply button (slots tied together apply together); a slot
  // that stays is dimmed and says why. Apply all saves the whole plan.
  function render(s) {
    const m = s.modal;
    if (!m) return '';
    const { plan, lineup } = m;
    const watching = plan.changes.filter((c) => c.to !== 'BN' && WATCH.has(lineup.players[c.id]?.injury));
    const watchNote = watching.length ? `<div class="warn-banner" role="status"><p>${watching.map((c) =>
      `<b>${esc(playerName(lineup.players, c.id))}</b> is ${esc(lineup.players[c.id].injury)}`).join(', ')}. Check the news before kickoff.</p></div>` : '';
    return optimizeDialog(m, {
      week: lineup.round,
      how: HOW,
      summary: planSummary(plan, 'Lineup projection', 'Starters\' projected points'),
      notes: watchNote,
      rows: `<div class="os-head nfl"><span>Slot</span><span>Starting</span><span>Replaces</span><span class="dp-pts" title="Projected points this week">Proj</span><span></span></div>
      ${lineup.slots.map((slot, i) => slotRow(m, slot, i)).join('')}`,
      actionable: plan.changes.length > 0,
      apply: applyAll(m, 'Apply all'),
    });
  }

  function slotRow(m, slot, i) {
    const { plan, lineup } = m;
    const cur = lineup.starters[i];
    const next = plan.starters[i];
    if (cur !== next) {
      const { slots } = applySlot(lineup.starters, plan.starters, i);
      const others = slots.filter((k) => k !== i).map((k) => lineup.slots[k]);
      const watch = WATCH.has(lineup.players[next]?.injury);
      const where = (id, list) => {
        const k = list.indexOf(id);
        return k < 0 ? 'bench' : lineup.slots[k];
      };
      const inSub = `<span class="sub move">From ${esc(where(next, lineup.starters))} · ${esc(opponent(lineup, next))}</span>${watch
        ? `<span class="sub drops warn">${esc(lineup.players[next].injury)}: check the news</span>` : ''}`;
      const outSub = real(cur) ? `<span class="sub move">To ${esc(where(cur, plan.starters))}<span class="why"> · ${f2(m.proj[cur] ?? 0)} proj</span></span>` : '';
      return `<div class="os-row nfl swap${watch ? ' warning' : ''}">
        <span class="os-slot">${slotBadge(slot)}</span>
        ${player(lineup, next, 'in', inSub)}
        ${player(lineup, cur, 'out', outSub)}
        <span class="dp-pts">${f2(m.proj[next] ?? 0)}</span>
        <span class="os-act">
          ${applyChange(m, i, others)}
        </span>
      </div>`;
    }
    const status = !real(cur) ? 'Empty' : lineup.played[cur] ? 'Started' : 'No change';
    return `<div class="os-row nfl same">
      <span class="os-slot">${slotBadge(slot)}</span>
      ${player(lineup, cur, 'keep', `<span class="sub">${esc(real(cur) ? lineup.played[cur] ? 'Game started' : opponent(lineup, cur) : '')}</span>`)}
      <span class="dp-pts">${real(cur) ? f2(m.proj[cur] ?? 0) : ''}</span>
      <span class="os-act"><span class="os-status">${status}</span></span>
    </div>`;
  }

  // Sleeper's projection names the opponent but not home or away.
  function opponent(lineup, id) {
    const opp = lineup.projections?.[id]?.opponent;
    return opp ? `Opp ${opp}` : 'No game this week';
  }

  function player(lineup, id, kind, sub) {
    const p = playerOf(lineup.players, id);
    return slotPlayer(id, p, kind, sub, { photo: headshot(id, p), tags: `${teamTag(p)}${injury(p)}` });
  }

  // The OPTIMIZE button, built from the classes of Sleeper's own WAIVER and TRADE buttons so it matches them.
  const BUTTON = `<div class="btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M17 20V4"/><path d="M13 16l4 4 4-4"/>
    </svg></div><div class="btn-text">OPTIMIZE</div>`;

  return { render, BUTTON };
})();
