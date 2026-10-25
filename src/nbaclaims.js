// NBA waivers: the bid or add dialog that Sleeper's W and ADD buttons open
// (page-hook.js hands their clicks over), and the Team tab's list of pending
// claims, to rebid or cancel (src/waivers.js draws both).
//   ctx: { state, api, leagueId, schedule, modalSave, reloadRosters }
(globalThis.SNP ||= {}).nbaClaims = ({ state, api, leagueId, schedule, modalSave, reloadRosters }) => {
  const { model, waivers, loaders } = globalThis.SNP;
  const FIELDS = loaders.TRANSACTION_FIELDS;
  const league = JSON.stringify(leagueId);
  const nameOf = (id) => state.players[id]?.name || `Player #${id}`;

  // The logged-in owner's pending waiver claims, as Sleeper's waiver list loads them.
  async function load() {
    const roster = waivers.myRoster(state);
    if (!roster || !api.loggedIn()) return;
    try {
      const data = await api.graphql('league_transactions_filtered (pending waivers)', `query league_transactions_filtered {
  league_transactions_filtered(league_id: ${league}, roster_id_filters: [${Number(roster.roster_id)}], type_filters: ["waiver"], leg_filters: [], status_filters: ["pending"]) {
    ${FIELDS}
  }
}`, { auth: true });
      state.claims = data?.league_transactions_filtered ?? [];
    } catch (err) {
      console.warn('[sleeper-nba-panel] pending waivers unavailable', err);
      state.claims ??= [];
    }
    schedule();
  }

  // Sleeper's add or waiver-bid dialog for a player.
  function openBid({ playerId, status }) {
    state.modal = { kind: 'bid', playerId, status, bid: '', drops: [], errors: [], saving: false, focus: true };
    state.notice = null;
    schedule();
  }

  function openList() {
    state.modal = { kind: 'claims', errors: [], saving: false };
    state.notice = null;
    schedule();
    load();
  }

  // Submits the bid dialog: a waiver claim (with a FAAB bid) or a free-agent add, plus drops.
  function submit() {
    const m = state.modal;
    const roster = waivers.myRoster(state);
    if (m?.kind !== 'bid' || m.saving || !roster || !state.ready) return;
    const waiver = m.status === 'waiver';
    const error = model.claimError({ league: state.league, roster, waiver, bid: m.bid, drops: m.drops });
    if (error) {
      m.errors = [error];
      return schedule();
    }
    const rid = Number(roster.roster_id);
    const variables = { k_adds: [m.playerId], v_adds: [rid], k_drops: m.drops, v_drops: m.drops.map(() => rid) };
    const bid = waiver && state.league.settings?.waiver_type === model.FAAB;
    if (bid) Object.assign(variables, { k_settings: ['waiver_bid'], v_settings: [Number(m.bid)] });
    const dropping = m.drops.length ? ` (dropping ${m.drops.map(nameOf).join(', ')})` : '';
    const lists = '$k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int]';
    const args = 'k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops';
    return modalSave(async () => {
      if (waiver) {
        await api.graphql('submit_waiver_claim', `mutation submit_waiver_claim(${lists}${bid ? ', $k_settings: [String], $v_settings: [Int]' : ''}) {
  submit_waiver_claim(league_id: ${league}, ${args}${bid ? ', k_settings: $k_settings, v_settings: $v_settings' : ''}) {
    ${FIELDS}
  }
}`, { auth: true, variables });
        await load();
      } else {
        await api.graphql('league_create_transaction', `mutation league_create_transaction(${lists}) {
  league_create_transaction(league_id: ${league}, type: "free_agent", ${args}) {
    ${FIELDS}
  }
}`, { auth: true, variables });
        await reloadRosters();
      }
    }, waiver
      ? `${bid ? `$${Number(m.bid)} bid` : 'Claim'} placed for ${nameOf(m.playerId)}${dropping}`
      : `Added ${nameOf(m.playerId)}${dropping}`);
  }

  const claimById = (id) => state.claims?.find((c) => c.transaction_id === id);
  const claimName = (claim) => state.players[Object.keys(claim.adds || {})[0]]?.name || 'claim';

  function updateBid(id, value) {
    const claim = claimById(id);
    const roster = waivers.myRoster(state);
    if (!claim || !roster) return;
    // Validate like a new bid; the claim's own add needs no extra roster room.
    const error = model.claimError({ league: state.league, roster: { ...roster, players: [] }, waiver: true, bid: value, drops: [] });
    if (error) {
      state.modal.errors = [error];
      return schedule();
    }
    const settings = { ...claim.settings, waiver_bid: Number(value) };
    const variables = { k_settings: Object.keys(settings), v_settings: Object.values(settings).map(Number) };
    return modalSave(async () => {
      await api.graphql('update_waiver_claim', `mutation update_waiver_claim($k_settings: [String], $v_settings: [Int]) {
  update_waiver_claim(league_id: ${league}, transaction_id: ${JSON.stringify(id)}, leg: ${Number(claim.leg)}, k_settings: $k_settings, v_settings: $v_settings) {
    ${FIELDS}
  }
}`, { auth: true, variables });
      await load();
    }, `Bid for ${claimName(claim)} is now $${Number(value)}`);
  }

  function cancel(id) {
    const claim = claimById(id);
    if (!claim) return;
    state.modal.confirmCancel = null;
    return modalSave(async () => {
      await api.graphql('cancel_waiver_claim', `mutation cancel_waiver_claim {
  cancel_waiver_claim(league_id: ${league}, leg: ${Number(claim.leg)}, transaction_id: ${JSON.stringify(id)}) {
    ${FIELDS}
  }
}`, { auth: true });
      await load();
    }, `Canceled the claim for ${claimName(claim)}`);
  }

  // The dialogs' clicks; true when one was theirs. `root`: the dialog layer.
  function click(target, root) {
    const m = state.modal;
    const drop = target.closest('[data-drop]');
    if (drop && m?.kind === 'bid' && !m.saving) {
      const id = drop.dataset.drop;
      m.drops = m.drops.includes(id) ? m.drops.filter((d) => d !== id) : [...m.drops, id];
      m.errors = [];
      schedule();
      return true;
    }
    const save = target.closest('[data-claim-save]');
    if (save) {
      const id = save.dataset.claimSave;
      updateBid(id, root.querySelector(`[data-claim-bid="${CSS.escape(id)}"]`)?.value ?? '');
      return true;
    }
    // Canceling a claim asks first; only "Yes, cancel" removes it.
    const ask = target.closest('[data-claim-cancel]');
    if (ask && m?.kind === 'claims' && !m.saving) {
      m.confirmCancel = ask.dataset.claimCancel;
      m.errors = [];
      schedule();
      return true;
    }
    if (target.closest('[data-claim-cancel-keep]') && m) {
      m.confirmCancel = null;
      schedule();
      return true;
    }
    const confirmed = target.closest('[data-claim-cancel-confirm]');
    if (confirmed) {
      cancel(confirmed.dataset.claimCancelConfirm);
      return true;
    }
    return false;
  }

  return { load, openBid, openList, submit, click };
};
