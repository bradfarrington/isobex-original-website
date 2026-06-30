// Step 04 — live verification. Boots the static site, loads every page in headless
// Chrome (executing the React/motion bundles), captures the full network log, and asserts:
//   1. ZERO runtime requests to any Framer / Google-fonts domain
//   2. No broken local assets (404s) — catches e.g. dynamic icon imports
// Allowed off-site hosts (explicitly kept): Google Analytics, WhatsApp, DigiCraft.
import { promises as fs } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ROOT, RAW, readJson } from './lib.mjs';

const PORT = 8137;
const BASE = `http://localhost:${PORT}`;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FORBIDDEN = [
  'framer.com', 'framerusercontent.com', 'framerstatic.com', 'app.framerstatic.com',
  'events.framer.com', 'api.framer.com', 'frameruni.link',
  'fonts.gstatic.com', 'fonts.googleapis.com',
  'secure.isobexlasers.co.uk', // the removed GoHighLevel tracking host
];
// Off-site hosts that are EXPECTED & intentionally kept (owner's own / third-party embeds,
// none of them Framer). Surfaced for transparency, not flagged.
const ALLOWED_OFFSITE = [
  'googletagmanager.com', 'google-analytics.com', 'analytics.google.com', // GA4 (kept)
  'supabase.co',                                                          // owner's custom pageview analytics (kept)
  'timefinance.com', 'maxcdn.bootstrapcdn.com', 'ajax.googleapis.com',    // Time Finance calculator iframe (/finance)
  'wa.me', 'thedigicraft.co.uk',                                          // WhatsApp + agency link (kept)
];
// Chrome's own background services — never page-initiated; ignored entirely.
const CHROME_INTERNAL = [
  'clients2.google.com', 'accounts.google.com', 'www.google.com', 'google.com',
  'safebrowsingohttpgateway.googleapis.com', 'csp.withgoogle.com',
  'content-autofill.googleapis.com', 'clientservices.googleapis.com',
  'optimizationguide-pa.googleapis.com', 'update.googleapis.com', 'redirector.gvt1.com',
];

const pages = (await readJson(path.join(RAW, 'pages.json'))).map((p) => (p.slug === '' ? '/' : `/${p.slug}`));

// boot server with access logging
const accessLog = path.join(os.tmpdir(), 'isobex-access.log');
await fs.writeFile(accessLog, '');
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
  env: { ...process.env, ACCESS_LOG: accessLog }, stdio: 'ignore',
});
await waitFor(BASE + '/', 5000);

const violations = [];
const unexpected = [];
const broken = new Set();

for (const route of pages) {
  const netlog = path.join(os.tmpdir(), `netlog-${route.replace(/\W/g, '_') || 'home'}.json`);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'chrome-iso-'));
  spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio',
    // Silence Chrome's own background networking so the net-log reflects ONLY page traffic.
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--disable-domain-reliability', '--no-pings', '--metrics-recording-only',
    '--disable-client-side-phishing-detection', '--safebrowsing-disable-auto-update',
    '--disable-default-apps', '--disable-breakpad', '--no-default-browser-check',
    '--disable-features=OptimizationHints,Translate,MediaRouter,InterestFeedContentSuggestions,AutofillServerCommunication,CalculateNativeWinOcclusion,OptimizationGuideModelDownloading,PreconnectToSearch',
    `--user-data-dir=${profile}`, `--log-net-log=${netlog}`,
    BASE + route,
    // A working (animating) app never goes network-idle, so we give it a fixed real-time
    // window to load + fire all requests (incl. dynamic imports), then SIGTERM. The net-log
    // is flushed incrementally, so it's complete by the time we stop the browser.
  ], { timeout: 9000, killSignal: 'SIGTERM', stdio: 'ignore' });

  // Only count ACTUAL request URLs (event params), not Chrome's compiled-in constant
  // domain lists (HSTS/NTP defaults) which would otherwise yield false positives.
  let hosts = new Set();
  try {
    const txt = await fs.readFile(netlog, 'utf8');
    for (const m of txt.matchAll(/"(?:url|original_url)":"https?:\/\/([a-z0-9.-]+)(?::\d+)?[/"]/gi)) {
      hosts.add(m[1].toLowerCase());
    }
  } catch { /* netlog may be absent if chrome failed */ }

  const matches = (list, h) => list.some((a) => h === a || h.endsWith('.' + a));
  const bad = [...hosts].filter((h) => matches(FORBIDDEN, h));
  const kept = [...hosts].filter((h) => matches(ALLOWED_OFFSITE, h));
  const review = [...hosts].filter((h) => h !== 'localhost' && !h.startsWith('127.') &&
    !matches(FORBIDDEN, h) && !matches(ALLOWED_OFFSITE, h) && !matches(CHROME_INTERNAL, h));
  if (bad.length) violations.push({ route, hosts: bad });
  if (review.length) unexpected.push({ route, hosts: review });
  console.log(`  ${route.padEnd(40)} forbidden=${bad.length ? bad.join(',') : 'none'}` +
    `  kept=[${kept.join(',') || '-'}]` + (review.length ? `  REVIEW=${review.join(',')}` : ''));
}

srv.kill();

// parse access log for 404s (broken local assets)
const log = await fs.readFile(accessLog, 'utf8');
for (const line of log.split('\n')) {
  const m = /^(\S+)\s+(\S+)\s+(\d+)$/.exec(line);
  if (m && m[3] === '404' && !m[2].endsWith('/favicon.ico')) broken.add(m[2]);
}

console.log('\n================ VERIFICATION SUMMARY ================');
console.log(`Pages checked: ${pages.length}`);
console.log(`Framer / Google-font domain violations: ${violations.length ? JSON.stringify(violations, null, 2) : 'NONE ✓'}`);
console.log(`Unexpected off-site hosts (not in kept list): ${unexpected.length ? JSON.stringify(unexpected, null, 2) : 'NONE ✓'}`);
console.log(`Broken local assets (404): ${broken.size ? [...broken].join('\n  ') : 'NONE ✓'}`);
process.exit(violations.length || broken.size ? 1 : 0);

function waitFor(url, timeout) {
  const end = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const tick = () => http.get(url, (r) => { r.destroy(); resolve(); })
      .on('error', () => (Date.now() > end ? reject(new Error('server timeout')) : setTimeout(tick, 150)));
    tick();
  });
}
