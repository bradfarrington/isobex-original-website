// Shared config + helpers for the Isobex de-Framer build pipeline.
// Node 18+ (uses global fetch). Run via the numbered scripts in this dir.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ORIGIN = 'https://isobexlasers.co.uk';
export const SITE_ID = '45msus6jAloyfNWAbvqkdp';
export const FRAMER_SITE_BASE = `https://framerusercontent.com/sites/${SITE_ID}`;

// Neutral brand prefix that replaces every `framer-` / `data-framer-` / `--framer-`
// identifier across HTML + JS + CSS. Derived from the company name.
export const SLUG = 'isobex';

// Repo root = web root (two levels up from tools/scripts/)
export const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
export const RAW = path.join(ROOT, 'raw');
export const RAW_HTML = path.join(RAW, 'html');
export const ASSETS = path.join(ROOT, '_assets');
export const DIR = {
  js: path.join(ASSETS, 'js'),
  fonts: path.join(ASSETS, 'fonts'),
  images: path.join(ASSETS, 'media', 'images'),
  video: path.join(ASSETS, 'media', 'video'),
  media: path.join(ASSETS, 'media'),
};

// Local URL roots (what the rewritten files point at)
export const URLROOT = {
  js: '/_assets/js',
  fonts: '/_assets/fonts',
  images: '/_assets/media/images',
  video: '/_assets/media/video',
};

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// sitemap slug -> output html filename at web root.
// '' (home) -> index.html ; everything else -> <slug>.html (clean URLs via host/server).
export function slugToFile(slug) {
  return slug === '' ? 'index.html' : `${slug}.html`;
}

export async function ensureDirs() {
  for (const d of [RAW_HTML, ...Object.values(DIR)]) await fs.mkdir(d, { recursive: true });
}

export function sha8(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
}

export async function fetchBuf(url, { tries = 4, allowStatus = [] } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' });
      if (!res.ok && !allowStatus.includes(res.status)) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, contentType: res.headers.get('content-type') || '' };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw new Error(`fetch failed ${url}: ${lastErr?.message}`);
}

export async function fetchText(url, opts) {
  const { buf } = await fetchBuf(url, opts);
  return buf.toString('utf8');
}

// Run async tasks with bounded concurrency.
export async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return out;
}

export async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
}
export async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

// The asset manifest path (URL -> local path map produced by the download step).
export const MANIFEST = () => path.join(RAW, 'manifest.json');
