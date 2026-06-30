// Step 01 — discover URLs from sitemap.xml and fetch each page's rendered (SSR) HTML
// into raw/html/<slug>.html. raw/ is git-ignored and is the intermediate capture.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ORIGIN, RAW, RAW_HTML, ensureDirs, fetchText, pool, writeJson } from './lib.mjs';

const sitemap = await fetchText(`${ORIGIN}/sitemap.xml`);
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

await ensureDirs();

const pages = locs.map((loc) => {
  const u = new URL(loc);
  let slug = u.pathname.replace(/^\/+|\/+$/g, ''); // strip leading/trailing slashes
  return { url: loc, slug, file: slug === '' ? 'index' : slug };
});

console.log(`Sitemap: ${pages.length} URLs`);

await pool(pages, 6, async (p) => {
  // The /404 page intentionally responds with HTTP 404; capture its body anyway.
  const html = await fetchText(p.url, { allowStatus: [404] });
  await fs.writeFile(path.join(RAW_HTML, `${p.file}.html`), html);
  console.log(`  fetched ${p.url}  (${html.length} bytes)`);
});

await writeJson(path.join(RAW, 'pages.json'), pages);
console.log(`Wrote raw/html/*.html and raw/pages.json`);
