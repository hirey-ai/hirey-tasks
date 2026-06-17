'use strict';
// Hirey Tasks SPA — framework-free Kanban + collaboration. Talks to the local proxy (/api/*),
// which forwards to Hi's hi.tasks capability with the right bearer.
// i18n: English by default, 中文 toggle (persisted in localStorage). Static strings carry
// data-i18n keys in index.html; dynamic strings go through t().

const api = (name) => new URL('api/' + name, document.baseURI).href;
let HOSTED = false, LOGGED_IN = false;
let VIEW = 'all';         // mine | assigned | all  (default all = mine + assigned-to-me)
let LAYOUT = 'board';     // board | list
let CACHE = [];           // last loaded tasks
let CURRENT = null;       // task open in the detail drawer

// ----- i18n ------------------------------------------------------------------
const I18N = {
  en: {
    'doc.title': 'Hirey Tasks — Inbox Zero / Kanban',
    'doc.desc': 'Auto-distill your Hi inbox (messages / meetings / matches) into tasks, and collaborate on a board: delegate to others, track progress live.',
    'brand.sub': 'Inbox · Kanban',
    'view.mine': 'Mine', 'view.assigned': 'Assigned to me', 'view.all': 'All',
    'layout.board': 'Board', 'layout.list': 'List',
    'btn.rules': 'Rules', 'btn.settings': 'Settings', 'btn.new': '+ New', 'btn.signin': 'Sign in',
    'td.title': 'Task', 'td.progress': 'Progress / Activity',
    'td.notePh': 'Write an update… (comment / progress note)',
    'td.status.none': 'No change', 'td.status.in_progress': 'In progress', 'td.status.waiting': 'Waiting', 'td.status.todo': 'To-do', 'td.status.done': 'Done',
    'td.update': 'Update',
    'td.delegate': 'Delegate',
    'td.delegateDesc': 'Hand this task to another user — enter their agent_id or owner public id. Requires a working relationship (same company or an existing pairing).',
    'td.assigneePh': 'their agent_id (ag_…) or owner public id', 'td.assignNotePh': 'note (optional)', 'td.assignBtn': 'Delegate',
    'td.complete': '✓ Complete', 'td.snooze': 'Snooze 1 day', 'td.drop': '✕ Drop',
    'new.title': 'New task', 'new.titlePh': 'Task title', 'new.type': 'Type', 'new.priority': 'Priority', 'new.create': 'Create',
    'set.title': 'Auto-capture & digest',
    'set.desc': 'When on, messages landing in your Hi inbox are auto-distilled into tasks (deduped, LLM-judged type / priority / title). A parallel overlay — it never affects message delivery.',
    'set.enable': 'Enable auto-capture', 'set.channel': 'Digest channel',
    'set.ch.auto': 'Auto (SMS if phone, else email)', 'set.ch.sms': 'SMS', 'set.ch.email': 'Email', 'set.ch.none': 'Off',
    'set.save': 'Save',
    'rules.title': 'Auto-triage rules',
    'rules.desc': 'Match conditions (all AND) → auto-label / set priority / auto-drop / auto-delegate. Applied in order on capture.',
    'rules.new': '+ New rule', 'rules.namePh': 'Rule name (optional)',
    'rules.textLabel': 'Text contains', 'rules.textPh': 'e.g. invoice',
    'rules.typeLabel': 'Type =', 'rules.any': 'Any',
    'rules.prioLabel': 'Set priority', 'rules.prioNone': 'No change',
    'rules.labelLabel': 'Add label', 'rules.labelPh': 'e.g. billing',
    'rules.drop': 'Auto-drop', 'rules.add': 'Add rule',
    'login.title': 'Sign in to Hirey',
    'login.desc': 'Tasks are private to you — sign in to view and manage them. Hi creates your account only after verifying identity: no anonymous identity, no key to paste.',
    'login.google': 'Sign in with Google', 'login.or': 'or',
    'login.email': 'Email', 'login.phone': 'Phone',
    'login.sendCode': 'Send code', 'login.codePh': '6-digit code', 'login.verify': 'Verify & sign in',
    'status.inbox': 'Inbox', 'status.todo': 'To-do', 'status.in_progress': 'In progress', 'status.waiting': 'Waiting', 'status.delegated': 'Delegated', 'status.done': 'Done', 'status.dropped': 'Dropped',
    'chip.assignedToMe': 'Assigned to me', 'chip.delegated': 'Delegated out',
    'role.assignee': 'I’m assignee', 'role.reporter': 'I’m reporter',
    'role.assigneeFull': 'I’m the assignee', 'role.reporterFull': 'I’m the reporter',
    'tl.assignee': 'Assignee', 'tl.owner': 'Reporter', 'tl.system': 'System',
    'tl.assignment': 'delegated', 'tl.progress': 'progress', 'tl.comment': 'comment', 'tl.none': 'No updates yet.',
    'meta.priority': 'Priority', 'card.untitled': '(untitled)',
    'empty.assignedH': 'No tasks assigned to you', 'empty.assignedP': 'When someone delegates a task to you, it shows up here.',
    'empty.zeroH': 'Inbox zero 🎉', 'empty.zeroP': 'No tasks. Create one, or turn on auto-capture to pull inbox messages in.',
    'empty.signinH': 'Sign in to see your tasks', 'empty.signinP': 'Tasks are private to you. Sign in with Google / email / phone.',
    'toast.moved': 'Moved to “{s}”', 'toast.fail': 'Failed: {m}', 'toast.created': 'Created', 'toast.updated': 'Updated', 'toast.delegated': 'Delegated', 'toast.completed': 'Completed', 'toast.dropped': 'Dropped', 'toast.snoozed': 'Snoozed', 'toast.saved': 'Saved',
    'toast.needTitle': 'Enter a title', 'toast.needContent': 'Write something or pick a status', 'toast.needAssignee': 'Enter their agent_id or owner public id', 'toast.codeSent': 'Code sent', 'toast.ruleAdded': 'Rule added', 'toast.ruleNeed': 'Add at least one condition and one action',
    'toast.readFail': 'Read failed: {m}', 'toast.loadFail': 'Load failed: {m}', 'toast.sendFail': 'Send failed: {e}', 'toast.verifyFail': 'Verification failed: {e}', 'toast.startFail': 'Could not start',
    'identity.signedIn': 'Signed in',
    'rules.loading': 'Loading…', 'rules.none': 'No rules yet.', 'rules.del': 'Delete',
    'rules.condContains': 'contains “{t}”', 'rules.condType': 'type={t}', 'rules.condAnd': ' and ', 'rules.condAny': 'Any',
    'rules.doPrio': 'priority→{p}', 'rules.doLabel': 'label+{l}', 'rules.doDrop': 'drop', 'rule.default': 'Rule',
    'lang.other': '中文',
  },
  zh: {
    'doc.title': 'Hirey Tasks — 收件箱归零 / 看板',
    'doc.desc': '把 Hi 收件箱里的消息/会议/匹配自动整理成任务，看板协作：派给别人、实时跟进度。',
    'brand.sub': '收件箱 · 看板',
    'view.mine': '我的', 'view.assigned': '派给我的', 'view.all': '全部',
    'layout.board': '看板', 'layout.list': '列表',
    'btn.rules': '规则', 'btn.settings': '设置', 'btn.new': '+ 新建', 'btn.signin': '登录',
    'td.title': '任务', 'td.progress': '进展 / 活动流',
    'td.notePh': '写条进展…（评论 / 进度备注）',
    'td.status.none': '不改状态', 'td.status.in_progress': '进行中', 'td.status.waiting': '等待', 'td.status.todo': '待办', 'td.status.done': '完成',
    'td.update': '更新',
    'td.delegate': '派给别人',
    'td.delegateDesc': '把这个任务派给另一个用户 —— 填对方的 agent_id 或 owner public id。需与对方有协作关系（同公司或已有 pairing）。',
    'td.assigneePh': '对方 agent_id（ag_…）或 owner public id', 'td.assignNotePh': '派发说明（可选）', 'td.assignBtn': '派发',
    'td.complete': '✓ 完成', 'td.snooze': '稍后一天', 'td.drop': '✕ 丢弃',
    'new.title': '新建任务', 'new.titlePh': '任务标题', 'new.type': '类型', 'new.priority': '优先级', 'new.create': '创建',
    'set.title': '自动捕获与摘要',
    'set.desc': '开启后，落到你 Hi 收件箱的消息会被自动蒸馏成任务（去重、LLM 判类型/优先级/标题）。平行外挂——不影响消息投递。',
    'set.enable': '开启自动捕获', 'set.channel': '摘要渠道',
    'set.ch.auto': '自动（有手机走短信，否则邮件）', 'set.ch.sms': '短信', 'set.ch.email': '邮件', 'set.ch.none': '不推送',
    'set.save': '保存',
    'rules.title': '自动分诊规则',
    'rules.desc': '命中条件（多项 AND）→ 自动打标 / 定优先级 / 自动丢弃 / 自动派发。捕获时按顺序应用。',
    'rules.new': '+ 新建规则', 'rules.namePh': '规则名（可选）',
    'rules.textLabel': '来源含文本', 'rules.textPh': '如 报价单',
    'rules.typeLabel': '类型=', 'rules.any': '任意',
    'rules.prioLabel': '设优先级', 'rules.prioNone': '不变',
    'rules.labelLabel': '加标签', 'rules.labelPh': '如 billing',
    'rules.drop': '自动丢弃', 'rules.add': '添加规则',
    'login.title': '登录 Hirey',
    'login.desc': '任务是你私有的，登录后才能查看与管理。Hi 在验证身份后才创建账号——没有匿名身份、不用粘贴 key。',
    'login.google': '用 Google 登录', 'login.or': '或',
    'login.email': '邮箱', 'login.phone': '手机',
    'login.sendCode': '发送验证码', 'login.codePh': '6 位验证码', 'login.verify': '验证并登录',
    'status.inbox': '新进', 'status.todo': '待办', 'status.in_progress': '进行中', 'status.waiting': '等待', 'status.delegated': '已委托', 'status.done': '已完成', 'status.dropped': '已丢弃',
    'chip.assignedToMe': '派给我', 'chip.delegated': '已派出',
    'role.assignee': '我受理', 'role.reporter': '我发起',
    'role.assigneeFull': '我是受理人', 'role.reporterFull': '我是报告人',
    'tl.assignee': '受理人', 'tl.owner': '报告人', 'tl.system': '系统',
    'tl.assignment': '派发', 'tl.progress': '进度', 'tl.comment': '评论', 'tl.none': '还没有进展。',
    'meta.priority': '优先级', 'card.untitled': '(无标题)',
    'empty.assignedH': '没有派给你的任务', 'empty.assignedP': '别人把任务派给你时，会出现在这里。',
    'empty.zeroH': '收件箱归零 🎉', 'empty.zeroP': '没有任务。新建一个，或开启自动捕获让收件箱消息自动进来。',
    'empty.signinH': '登录查看你的任务', 'empty.signinP': '任务是你私有的。用 Google / 邮箱 / 手机登录即可。',
    'toast.moved': '已移动到「{s}」', 'toast.fail': '失败：{m}', 'toast.created': '已创建', 'toast.updated': '已更新', 'toast.delegated': '已派发', 'toast.completed': '已完成', 'toast.dropped': '已丢弃', 'toast.snoozed': '已推迟', 'toast.saved': '已保存',
    'toast.needTitle': '填个标题', 'toast.needContent': '写点内容或选个状态', 'toast.needAssignee': '填对方 agent_id 或 owner public id', 'toast.codeSent': '验证码已发送', 'toast.ruleAdded': '规则已添加', 'toast.ruleNeed': '至少填一个条件和一个动作',
    'toast.readFail': '读取失败：{m}', 'toast.loadFail': '加载失败：{m}', 'toast.sendFail': '发送失败：{e}', 'toast.verifyFail': '验证失败：{e}', 'toast.startFail': '启动失败',
    'identity.signedIn': '已登录',
    'rules.loading': '加载中…', 'rules.none': '还没有规则。', 'rules.del': '删除',
    'rules.condContains': '含“{t}”', 'rules.condType': '类型={t}', 'rules.condAnd': ' 且 ', 'rules.condAny': '任意',
    'rules.doPrio': '优先级→{p}', 'rules.doLabel': '标签+{l}', 'rules.doDrop': '丢弃', 'rule.default': '规则',
    'lang.other': 'EN',
  },
};
let LANG = 'en';
try { const s = localStorage.getItem('hirey_tasks_lang'); if (s === 'en' || s === 'zh') LANG = s; } catch {}
function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) || (I18N.en[key]) || key;
  if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
