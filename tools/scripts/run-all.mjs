// Runs the full rebuild pipeline end-to-end: fetch -> download -> transform.
// Re-run any time the live (Framer) site changes — before you cancel the subscription.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const steps = ['01-fetch-html.mjs', '02-download-assets.mjs', '02b-download-icons.mjs', '03-transform.mjs'];

for (const step of steps) {
  console.log(`\n=== ${step} ===`);
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(here, step)], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${step} exited ${code}`))));
  });
}
console.log('\nPipeline complete.');
