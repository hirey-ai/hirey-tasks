'use strict';
// Hirey Tasks SPA — framework-free Kanban + collaboration. Talks to the local proxy (/api/*),
// which forwards to Hi's hi.tasks capability with the right bearer.

const api = (name) => new URL('api/' + name, document.baseURI).href;
let HOSTED = false, LOGGED_IN = false;
let VIEW = 'mine';        // mine | assigned | all
let LAYOUT = 'board';     // board | list
let CACHE = [];           // last loaded tasks
let CURRENT = null;       // task open in the detail drawer

async function call(action, params = {}) {
  const r = await fetch(api('call'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability: 'hi.tasks', action, params }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { LOGGED_IN = false; openLogin(); throw new Error('login_required'); }
  if (j && j.result) return j.result;
  throw new Error((j && (j.message || j.error || j.error_code)) || ('http_' + r.status));
}

const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const STATUS_LABEL = { inbox: '新进', todo: '待办', in_progress: '进行中', waiting: '等待', delegated: '已委托', done: '已完成', dropped: '已丢弃' };
const BOARD_COLS = ['inbox', 'todo', 'in_progress', 'waiting', 'delegated', 'done'];
const PRIO_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200); }
function showBanner(m) { const b = $('#banner'); b.textContent = m; b.hidden = !m; }

// ----- card meta (shared by board + list) ------------------------------------
function metaChips(t, into) {
  into.appendChild(el('span', 'chip type', t.type || 'general'));
  (t.labels || []).forEach((l) => into.appendChild(el('span', 'chip label', l)));
  if (t.assignee_kind === 'user' && t.assignee_customer_id) {
    // 我是报告人 → 显示「已派给…」；我是受理人 → 显示「派给我」
    into.appendChild(el('span', 'chip assignee', t.your_role === 'assignee' ? '派给我' : '已派出'));
  }
  if (VIEW !== 'mine' && t.your_role) into.appendChild(el('span', 'chip reporter', t.your_role === 'assignee' ? '我受理' : '我发起'));
}

// ----- board -----------------------------------------------------------------
function renderBoard(tasks) {
  const board = $('#board'); board.innerHTML = '';
  const byStatus = {}; BOARD_COLS.forEach((s) => (byStatus[s] = []));
  for (const t of tasks) (byStatus[t.status] || (byStatus[t.status] = [])).push(t);
  for (const s of BOARD_COLS) {
    const list = (byStatus[s] || []).sort((a, b) => (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2));
    const col = el('div', 'col'); col.dataset.status = s;
    const head = el('div', 'col-head'); head.appendChild(el('span', null, STATUS_LABEL[s]));
    head.appendChild(el('span', 'n', String(list.length))); col.appendChild(head);
    const cards = el('div', 'col-cards');
    for (const t of list) cards.appendChild(boardCard(t));
    col.appendChild(cards);
    // drag-drop: drop a card here → update its status
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const task = CACHE.find((x) => x.id === id);
      if (!task || task.status === s) return;
      try { await call('add_progress', { task_id: id, status: s }); toast('已移动到「' + STATUS_LABEL[s] + '」'); load(); }
      catch (err) { if (err.message !== 'login_required') toast('失败：' + err.message); }
    });
    board.appendChild(col);
  }
}
function boardCard(t) {
  const c = el('div', 'kcard p-' + (t.priority || 'normal')); c.draggable = true;
  c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t.id); c.classList.add('dragging'); });
  c.addEventListener('dragend', () => c.classList.remove('dragging'));
  c.onclick = () => openTask(t.id);
  c.appendChild(el('p', 'kt', t.title || '(无标题)'));
  const m = el('div', 'kmeta'); metaChips(t, m); c.appendChild(m);
  if (t.progress_pct != null) { const b = el('div', 'kbar'); const i = el('i'); i.style.width = Math.max(0, Math.min(100, t.progress_pct)) + '%'; b.appendChild(i); c.appendChild(b); }
  return c;
}