function localize(root) {
  (root || document).querySelectorAll('[data-i18n]').forEach((node) => {
    const key = node.getAttribute('data-i18n');
    const attr = node.getAttribute('data-i18n-attr');
    if (attr) node.setAttribute(attr, t(key));
    else node.textContent = t(key);
  });
  document.documentElement.lang = LANG;
  const lb = $('#langBtn'); if (lb) lb.textContent = t('lang.other');
}
function setLang(lang) {
  LANG = lang; try { localStorage.setItem('hirey_tasks_lang', lang); } catch {}
  localize();
  // re-render dynamic content (board/list, empty state, drawer) in the new language
  if (HOSTED && !LOGGED_IN) { $('#empty').innerHTML = `<h2>${t('empty.signinH')}</h2><p class="muted">${t('empty.signinP')}</p>`; }
  else load();
}

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
const el = (tag, c, txt) => { const e = document.createElement(tag); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
const statusLabel = (s) => t('status.' + s) || s;
const BOARD_COLS = ['inbox', 'todo', 'in_progress', 'waiting', 'delegated', 'done'];
const PRIO_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
function toast(m) { const tn = $('#toast'); tn.textContent = m; tn.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { tn.hidden = true; }, 2200); }
function showBanner(m) { const b = $('#banner'); b.textContent = m; b.hidden = !m; }

