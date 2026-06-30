// Step 03 — turn the raw capture into the self-hosted, de-Framered static site.
// Reads raw/html/*.html + raw/manifest.json, transforms the captured HTML and the
// downloaded JS bundles in place, and writes the final page files to the repo root.
//
// Operations (in order):
//   HTML: strip Framer branding/analytics -> localize asset URLs -> rename core bundle
//         -> clean internal nav links -> rename framer-* identifiers
//   JS:   localize asset URLs -> re-point forms -> neutralize editor/iframe/icon CDNs
//         -> rename core bundle -> rename framer-* identifiers -> scrub dev strings
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ORIGIN, ROOT, RAW_HTML, DIR, SLUG, readJson, MANIFEST,
} from './lib.mjs';

const execFileP = promisify(execFile);

const manifest = await readJson(MANIFEST());

// The Framer core runtime bundle gets a neutral name; rename the file + every reference.
const CORE_OLD = 'framer.U7irxa_E.mjs';
const CORE_NEW = 'runtime-core.U7irxa_E.mjs';

// --- shared helpers -----------------------------------------------------------------
// NB: the character class excludes ${ } as well as quotes/backtick so a URL embedded in a
// JS template literal (e.g. `.../contact/${x?`a`:`b`}`) is not over-consumed past its `${`.
const ASSET_URL_RE =
  /https:\/\/(?:framerusercontent\.com|fonts\.gstatic\.com)\/[^\s"'`)<>\\${}]+/g;

function localizeAssets(text) {
  return text.replace(ASSET_URL_RE, (m) => {
    const decoded = m.replace(/&amp;/g, '&');
    const local = manifest[decoded] ?? manifest[m];
    return local ?? m; // leave unknown (reported later)
  });
}

// Rename every genuine Framer identifier to the neutral brand slug. CASE-SENSITIVE on
// purpose: lowercase `framer` covers framer-* classes, --framer-* props, data-framer-*
// attrs, framerAppearId, framerSiteId, framer/appear script types, __framer globals, etc.
// Capital `Framer` covers FramerMetadata & friends. It deliberately does NOT touch
// `frameResolver` / `FrameRate` (capital R) — those are unrelated motion-lib internals
// the spec allows to remain.
const SLUG_CAP = SLUG.charAt(0).toUpperCase() + SLUG.slice(1);
function renameIdentifiers(text) {
  return text.replace(/framer/g, SLUG).replace(/Framer/g, SLUG_CAP);
}

function renameCoreBundle(text) {
  return text.split(CORE_OLD).join(CORE_NEW);
}

// --- HTML transform -----------------------------------------------------------------
const STRIP_HTML = [
  /<!--\s*Made in Framer[\s\S]*?-->/g,                                   // branding comment
  /<meta[^>]*name="generator"[^>]*content="Framer[^"]*"[^>]*>/gi,        // generator meta
  /<meta[^>]*name="framer-search-index(?:-fallback)?"[^>]*>/gi,          // search index
  /<meta[^>]*name="framer-html-plugin"[^>]*>/gi,                         // html plugin flag
  /<script[^>]*src="https:\/\/events\.framer\.com[^"]*"[^>]*>\s*<\/script>/gi, // analytics beacon
  /<script[^>]*src="https:\/\/secure\.isobexlasers\.co\.uk\/js\/external-tracking\.js"[^>]*>\s*<\/script>/gi, // GHL tracking
  /<script>[^<]*__framer_force_showing_editorbar[\s\S]*?<\/script>/gi,   // editor-bar bootstrap
  // Any <link> still pointing at a Google/Framer font or CDN domain after localization is a
  // resource hint (preconnect/dns-prefetch). Fonts are self-hosted, and a live preconnect
  // would still open a runtime connection to those domains — strip them.
  /<link[^>]*(?:fonts\.gstatic\.com|framerusercontent\.com|framer\.com)[^>]*>/gi,
];

