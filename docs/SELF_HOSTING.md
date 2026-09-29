# Self-hosting GymTask (legacy Docker path)

> **Status: legacy.** The primary deploy target for this fork is **Vercel (static
> frontend) + Firebase (auth/db/functions)** — see [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md)
> and [GYMTASK.md](../GYMTASK.md). This document covers the inherited Docker self-host
> stack (`docker-compose.yml` / `web/`), kept as a local/dev fallback — not the deploy target.
>
> **What changed vs upstream openGym:**
> - **Auth is Firebase (client-side), not passkeys.** The passkey/WebAuthn endpoints were
>   removed from `api/server.js`; there is no `RP_ID`/`RP_NAME`, no `@simplewebauthn`
>   dependency, and no "create profile with a passkey" step. Any old instruction below that
>   mentions passkeys, `RP_ID`, or `ORIGIN`-bound credentials does not apply anymore.
> - **No admin dashboard, no invites.** `ADMIN_UIDS` / `INVITE_ONLY` are gone.
> - `ORIGIN` still exists in `.env.example`, but only as CSRF protection (the server compares
>   the `Origin` header of state-changing requests against it) and to mark the session cookie
>   `Secure` when it starts with `https:`.

## 1. Run it locally

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```bash
git clone https://github.com/Paulo-Santos20/GymTask
cd GymTask
cp .env.example .env
docker compose up -d
```

- First start downloads the exercise images/GIFs (~140 MB) once into `media/img` and `media/gif`.
- Open **http://localhost:8080**. Without Firebase configured the app runs in guest/local
  mode (data stays in that browser); with `VITE_FIREBASE_*` baked into a local frontend build
  it signs in against your Firebase project instead.

Check it's healthy:

```bash
docker compose ps
curl http://localhost:8080/api/health      # {"ok":true,...}
```

Logs: `docker compose logs -f`. Stop: `docker compose down`.

## 2. Expose it over HTTPS on your own domain

Put GymTask behind something that terminates TLS for a hostname you control, then point it at
the `web` container. Pick whichever you already run:

### Option A — Cloudflare Tunnel (no open ports)

1. Create a tunnel and route `gym.example.com` → `http://<docker-host>:8080`.
2. Cloudflare gives you HTTPS automatically.

### Option B — Caddy (automatic Let's Encrypt)

```caddy
gym.example.com {
    reverse_proxy localhost:8080
}
```

### Option C — Traefik / nginx / Nginx Proxy Manager

Route `gym.example.com` (HTTPS) → `web:80` (or `<docker-host>:8080`). If that proxy caps
request bodies (nginx does, at 1 MiB by default), allow at least 5 MiB on `/api/` — the app syncs
its whole history in one PUT; the bundled web image already allows 5 MiB, matching the API.

Then set your domain in `.env` and restart:

```bash
# .env
ORIGIN=https://gym.example.com
WEB_PORT=8080
```

```bash
docker compose up -d
```

> Want HTTPS **without** exposing anything to the internet — a valid certificate on a LAN-only
> address? See [SELF_HOSTING_HTTPS.md](./SELF_HOSTING_HTTPS.md) (wildcard cert via a DNS
> challenge, Caddy in front). Note: its worked example still uses upstream `RP_ID`/`ORIGIN`
> wording in one place — read it as "set `ORIGIN` to your public `https://` address"; there is
> no `RP_ID` anymore.

## 3. Fitting it into an existing stack

The defaults assume GymTask is the only thing here. Four settings in `.env` move the ports
without editing any config file:

```bash
WEB_PORT=8080              # host port — what you browse to
NGINX_PORT=80              # port the web container listens on, inside the container
BACKEND=api                # name of the API service that /api is proxied to
PORT=3000                  # port the API listens on; web proxies to the same value
```

The web image renders its nginx config from these when the container starts, so they take effect
on a **prebuilt image** — no rebuild.

## 4. Backups

Everything is in `./data`:

```bash
tar czf gymtask-backup-$(date +%F).tar.gz data/
```

Restore by unpacking it back into the project folder. (Individual users can also export their
own data as JSON from Settings. Firebase-mode data lives in Firestore, not here — export it
from the Firebase console or the in-app JSON export.)

## 5. Updating

```bash
git pull
docker compose up -d --build
```

The app shell is versioned (`?v=N`) so clients pick up changes on next load. Your `./data` and the
downloaded media are untouched.

## 6. Notifications (fallback stack)

The fallback API can push rest-timer-over and day-reminder alerts via Web Push (`web-push`;
VAPID keys generated on first run into `./data/vapid.json`). Turn it on per-profile in
**Settings → Notifications** (requires HTTPS — see section 2 — or `localhost`).

Where it works: any desktop browser, Android Chrome, and on iOS only the app **added to the Home
Screen** (Safari in a tab has no Web Push).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Media didn't download | `docker compose logs media`. Re-run `docker compose up -d`, or run `./scripts/fetch-media.sh`. |
| Port 8080 already used | Set `WEB_PORT=9090` in `.env` (and update `ORIGIN` for local testing). |
| Login/auth behaves oddly behind a proxy | The server checks the `Origin` header against `ORIGIN` — make sure `ORIGIN` is exactly the public `https://` address in the browser bar (no trailing slash). |
| `docker compose pull` fails with "denied" / "unauthorized" | No prebuilt images are published for this fork — build from source (`docker compose up -d --build`). |

### `VITE_IMG_BASE` / `VITE_GIF_BASE` are build-time, not run-time

These two are read by Vite when the frontend is **compiled**, so their values are baked into
the shipped JavaScript bundle. Setting them in the `.env` next to `docker compose` has no
effect on an already-built image — the bundle has already made up its mind.