// ----- card meta (shared by board + list) ------------------------------------
function metaChips(t_, into) {
  into.appendChild(el('span', 'chip type', t_.type || 'general'));
  (t_.labels || []).forEach((l) => into.appendChild(el('span', 'chip label', l)));
  if (t_.assignee_kind === 'user' && t_.assignee_customer_id) {
    into.appendChild(el('span', 'chip assignee', t_.your_role === 'assignee' ? t('chip.assignedToMe') : t('chip.delegated')));
  }
  if (VIEW !== 'mine' && t_.your_role) into.appendChild(el('span', 'chip reporter', t_.your_role === 'assignee' ? t('role.assignee') : t('role.reporter')));
}

// ----- board -----------------------------------------------------------------
function renderBoard(tasks) {
  const board = $('#board'); board.innerHTML = '';
  const byStatus = {}; BOARD_COLS.forEach((s) => (byStatus[s] = []));
  for (const t_ of tasks) (byStatus[t_.status] || (byStatus[t_.status] = [])).push(t_);
  for (const s of BOARD_COLS) {
    const list = (byStatus[s] || []).sort((a, b) => (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2));
    const col = el('div', 'col'); col.dataset.status = s;
    const head = el('div', 'col-head'); head.appendChild(el('span', null, statusLabel(s)));
    head.appendChild(el('span', 'n', String(list.length))); col.appendChild(head);
    const cards = el('div', 'col-cards');
    for (const t_ of list) cards.appendChild(boardCard(t_));
    col.appendChild(cards);
    // drag-drop: drop a card here → update its status
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const task = CACHE.find((x) => x.id === id);
      if (!task || task.status === s) return;
      try { await call('add_progress', { task_id: id, status: s }); toast(t('toast.moved', { s: statusLabel(s) })); load(); }
      catch (err) { if (err.message !== 'login_required') toast(t('toast.fail', { m: err.message })); }
    });
    board.appendChild(col);
  }
}
function boardCard(t_) {
  const c = el('div', 'kcard p-' + (t_.priority || 'normal')); c.draggable = true;
  c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t_.id); c.classList.add('dragging'); });
  c.addEventListener('dragend', () => c.classList.remove('dragging'));
  c.onclick = () => openTask(t_.id);
  c.appendChild(el('p', 'kt', t_.title || t('card.untitled')));
  const m = el('div', 'kmeta'); metaChips(t_, m); c.appendChild(m);
  if (t_.progress_pct != null) { const b = el('div', 'kbar'); const i = el('i'); i.style.width = Math.max(0, Math.min(100, t_.progress_pct)) + '%'; b.appendChild(i); c.appendChild(b); }
  return c;
}

