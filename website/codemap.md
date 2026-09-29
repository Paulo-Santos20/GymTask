# website/

Static marketing site for GymTask: plain hand-written HTML/CSS/JS, **no framework,
no build step, no package.json** — served by nginx as-is. Marketing only; it is
not part of the Vercel frontend build (`frontend/` deploys separately).

## Responsibility

Four pages sharing one stylesheet and one script: `index.html` (hero, `#features`,
`#screens`, `#demo`, `#download`, `#story`, `#opensource`, `#elsewhere`),
`docs.html`, `api.html`, `about.html`. Plus SEO/crawler files: `sitemap.xml`,
`robots.txt`, `llms.txt`, and `README.md` documenting deploy-time additions.

## Design

- **`styles.css`** — single sheet; topic rail `.side` (fixed column ≥1300 px,
  hamburger sheet below), `.skip` "skip to content" link on every page.
- **`site.js`** — five independent features, each **failing soft** so the page is
  complete without any of them: the rail sheet, its scrollspy, scroll reveals,
  the demo iframe (injected only once on screen, never <700 px), and two live
  lookups against `api.github.com` (star/issue counts, About release timeline) —
  the network ones deferred via `requestIdleCallback`. Shared `panel()` helper
  for focus-trapped open/close.
- Assets are **cache-busted by `?v=N`** on `styles.css`/`site.js` (nginx serves
  `no-cache, must-revalidate`; the query defeats stale Cloudflare edges). Bump on
  every change. Screenshot URLs are stable names, so redeploys rely on the 7-day
  image cache.
- `api.html` is the only **generated** file: `node scripts/build-api-docs.mjs`
  (repo root) rewrites it from `api/openapi.yaml` — edit the spec, re-run, never
  hand-edit.

## Flow

Browser → nginx → static HTML, lazy `site.js` behaviours, GitHub API calls at idle.
`#demo` gets its `<iframe>` injected by `site.js` only when the section scrolls
into view (wide viewports only; below 700 px CSS swaps in an "open full-screen"
card). No data flows in; the site never touches user or app data.

## Integration

- **Not in git** (added at deploy): `img/` from `build-images.sh <dist>/img`
  (screenshots in PNG + WebP 480/600/1170, `banner.png`, `social.jpg` og:image),
  `icon-180/512.png` copied from `frontend/public/`, and `demo/` — the browser-only
  demo build of `frontend` made with `VITE_DEMO=1` in the `pages` job of
  `.github/workflows/pages.yml`, which the site frames (must live on the same
  origin because of `X-Frame-Options: SAMEORIGIN`).
- Canonical URLs point at the site host; download links point users to the app,
  GitHub, and the Vercel/Firebase deploy docs.
