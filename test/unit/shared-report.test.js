import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSnp } from './load.js';

test('shared.report: a dropped connection goes to debug, anything else keeps its level', () => {
  const calls = [];
  const fake = (level) => (...args) => calls.push([level, ...args.slice(0, 1)]);
  const { shared } = loadSnp({ console: { debug: fake('debug'), warn: fake('warn'), error: fake('error'), log() {} } });
  // The VM's own TypeError, as a fetch in the page would throw it.
  shared.report('warn', 'a', new (Object.getPrototypeOf(shared.report).constructor('return TypeError')())('Failed to fetch'));
  shared.report('warn', 'b', new Error('boom'));
  shared.report('error', 'c', new TypeError('x is undefined'));
  assert.deepEqual(calls, [['debug', 'a'], ['warn', 'b'], ['error', 'c']]);
});
