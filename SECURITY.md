# Security policy

GymTask is a personal tracker: the frontend is a static build on Vercel, and your data lives
in your own Firebase project (or on your own machine in local mode). This file says which
versions get fixes, how to report something privately, and — the part most people actually
need — what the app protects you from and what it doesn't.

> GymTask is a derivative of openGym (https://github.com/DuarteSantos8/openGym), AGPL-3.0 licence kept.

## Supported versions

Only the **latest release**. Releases are semver tags (see [CHANGELOG.md](CHANGELOG.md));
there is no LTS or maintenance branch and older tags are never patched. A fix ships in the
next release.

## Reporting a vulnerability

Open a private vulnerability report at
<https://github.com/Paulo-Santos20/GymTask/security/advisories/new> (GitHub → Security →
Report a vulnerability). Only the maintainers see it.

Please don't put a working exploit in a *public* issue if it can be used against other
people's instances. Everything else (a crash you can only trigger on your own project, a
scanner warning) is fine as a normal issue.

Useful in a report: the version or commit, whether you're running the Vercel deploy, local
dev or the Docker fallback, steps to reproduce, and what an attacker gets out of it.

**On response times:** this is a personal project maintained alongside everything else.
There is no SLA and no bounty. Expect days rather than hours. If a week goes by with no
reply, comment on the thread — it's more likely to be a missed notification than a decision.

## Authentication

- **Passkeys are gone.** There is no WebAuthn in this fork: no `@simplewebauthn` dependency,
  no `RP_ID`/`RP_NAME` env vars, no passkey routes in `api/server.js`.
- **Sign-in is Firebase e-mail/senha** (`frontend/src/lib/firebase.js`, `views/Login.jsx`),
  with password reset via Firebase. There is no admin dashboard and no invite system.
- **The local/fallback API** (`api/server.js`) still uses a signed session cookie and
  per-user state files (`state-<uid>.json` under `DATA_DIR`); `GET`/`PUT /api/data` only
  ever touch the caller's own file.

## In scope

- **`api/server.js`** — forging or replaying a session cookie, reading or writing another
  user's data through `/api/data`.
- **Frontend** — XSS in the React app, or anything that lets a page on another origin read or
  change a signed-in user's data; leaking a server-side key (`XAI_API_KEY`, Nutritionix keys)
  into the browser bundle.
- **Firebase rules** — the shipped `firestore.rules` letting one authenticated user read or
  write another user's documents.
- **Shipped deployment config** — `vercel.json`, `firebase.json`, `firestore.rules`: a default
  that exposes something a deployer wouldn't expect to be exposed.

## Out of scope

- Anything that already assumes access to the host, to `./data`, to the Firebase console, or
  to the browser's own storage. The operator is trusted by design.
- **Missing rate limiting**, brute force, or "I sent 100k requests and it got slow". Rate
  limits belong in the platform in front of the app (Firebase / Vercel). Genuine amplification
  (one small request causing unbounded work) *is* in scope.
- Scanner output with no working exploit, and `npm audit` findings in build-time
  devDependencies (Vite, Vitest) that never reach a running instance.
- Third-party content: the exercise image/GIF dataset and the CDN it's fetched from.

## Security model

### What it does

- **Passwords live with Firebase, not in this repo.** Registration, login, reset and session
  handling for the deployed app are Firebase Authentication's job; GymTask never sees or
  stores a password.
- **Data is isolated per user.** In Firestore, each user reads/writes only
  `users/{uid}/state/app` for their own uid (see `firestore.rules`); on the fallback API,
  each session only touches its own `state-<uid>.json`.
- **Server-side keys stay server-side.** `XAI_API_KEY` and the Nutritionix keys live in the
  Cloud Functions environment (`functions/`), never in the frontend bundle; the browser only
  ever calls the `coach` / `nutritionProxy` function URLs.
- **Guest mode never reaches a backend.** That data lives unencrypted in the browser's
  `localStorage` and is gone when the browser storage is cleared.

### What it does not do

- **Nothing in `./data` (local/fallback mode) or in exported JSON backups is encrypted.**
  Anyone who can read that folder or file can read the workout history in it. If you deploy
  for other people, they are trusting you exactly as much as they'd trust any server operator.
- **HTTPS is the platform's job.** The Vercel + Firebase deploy is HTTPS by default; the
  legacy Docker stack speaks plain HTTP behind whatever reverse proxy you put in front.
- **No rate limiting in the fallback API.** An instance on the open internet should have a
  rate limit in front of it.

## License

GymTask's own code is [GNU AGPL v3.0](LICENSE). Third-party exercise media is covered by
neither the AGPL nor the dataset's MIT license — see [NOTICE.md](NOTICE.md).
