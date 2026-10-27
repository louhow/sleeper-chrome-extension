import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { nbaNavView } = loadSnp();

test("sidebar lines: your matchup in Sleeper's own NFL markup, names escaped, – before any points, the win bar under it", () => {
  const html = nbaNavView.render({ mine: { team: 'Moore\'s <Law>', points: null, proj: 180.72 }, theirs: { team: 'Cling Kong', points: 189, proj: 181.675 } });
  const [line, bar] = html.split(/(?=<div class="snp-win)/);
  assert.equal(line, '<div class="team-name-container"><div class="small-text">Moore&#39;s &lt;Law&gt;</div><div class="vs">vs.</div><div class="small-text right">Cling Kong</div></div>'
    + '<div class="score-container"><div class="left-score"><div class="roster-score-and-projection-matchup row"><div class="score">–</div><div class="projections">180.72</div></div></div>'
    + '<div class="win-bar-wrapper"></div><div class="right-score"><div class="roster-score-and-projection-matchup flip row"><div class="score">189.00</div><div class="projections">181.68</div></div></div></div>');
  // Nothing scored yet against 189 already in: behind, so red.
  assert.match(bar, /^<div class="snp-win down" title="\d+% to win"><span>\d+%<\/span><i><b style="width:\d+%"><\/b><\/i><\/div>$/);
});

test('win bar: green ahead, red behind, the percent over the bar', () => {
  assert.equal(nbaNavView.winBar(0.8), '<div class="snp-win up" title="80% to win"><span>80%</span><i><b style="width:80%"></b></i></div>');
  assert.match(nbaNavView.winBar(0.14), /class="snp-win down"[^>]*><span>14%<\/span><i><b style="width:14%">/);
  assert.match(nbaNavView.winBar(0.5), /snp-win up/, 'even counts as ahead');
});

test('chopped line: safe chance in the bar, rank where an opponent would be; a chopped team, its week', () => {
  assert.match(nbaNavView.chopBar({ rank: 2, of: 12, safe: 1, zone: 'safe' }), /^<div class="snp-win up" title="100% safe from the chop"><span>100% safe<\/span><i><b style="width:100%">/);
  assert.match(nbaNavView.chopBar({ rank: 11, of: 12, safe: 0.97, zone: 'danger' }), /snp-win warn".*97% safe/);
  assert.match(nbaNavView.chopBar({ rank: 12, of: 12, safe: 0.07, zone: 'chop' }), /snp-win down".*7% safe/);
  assert.equal(nbaNavView.chopRank({ rank: 2, of: 12, zone: 'safe' }), '<div class="snp-chop-rank safe">2nd / 12</div>');
  assert.equal(nbaNavView.chopBar({ out: 6 }), '<div class="snp-win down"><span>Chopped wk 6</span></div>');
  assert.equal(nbaNavView.chopRank({ out: 6 }), '');
});
