// A trade in Sleeper's chat, written out as Sleeper's mobile app shows it: each
// team and what it gets, so there's no VIEW to click for it. Pure: data -> HTML.
//   t = { title or status, opens, rosterIds, adds, drops, picks, budget, players, names },
//   read off Sleeper's trade card or rows (page-hook.js); `opens` when a click opens
//   Sleeper's trade dialog (a card does): adds and drops are { playerId: rosterId },
//   picks "originalRosterId,season,round,newRosterId,oldRosterId", budget
//   "fromRosterId,toRosterId,amount", players { playerId: player } and names { rosterId: name }.
(globalThis.SNP ||= {}).chatView = (() => {
  const { esc, CDN, ordinal } = globalThis.SNP.ui;
  const TITLES = {
    complete: 'A trade has been completed.',
    pending: 'A trade is waiting to process.',
    proposed: 'A trade has been proposed.',
    rejected: 'A trade was rejected.',
    cancelled: 'A trade was cancelled.',
    failed: 'A trade failed.',
  };

  const nameOf = (t, rosterId) => t.names?.[rosterId] || `Team ${rosterId}`;

  // What each team in the trade gets (a player dropped to make room shows as a drop).
  function sides(t) {
    const list = (t.rosterIds || []).map((rosterId) => ({ rosterId: Number(rosterId), name: nameOf(t, rosterId), assets: [] }));
    const side = (rosterId) => list.find((s) => s.rosterId === Number(rosterId));
    for (const [id, rosterId] of Object.entries(t.adds || {})) side(rosterId)?.assets.push({ type: 'player', id, add: true });
    for (const [id, rosterId] of Object.entries(t.drops || {})) {
      if (!(id in (t.adds || {}))) side(rosterId)?.assets.push({ type: 'player', id, add: false });
    }
    for (const pick of t.picks || []) {
      const [original, season, round, to] = pick.split(',');
      side(to)?.assets.push({ type: 'pick', season, round: Number(round), via: Number(original) === Number(to) ? null : nameOf(t, original) });
    }
    for (const budget of t.budget || []) {
      const [, to, amount] = budget.split(',');
      side(to)?.assets.push({ type: 'faab', amount });
    }
    return list;
  }

  // A team defense's id is its team, and its picture that team's logo.
  function playerLine(id, p = {}) {
    const defense = p.position === 'DEF';
    const first = p.first_name || '';
    const name = defense ? `${first} ${p.last_name || ''}`.trim() : `${first.slice(0, 1)}${first ? '. ' : ''}${p.last_name || ''}`.trim();
    const sport = encodeURIComponent(p.sport || 'nfl');
    return {
      name: name || `Player ${id}`,
      sub: [p.position, p.team].filter(Boolean).join(' - '),
      photo: defense
        ? `${CDN}/images/team_logos/${sport}/${encodeURIComponent(String(id).toLowerCase())}.png`
        : `${CDN}/content/${sport}/players/thumb/${encodeURIComponent(id)}.jpg`,
      position: String(p.position || '').toLowerCase(),
    };
  }

  const row = (face, cls, name, sub, sign, playerId) => `<div class="snp-tr-asset${playerId ? ' player' : ''}"${playerId ? ` data-player="${esc(playerId)}"` : ''}>
      <span class="snp-tr-face ${esc(cls)}">${face}${sign ? `<i class="snp-tr-sign ${sign === '+' ? 'add' : 'drop'}">${sign === '+' ? '+' : '&minus;'}</i>` : ''}</span>
      <span class="snp-tr-meta"><span class="snp-tr-name">${esc(name)}</span><span class="snp-tr-sub">${esc(sub)}</span></span>
    </div>`;

  function asset(t, a) {
    if (a.type === 'pick') {
      const round = ordinal(a.round);
      return row(`<b>${esc(round)}</b>`, 'token', `${a.season} ${round}`, a.via ? `via ${a.via}` : 'Draft pick', '+');
    }
    if (a.type === 'faab') return row(`<b>$${esc(a.amount)}</b>`, 'token', `$${a.amount}`, 'FAAB', '+');
    const p = playerLine(a.id, t.players?.[a.id]);
    return row(`<img class="snp-tr-shot" src="${esc(p.photo)}" alt="">`, p.position, p.name, p.sub, a.add ? '+' : '-', a.id);
  }

  function tradeHtml(t) {
    const teams = sides(t).map((s) => `<div class="snp-tr-side">
        <div class="snp-tr-team">@${esc(s.name)}</div>
        <div class="snp-tr-assets">${s.assets.map((a) => asset(t, a)).join('')}</div>
      </div>`).join('');
    return `<div class="snp-tr-title">${esc(t.title || TITLES[t.status] || 'A trade.')}</div><div class="snp-tr-body"${t.opens ? ' title="View this trade"' : ''}>${teams}</div>`;
  }

  return { sides, tradeHtml };
})();
