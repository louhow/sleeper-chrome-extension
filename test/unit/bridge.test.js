import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');

// The code between the "bridge.js copy" markers, each line's indent dropped.
function copy(file) {
  const text = source(file);
  const from = text.indexOf('// bridge.js copy: start');
  const to = text.indexOf('// bridge.js copy: end');
  assert.ok(from >= 0 && to > from, `${file} has the bridge.js copy markers`);
  return text.slice(from, to).split('\n').map((line) => line.trim()).join('\n');
}

// Chrome injects a file once per frame, so page-hook.js can't share bridge.js and keeps a copy.
test("page-hook.js's bridge is the same code as bridge.js", () => {
  assert.equal(copy('page-hook.js'), copy('bridge.js'));
});

// Both worlds' bridges on one document, as in the page.
function twoSides() {
  const document = new EventTarget();
  const errors = [];
  const load = () => {
    const context = vm.createContext({ document, CustomEvent, console: { error: (...x) => errors.push(x) } });
    vm.runInContext(source('bridge.js'), context);
    return context.SNP.bridge;
  };
  return { content: load(), page: load(), document, errors };
}

test('ask gets the answer back there and then, null when nobody answers', () => {
  const { content, page } = twoSides();
  assert.equal(content.ask('snp:x', { a: 1 }), null);
  const off = page.answer('snp:x', ({ a }) => ({ b: a + 1 }));
  assert.deepEqual({ ...content.ask('snp:x', { a: 1 }) }, { b: 2 });
  off();
  assert.equal(content.ask('snp:x', { a: 1 }), null);
});

test('concurrent calls each get their own answer', async () => {
  const { content, page } = twoSides();
  page.answerLater('snp:save', async ({ n }) => {
    await new Promise((resolve) => setTimeout(resolve, n === 1 ? 20 : 0));
    return { ok: n };
  });
  const [one, two] = await Promise.all([content.call('snp:save', { n: 1 }), content.call('snp:save', { n: 2 })]);
  assert.equal(one.ok, 1);
  assert.equal(two.ok, 2);
});

test('a message that is not JSON is logged and dropped', () => {
  const { page, document, errors } = twoSides();
  const seen = [];
  page.on('snp:x', (x) => seen.push(x));
  document.dispatchEvent(new CustomEvent('snp:x', { detail: '{' }));
  assert.deepEqual(seen, []);
  assert.equal(errors.length, 1);
});
