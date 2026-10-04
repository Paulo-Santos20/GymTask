import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
// The API refuses a state-changing request that a browser sent from anywhere other than its own
// ORIGIN (the CSRF guard in api/server.js). The dev server is on a different port, so the page's
// real Origin is not ORIGIN — modern browsers get through on Sec-Fetch-Site: same-origin, and
// presenting the expected Origin here covers the ones that don't send it. Match your .env if you
// changed ORIGIN: API_ORIGIN=https://gym.example.com npm run dev
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:8080'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

// Optional web analytics (Umami). Injected only when BOTH vars are set at build time,
// so a plain `npm run build` — and every self-hosted install — stays telemetry-free.
// Set for the public instance: VITE_UMAMI_SRC=https://stats.example/script.js VITE_UMAMI_ID=<uuid>
const umamiSrc = process.env.VITE_UMAMI_SRC
const umamiId = process.env.VITE_UMAMI_ID

const umami = {
  name: 'gytask-umami',
  transformIndexHtml() {
    if (!umamiSrc || !umamiId) return
    return [{
      tag: 'script',
      attrs: { defer: true, src: umamiSrc, 'data-website-id': umamiId },
      injectTo: 'head'
    }]
  }
}

// The service worker's cache is named after the build (public/sw.js carries a `__BUILD__`
// placeholder): a deploy is then a new worker with its own cache, and the previous build's
// shell and chunks are dropped on activate instead of piling up under one fixed name. The
// stamp is a hash of the built index.html — it changes exactly when the bundle does.
const swStamp = {
  name: 'gytask-sw-stamp',
  apply: 'build',
  closeBundle() {
    const dir = new URL('./dist/', import.meta.url)
    const html = new URL('index.html', dir), sw = new URL('sw.js', dir)
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, readFileSync(sw, 'utf8').replace('__BUILD__', stamp))
  }
}

// The version people are asked for in #install-help and on every bug report. Read from
// package.json so it cannot drift from the release it was built in, and inlined at build
// time so no runtime fetch is involved.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [react(), umami, swStamp],
  base: './',
  test: { setupFiles: ['./vitest.setup.js'] },
  server: {
    // The Coach's core (payload, validator, prompts, HTTP adapters) lives in ../api/coach/core
    // and is imported by the phone build. vite build and vitest already reach it; the dev
    // server needs to be told the workspace is wider than frontend/.
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Vendor split: heavyweight libraries get their own long-lived chunks so an app
        // deploy doesn't invalidate the react/firebase payloads in everyone's cache.
        // Groups mirror package.json deps. No vendor-charts: the Stats charts are hand-rolled
        // SVG (no chart dependency exists). Everything else keeps Vite's default chunking —
        // grouping "the rest" into one `vendor` chunk was tried and regressed: it hoisted the
        // dynamically-imported jsQR/lean-qr (~137 kB) into the eagerly-loaded graph, growing
        // first paint while only making the entry number look smaller. QR code + zustand stay
        // lazy/entry-local by default instead.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/(?:^|[/\\])node_modules[/\\]@remix-run[/\\]/.test(id)) return 'vendor-react'
          if (/(?:^|[/\\])node_modules[/\\](react|react-dom|react-router|react-router-dom|scheduler)[/\\]/.test(id)) return 'vendor-react'
          if (/(?:^|[/\\])node_modules[/\\](firebase|@firebase)[/\\]/.test(id)) return 'vendor-firebase'
        }
      }
    }
  }
})
