import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// content.js and page-hook.js need a browser to run, but they must at least compile.
test('every extension script compiles', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  for (const file of manifest.content_scripts.flatMap((c) => c.js)) {
    assert.doesNotThrow(() => new vm.Script(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), { filename: file }), file);
  }
});

// Chrome won't load an extension whose icons are missing; its description is capped at 132 characters.
test('the manifest\'s icons are square PNGs of their size, and its description fits', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.description.length <= 132, `${manifest.description.length} characters`);
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = readFileSync(new URL(`../../${file}`, import.meta.url));
    assert.equal(png.toString('ascii', 1, 4), 'PNG', file);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Number(size), Number(size)], file);
  }
});
