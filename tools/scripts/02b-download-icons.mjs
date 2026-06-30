// Step 02b — self-host the icon modules the app loads *dynamically* at runtime.
// Framer's icon components (Feather / Hero) lazy-import individual icons from
// framer.com/m/<pack>/<name>.js@<ver>, which re-export the real module from
// framerusercontent.com/modules/…. We host them locally as clean `.mjs` files so there's
// no runtime Framer request and no fragile `.js@version` extension.
//
// ICONS lists the icons actually imported by the live site (discovered via 04-verify's
// broken-asset capture). If a future page uses more icons, add them here and re-run.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DIR, fetchText, ensureDirs } from './lib.mjs';

const ICONS = [
  { pack: 'feather-icons', name: 'minus', version: '0.0.29' },
  { pack: 'feather-icons', name: 'plus', version: '0.0.29' },
];

await ensureDirs();

for (const { pack, name, version } of ICONS) {
  const outDir = path.join(DIR.js, 'icons', pack);
  await fs.mkdir(outDir, { recursive: true });

  // 1) fetch the shim (re-export wrapper)
  const shim = await fetchText(`https://framer.com/m/${pack}/${name}.js@${version}`);
  const realUrl = (shim.match(/https:\/\/framerusercontent\.com\/modules\/[^"']+\.js/) || [])[0];
  if (!realUrl) { console.warn(`  ! no real module url in shim for ${pack}/${name}`); continue; }

  // 2) fetch the real (self-contained) module and host it directly as <name>.mjs
  const real = await fetchText(realUrl);
  if (/from\s*["']https?:|import\s*\(?\s*["']https?:/.test(real)) {
    console.warn(`  ! ${pack}/${name} real module has external imports — review needed`);
  }
  await fs.writeFile(path.join(outDir, `${name}.mjs`), real);
  console.log(`  icon ${pack}/${name}.mjs  (${real.length} bytes)`);
}

console.log('Icons self-hosted under _assets/js/icons/.');
