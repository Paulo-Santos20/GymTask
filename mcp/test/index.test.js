// Entry-wiring tests for mcp/src/index.js — the layer the unit suite structurally cannot
// reach. index.js is a side-effectful entry: it resolves the profile, registers every tool
// and starts the stdio transport at import time, so it is exercised exactly the way an LLM
// client exercises it — a real child process speaking JSON-RPC over stdio, with the MCP SDK
// client on the other end of the pipe. Pinned here: the tools/list ↔ TOOLS registration, the
// JSON text wrapper around handler results, the error wrapper (code-prefixed, isError),
// the stderr-only profile banner, and the fail-soft that keeps the tool list up when
// OPENGYM_DATA is wrong. The spawn itself is also the plain-node proof for index.js: this
// child runs under bare `node`, not through Vite.
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { TOOLS } from '../src/tools.js'

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_JS = path.join(MCP_ROOT, 'src', 'index.js')

let DATA_DIR = null
const started = []

// Spawn the server the way claude_desktop_config.json does: `node src/index.js` with the
// data dir in env. stderr is piped so the diagnostics index.js writes can be asserted —
// they are part of the contract (they are the only thing the user sees on a bad config).
async function startServer(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [INDEX_JS],
    env: { ...process.env, ...env },
    stderr: 'pipe',
    cwd: MCP_ROOT
  })
  let stderr = ''
  transport.stderr?.on('data', chunk => { stderr += chunk.toString() })
  const client = new Client({ name: 'gytask-wiring-test', version: '0.0.0' })
  await client.connect(transport)
  const server = { client, stderrText: () => stderr }
  started.push(server)
  return server
}

beforeAll(() => {
  DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gytask-mcp-index-'))
  fs.writeFileSync(path.join(DATA_DIR, 'db.json'), JSON.stringify({
    users: [{ id: 'alice', name: 'Alice', created: '2026-07-26T00:00:00.000Z' }],
    creds: [], subs: [], invites: []
  }))
  fs.writeFileSync(path.join(DATA_DIR, 'state-alice.json'),
    JSON.stringify({ unit: 'kg', routines: [], workouts: [] }))
})

afterAll(async () => {
  for (const s of started) { try { await s.client.close() } catch { /* already gone */ } }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5 }) } catch { /* best-effort */ }
})

const GOOD_ENV = () => ({ OPENGYM_DATA: DATA_DIR, OPENGYM_UID: 'alice' })

describe('index: tool registration over the real transport', () => {
  let server

  beforeAll(async () => {
    server = await startServer(GOOD_ENV())
  }, 30000)

  test('tools/list over JSON-RPC returns exactly the TOOLS the module exports', { timeout: 30000 }, async () => {
    const { tools } = await server.client.listTools()
    expect(tools.map(t => t.name)).toEqual(TOOLS.map(t => t.name))
    for (const t of tools) {
      expect(typeof t.description).toBe('string')
      expect(t.description.length).toBeGreaterThan(0)
      expect(typeof t.inputSchema).toBe('object')  // zod shape → JSON schema, at the wire
    }
  })

  test('a tool call comes back as JSON text inside the MCP content wrapper', { timeout: 30000 }, async () => {
    const res = await server.client.callTool({ name: 'list_routines', arguments: {} })
    expect(res.isError).toBeFalsy()
    expect(res.content[0].type).toBe('text')
    // index.js JSON.stringify's the handler's result — the LLM parses this text.
    const body = JSON.parse(res.content[0].text)
    expect(body).toEqual({ unit: 'kg', routines: [] })
  })

  test('a thrown handler error crosses the wire as isError with its code prefix', { timeout: 30000 }, async () => {
    const res = await server.client.callTool({ name: 'get_routine', arguments: { routine_id: 'bogus' } })
    expect(res.isError).toBe(true)
    // `${err.code}: ${err.message}` — the ENOENT branch of index.js's catch. Without the
    // wrapper this would be a protocol-level crash instead of an answer the LLM can read.
    expect(res.content[0].text).toMatch(/^ENOENT: /)
    expect(res.content[0].text).toContain('no routine with id')
  })

  test('the server announces the resolved profile on stderr — diagnostics, not stdout', { timeout: 30000 }, async () => {
    // The banner proves index.js ran init() + getUser() against the fixture, and stderr is
    // the channel that must carry it: stdout is the JSON-RPC channel.
    expect(server.stderrText()).toContain('[gytask-mcp] serving profile Alice (alice)')
  })
})

describe('index: fail-soft on bad config', () => {
  test('a missing OPENGYM_DATA keeps the full tool list up and answers errors readably', { timeout: 30000 }, async () => {
    const server = await startServer({ OPENGYM_DATA: path.join(DATA_DIR, 'missing'), OPENGYM_UID: '' })

    // index.js logs the config error but does NOT exit — the user still sees the tool list
    // and a useful message after fixing the env, instead of a dead handshake.
    expect(server.stderrText()).toContain('OPENGYM_DATA dir does not exist')

    const { tools } = await server.client.listTools()
    expect(tools.map(t => t.name)).toEqual(TOOLS.map(t => t.name))

    // And a tool call on the broken config is an isError answer, not a crashed process:
    // getState() re-throws through init(), index.js's catch gives it no code → 'ERROR'.
    const res = await server.client.callTool({ name: 'list_routines', arguments: {} })
    expect(res.isError).toBe(true)
    expect(res.content[0].text).toMatch(/^ERROR: OPENGYM_DATA dir does not exist/)
  })
})
