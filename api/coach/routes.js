/* HTTP surface for the Coach — user routes.
 *
 * Written as a factory taking server.js's own helpers rather than importing them: the helpers
 * are closures over the db and the session secret, and passing them in keeps this module free
 * of a cycle (and trivially testable against fakes).
 */
import * as cfgStore from './config.js'
import * as jobs from './jobs.js'
import { computeCohort } from './cohort.js'
import { DATA_CATEGORIES } from './core/payload.js'

// Job failures the user sees, in the app's own voice. The raw provider detail never reaches
// them — it goes to the admin card, which is where someone can act on it (FR-47).
const USER_ERROR = {
  off: 'the Coach is not set up on this instance',
  busy: 'the Coach is already thinking about your training',
  cap: 'the Coach is resting — try again tomorrow',
  consent: 'the Coach needs your go-ahead first',
  // Verbatim, because it tells the user the one thing that resolves it and names who resolves
  // it. A vaguer message here turns into a support question for the person running the box.
  shared: cfgStore.SHARED_ACCOUNT_REFUSAL,
  unprivileged: 'the Coach is switched off on this instance for safety reasons',
}
const HTTP_FOR = { off: 503, busy: 409, cap: 429, consent: 403, shared: 409, unprivileged: 503 }

export function coachRoutes({ json, readBody, readSession }) {
  /** Every user route starts the same way: signed in, feature on, feature reachable. */
  const guard = (req, res) => {
    const user = readSession(req)
    if (!user) {
      json(res, 401, { error: 'not signed in' })
      return null
    }
    if (!cfgStore.isEnabled() || !cfgStore.isConnected()) {
      json(res, 503, { error: USER_ERROR.off })
      return null
    }
    return user
  }
  const failEnqueue = (res, e) => {
    if (e instanceof jobs.CoachError)
      return json(res, HTTP_FOR[e.code] || 400, { error: USER_ERROR[e.code] || e.message, code: e.code })
    throw e
  }

  return {
    /* ------------------------------ user ------------------------------ */

    // What the consent screen has to disclose, straight from the module that builds payloads,
    // so the screen cannot drift from what actually leaves (FR-09). Signed in only: the screen
    // that reads it sits behind a session anyway, and on an invite-only instance which provider
    // this box is wired to is nobody's business who has not been let in.
    'GET /api/coach/disclosure': async (req, res) => {
      if (!readSession(req)) return json(res, 401, { error: 'not signed in' })
      const cfg = cfgStore.load()
      json(res, 200, {
        provider: cfg.provider,
        providerLabel: cfgStore.providerMeta(cfg).label,
        categories: DATA_CATEGORIES,
        version: 1,
      })
    },

    'GET /api/coach/status': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      json(res, 200, jobs.status(user.id))
    },

    /* The model's answer as it is written — an SSE side-channel beside the status poll.
       Opt-in at the Accept header, never a new default: a client that asks for JSON gets the
       exact status answer it gets without this route existing. The handshake opens before any
       work is waited on (attach replays, it doesn't block), and the stream ends `end` — after
       the proposal is written — so a refresh on end finds it. `?job=` pins the stream to one
       job; without it the profile's current job is followed. */
    'GET /api/coach/stream': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      const accept = String((req.headers && req.headers.accept) || '')
      if (!/text\/event-stream/.test(accept)) return json(res, 200, jobs.status(user.id))
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // nginx must not buffer the tail into one delivery
      })
      const jobId = new URL(req.url, 'http://x').searchParams.get('job')
      let detach = null
      const send = ev => {
        try {
          res.write('event: ' + ev.type + '\ndata: ' + JSON.stringify(ev) + '\n\n')
        } catch {
          /* response already gone; detach below drops it from the tape */
        }
        if (ev.type === 'end') {
          try {
            res.end()
          } catch {
            /* already closed */
          }
          if (detach) detach()
        }
      }
      detach = jobs.attachTape(user.id, jobId, send)
      // A client that navigates away stops costing anything: the tape forgets the subscriber,
      // it does not keep a closed response in its set until the job ends.
      if (typeof req.on === 'function') req.on('close', () => detach && detach())
      return
    },

    'POST /api/coach/plan': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      const body = await readBody(req)
      try {
        const job = jobs.enqueue(user.id, {
          kind: 'create',
          intake: body.intake || null,
          refine: body.refine ? String(body.refine).slice(0, 1000) : null,
        })
        json(res, 202, { job })
      } catch (e) {
        failEnqueue(res, e)
      }
    },

    'POST /api/coach/review': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      const body = await readBody(req)
      try {
        const job = jobs.enqueue(user.id, { kind: 'review', note: body.note ? String(body.note).slice(0, 1000) : null })
        json(res, 202, { job })
      } catch (e) {
        failEnqueue(res, e)
      }
    },

    // One workout, read closely. Nothing to apply — the card is kept in the user's log.
    'POST /api/coach/debrief': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      const body = await readBody(req)
      try {
        const job = jobs.enqueue(user.id, {
          kind: 'debrief',
          workoutId: body.workoutId ? String(body.workoutId).slice(0, 40) : null,
        })
        json(res, 202, { job })
      } catch (e) {
        failEnqueue(res, e)
      }
    },

    /* A day of eating from the recorded TDEE. The nutrition snapshot rides in the body —
       it lives only in the phone's local store, so the client sends it and payload.build
       allowlists it field by field. */
    'POST /api/coach/mealplan': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      const body = await readBody(req)
      try {
        const job = jobs.enqueue(user.id, { kind: 'mealplan', nutrition: body.nutrition || null })
        json(res, 202, { job })
      } catch (e) {
        failEnqueue(res, e)
      }
    },

    /* How this profile sits against everyone else on the instance who opted in: medians only,
       at least three people, and nothing for a profile that does not share itself. */
    'GET /api/coach/cohort': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      if (!cfgStore.load().community) return json(res, 200, { ok: false, enabled: false })
      json(res, 200, computeCohort(user.id))
    },
    'POST /api/coach/cohort/share': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      const body = await readBody(req)
      json(res, 200, { ok: true, sharing: jobs.setShare(user.id, !!body.share) })
    },

    'POST /api/coach/pending/resolve': async (req, res) => {
      const user = guard(req, res)
      if (!user) return
      const body = await readBody(req)
      json(
        res,
        200,
        jobs.resolvePending(user.id, {
          accepted: Array.isArray(body.accepted) ? body.accepted : [],
          rejected: Array.isArray(body.rejected) ? body.rejected : [],
          dismissed: !!body.dismissed,
        }),
      )
    },

    // Consent withdrawn, or the profile turned the Coach off: drop everything held server-side
    // for them at once, without waiting for a sync to carry the news (D5).
    'POST /api/coach/forget': async (req, res) => {
      const user = readSession(req)
      if (!user) return json(res, 401, { error: 'not signed in' })
      jobs.clearUser(user.id)
      json(res, 200, { ok: true })
    },

    /* Whose account this profile is about to spend. Its own route because both the Coach screen
       and the admin card must state it, and neither should be inferring it from settings. */
    'GET /api/coach/account': async (req, res) => {
      const user = readSession(req)
      if (!user) return json(res, 401, { error: 'not signed in' })
      json(res, 200, cfgStore.accountFor(user.id))
    },
  }
}
