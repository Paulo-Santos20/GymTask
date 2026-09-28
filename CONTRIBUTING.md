# Contributing to GymTask

Thanks for taking a look! GymTask is intentionally small and dependency-light, and the goal is
to keep it that way — easy to read, easy to deploy.

> GymTask is a derivative of openGym (https://github.com/DuarteSantos8/openGym), AGPL-3.0 licence kept.

## Project layout

```
frontend/  React 19 + Vite app (src/views, src/components, src/store, src/lib). PWA-only: no
           native shells — install via Add to Home Screen. Static build → Vercel.
api/       backend — server.js (Node, no framework), used for local dev and as HTTP fallback.
functions/ Firebase Cloud Functions (CJS): coach, nutritionProxy, pushDailyReminder.
media/     exercise img/gif (gitignored, fetched at runtime).
docs/      deploy and feature guides (DEPLOY_VERCEL.md is the primary deploy doc).
mcp/       optional Model Context Protocol server — read-only stdio bridge for LLM apps
           (Claude Desktop, Cursor, …) to query a user's workouts/1RM/muscle balance. Only runs
           when an LLM client spawns it. See mcp/README.md.
```

The project spec lives in [GYMTASK.md](GYMTASK.md) — read it before changing auth, state sync,
Coach or Nutrition code.

## Running for development

```bash
cd frontend && npm install && npm run dev    # frontend hot reload, works with zero config
# training + nutrition logic (progression rules, 1RM, session read-back, TDEE, foods):
cd frontend && npm test
```

Deploy target is **Vercel (static frontend) + Firebase (auth/db/functions)** — see
[docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md). The `docker-compose.yml` / `web/` stack is
legacy from upstream, not the deploy target.

## Guidelines

- **Keep it dependency-light.** The frontend uses React + Router + Zustand and nothing else;
  new deps (front or back) are a hard sell.
- **Match the style.** Small components, clear names, comments only where the "why" isn't obvious.
  State lives in the Zustand store (`src/store`); pure helpers in `src/lib`.
- **Don't commit** the exercise media (`media/`) or `data/` — they're gitignored.
- **Test the flow** you touched — click through the affected screens (and the workout flow) in a
  browser before opening a pull request.
- **Training logic gets a unit test.** Anything deciding what you lift next, or reading a logged
  session back, belongs in a pure helper in `src/lib` with tests beside it (`npm test`). These
  rules are easy to get subtly wrong and nearly impossible to verify by clicking — the
  progression engine grew two real bugs that only a test pinned down.

## What CI does with your pull request

A pull request runs the frontend, MCP and api test suites through GitHub Actions
(`.github/workflows/test.yml`, Node 22). **Tests must pass (`cd frontend && npm test`)**
before merge.

## Good first issues

- Nutrition extras (barcode scan, meal suggestions, recipes)
- More starter plans
- Accessibility passes on the workout and chart screens

## Where to ask what

| You have | Goes to |
| --- | --- |
| A question or an idea you're not sure about yet | [An issue](https://github.com/Paulo-Santos20/GymTask/issues) |
| A reproducible bug | [Issues](https://github.com/Paulo-Santos20/GymTask/issues) |
| A change you've already built | [A pull request](https://github.com/Paulo-Santos20/GymTask/pulls) |

By contributing you agree your work is licensed under the project's [GNU AGPL v3.0](LICENSE).
