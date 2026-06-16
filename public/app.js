'use strict';
// Hirey Tasks SPA — framework-free. Talks to the local proxy (/api/*), which forwards to Hi's
// hi.tasks capability with the right bearer (the single local identity, or the signed-in session).

// API base relative to where the app is mounted (works at "/" locally and "/tasks/demo/" hosted).
const api = (name) => new URL('api/' + name, document.baseURI).href;
let HOSTED = false;
let LOGGED_IN = false;

async function call(action, params = {}) {
  const r = await fetch(api('call'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability: 'hi.tasks', action, params }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { LOGGED_IN = false; openLogin(); throw new Error('login_required'); }
  if (j && j.result) return j.result;                 // capability success envelope
  throw new Error((j && (j.message || j.error || j.error_code)) || ('http_' + r.status));
}

const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const PRIO_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_LABEL = { inbox: '新进', todo: '待办', in_progress: '进行中', waiting: '等待', delegated: '已委托', done: '已完成', dropped: '已丢弃' };
const OPEN = ['inbox', 'todo', 'in_progress', 'waiting'];

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200); }

// ----- render -------------------------------------------------------------
function taskCard(t) {
  const card = el('div', 'task' + (t.status === 'done' || t.status === 'dropped' ? ' resolved' : ''));
  card.appendChild(el('div', 'pri ' + (t.priority || 'normal')));
  const main = el('div', 'task-main');
  main.appendChild(el('p', 'task-title', t.title || '(无标题)'));
  const meta = el('div', 'meta');
  meta.appendChild(el('span', 'chip type', t.type || 'general'));
  if (t.status && t.status !== 'inbox') meta.appendChild(el('span', 'chip status', STATUS_LABEL[t.status] || t.status));
  (t.labels || []).forEach((l) => meta.appendChild(el('span', 'chip label', l)));
  if (t.source_kind && t.source_kind !== 'manual') meta.appendChild(el('span', 'chip', t.source_kind === 'message' ? '来自消息' : t.source_kind));
  main.appendChild(meta);

  if (t.status !== 'done' && t.status !== 'dropped') {
    const acts = el('div', 'actions');
    const mk = (label, cls, fn) => { const b = el('button', cls, label); b.onclick = () => fn(t); acts.appendChild(b); };
    mk('✓ 完成', 'done', (x) => act('complete', { task_id: x.id }));
    mk('稍后', '', (x) => act('snooze', { task_id: x.id, snooze_until: new Date(Date.now() + 864e5).toISOString(), status: 'waiting' }));
    mk('委托…', '', (x) => { const ref = prompt('委托给（agent_id / mod id）：'); if (ref) act('assign', { task_id: x.id, assignee_kind: 'mod', assignee_ref: ref }); });
    mk('优先级', '', (x) => { const order = ['urgent', 'high', 'normal', 'low']; const next = order[(order.indexOf(x.priority) + 1) % 4]; act('update', { task_id: x.id, priority: next }); });
    mk('✕ 丢弃', 'drop', (x) => act('drop', { task_id: x.id }));
    main.appendChild(acts);
  }
  card.appendChild(main);
  return card;
}

function render(result) {
  const tasks = result.tasks || [];
  const counts = result.counts || {};
  $('#summary').hidden = false;
  $('#statOpen').textContent = result.open_total || 0;
  $('#statInbox').textContent = counts.inbox || 0;
  $('#statDone').textContent = counts.done || 0;
  $('#statUrgent').textContent = tasks.filter((t) => OPEN.includes(t.status) && (t.priority === 'urgent' || t.priority === 'high')).length;

  const list = $('#list'); list.innerHTML = '';
  if (!tasks.length) {
    $('#empty').hidden = false;
    $('#empty').innerHTML = '<h2>收件箱归零 🎉</h2><p class="muted">没有待处理的任务。新消息进来时会自动出现在这里。</p>';
    return;
  }
  $('#empty').hidden = true;

  const showResolved = $('#showResolved').checked;
  const groups = showResolved ? ['inbox', 'todo', 'in_progress', 'waiting', 'delegated', 'done', 'dropped'] : OPEN.concat('delegated');
  for (const g of groups) {
    const inG = tasks.filter((t) => t.status === g).sort((a, b) => (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2));
    if (!inG.length) continue;
    list.appendChild(el('div', 'group-label', STATUS_LABEL[g] + ' · ' + inG.length));
    inG.forEach((t) => list.appendChild(taskCard(t)));
  }
}

async function load() {
  try {
    const result = await call('list', { include_resolved: $('#showResolved').checked, limit: 100 });
    render(result);
  } catch (e) { if (e.message !== 'login_required') showBanner('加载失败：' + e.message); }
}
async function act(action, params) {
  try { await call(action, params); toast('已更新'); load(); }
  catch (e) { if (e.message !== 'login_required') toast('失败：' + e.message); }
}
function showBanner(msg) { const b = $('#banner'); b.textContent = msg; b.hidden = false; }

// ----- enroll / settings --------------------------------------------------
async function openSettings() {
  $('#settingsDrawer').hidden = false;
  try {
    const r = await call('get_enrollment');
    const e = r.enrollment;
    $('#enrollEnabled').checked = !!(e && e.enabled);
    $('#digestChannel').value = (e && e.digest_channel) || 'auto';
  } catch { /* not enrolled yet */ }
}
async function saveEnroll() {
  try {
    await call('enroll', { enabled: $('#enrollEnabled').checked, digest_channel: $('#digestChannel').value });
    toast('已保存'); $('#settingsDrawer').hidden = true; load();
  } catch (e) { toast('失败：' + e.message); }
}

