# Isobex Lasers — self-hosted static site

A fully self-hosted, **static** clone of [isobexlasers.co.uk](https://isobexlasers.co.uk),
rebuilt to run with **zero dependency on Framer**. The original site was built in Framer;
this repo reproduces it pixel-for-pixel (layout, fonts, images, videos, scroll/appear
animations, counters, hover effects, mobile breakpoints) while serving every asset from
this repo. Once deployed, the Framer subscription can be cancelled with no change to the
live site.

There is **no build step** to deploy — the repo root *is* the web root.

---

## Quick start (local)

```bash
npm start            # http://localhost:3000  (clean URLs, no trailing slash, video range requests)
# or choose a port:
node server.js 8080
```

The dev server (`server.js`, zero dependencies) mirrors the production hosting contract:

| Behaviour | Example |
|---|---|
| Clean URLs | `/about` serves `about.html` |
| No trailing slash | `/about/` → `301` → `/about` |
| Immutable asset caching | `/_assets/*` → `Cache-Control: max-age=31536000, immutable` |
| HTTP range requests | video seeking (`206 Partial Content`) |
| Custom 404 | unknown path → `404.html` with status `404` |

---

## Structure

```
/                       web root (deploy this directory as-is)
  index.html            home  (+ 17 more page files: about.html, contact.html, …)
  *.html                one file per page — served at clean URLs (/about, /contact, …)
  _assets/
    js/                 the React + Framer-motion ES-module graph (63 .mjs bundles)
    fonts/              self-hosted woff2 (282) — Google Fonts + Framer font CDN
    media/images/       responsive image variants (186)
    media/video/        background / section videos (4, mp4)
  server.js             zero-dep local dev server (production-equivalent routing)
  vercel.json           cleanUrls + trailingSlash:false + immutable asset headers
  sitemap.xml           production URLs (https://isobexlasers.co.uk/…)
  robots.txt            points at the production sitemap
  tools/scripts/        the rebuild pipeline (see below)
  raw/                  git-ignored intermediate capture (re-creatable)
```

18 pages, ~116 MB of assets (images + video dominate).

---

## Deploy

The site is plain static files and hosts anywhere (Vercel / Netlify / Cloudflare Pages /
S3+CloudFront / nginx). Upload the repo root.

- **Vercel** — zero config; `vercel.json` already enforces `cleanUrls`, `trailingSlash:false`,
  and long-cache immutable headers for `/_assets`. `vercel deploy --prod`.
- **Netlify** — set publish dir to the repo root. Add equivalent redirects:
  `/*  /:splat  200` is not needed; enable "Pretty URLs". A `_redirects` rule
  `/about/  /about  301!` reproduces the no-trailing-slash rule (or rely on Netlify's
  "trailing slash" setting).
- **nginx** — `try_files $uri $uri.html $uri/ =404;` plus a `rewrite ^/(.*)/$ /$1 permanent;`
  for the no-trailing-slash rule, and `location /_assets { add_header Cache-Control "public, max-age=31536000, immutable"; }`.

---

## Rebuild pipeline (`tools/scripts/`)

Re-runnable end-to-end (use it to refresh from the live Framer site **before** you cancel):

```bash
npm run build            # runs 01 → 02 → 03 in order
# or individually:
npm run build:fetch      # 01 — read sitemap.xml, save each page's rendered HTML to raw/html/
npm run build:assets     # 02 — crawl the JS module graph + download fonts/images/videos
npm run build:transform  # 03 — localize URLs, strip Framer, rename identifiers, wire forms
node tools/scripts/04-verify.mjs   # live headless-Chrome network capture on every page
```

What step 03 does:
1. **Localizes** every `framerusercontent.com` / `fonts.gstatic.com` URL (incl. each
   responsive image variant) to a path under `_assets/`.
2. **Strips Framer** branding/analytics/editor (see below).
3. **Renames identifiers** — every `framer-*` class, `--framer-*` CSS var, `data-framer-*`
   attribute, `framerXxx` runtime property and `framer/appear` script type is renamed to an
   `isobex-*` / `isobexXxx` equivalent, **consistently across HTML and the JS bundles** so
   the rehydration/animation linkage is preserved. The rename is case-sensitive so unrelated
   motion-library internals (`keyframeResolver`, `forceFrameRate`) are left untouched.
4. **Re-points forms** (see "Forms" below).
5. **Validates** that all 63 JS bundles still parse (`node --check`).

`04-verify.mjs` boots the site and loads all 18 pages in headless Chrome (executing the
React/motion bundles), captures the full network log, and asserts **zero** runtime requests
to any Framer / Google-fonts domain and **zero** broken local assets.

---

## De-Framered — what was removed / what was kept

### Removed (no trace in code or on the network)
- `<meta name="generator" content="Framer …">`
- The `<!-- Made in Framer · framer.com ✨ -->` banner comment
- `framer-search-index` + `framer-search-index-fallback` meta
- `framer-html-plugin` meta
- The **Framer analytics beacon** (`events.framer.com/script`)
- The **editor-bar bootstrap** (`localStorage … __framer_force_showing_editorbar` →
  `framer.com/edit/init.mjs`) and any editor/iframe-check phone-home (`api.framer.com/functions/…`)
- `fonts.gstatic.com` / Framer-CDN **preconnect** resource hints (fonts are self-hosted)
- Every `framer-*` / `data-framer-*` / `--framer-*` / `framerXxx` identifier (renamed to `isobex…`)

The only remaining `framer`-ish substrings anywhere in the shipped site are the unrelated
third-party motion-library internals `keyframeResolver` and `forceFrameRate`, exactly as
expected.

### External services KEPT (none are Framer; all survive Framer cancellation)
| Service | What / where | Why kept |
|---|---|---|
| **Google Analytics 4** | `gtag.js` `G-JLFT6E60DF` (all pages) | Your analytics — confirmed kept |
| **Supabase pageview analytics** | inline script → `POST https://iwoagrmcszakilvqdydq.supabase.co/functions/v1/track` (all pages) | Your own custom visitor tracking (`isbx_session`), unrelated to Framer |
| **Time Finance calculator** | `<iframe src="https://calculators.timefinance.com/isobex/calculator-v3.html">` on `/finance` (loads its own bootstrap + jQuery) | Live third-party finance calculator embed |
| **WhatsApp click-to-chat** | `wa.me` links | Plain links |
| **DigiCraft** | `thedigicraft.co.uk` footer link | Plain link |

### Removed external service
- **GoHighLevel / LeadConnector tracking** (`secure.isobexlasers.co.uk/js/external-tracking.js`)
  was removed at your request.

> If you'd like the Supabase analytics or any kept service removed too, say so — each is an
> isolated edit.

---

## Forms ⚠️ action required

The site has **native Framer forms** (on `/contact`, `/waitlist`, `/finance`,
`/tailored-maintenance`). Framer forms submit through Framer's own backend
(`api.framer.com/forms/v1/forms/<id>/submit`) — which **stops working when you cancel
Framer**.

Per your choice, every form is now re-pointed to a **same-origin** endpoint, preserving the
original Framer validation + success animation:

```
https://api.framer.com/forms/v1/forms/<FORM_ID>/submit   →   /api/forms/<FORM_ID>/submit
```

You need to make `/api/forms/:id/submit` reach **your backend**. Two options:

**A. Host rewrite (no code).** Add to `vercel.json`:
```json
"rewrites": [
  { "source": "/api/forms/:id/submit", "destination": "https://YOUR-BACKEND.example.com/forms/:id" }
]
```

**B. Serverless function.** Add `api/forms/[id]/submit.js` (Vercel/Netlify function) that
forwards the JSON body to wherever you want (CRM, email, database).

The 7 Framer form IDs in use (all routed to `/api/forms/<id>/submit`):
```
02456a21-ca3f-41af-8792-f11f110c5f38
06a5d863-fb21-4fb9-ba8b-a54612cfff56
44d10bf3-a1dc-4100-8739-4f619ec79031
6538fe83-1b0b-4f31-abf5-eea2ff34298a
6be19349-6c0e-49cb-8c0b-23f0ec566c46
d637138a-187f-4e43-b636-aa5ec7ad8ab8
e78c227b-672b-4397-897e-4ac943d9ad78
```
The backend receives a JSON body of the form fields (e.g. `Name`, `Email`, `Phone`,
`BusinessName`, `MachineMakeModel`, `PostCode`, `MoreDetails`). Return `200` for the
success state to show. **Until you wire this up, forms render and validate identically but
the final submit will 404.**