function navLocal(href) {
  let h = href.trim();
  if (h === '.' || h === './' || h === ORIGIN || h === `${ORIGIN}/`) return '/';
  if (h.startsWith('./')) h = '/' + h.slice(2);
  else if (h.startsWith(ORIGIN)) h = h.slice(ORIGIN.length) || '/';
  else return href; // external / mailto / tel / wa.me / # / already-absolute-local
  // split off ?query / #hash, trim trailing slash on the path part
  const mm = h.match(/^([^?#]*)([?#].*)?$/);
  let p = mm[1].replace(/\/+$/, '') || '/';
  return p + (mm[2] || '');
}

function fixNavLinks(html) {
  return html.replace(/<a\b[^>]*?>/gi, (tag) =>
    tag.replace(/href="([^"]*)"/i, (m, href) => `href="${navLocal(href)}"`)
  );
}

async function transformHtml() {
  const files = (await fs.readdir(RAW_HTML)).filter((f) => f.endsWith('.html'));
  for (const f of files) {
    let html = await fs.readFile(path.join(RAW_HTML, f), 'utf8');
    for (const re of STRIP_HTML) html = html.replace(re, '');
    html = localizeAssets(html);
    html = renameCoreBundle(html);
    html = fixNavLinks(html);
    html = renameIdentifiers(html);
    // f is already <slug>.html / index.html — write under the same name at the web root
    await fs.writeFile(path.join(ROOT, f), html);
  }
  console.log(`HTML: transformed ${files.length} pages -> repo root`);
}

// --- JS transform -------------------------------------------------------------------
function transformJsText(text) {
  text = localizeAssets(text);
  // Re-point native Framer forms to a same-origin endpoint (host routes to your backend).
  text = text.replace(
    /https:\/\/api\.framer\.com\/forms\/v1\/forms\/([0-9a-f-]+)\/submit/gi,
    '/api/forms/$1/submit'
  );
  // Neutralize Framer-hosted helpers that would phone home (site uses none of these paths).
  text = text.replace(/https:\/\/api\.framer\.com\/functions\/check-iframe-url/gi, '/_disabled/check-iframe-url');
  text = text.replace(/https:\/\/framer\.com\/edit\/init\.mjs/gi, '/_disabled/edit-init.mjs');
  text = text.replace(/https:\/\/framer\.com\/m\/feather-icons\//gi, '/_assets/js/icons/feather-icons/');
  text = text.replace(/https:\/\/framer\.com\/m\/hero-icons\//gi, '/_assets/js/icons/hero-icons/');
  // Normalize dynamic icon imports `<name>.js@<semver>` -> `<name>.mjs` (self-hosted locally;
  // the `.js@x.y.z` extension would otherwise get a wrong MIME on static hosts).
  text = text.replace(/\.js@\d+\.\d+\.\d+/g, '.mjs');
  // Neutralize any remaining framer.com / frameruni.link URLs in dev-warning strings,
  // BEFORE the identifier rename (so they don't get mangled into isobex.com).
  // Char class excludes ${ } / quotes / backtick so URLs embedded in template literals are
  // not over-consumed past their interpolation boundary (would corrupt the JS).
  const URLTAIL = "[^\\s\"'`)${}]*";
  text = text.replace(new RegExp(`https?://(?:www\\.)?framer\\.com${URLTAIL}`, 'gi'), 'about:blank');
  text = text.replace(new RegExp(`https?://frameruni\\.link${URLTAIL}`, 'gi'), 'about:blank');
  // Dormant Google-Fonts base used only in startsWith() detection (our fonts are local, so
  // this branch never runs) — neutralize so no gstatic reference survives in the code.
  text = text.replace(new RegExp(`https?://fonts\\.gstatic\\.com${URLTAIL}`, 'gi'), 'about:blank');
  text = renameCoreBundle(text);
  text = renameIdentifiers(text);
  return text;
}

// Recursively list every .mjs under _assets/js (incl. icons/ and any module subdirs).
async function listMjs(dir) {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await listMjs(p));
    else if (ent.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

async function transformJs() {
  const files = await listMjs(DIR.js);
  for (const p of files) {
    const out = transformJsText(await fs.readFile(p, 'utf8'));
    await fs.writeFile(p, out);
  }
  // physically rename the core runtime bundle
  const oldP = path.join(DIR.js, CORE_OLD);
  try {
    await fs.rename(oldP, path.join(DIR.js, CORE_NEW));
  } catch { /* already renamed on a re-run */ }
  console.log(`JS: transformed ${files.length} bundles, renamed core bundle -> ${CORE_NEW}`);
}

await transformHtml();
await transformJs();

// --- residual report ----------------------------------------------------------------
const residual = {};
for (const dir of [ROOT, DIR.js]) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.html') || f.endsWith('.mjs'));
  for (const f of files) {
    const t = await fs.readFile(path.join(dir, f), 'utf8');
    const hits = t.match(/framer/gi);
    if (hits) residual[f] = (residual[f] || 0) + hits.length;
  }
}
console.log('Residual "framer" occurrences by file:', Object.keys(residual).length ? residual : 'NONE');

// --- JS syntax validation (catches any over-greedy rewrite that corrupts a bundle) ------
const jsFiles = await listMjs(DIR.js);
const syntaxErrors = [];
await Promise.all(jsFiles.map(async (p) => {
  try {
    await execFileP(process.execPath, ['--check', p]);
  } catch (e) {
    syntaxErrors.push(`${path.basename(p)}: ${String(e.stderr || e.message).split('\n').find((l) => /SyntaxError|Error:/.test(l)) || 'parse error'}`);
  }
}));
if (syntaxErrors.length) {
  console.error(`\n✗ JS SYNTAX ERRORS in ${syntaxErrors.length} bundle(s):\n  ${syntaxErrors.join('\n  ')}`);
  process.exit(1);
}
console.log(`JS syntax check: all ${jsFiles.length} bundles parse cleanly ✓`);