// ----- rules --------------------------------------------------------------
async function openRules() {
  $('#rulesDrawer').hidden = false;
  const box = $('#rulesList'); box.innerHTML = '<p class="muted">加载中…</p>';
  try {
    const r = await call('list_rules');
    box.innerHTML = '';
    if (!(r.rules || []).length) { box.innerHTML = '<p class="muted">还没有规则。</p>'; return; }
    for (const rule of r.rules) {
      const row = el('div', 'rule');
      const m = rule.match || {}, a = rule.action || {};
      const cond = [m.text_contains && `含“${m.text_contains}”`, m.type && `类型=${m.type}`, m.from_agent_id && `发件=${m.from_agent_id}`].filter(Boolean).join(' 且 ') || '任意';
      const doer = [a.set_priority && `优先级→${a.set_priority}`, (a.add_labels || []).length && `标签+${a.add_labels.join(',')}`, a.set_type && `类型→${a.set_type}`, a.drop && '丢弃', a.assign_to && `派给 ${a.assign_to.ref}`].filter(Boolean).join('，');
      const left = el('div'); left.innerHTML = `<b>${rule.name || '规则'}</b><br><span class="muted">${cond} → ${doer}</span>`;
      const del = el('button', 'small ghost', '删除'); del.onclick = async () => { await call('delete_rule', { rule_id: rule.id }); openRules(); };
      row.appendChild(left); row.appendChild(del); box.appendChild(row);
    }
  } catch (e) { box.innerHTML = '<p class="muted">加载失败：' + e.message + '</p>'; }
}
async function addRule() {
  const match = {}; const action = {};
  const txt = $('#rText').value.trim(); if (txt) match.text_contains = txt;
  if ($('#rType').value) match.type = $('#rType').value;
  if ($('#rPriority').value) action.set_priority = $('#rPriority').value;
  const lbl = $('#rLabel').value.trim(); if (lbl) action.add_labels = [lbl];
  if ($('#rDrop').checked) action.drop = true;
  if (!Object.keys(match).length || !Object.keys(action).length) { toast('至少填一个条件和一个动作'); return; }
  try {
    await call('add_rule', { name: $('#rName').value.trim() || undefined, match, rule_action: action });
    $('#rName').value = $('#rText').value = $('#rLabel').value = ''; $('#rType').value = $('#rPriority').value = ''; $('#rDrop').checked = false;
    toast('规则已添加'); openRules();
  } catch (e) { toast('失败：' + e.message); }
}

// ----- auth (hosted) ------------------------------------------------------
let otpKind = 'email';
function openLogin() { if (HOSTED) $('#loginModal').hidden = false; }
async function loginPost(path, body) {
  const r = await fetch(api('login/' + path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
async function googleLogin() {
  const { j } = await loginPost('google/start', {});
  if (!j.authorize_url) { toast('启动失败'); return; }
  const pop = window.open(j.authorize_url, 'higoogle', 'width=480,height=640');
  const timer = setInterval(async () => {
    const { j: p } = await loginPost('google/poll', {});
    if (p.status === 'verified') { clearInterval(timer); try { pop && pop.close(); } catch {} onLoggedIn(); }
  }, 1500);
}
async function otpStart() {
  const id = $('#otpId').value.trim(); if (!id) return;
  const { status, j } = await loginPost(otpKind + '/start', otpKind === 'email' ? { email: id } : { phone: id });
  if (status === 200 && j.ok) { $('#otpStep2').hidden = false; toast('验证码已发送'); }
  else toast('发送失败：' + (j.error || status));
}
async function otpVerify() {
  const code = $('#otpCode').value.trim();
  const { status, j } = await loginPost(otpKind + '/verify', { code });
  if (status === 200 && j.logged_in) onLoggedIn(); else toast('验证失败：' + (j.error || status));
}
function onLoggedIn() { LOGGED_IN = true; $('#loginModal').hidden = true; $('#authBtn').hidden = true; $('#identity').hidden = false; $('#identity').textContent = '已登录'; load(); }

// ----- boot ---------------------------------------------------------------
function wire() {
  $('#refreshBtn').onclick = load;
  $('#showResolved').onchange = load;
  $('#settingsBtn').onclick = openSettings;
  $('#rulesBtn').onclick = openRules;
  $('#saveEnroll').onclick = saveEnroll;
  $('#addRule').onclick = addRule;
  $('#authBtn').onclick = openLogin;
  $('#googleLogin').onclick = googleLogin;
  $('#otpStart').onclick = otpStart;
  $('#otpVerify').onclick = otpVerify;
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = (e) => e.target.closest('.drawer,.modal').hidden = true);
  document.querySelectorAll('.otp-tabs .tab').forEach((b) => b.onclick = () => {
    otpKind = b.dataset.otp; document.querySelectorAll('.otp-tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
    $('#otpId').placeholder = otpKind === 'email' ? 'you@example.com' : '+1 555 0100'; $('#otpStep2').hidden = true;
  });
  // click backdrop closes
  document.querySelectorAll('.drawer,.modal').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.hidden = true; }));
}

async function boot() {
  wire();
  try {
    const s = await fetch(api('session')).then((r) => r.json());
    HOSTED = !!s.hosted; LOGGED_IN = !!s.logged_in;
  } catch { /* default local */ }
  if (HOSTED && !LOGGED_IN) {
    $('#authBtn').hidden = false;
    $('#empty').hidden = false;
    $('#empty').innerHTML = '<h2>登录查看你的任务</h2><p class="muted">任务是你私有的。用 Google / 邮箱 / 手机登录即可。</p>';
    openLogin();
  } else {
    if (HOSTED) { $('#identity').hidden = false; $('#identity').textContent = '已登录'; }
    load();
  }
}
boot();
