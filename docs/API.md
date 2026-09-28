# HTTP API

The GymTask HTTP fallback API — every route of `api/server.js`, with auth,
request/response schemas and the env-dependent behavior — is documented as a
hand-written OpenAPI 3.1 spec:

- **Spec (source of truth):** [`api/openapi.yaml`](../api/openapi.yaml)

Notes for this fork:

- This spec covers the **fallback/local API only** (`/api/health`, `/api/data`,
  push, …). With Firebase configured **and** a signed-in user, the app
  talks to Firestore directly and these routes are bypassed (see `frontend/src/lib/api.js`
  and [GYMTASK.md](../GYMTASK.md) §2).
- The **Coach surface is not in this spec** — the Coach also runs as a Firebase Cloud
  Function (`functions/index.js` exports `coach`; client contract in `functions/README.md`).
- There are **no passkey/WebAuthn routes and no `/api/admin/*` routes** — both were removed
  with the upstream auth/admin system. The old browsable Swagger UI on the upstream domain
  no longer applies to this fork.

Lint it after changing routes:

```sh
npx --yes @redocly/cli lint api/openapi.yaml
```
