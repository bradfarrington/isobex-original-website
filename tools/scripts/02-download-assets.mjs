// Step 02 — crawl & download the full asset graph referenced by the captured HTML:
//   * the React + Framer-motion ES module graph (.mjs, crawled transitively)
//   * fonts (framerusercontent /assets/*.woff2 + fonts.gstatic.com)
//   * images (framerusercontent /images/* — every responsive variant URL)
//   * videos (.mp4 etc.)
// Produces _assets/** on disk and raw/manifest.json mapping every remote URL -> local web path.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  FRAMER_SITE_BASE, RAW_HTML, DIR, URLROOT, ensureDirs, fetchBuf, fetchText,
  pool, sha8, writeJson, MANIFEST,
} from './lib.mjs';

await ensureDirs();

const htmlFiles = (await fs.readdir(RAW_HTML)).filter((f) => f.endsWith('.html'));
const htmls = {};
for (const f of htmlFiles) htmls[f] = await fs.readFile(path.join(RAW_HTML, f), 'utf8');

const dec = (u) => u.replace(/&amp;/g, '&');
const ASSET_RE = /https:\/\/(?:framerusercontent\.com|fonts\.gstatic\.com)\/[^"'`)\s\\<>]+/g;

// ---- collect every remote URL referenced in the HTML --------------------------------
const allUrls = new Set();
for (const html of Object.values(htmls)) {
  for (const m of html.matchAll(ASSET_RE)) allUrls.add(dec(m[0]));
}

// ---- classify ----------------------------------------------------------------------
const isMjs = (u) => /\.mjs(\?|$)/.test(u);
const extOf = (u) => {
  const p = new URL(u).pathname;
  const e = path.extname(p).toLowerCase().replace('.', '');
  return e;
};
const FONT = new Set(['woff2', 'woff', 'ttf', 'otf']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v']);
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'svg', 'gif', 'webp', 'avif', 'ico']);

// ---- crawl the JS module graph -----------------------------------------------------
const jsSeen = new Map(); // absUrl -> { file, text }
const jsQueue = [...allUrls].filter(isMjs);
const IMPORT_RE = /(?:import|export)[^'"]*?["']([^"']+\.mjs)["']|import\(\s*["']([^"']+\.mjs)["']\s*\)/g;

async function crawlJs(url) {
  if (jsSeen.has(url)) return;
  jsSeen.set(url, null); // reserve
  let text;
  try {
    text = await fetchText(url);
  } catch (e) {
    console.warn(`  ! js fetch failed ${url}: ${e.message}`);
    jsSeen.delete(url);
    return;
  }
  const base = path.basename(new URL(url).pathname);
  jsSeen.set(url, { file: base, text });
  // discover nested .mjs imports (relative ./x.mjs or absolute) + any asset urls
  const found = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    const abs = new URL(spec, url).href; // relative imports resolve under the sites/<id>/ dir
    found.push(abs);
  }
  for (const m of text.matchAll(ASSET_RE)) {
    const u = dec(m[0]);
    if (isMjs(u)) found.push(u);
    else allUrls.add(u); // fonts/images referenced from inside bundles
  }
  for (const u of found) if (isMjs(u) && !jsSeen.has(u)) await crawlJs(u);
}

console.log(`Crawling JS module graph from ${jsQueue.length} entry modules...`);
for (const u of jsQueue) await crawlJs(u);
const jsModules = [...jsSeen.entries()].filter(([, v]) => v);
console.log(`  resolved ${jsModules.length} JS modules`);

// write JS modules to disk (flat, original basenames -> relative imports keep resolving)
const manifest = {}; // remote url -> local web path
for (const [url, { file, text }] of jsModules) {
  await fs.writeFile(path.join(DIR.js, file), text);
  manifest[url] = `${URLROOT.js}/${file}`;
}

// ---- download fonts / images / videos ----------------------------------------------
function localFor(url) {
  const e = extOf(url);
  const baseName = path.basename(new URL(url).pathname) || `asset-${sha8(url)}`;
  const stem = baseName.replace(/\.[^.]+$/, '');
  const hasQuery = !!new URL(url).search;
  if (FONT.has(e)) return { dir: DIR.fonts, root: URLROOT.fonts, name: baseName };
  if (VIDEO.has(e)) return { dir: DIR.video, root: URLROOT.video, name: hasQuery ? `${stem}__${sha8(url)}.${e}` : baseName };
  if (IMAGE.has(e)) return { dir: DIR.images, root: URLROOT.images, name: hasQuery ? `${stem}__${sha8(url)}.${e}` : baseName };
  // unknown -> media root, keep ext if any
  return { dir: DIR.media, root: '/_assets/media', name: hasQuery ? `${stem}__${sha8(url)}.${e || 'bin'}` : baseName };
}

const KNOWN = new Set([...FONT, ...VIDEO, ...IMAGE]);
const skipped = [];
const binUrls = [...allUrls].filter((u) => {
  if (isMjs(u)) return false;
  if (!KNOWN.has(extOf(u))) { skipped.push(u); return false; } // base-url fragments etc.
  return true;
});
if (skipped.length) console.log(`  (skipped ${skipped.length} non-asset url fragments, e.g. ${skipped[0]})`);
console.log(`Downloading ${binUrls.length} binary assets (fonts/images/videos)...`);
let n = 0;
const failed = [];
await pool(binUrls, 12, async (url) => {
  const { dir, root, name } = localFor(url);
  const out = path.join(dir, name);
  manifest[url] = `${root}/${name}`;
  try {
    await fs.access(out); // skip if already downloaded (idempotent re-runs)
  } catch {
    try {
      const { buf } = await fetchBuf(url);
      await fs.writeFile(out, buf);
    } catch (e) {
      failed.push(url);
      delete manifest[url];
      console.warn(`  ! asset failed ${url}: ${e.message}`);
    }
  }
  if (++n % 50 === 0) console.log(`  ${n}/${binUrls.length}`);
});
if (failed.length) console.warn(`  ${failed.length} assets failed to download`);

await writeJson(MANIFEST(), manifest);

// quick category tally
const tally = {};
for (const local of Object.values(manifest)) {
  const k = local.split('/')[2] === 'js' ? 'js' : local.split('/').slice(2, 4).join('/');
  tally[k] = (tally[k] || 0) + 1;
}
console.log('Manifest entries by category:', tally);
console.log(`Total mapped URLs: ${Object.keys(manifest).length}`);
console.log(`Wrote raw/manifest.json`);
