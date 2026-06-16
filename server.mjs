#!/usr/bin/env node
// Hirey Tasks — a zero-dependency "inbox-zero" task manager for Hirey Hi.
//
// It turns the messages, meeting requests and matches that land in your Hi inbox into a managed
// task list — auto-captured, LLM-distilled (type / priority / a recipient-facing title), and
// triageable with one click (done / drop / snooze / delegate). It's a thin, framework-free web
// front-end over Hi's `hi.tasks` capability; the platform does all the work.
//
// Two run modes:
//   • local (default, `npm start`): one Hi identity (cached creds / env) backs everything — you
//     manage that owner's tasks. Good for self-hosting on your own box next to your agent.
//   • hosted (HOSTED=1): a public multi-tenant deployment with AUTH-FIRST login. Tasks are private,
//     so there is NO anonymous browsing — a visitor signs in via Hi's auth-first endpoints
//     (/v1/auth/web/*): Google / email-OTP / phone-OTP. Hi creates the agent ONLY after the identity
//     is verified and hands back a token; this proxy holds that token server-side (keyed by the
//     ht_sid cookie). The browser never sees a token and no anonymous agent is ever minted.
//
// The delivery invariant holds end-to-end: the task layer is a parallel, read-only overlay on the
// message stream — nothing here ever consumes or hides a message. Completing/deleting a task never
// touches the underlying conversation.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const HI_BASE = (process.env.HI_BASE_URL || 'https://hi.hirey.ai').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 4174);
const HOSTED = process.env.HOSTED === '1';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const CREDS_DIR = join(homedir(), '.config', 'hirey-tasks');
const CREDS_PATH = join(CREDS_DIR, 'credentials.json');

// Every action the browser may invoke is on the single owner-scoped `hi.tasks` capability.
// Tasks are private, so in hosted mode ALL of them require a signed-in session (no shared reader).
const ALLOWED = new Set([
  'list', 'get', 'create', 'update', 'complete', 'drop', 'snooze', 'assign', 'delete',
  'add_progress', 'list_progress',
  'enroll', 'get_enrollment', 'add_rule', 'list_rules', 'delete_rule',
].map((a) => `hi.tasks:${a}`));
const isAllowed = (cap, action) => ALLOWED.has(`${cap}:${action}`);

// ----------------------------------------------------------------------------- identity (local mode)
class ServiceAgent {
  constructor(creds) { this.creds = creds; this.token = { value: null, exp: 0 }; }
  async getToken() {
    const now = Date.now();
    if (this.token.value && this.token.exp - now > 60_000) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.creds.client_id, client_secret: this.creds.client_secret, audience: 'hirey-hi' });
    const res = await fetch(`${HI_BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
    const j = await res.json();
    this.token = { value: j.access_token, exp: now + (j.expires_in || 3600) * 1000 };
    return this.token.value;
  }
}
let serviceAgent = null; // only used in local mode

async function registerServiceAgent(persist) {
  const res = await fetch(`${HI_BASE}/v1/agents/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Hirey Tasks', agent_kind: 'external', metadata: { host: 'hirey-tasks' } }) });
  if (!res.ok) throw new Error(`agent register failed: ${res.status}`);
  const j = await res.json();
  const c = { client_id: j.auth.client_id, client_secret: j.auth.client_secret, agent_id: j.agent.agent_id, installation_id: j.installation.installation_id };
  if (persist) { await mkdir(CREDS_DIR, { recursive: true, mode: 0o700 }); await writeFile(CREDS_PATH, JSON.stringify(c, null, 2), { mode: 0o600 }); }
  return c;
}
async function loadServiceCreds() {
  if (process.env.HI_CLIENT_ID && process.env.HI_CLIENT_SECRET) return { client_id: process.env.HI_CLIENT_ID, client_secret: process.env.HI_CLIENT_SECRET, agent_id: process.env.HI_AGENT_ID || null };
  if (existsSync(CREDS_PATH)) { try { const c = JSON.parse(await readFile(CREDS_PATH, 'utf8')); if (c.client_id && c.client_secret) return c; } catch { /* re-register */ } }
  return registerServiceAgent(true);
}
async function activate(token) {
  try { await fetch(`${HI_BASE}/v1/agents/activate`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' }); } catch { /* non-fatal */ }
}

// Call a Hi capability with an explicit bearer (the local service agent OR a signed-in session token).
async function callHi(token, capability, action, params = {}) {
  const res = await fetch(`${HI_BASE}/v1/capabilities/${capability}/call`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action, ...params }) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { error: 'bad_upstream_json', raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

// ----------------------------------------------------------------------------- sessions (hosted login)
// ht_sid cookie -> { token, agent_id, workspace_id, flowId, kind, lastSeen }. A session exists only
// once a visitor starts signing in; the Hi agent behind `token` is created by Hi on verification.
const sessions = new Map();
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30d
const MAX_SESSIONS = 50000;
const SID_RE = /^[a-f0-9]{32}$/;
const newSid = () => randomBytes(16).toString('hex');
const reqHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!req.socket?.encrypted;
const sessionCookie = (sid, secure) => `ht_sid=${sid}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`;

function sweepSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions) if (now - s.lastSeen > SESSION_TTL) sessions.delete(sid);
  if (sessions.size > MAX_SESSIONS) { const old = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, sessions.size - MAX_SESSIONS); for (const [sid] of old) sessions.delete(sid); }
}
function parseCookies(req) { const out = {}; const h = req.headers.cookie; if (h) for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); } return out; }
function getSession(req) { const sid = parseCookies(req).ht_sid; return sid && SID_RE.test(sid) ? sessions.get(sid) : null; }
function ensureSession(req, setCookie) {
  let sid = parseCookies(req).ht_sid;
  let s = (sid && SID_RE.test(sid)) ? sessions.get(sid) : null;
  if (!s) { sweepSessions(); sid = newSid(); s = { lastSeen: Date.now() }; sessions.set(sid, s); setCookie(sessionCookie(sid, HOSTED && reqHttps(req))); }
  s.lastSeen = Date.now();
  return { sid, s };
}
function rotateSession(req, s, setCookie) {
  const oldSid = parseCookies(req).ht_sid;
  if (oldSid && sessions.get(oldSid) === s) sessions.delete(oldSid);
  const sid = newSid(); sessions.set(sid, s); setCookie(sessionCookie(sid, HOSTED && reqHttps(req)));
}