// ----- list (fallback) -------------------------------------------------------
function renderList(tasks) {
  const wrap = $('#list'); wrap.innerHTML = '';
  const groups = BOARD_COLS.concat('dropped');
  for (const g of groups) {
    const inG = tasks.filter((t_) => t_.status === g).sort((a, b) => (PRIO_ORDER[a.priority] ?? 2) - (PRIO_ORDER[b.priority] ?? 2));
    if (!inG.length) continue;
    wrap.appendChild(el('div', 'group-label', statusLabel(g) + ' · ' + inG.length));
    for (const t_ of inG) {
      const card = el('div', 'task'); card.appendChild(el('div', 'pri ' + (t_.priority || 'normal')));
      const main = el('div', 'task-main'); const title = el('p', 'task-title', t_.title || t('card.untitled')); main.appendChild(title);
      const meta = el('div', 'meta'); meta.appendChild(el('span', 'chip status', statusLabel(t_.status))); metaChips(t_, meta);
      if (t_.progress_pct != null) meta.appendChild(el('span', 'chip', t_.progress_pct + '%'));
      main.appendChild(meta); card.appendChild(main); card.onclick = () => openTask(t_.id); wrap.appendChild(card);
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
        ? `<h2>${t('empty.assignedH')}</h2><p class="muted">${t('empty.assignedP')}</p>`
        : `<h2>${t('empty.zeroH')}</h2><p class="muted">${t('empty.zeroP')}</p>`;
      return;
    }
    empty.hidden = true;
    if (LAYOUT === 'board') { board.hidden = false; list.hidden = true; renderBoard(CACHE); }
    else { board.hidden = true; list.hidden = false; renderList(CACHE); }
    if (CURRENT) { const fresh = CACHE.find((x) => x.id === CURRENT); if (fresh) refreshDrawer(fresh); }
  } catch (e) { if (e.message !== 'login_required') showBanner(t('toast.loadFail', { m: e.message })); }
}

