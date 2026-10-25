// NFL "Optimize lineup": the dialog for the lineup model.bestNflLineup
// proposes on Sleeper's own NFL Team tab, laid out like the NBA one (a row per
// slot, each change applied on its own or all at once). NFL has one game a week
// and no Lock-In; players with an injury designation moving into the lineup
// are flagged. Pure: state -> HTML.
(globalThis.SNP ||= {}).nfl = (() => {
  const { esc, f2, CDN, dialog, dialogErrors } = globalThis.SNP.ui;
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

  // The dialog over Sleeper's page: like the NBA one, one row per starting
  // slot in lineup order. A change leads with who comes in, beside who they
  // replace, with an Apply button (slots tied together apply together); a slot
  // that stays is dimmed and says why. Apply all saves the whole plan.
  function render(s) {
    const m = s.modal;
    if (!m) return '';
    const { plan, lineup } = m;
    const how = `<span class="how" tabindex="0" aria-describedby="how-tip">How it picks<span class="how-tip" id="how-tip" role="tooltip">${esc(HOW)}</span></span>`;
    const name = (id) => lineup.players[id]?.name || `Player #${id}`;
    const watching = plan.changes.filter((c) => c.to !== 'BN' && WATCH.has(lineup.players[c.id]?.injury));
    const watchNote = watching.length ? `<div class="warn-banner" role="status"><p>${watching.map((c) =>
      `<b>${esc(name(c.id))}</b> is ${esc(lineup.players[c.id].injury)}`).join(', ')}. Check the news before kickoff.</p></div>` : '';
    const done = m.done ? `<p class="op-done" role="status">${esc(m.done)}</p>` : '';
    const rows = `<div class="os-head nfl"><span>Slot</span><span>Starting</span><span>Replaces</span><span class="dp-pts" title="Projected points this week">Proj</span><span></span></div>
      ${lineup.slots.map((slot, i) => slotRow(m, slot, i)).join('')}`;
    const body = plan.changes.length ? `${summary(plan)}${done}${watchNote}${rows}`
      : `${summary(plan)}${done}<p class="msg">This is already your best lineup for week ${esc(lineup.round)}.</p>${rows}`;
    return dialog('Optimize Lineup', `Week ${lineup.round}`, `
      <div class="dialog-body">
        ${dialogErrors(m.errors)}
        ${body}
      </div>
      <footer class="dialog-foot op-foot">
        <button data-action="close-modal" ${m.saving ? 'disabled' : ''}>${plan.changes.length ? 'Cancel' : 'Close'}</button>
        ${plan.changes.length ? `<button class="primary" data-action="apply-lineup" ${m.saving ? 'disabled' : ''}>${m.busy === 'all' ? 'Saving…' : 'Apply all'}</button>` : ''}
      </footer>`, how);
  }

  function summary(plan) {
    const gain = plan.after - plan.before;
    return `<div class="op-sum">
      <span class="label">Lineup projection<span class="sub">Starters' projected points</span></span>
      <span class="nums"><b>${f2(plan.before)}</b><span class="arrow">→</span><b class="after">${f2(plan.after)}</b>
        ${plan.changes.length ? `<span class="gain${gain < 0 ? ' down' : ''}">${gain >= 0 ? '+' : ''}${f2(gain)}</span>` : ''}</span>
    </div>`;
  }

  const real = (id) => id && id !== '0';

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
          <button class="os-apply" data-op-row="${i}" ${m.saving ? 'disabled' : ''} ${others.length ? `title="Also changes ${esc(others.join(', '))}"` : ''}>${m.busy === `row:${i}` ? 'Saving…' : 'Apply change'}</button>
          ${others.length ? `<span class="os-with">with ${esc(others.join(', '))}</span>` : ''}
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
    if (!real(id)) return `<span class="os-p ${kind} empty"><span class="headshot blank"></span><span class="dp-info"><span class="dp-name">Empty</span></span></span>`;
    const p = lineup.players[id] || { name: `Player #${id}`, positions: [] };
    return `<span class="os-p ${kind}">
      <span class="os-face"><img class="headshot" src="${headshot(id, p)}" alt="">${globalThis.SNP.optimize.subArrow(kind)}</span>
      <span class="dp-info">
        <span class="dp-name"><b>${esc(p.name)}</b> <span class="team">${esc(p.position || '')} - ${esc(p.team || 'FA')}</span>${injury(p)}</span>
        ${sub}
      </span>
    </span>`;
  }

  // League tab: the week's matchups as the NBA League tab draws them, with
  // Sleeper's own numbers (read from its cards, which stay hidden). Yours first.
  // `failed`: avatar URLs that didn't load, drawn as the plain circle.
  function league(cards, failed = new Set()) {
    if (!cards.length) return '';
    const order = cards.map((c, i) => ({ ...c, i })).sort((a, b) => b.own - a.own || a.i - b.i);
    return `<div class="app league nfl-league"><div class="lg-list">${order.map((c) => {
      const [a, b] = c.sides;
      const label = `Open ${a?.team || 'matchup'}${b ? ` vs ${b.team}` : ''}`;
      return `<div class="lg-match mu-head${c.own ? ' own' : ''}" role="button" tabindex="0" data-nfl-matchup="${c.i}" aria-label="${esc(label)}">
        ${a ? side(a, 'mine', failed) : ''}
        <span class="vs">VS</span>
        ${b ? side(b, 'theirs', failed) : '<div class="mu-team theirs bye"><span class="sub">No opponent this week</span></div>'}
      </div>`;
    }).join('')}</div></div>`;
  }

  function side(t, cls, failed) {
    const pct = parseFloat(t.win);
    const trend = Number.isNaN(pct) ? '' : pct >= 50 ? 'up' : 'down';
    return `<div class="mu-team ${cls}">
      ${t.avatar && !failed.has(t.avatar) ? `<img class="avatar" src="${esc(t.avatar)}" alt="">` : '<div class="avatar"></div>'}
      <div class="mu-who">
        <div class="sub">@${esc(t.owner || 'unknown')}</div>
        <div class="team-name">${esc(t.team)}</div>
      </div>
      <div class="mu-pts">${esc(t.score || '–')}</div>
      <div class="mu-bar"><span class="${trend}" style="width:${Math.max(0, Math.min(100, t.bar))}%"></span></div>
      <div class="mu-meta">
        ${t.win ? `<b class="${trend}">${esc(t.win)} WIN</b>` : ''}
        <span>${esc(t.record)}</span>
        <span class="proj">${esc(t.proj)}</span>
      </div>
    </div>`;
  }

  // The OPTIMIZE button, built from the classes of Sleeper's own WAIVER and TRADE buttons so it matches them.
  const BUTTON = `<div class="btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 4v16"/><path d="M3 8l4-4 4 4"/><path d="M17 20V4"/><path d="M13 16l4 4 4-4"/>
    </svg></div><div class="btn-text">OPTIMIZE</div>`;

  return { render, league, side, slotBadge, headshot, injury, BUTTON, HOW };
})();
