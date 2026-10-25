// Turns a Sleeper soccer stat line (projected or actual) into fantasy points.
// Soccer scoring settings are keyed by position and stat (pos_m_g = goals by
// a midfielder), and Sleeper's stat rows carry the same keys, so a line's
// points are the weighted sum of the keys the league scores.
(globalThis.SEP ||= {}).scoring = (() => {
  function scoreStats(settings, stats) {
    let total = 0;
    for (const [key, weight] of Object.entries(settings || {})) {
      if (!weight) continue;
      const value = stats?.[key];
      if (value != null) total += weight * value;
    }
    return total;
  }

  // Stat names, as Sleeper abbreviates them in its soccer stat lines.
  const STAT_LABELS = {
    min: 'Minutes', gp: 'Games', gs: 'Starts', g: 'Goals', at: 'Assists', g_at: 'Goals + Assists', first_g: 'First Goal',
    sot: 'Shots on Target', sat: 'Shots', kp: 'Key Passes', sm: 'Dribbles', dis: 'Dispossessed', cos: 'Corners',
    acnc: 'Accurate Crosses', tkw: 'Tackles Won', tk: 'Tackles', int: 'Interceptions', clr: 'Clearances',
    bs: 'Blocked Shots', aer: 'Aerials Won', fl: 'Fouls', cs: 'Clean Sheet', hcs: 'Half Clean Sheet',
    ga: 'Goals Against', sv: 'Saves', pks: 'Penalty Saves', pkm: 'Penalties Missed', pkd: 'Penalties Won',
    og: 'Own Goals', yc: 'Yellow Card', yc2: 'Second Yellow', rc: 'Red Card', xg: 'xG', xa: 'xA',
    p_att: 'Passes', poss: 'Possession', tc: 'Touches', cnr: 'Corners Taken',
  };
  const SETTING_KEY = /^pos_(gk|f|m|d)_(.+)$/;

  // The scored parts of one stat line, biggest first: [{ stat, label, value, points }].
  function breakdown(settings, stats) {
    const out = [];
    for (const [key, weight] of Object.entries(settings || {})) {
      const value = stats?.[key];
      if (!weight || !value) continue;
      const stat = key.replace(SETTING_KEY, '$2');
      out.push({ stat, label: STAT_LABELS[stat] || stat, value, points: weight * value });
    }
    return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  }

  return { scoreStats, STAT_LABELS, breakdown };
})();