// ----- task detail drawer ----------------------------------------------------
async function openTask(id) {
  CURRENT = id;
  const drawer = $('#taskDrawer'); drawer.hidden = false;
  const t_ = CACHE.find((x) => x.id === id);
  if (t_) refreshDrawer(t_);
  try { const r = await call('get', { task_id: id, include_progress: true }); if (r.task) { CURRENT = id; refreshDrawer({ ...r.task, your_role: r.your_role }, r.progress || []); } }
  catch (e) { if (e.message !== 'login_required') toast(t('toast.readFail', { m: e.message })); }
}
function refreshDrawer(t_, progress) {
  $('#tdTitle').textContent = t_.title || t('card.untitled');
  const m = $('#tdMeta'); m.innerHTML = '';
  m.appendChild(el('span', 'chip status', statusLabel(t_.status)));
  m.appendChild(el('span', 'chip type', t_.type || 'general'));
  m.appendChild(el('span', 'chip', t('meta.priority') + ' ' + (t_.priority || 'normal')));
  if (t_.your_role) m.appendChild(el('span', 'chip ' + (t_.your_role === 'assignee' ? 'assignee' : 'reporter'), t_.your_role === 'assignee' ? t('role.assigneeFull') : (t_.your_role === 'owner' ? t('role.reporterFull') : t_.your_role)));
  const pb = $('#tdProgressBar');
  if (t_.progress_pct != null) { pb.hidden = false; $('#tdBarFill').style.width = Math.max(0, Math.min(100, t_.progress_pct)) + '%'; $('#tdBarLabel').textContent = t_.progress_pct + '%'; } else pb.hidden = true;
  if (progress) renderTimeline(progress);
}
function renderTimeline(items) {
  const tl = $('#tdTimeline'); tl.innerHTML = '';
  if (!items.length) { tl.appendChild(el('p', 'muted', t('tl.none'))); return; }
  for (const e of items) {
    const row = el('div', 'tl ' + (e.author_role || '')); row.appendChild(el('div', 'dot'));
    const body = el('div', 'body');
    const head = [e.author_role === 'assignee' ? t('tl.assignee') : (e.author_role === 'owner' ? t('tl.owner') : t('tl.system')),
      e.kind === 'assignment' ? t('tl.assignment') : (e.status_to ? '→' + statusLabel(e.status_to) : (e.kind === 'progress' ? t('tl.progress') : t('tl.comment'))),
      e.progress_pct != null ? e.progress_pct + '%' : ''].filter(Boolean).join(' · ');
    body.appendChild(el('div', 'who', head));
    if (e.note) body.appendChild(el('div', null, e.note));
    row.appendChild(body); tl.appendChild(row);
  }
  tl.scrollTop = tl.scrollHeight;
}
async function act(action, params, okKey) {
  try { await call(action, { task_id: CURRENT, ...params }); if (okKey) toast(t(okKey)); await openTask(CURRENT); load(); }
  catch (e) { if (e.message !== 'login_required') toast(t('toast.fail', { m: e.message })); }
}