// ----- list (fallback) -------------------------------------------------------
function renderList(tasks) {
  const wrap = $('#list'); wrap.innerHTML = '';
  const groups = BOARD_COLS.concat('dropped');
  for (const g of groups) {
    const inG = tasks.filter((t) => t.status === g).sort((a, b) => (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2));
    if (!inG.length) continue;
    wrap.appendChild(el('div', 'group-label', STATUS_LABEL[g] + ' · ' + inG.length));
    for (const t of inG) {
      const card = el('div', 'task'); card.appendChild(el('div', 'pri ' + (t.priority || 'normal')));
      const main = el('div', 'task-main'); const title = el('p', 'task-title', t.title || '(无标题)'); main.appendChild(title);
      const meta = el('div', 'meta'); meta.appendChild(el('span', 'chip status', STATUS_LABEL[t.status])); metaChips(t, meta);
      if (t.progress_pct != null) meta.appendChild(el('span', 'chip', t.progress_pct + '%'));
      main.appendChild(meta); card.appendChild(main); card.onclick = () => openTask(t.id); wrap.appendChild(card);
    }
  }
}

// ----- load ------------------------------------------------------------------
async function load() {
  try {
    const res = await call('list', { view: VIEW, include_resolved: true, limit: 200 });
    CACHE = res.tasks || [];
    showBanner('');
    const board = $('#board'), list = $('#list'), empty = $('#empty');
    $('#app').classList.toggle('wide', LAYOUT === 'board');
    if (!CACHE.length) {
      board.hidden = true; list.hidden = true; empty.hidden = false;
      empty.innerHTML = VIEW === 'assigned'
        ? '<h2>没有派给你的任务</h2><p class="muted">别人用 tasks.assign 把任务派给你时，会出现在这里。</p>'
        : '<h2>收件箱归零 🎉</h2><p class="muted">没有任务。新建一个，或开启自动捕获让收件箱消息自动进来。</p>';
      return;
    }
    empty.hidden = true;
    if (LAYOUT === 'board') { board.hidden = false; list.hidden = true; renderBoard(CACHE); }
    else { board.hidden = true; list.hidden = false; renderList(CACHE); }
    if (CURRENT) { const fresh = CACHE.find((x) => x.id === CURRENT); if (fresh) refreshDrawer(fresh); }
  } catch (e) { if (e.message !== 'login_required') showBanner('加载失败：' + e.message); }
}

// ----- task detail drawer ----------------------------------------------------
async function openTask(id) {
  CURRENT = id;
  const drawer = $('#taskDrawer'); drawer.hidden = false;
  const t = CACHE.find((x) => x.id === id);
  if (t) refreshDrawer(t);
  // pull full task + progress
  try { const r = await call('get', { task_id: id, include_progress: true }); if (r.task) { CURRENT = id; refreshDrawer({ ...r.task, your_role: r.your_role }, r.progress || []); } }
  catch (e) { if (e.message !== 'login_required') toast('读取失败：' + e.message); }
}
function refreshDrawer(t, progress) {
  $('#tdTitle').textContent = t.title || '(无标题)';
  const m = $('#tdMeta'); m.innerHTML = '';
  m.appendChild(el('span', 'chip status', STATUS_LABEL[t.status] || t.status));
  m.appendChild(el('span', 'chip type', t.type || 'general'));
  m.appendChild(el('span', 'chip', '优先级 ' + (t.priority || 'normal')));
  if (t.your_role) m.appendChild(el('span', 'chip ' + (t.your_role === 'assignee' ? 'assignee' : 'reporter'), t.your_role === 'assignee' ? '我是受理人' : (t.your_role === 'owner' ? '我是报告人' : t.your_role)));
  const pb = $('#tdProgressBar');
  if (t.progress_pct != null) { pb.hidden = false; $('#tdBarFill').style.width = Math.max(0, Math.min(100, t.progress_pct)) + '%'; $('#tdBarLabel').textContent = t.progress_pct + '%'; } else pb.hidden = true;
  if (progress) renderTimeline(progress);
}
function renderTimeline(items) {
  const tl = $('#tdTimeline'); tl.innerHTML = '';
  if (!items.length) { tl.appendChild(el('p', 'muted', '还没有进展。')); return; }
  for (const e of items) {
    const row = el('div', 'tl ' + (e.author_role || '')); row.appendChild(el('div', 'dot'));
    const body = el('div', 'body');
    const head = [e.author_role === 'assignee' ? '受理人' : (e.author_role === 'owner' ? '报告人' : '系统'),
      e.kind === 'assignment' ? '派发' : (e.status_to ? '→' + (STATUS_LABEL[e.status_to] || e.status_to) : (e.kind === 'progress' ? '进度' : '评论')),
      e.progress_pct != null ? e.progress_pct + '%' : ''].filter(Boolean).join(' · ');
    body.appendChild(el('div', 'who', head));
    if (e.note) body.appendChild(el('div', null, e.note));
    row.appendChild(body); tl.appendChild(row);
  }
  tl.scrollTop = tl.scrollHeight;
}
async function act(action, params, okMsg) {
  try { await call(action, { task_id: CURRENT, ...params }); if (okMsg) toast(okMsg); await openTask(CURRENT); load(); }
  catch (e) { if (e.message !== 'login_required') toast('失败：' + e.message); }
}

