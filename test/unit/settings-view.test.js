import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

const { settingsView } = loadSnp();

test('settings dialog: a switch per setting, as saved, with account settings a click away', () => {
  const on = settingsView.render({ nflUi: true });
  assert.match(on, /<input type="checkbox" data-setting="nflUi" checked>/);
  assert.match(on, /NFL tabs and tools/);
  assert.match(on, /data-action="account">Sleeper account settings</);
  assert.match(on, /data-action="close-modal"/);
  assert.doesNotMatch(settingsView.render({ nflUi: false }), /data-setting="nflUi" checked/);
});