// ----- enroll / rules / login ------------------------------------------------
async function openSettings() { $('#settingsDrawer').hidden = false; try { const r = await call('get_enrollment'); const e = r.enrollment; $('#enrollEnabled').checked = !!(e && e.enabled); $('#digestChannel').value = (e && e.digest_channel) || 'auto'; } catch {} }
async function saveEnroll() { try { await call('enroll', { enabled: $('#enrollEnabled').checked, digest_channel: $('#digestChannel').value }); toast(t('toast.saved')); $('#settingsDrawer').hidden = true; load(); } catch (e) { toast(t('toast.fail', { m: e.message })); } }
async function openRules() {
  $('#rulesDrawer').hidden = false; const box = $('#rulesList'); box.innerHTML = `<p class="muted">${t('rules.loading')}</p>`;
  try {
    const r = await call('list_rules'); box.innerHTML = '';
    if (!(r.rules || []).length) { box.innerHTML = `<p class="muted">${t('rules.none')}</p>`; return; }
    for (const rule of r.rules) {
      const row = el('div', 'rule'); const a = rule.action || {}, mm = rule.match || {};
      const cond = [mm.text_contains && t('rules.condContains', { t: mm.text_contains }), mm.type && t('rules.condType', { t: mm.type })].filter(Boolean).join(t('rules.condAnd')) || t('rules.condAny');
      const doer = [a.set_priority && t('rules.doPrio', { p: a.set_priority }), (a.add_labels || []).length && t('rules.doLabel', { l: a.add_labels.join(',') }), a.drop && t('rules.doDrop')].filter(Boolean).join('，');
      const left = el('div'); left.innerHTML = `<b></b><br><span class="muted"></span>`;
      left.querySelector('b').textContent = rule.name || t('rule.default');
      left.querySelector('span').textContent = cond + ' → ' + doer;
      const del = el('button', 'small ghost', t('rules.del')); del.onclick = async () => { await call('delete_rule', { rule_id: rule.id }); openRules(); };
      row.appendChild(left); row.appendChild(del); box.appendChild(row);
    }
  } catch (e) { box.innerHTML = `<p class="muted">${t('toast.loadFail', { m: e.message })}</p>`; }
}
async function addRule() {
  const match = {}, action = {}; const txt = $('#rText').value.trim(); if (txt) match.text_contains = txt; if ($('#rType').value) match.type = $('#rType').value;
  if ($('#rPriority').value) action.set_priority = $('#rPriority').value; const lbl = $('#rLabel').value.trim(); if (lbl) action.add_labels = [lbl]; if ($('#rDrop').checked) action.drop = true;
  if (!Object.keys(match).length || !Object.keys(action).length) { toast(t('toast.ruleNeed')); return; }
  try { await call('add_rule', { name: $('#rName').value.trim() || undefined, match, rule_action: action }); $('#rName').value = $('#rText').value = $('#rLabel').value = ''; $('#rType').value = $('#rPriority').value = ''; $('#rDrop').checked = false; toast(t('toast.ruleAdded')); openRules(); } catch (e) { toast(t('toast.fail', { m: e.message })); }
}
let otpKind = 'email';
function openLogin() { if (HOSTED) $('#loginModal').hidden = false; }
async function loginPost(path, body) { const r = await fetch(api('login/' + path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }
async function googleLogin() { const { j } = await loginPost('google/start', {}); if (!j.authorize_url) { toast(t('toast.startFail')); return; } const pop = window.open(j.authorize_url, 'higoogle', 'width=480,height=640'); const timer = setInterval(async () => { const { j: p } = await loginPost('google/poll', {}); if (p.status === 'verified') { clearInterval(timer); try { pop && pop.close(); } catch {} onLoggedIn(); } }, 1500); }
async function otpStart() { const id = $('#otpId').value.trim(); if (!id) return; const { status, j } = await loginPost(otpKind + '/start', otpKind === 'email' ? { email: id } : { phone: id }); if (status === 200 && j.ok) { $('#otpStep2').hidden = false; toast(t('toast.codeSent')); } else toast(t('toast.sendFail', { e: (j.error || status) })); }
async function otpVerify() { const code = $('#otpCode').value.trim(); const { status, j } = await loginPost(otpKind + '/verify', { code }); if (status === 200 && j.logged_in) onLoggedIn(); else toast(t('toast.verifyFail', { e: (j.error || status) })); }
function onLoggedIn() { LOGGED_IN = true; $('#loginModal').hidden = true; $('#authBtn').hidden = true; $('#identity').hidden = false; $('#identity').textContent = t('identity.signedIn'); load(); }

// ----- boot ------------------------------------------------------------------
function wire() {
  $('#settingsBtn').onclick = openSettings; $('#rulesBtn').onclick = openRules;
  $('#saveEnroll').onclick = saveEnroll; $('#addRule').onclick = addRule;
  $('#authBtn').onclick = openLogin; $('#googleLogin').onclick = googleLogin; $('#otpStart').onclick = otpStart; $('#otpVerify').onclick = otpVerify;
  $('#langBtn').onclick = () => setLang(LANG === 'en' ? 'zh' : 'en');
  $('#newBtn').onclick = () => { $('#newModal').hidden = false; };
  $('#nCreate').onclick = async () => { const title = $('#nTitle').value.trim(); if (!title) return toast(t('toast.needTitle')); try { await call('create', { title, type: $('#nType').value, priority: $('#nPriority').value }); $('#nTitle').value = ''; $('#newModal').hidden = true; toast(t('toast.created')); load(); } catch (e) { toast(t('toast.fail', { m: e.message })); } };
  // view + layout switchers
  document.querySelectorAll('#viewSeg button').forEach((b) => b.onclick = () => { VIEW = b.dataset.view; document.querySelectorAll('#viewSeg button').forEach((x) => x.classList.toggle('active', x === b)); load(); });
  document.querySelectorAll('#layoutSeg button').forEach((b) => b.onclick = () => { LAYOUT = b.dataset.layout; document.querySelectorAll('#layoutSeg button').forEach((x) => x.classList.toggle('active', x === b)); load(); });
  // task drawer actions
  $('#tdAddProgress').onclick = () => { const note = $('#tdNote').value.trim(); const pctRaw = $('#tdPct').value.trim(); const status = $('#tdStatus').value; const params = {}; if (note) params.note = note; if (pctRaw !== '') params.progress_pct = Number(pctRaw); if (status) params.status = status; if (!params.note && params.progress_pct == null && !params.status) return toast(t('toast.needContent')); act('add_progress', params, 'toast.updated').then(() => { $('#tdNote').value = ''; $('#tdPct').value = ''; $('#tdStatus').value = ''; }); };
  $('#tdAssign').onclick = () => { const v = $('#tdAssignee').value.trim(); if (!v) return toast(t('toast.needAssignee')); const params = /^ag_/.test(v) ? { assignee_agent_id: v } : { assignee_owner_public_id: v }; const note = $('#tdAssignNote').value.trim(); if (note) params.note = note; act('assign', params, 'toast.delegated').then(() => { $('#tdAssignee').value = ''; $('#tdAssignNote').value = ''; }); };
  $('#tdComplete').onclick = () => act('complete', {}, 'toast.completed');
  $('#tdDrop').onclick = () => act('drop', {}, 'toast.dropped');
  $('#tdSnooze').onclick = () => act('snooze', { snooze_until: new Date(Date.now() + 864e5).toISOString(), status: 'waiting' }, 'toast.snoozed');
  document.querySelectorAll('[data-close]').forEach((b) => b.onclick = (e) => { const d = e.target.closest('.drawer,.modal'); d.hidden = true; if (d.id === 'taskDrawer') CURRENT = null; });
  document.querySelectorAll('.drawer,.modal').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) { d.hidden = true; if (d.id === 'taskDrawer') CURRENT = null; } }));
  document.querySelectorAll('.otp-tabs .tab').forEach((b) => b.onclick = () => { otpKind = b.dataset.otp; document.querySelectorAll('.otp-tabs .tab').forEach((x) => x.classList.toggle('active', x === b)); $('#otpId').placeholder = otpKind === 'email' ? 'you@example.com' : '+1 555 0100'; $('#otpStep2').hidden = true; });
}
async function boot() {
  localize();
  wire();
  try { const s = await fetch(api('session')).then((r) => r.json()); HOSTED = !!s.hosted; LOGGED_IN = !!s.logged_in; } catch {}
  if (HOSTED && !LOGGED_IN) { $('#authBtn').hidden = false; $('#board').hidden = true; $('#empty').hidden = false; $('#empty').innerHTML = `<h2>${t('empty.signinH')}</h2><p class="muted">${t('empty.signinP')}</p>`; openLogin(); }
  else { if (HOSTED) { $('#identity').hidden = false; $('#identity').textContent = t('identity.signedIn'); } load(); }
}
boot();
