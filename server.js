#!/usr/bin/env node
// Zero-dependency static dev server that mirrors the production hosting contract:
//   * clean URLs            ->  /about           serves about.html
//   * no trailing slash     ->  /about/          301-redirects to /about
//   * HTTP range requests   ->  video (and any file) supports `Range:` for seeking
//   * long-cache assets      ->  /_assets/* sent with immutable cache headers
//   * custom 404             ->  unknown path serves 404.html with status 404
// Run: `npm start` (or `node server.js [port]`). Matches vercel.json behavior.
import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import fssync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

const exists = (p) => fs.access(p).then(() => true).catch(() => false);
const isFile = async (p) => { try { return (await fs.stat(p)).isFile(); } catch { return false; } };

// Resolve a request pathname to a file on disk following the clean-URL contract.
// Returns { file } or { redirect } or null.
async function resolvePath(pathname) {
  // strip trailing slash (except root) -> redirect signal
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return { redirect: pathname.replace(/\/+$/, '') };
  }
  if (pathname === '/') return { file: path.join(ROOT, 'index.html') };

  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  const abs = path.join(ROOT, rel);
  // security: keep inside ROOT
  if (!abs.startsWith(ROOT)) return null;

  if (await isFile(abs)) return { file: abs };               // real file (assets, .html, etc.)
  if (await isFile(`${abs}.html`)) return { file: `${abs}.html` }; // clean URL -> <name>.html
  return null;
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  if (body) res.end(body); else res.end();
}

async function serveFile(req, res, file, status = 200) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const stat = await fs.stat(file);
  const isAsset = file.includes(`${path.sep}_assets${path.sep}`);
  const cache = isAsset
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=0, must-revalidate';

  const base = {
    'Content-Type': type,
    'Cache-Control': cache,
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
  };

  // Range request (video seeking / partial content)
  const range = req.headers.range;
  if (range && status === 200) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? undefined : parseInt(m[1], 10);
      let end = m[2] === '' ? undefined : parseInt(m[2], 10);
      const size = stat.size;
      if (start === undefined) { start = size - end; end = size - 1; }
      if (end === undefined || end >= size) end = size - 1;
      if (Number.isNaN(start) || start > end || start < 0) {
        return send(res, 416, { 'Content-Range': `bytes */${size}` });
      }
      res.writeHead(206, {
        ...base,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
      return createReadStream(file, { start, end }).pipe(res);
    }
  }

  res.writeHead(status, { ...base, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// Optional access log (used by the verification step to catch broken local assets).
const ACCESS_LOG = process.env.ACCESS_LOG;
function logAccess(method, pathname, status) {
  if (!ACCESS_LOG) return;
  try { fssync.appendFileSync(ACCESS_LOG, `${method} ${pathname} ${status}\n`); } catch {}
}

const server = http.createServer(async (req, res) => {
  res.on('finish', () => logAccess(req.method, new URL(req.url, 'http://x').pathname, res.statusCode));
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const resolved = await resolvePath(url.pathname);

    if (resolved?.redirect !== undefined) {
      return send(res, 301, { Location: resolved.redirect + url.search });
    }
    if (resolved?.file) return serveFile(req, res, resolved.file);

    // 404
    const notFound = path.join(ROOT, '404.html');
    if (await isFile(notFound)) return serveFile(req, res, notFound, 404);
    return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
  } catch (e) {
    send(res, 500, { 'Content-Type': 'text/plain' }, 'Server error');
  }
});

server.listen(PORT, () => {
  console.log(`Isobex static site -> http://localhost:${PORT}`);
});