// ----- enroll / rules / login (unchanged from v1) ----------------------------
async function openSettings() { $('#settingsDrawer').hidden = false; try { const r = await call('get_enrollment'); const e = r.enrollment; $('#enrollEnabled').checked = !!(e && e.enabled); $('#digestChannel').value = (e && e.digest_channel) || 'auto'; } catch {} }
async function saveEnroll() { try { await call('enroll', { enabled: $('#enrollEnabled').checked, digest_channel: $('#digestChannel').value }); toast('已保存'); $('#settingsDrawer').hidden = true; load(); } catch (e) { toast('失败：' + e.message); } }
async function openRules() {
  $('#rulesDrawer').hidden = false; const box = $('#rulesList'); box.innerHTML = '<p class="muted">加载中…</p>';
  try {
    const r = await call('list_rules'); box.innerHTML = '';
    if (!(r.rules || []).length) { box.innerHTML = '<p class="muted">还没有规则。</p>'; return; }
    for (const rule of r.rules) {
      const row = el('div', 'rule'); const a = rule.action || {}, mm = rule.match || {};
      const cond = [mm.text_contains && `含“${mm.text_contains}”`, mm.type && `类型=${mm.type}`].filter(Boolean).join(' 且 ') || '任意';
      const doer = [a.set_priority && `优先级→${a.set_priority}`, (a.add_labels || []).length && `标签+${a.add_labels.join(',')}`, a.drop && '丢弃'].filter(Boolean).join('，');
      const left = el('div'); left.innerHTML = `<b>${rule.name || '规则'}</b><br><span class="muted">${cond} → ${doer}</span>`;
      const del = el('button', 'small ghost', '删除'); del.onclick = async () => { await call('delete_rule', { rule_id: rule.id }); openRules(); };
      row.appendChild(left); row.appendChild(del); box.appendChild(row);
    }
  } catch (e) { box.innerHTML = '<p class="muted">加载失败：' + e.message + '</p>'; }
}
async function addRule() {
  const match = {}, action = {}; const txt = $('#rText').value.trim(); if (txt) match.text_contains = txt; if ($('#rType').value) match.type = $('#rType').value;
  if ($('#rPriority').value) action.set_priority = $('#rPriority').value; const lbl = $('#rLabel').value.trim(); if (lbl) action.add_labels = [lbl]; if ($('#rDrop').checked) action.drop = true;
  if (!Object.keys(match).length || !Object.keys(action).length) { toast('至少填一个条件和一个动作'); return; }
  try { await call('add_rule', { name: $('#rName').value.trim() || undefined, match, rule_action: action }); $('#rName').value = $('#rText').value = $('#rLabel').value = ''; $('#rType').value = $('#rPriority').value = ''; $('#rDrop').checked = false; toast('规则已添加'); openRules(); } catch (e) { toast('失败：' + e.message); }
}
let otpKind = 'email';
function openLogin() { if (HOSTED) $('#loginModal').hidden = false; }
async function loginPost(path, body) { const r = await fetch(api('login/' + path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function googleLogin() { const { j } = await loginPost('google/start', {}); if (!j.authorize_url) { toast('启动失败'); return; } const pop = window.open(j.authorize_url, 'higoogle', 'width=480,height=640'); const timer = setInterval(async () => { const { j: p } = await loginPost('google/poll', {}); if (p.status === 'verified') { clearInterval(timer); try { pop && pop.close(); } catch {} onLoggedIn(); } }, 1500); }
async function otpStart() { const id = $('#otpId').value.trim(); if (!id) return; const { status, j } = await loginPost(otpKind + '/start', otpKind === 'email' ? { email: id } : { phone: id }); if (status === 200 && j.ok) { $('#otpStep2').hidden = false; toast('验证码已发送'); } else toast('发送失败：' + (j.error || status)); }
async function otpVerify() { const code = $('#otpCode').value.trim(); const { status, j } = await loginPost(otpKind + '/verify', { code }); if (status === 200 && j.logged_in) onLoggedIn(); else toast('验证失败：' + (j.error || status)); }
function onLoggedIn() { LOGGED_IN = true; $('#loginModal').hidden = true; $('#authBtn').hidden = true; $('#identity').hidden = false; $('#identity').textContent = '已登录'; load(); }

// ----- boot ------------------------------------------------------------------
function wire() {
  $('#settingsBtn').onclick = openSettings; $('#rulesBtn').onclick = openRules;
  $('#saveEnroll').onclick = saveEnroll; $('#addRule').onclick = addRule;
  $('#authBtn').onclick = openLogin; $('#googleLogin').onclick = googleLogin; $('#otpStart').onclick = otpStart; $('#otpVerify').onclick = otpVerify;
  $('#newBtn').onclick = () => { $('#newModal').hidden = false; };
  $('#nCreate').onclick = async () => { const title = $('#nTitle').value.trim(); if (!title) return toast('填个标题'); try { await call('create', { title, type: $('#nType').value, priority: $('#nPriority').value }); $('#nTitle').value = ''; $('#newModal').hidden = true; toast('已创建'); load(); } catch (e) { toast('失败：' + e.message); } };
  // view + layout switchers
  document.querySelectorAll('#viewSeg button').forEach((b) => b.onclick = () => { VIEW = b.dataset.view; document.querySelectorAll('#viewSeg button').forEach((x) => x.classList.toggle('active', x === b)); load(); });
  document.querySelectorAll('#layoutSeg button').forEach((b) => b.onclick = () => { LAYOUT = b.dataset.layout; document.querySelectorAll('#layoutSeg button').forEach((x) => x.classList.toggle('active', x === b)); load(); });
  // task drawer actions
  $('#tdAddProgress').onclick = () => { const note = $('#tdNote').value.trim(); const pctRaw = $('#tdPct').value.trim(); const status = $('#tdStatus').value; const params = {}; if (note) params.note = note; if (pctRaw !== '') params.progress_pct = Number(pctRaw); if (status) params.status = status; if (!params.note && params.progress_pct == null && !params.status) return toast('写点内容或选个状态'); act('add_progress', params, '已更新').then(() => { $('#tdNote').value = ''; $('#tdPct').value = ''; $('#tdStatus').value = ''; }); };
  $('#tdAssign').onclick = () => { const v = $('#tdAssignee').value.trim(); if (!v) return toast('填对方 agent_id 或 owner public_id'); const params = /^ag_/.test(v) ? { assignee_agent_id: v } : { assignee_owner_public_id: v }; const note = $('#tdAssignNote').value.trim(); if (note) params.note = note; act('assign', params, '已派发').then(() => { $('#tdAssignee').value = ''; $('#tdAssignNote').value = ''; }); };
  $('#tdComplete').onclick = () => act('complete', {}, '已完成');
  $('#tdDrop').onclick = () => act('drop', {}, '已丢弃');
  $('#tdSnooze').onclick = () => act('snooze', { snooze_until: new Date(Date.now() + 864e5).toISOString(), status: 'waiting' }, '已推迟');
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = (e) => { const d = e.target.closest('.drawer,.modal'); d.hidden = true; if (d.id === 'taskDrawer') CURRENT = null; });
  document.querySelectorAll('.drawer,.modal').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) { d.hidden = true; if (d.id === 'taskDrawer') CURRENT = null; } }));
  document.querySelectorAll('.otp-tabs .tab').forEach((b) => b.onclick = () => { otpKind = b.dataset.otp; document.querySelectorAll('.otp-tabs .tab').forEach((x) => x.classList.toggle('active', x === b)); $('#otpId').placeholder = otpKind === 'email' ? 'you@example.com' : '+1 555 0100'; $('#otpStep2').hidden = true; });
}
async function boot() {
  wire();
  try { const s = await fetch(api('session')).then((r) => r.json()); HOSTED = !!s.hosted; LOGGED_IN = !!s.logged_in; } catch {}
  if (HOSTED && !LOGGED_IN) { $('#authBtn').hidden = false; $('#board').hidden = true; $('#empty').hidden = false; $('#empty').innerHTML = '<h2>登录查看你的任务</h2><p class="muted">任务是你私有的。用 Google / 邮箱 / 手机登录即可。</p>'; openLogin(); }
  else { if (HOSTED) { $('#identity').hidden = false; $('#identity').textContent = '已登录'; } load(); }
}
boot();
