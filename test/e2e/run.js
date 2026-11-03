// Runs panel.test.js in parallel shards, one browser each, and prints their results one after another.
// E2E_SHARDS sets how many (default 6).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = `${ROOT}/test-results`;
const N = Number(process.env.E2E_SHARDS) || 6;
mkdirSync(OUT, { recursive: true });

const run = (i) => new Promise((resolve) => {
  const child = spawn(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=tap', `--test-reporter-destination=${OUT}/e2e-${i}.tap`, 'test/e2e/panel.test.js'],
  { cwd: ROOT, env: { ...process.env, E2E_SHARD: `${i}/${N}` } });
  let text = '';
  child.stdout.on('data', (d) => { text += d; });
  child.stderr.on('data', (d) => { text += d; });
  child.on('close', (code) => resolve({ i, code, text }));
});

const started = Date.now();
const results = await Promise.all(Array.from({ length: N }, (_, i) => run(i)));
for (const r of results) process.stdout.write(`\n=== shard ${r.i + 1}/${N} (exit ${r.code}) ===\n${r.text}`);
// One tap file for the whole run, as before.
writeFileSync(`${OUT}/e2e.tap`, results.map((r) => readFileSync(`${OUT}/e2e-${r.i}.tap`, 'utf8')).join('\n'));
const failed = results.filter((r) => r.code !== 0);
console.log(`\n${N} shards in ${((Date.now() - started) / 1000).toFixed(0)}s: ${failed.length ? `shards ${failed.map((r) => r.i + 1).join(', ')} failed` : 'all passed'}`);
process.exit(failed.length ? 1 : 0);
