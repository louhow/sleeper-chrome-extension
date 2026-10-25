// Loads the extension's content scripts into a fresh VM context, in manifest order.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));

function run(context, files) {
  for (const file of files) {
    if (file.endsWith('content.js')) continue;
    vm.runInContext(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), context, { filename: file });
  }
}

export function loadSnp() {
  const context = vm.createContext({});
  run(context, manifest.content_scripts[0].js);
  return context.SNP;
}

// The Premier League entry, loaded after the first entry as in the browser, since it reads off SNP.
export function loadSep() {
  const context = vm.createContext({});
  run(context, manifest.content_scripts[0].js);
  run(context, manifest.content_scripts.find((c) => c.js.some((f) => f.startsWith('src/epl/'))).js);
  return { SEP: context.SEP, SNP: context.SNP };
}