// per-IP rate limit on login-start (each start mints a Hi subject + may send an OTP)
const buckets = new Map();
function clientIp(req) { return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown'; }
function rateOk(ip, max, windowMs) { const now = Date.now(); if (buckets.size > 5000) buckets.clear(); const a = (buckets.get(ip) || []).filter((t) => now - t < windowMs); if (a.length >= max) { buckets.set(ip, a); return false; } a.push(now); buckets.set(ip, a); return true; }

async function authPost(path, body) {
  const res = await fetch(`${HI_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let j; try { j = await res.json(); } catch { j = { error: 'bad_json' }; }
  return { status: res.status, j };
}

// ----------------------------------------------------------------------------- http
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
function sendJson(res, status, body, extra) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...(extra || {}) }); res.end(JSON.stringify(body)); }
async function readBody(req) { const chunks = []; for await (const c of req) chunks.push(c); return Buffer.concat(chunks).toString('utf8'); }
function originOk(req) { const o = req.headers.origin; if (!o) return true; if (ALLOWED_ORIGIN) return o === ALLOWED_ORIGIN; try { return new URL(o).host === req.headers.host; } catch { return false; } }

async function handleLogin(req, res, sub) {
  const ip = clientIp(req);
  let body; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'bad_json' }); }

  if (sub === 'email/start' || sub === 'phone/start') {
    if (!rateOk(ip, 10, 60_000)) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    const kind = sub.split('/')[0];
    const payload = kind === 'email' ? { email: String(body.email || '') } : { phone: String(body.phone || '') };
    const { status, j } = await authPost(`/v1/auth/web/${kind}/start`, payload);
    if (status !== 200 || !j.flow_id) return sendJson(res, status === 200 ? 400 : status, { ok: false, error: j.error || 'start_failed' });
    let cookie = null; const { s } = ensureSession(req, (c) => { cookie = c; });
    s.flowId = j.flow_id; s.kind = kind; s.token = null;
    return sendJson(res, 200, { ok: true }, cookie ? { 'set-cookie': cookie } : undefined);
  }

  if (sub === 'email/verify' || sub === 'phone/verify') {
    const kind = sub.split('/')[0];
    const s = getSession(req);
    if (!s || !s.flowId || s.kind !== kind) return sendJson(res, 400, { ok: false, error: 'no_active_login' });
    const { status, j } = await authPost(`/v1/auth/web/${kind}/verify`, { flow_id: s.flowId, code: String(body.code || '') });
    if (status !== 200 || !j.access_token) return sendJson(res, status === 200 ? 400 : status, { ok: false, error: j.error || 'verify_failed' });
    s.token = j.access_token; s.agent_id = j.agent_id; s.workspace_id = j.workspace_id; s.flowId = null;
    let cookie = null; rotateSession(req, s, (c) => { cookie = c; });
    return sendJson(res, 200, { ok: true, logged_in: true }, cookie ? { 'set-cookie': cookie } : undefined);
  }

  if (sub === 'google/start') {
    if (!rateOk(ip, 10, 60_000)) return sendJson(res, 429, { ok: false, error: 'rate_limited' });
    const { status, j } = await authPost('/v1/auth/web/google/start', {});
    if (status !== 200 || !j.authorize_url) return sendJson(res, status === 200 ? 400 : status, { ok: false, error: j.error || 'start_failed' });
    let cookie = null; const { s } = ensureSession(req, (c) => { cookie = c; });
    s.flowId = j.flow_id; s.kind = 'google'; s.token = null;
    return sendJson(res, 200, { ok: true, authorize_url: j.authorize_url }, cookie ? { 'set-cookie': cookie } : undefined);
  }

  if (sub === 'google/poll') {
    const s = getSession(req);
    if (!s || !s.flowId || s.kind !== 'google') return sendJson(res, 400, { ok: false, error: 'no_active_login' });
    const { status, j } = await authPost('/v1/auth/web/google/poll', { flow_id: s.flowId });
    if (status !== 200) return sendJson(res, status, { ok: false, error: j.error || 'poll_failed' });
    if (j.status === 'verified' && j.access_token) {
      s.token = j.access_token; s.agent_id = j.agent_id; s.workspace_id = j.workspace_id; s.flowId = null;
      let cookie = null; rotateSession(req, s, (c) => { cookie = c; });
      return sendJson(res, 200, { status: 'verified', logged_in: true }, cookie ? { 'set-cookie': cookie } : undefined);
    }
    return sendJson(res, 200, { status: 'pending' });
  }

  return sendJson(res, 404, { ok: false, error: 'unknown_login_action' });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    if (p === '/api/health') return sendJson(res, 200, { ok: true, hosted: HOSTED, hi_base: HI_BASE });

    if (p === '/api/session') {
      const s = HOSTED ? getSession(req) : { token: 'local' };
      return sendJson(res, 200, { hosted: HOSTED, logged_in: !!(s && s.token) });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      const sid = parseCookies(req).ht_sid; if (sid) sessions.delete(sid);
      return sendJson(res, 200, { ok: true }, { 'set-cookie': 'ht_sid=; Path=/; HttpOnly; Max-Age=0' });
    }

    if (p.startsWith('/api/login/')) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      if (!HOSTED) return sendJson(res, 400, { ok: false, error: 'login_only_in_hosted_mode' });
      if (!originOk(req)) return sendJson(res, 403, { ok: false, error: 'bad_origin' });
      return handleLogin(req, res, p.slice('/api/login/'.length));
    }

    if (p === '/api/call') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      if (!originOk(req)) return sendJson(res, 403, { ok: false, error: 'bad_origin' });
      let body; try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'bad_json' }); }
      const { capability, action } = body; const params = body.params || {};
      if (!isAllowed(capability, action)) return sendJson(res, 403, { ok: false, error: `not allowed: ${capability}.${action}` });
      // Tasks are private: local mode uses the single cached identity; hosted mode requires sign-in for everything.
      let token;
      if (!HOSTED) { token = await serviceAgent.getToken(); }
      else { const s = getSession(req); if (!s || !s.token) return sendJson(res, 401, { ok: false, error: 'login_required' }); token = s.token; }
      const { status, json } = await callHi(token, capability, action, params);
      return sendJson(res, status, json);
    }

    // static (+ SPA fallback). Mount-path agnostic: front-end uses URLs relative to location.pathname.
    const rel = p === '/' ? '/index.html' : decodeURIComponent(p);
    const filePath = normalize(join(PUBLIC_DIR, rel));
    if (filePath.startsWith(PUBLIC_DIR) && existsSync(filePath) && extname(filePath)) {
      const data = await readFile(filePath);
      res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
      return res.end(data);
    }
    const idx = await readFile(join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(idx);
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
});

async function bootstrap() {
  console.log(`Hirey Tasks — starting up (${HOSTED ? 'hosted/auth-first' : 'local'})…`);
  if (!HOSTED) {
    serviceAgent = new ServiceAgent(await loadServiceCreds());
    await activate(await serviceAgent.getToken());
  }
}

bootstrap()
  .then(() => server.listen(PORT, () => {
    console.log(`\n  ▸ Hirey Tasks is live at     http://localhost:${PORT}`);
    console.log(`  ▸ identity (local)           ${HOSTED ? '(per-visitor sign-in)' : (serviceAgent?.creds.agent_id || '(env credentials)')}`);
    console.log(`  ▸ mode                       ${HOSTED ? 'hosted — auth-first sign-in (tasks are private; no anonymous agent)' : 'local — single identity'}`);
    console.log(`  ▸ talking to                 ${HI_BASE}\n`);
  }))
  .catch((e) => { console.error('\n  ✗ bootstrap failed:', e.message, '\n'); process.exit(1); });
