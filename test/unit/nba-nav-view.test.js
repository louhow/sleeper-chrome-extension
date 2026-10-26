import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { nbaNavView } = loadSnp();

test("sidebar lines: your matchup in Sleeper's own NFL markup, names escaped, – before any points", () => {
  const html = nbaNavView.render({ mine: { team: 'Moore\'s <Law>', points: null, proj: 180.72 }, theirs: { team: 'Cling Kong', points: 189, proj: 181.675 } });
  assert.equal(html, '<div class="team-name-container"><div class="small-text">Moore&#39;s &lt;Law&gt;</div><div class="vs">vs.</div><div class="small-text right">Cling Kong</div></div>'
    + '<div class="score-container"><div class="left-score"><div class="roster-score-and-projection-matchup row"><div class="score">–</div><div class="projections">180.72</div></div></div>'
    + '<div class="win-bar-wrapper"></div><div class="right-score"><div class="roster-score-and-projection-matchup flip row"><div class="score">189.00</div><div class="projections">181.68</div></div></div></div>');
});
