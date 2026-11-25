import { createWorkspaceApi } from './workspace-api.js?v=access-code';

const config = window.HANDBOOK_CONFIG;
const api = config?.url && config.publicKey
  ? createWorkspaceApi({ ...config, url: config.url.replace(/\/+$/, '') })
  : null;
const $ = id => document.getElementById(id);
const status = $('connectionStatus');
const dialog = $('workspaceDialog');
const blank = () => ({ records: [], files: [], messages: [] });
let workspace = blank();
let member;
let refresh;
let edit;
let replyTo = null;
let toastTimer;

const progress = ['未开始', '进行中', '待反馈', '已完成'];
const outputs = {
  report: ['6.1', '意大利、西班牙乡村产业链整体调研报告'],
  station: ['6.2', '乡村振兴工作站点位专项方案手册'],
  europe: ['6.3', '面向欧洲公众的乡村振兴成果展示与传播'],
};
const names = { route: '行程', point: '点位', task: '任务', output: '成果' };
const field = (key, label, type = 'text', options) => ({ key, label, type, options });
const forms = {
  route: [field('date', '日期'), field('location', '城市 / 地区'), field('activity', '拟开展活动'), field('group', '负责小组'), field('status', '确认状态', 'select', ['待确定', '联系中', '已确定']), field('next', '下一步')],
  point: [field('name', '点位名称'), field('location', '地点'), field('direction', '对应研究方向'), field('description', '详细介绍', 'textarea'), field('contact', '联系方式'), field('outreach', '当前外联进展', 'textarea'), field('confirmed', '外联完毕并确认', 'checkbox')],
  task: [field('task', '当前任务', 'textarea'), field('status', '完成进度', 'select', progress)],
  output: [field('name', '成果名称'), field('location', '点位 / 展示地点'), field('description', '主要内容', 'textarea'), field('group', '负责小组及负责人'), field('status', '推进状态', 'select', ['未开始', '资料收集', '制作中', '待交接', '已完成']), field('date', '计划完成时间'), field('handoff', '交接或合作对象'), field('handoffDate', '交接时间'), field('link', '文件位置或发布链接'), field('implementation', '实施 / 发布情况', 'textarea'), field('followup', '回访或反馈记录（时间、对象、成效）', 'textarea')],
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 4200);
}

function visibility() {
  const signedIn = Boolean(member);
  document.querySelectorAll('[data-members-only]').forEach(el => { el.hidden = !signedIn; });
  document.querySelectorAll('[data-public-preview]').forEach(el => { el.hidden = signedIn; });
  $('boardNav').hidden = !signedIn;
  $('loginButton').hidden = signedIn || !api;
  $('logoutButton').hidden = !signedIn;
  $('messageSignature').hidden = !signedIn || !api.isCodeSession();
  $('refreshButton').hidden = !signedIn;
  if (!signedIn) status.textContent = api
    ? '公开手册可直接浏览。队员输入支队的访问码后可参与协作。'
    : '当前可在线阅读手册。队内登录和协作待开通。';
}

function readableTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}

function filesFor(record) {
  const files = workspace.files.filter(file => file.record_id === record.id);
  return '<div class="record-files">' + (files.length
    ? '<ul>' + files.map(file =>
      '<li><button class="text-button" type="button" data-file="' + esc(file.id) + '">下载 · ' + esc(file.filename) + '</button> <small>' +
      esc(readableTime(file.created_at)) + '</small></li>').join('') + '</ul>'
    : '<p class="upload-name">暂无附件</p>') +
    '<label class="button ghost file-button">上传附件<input type="file" data-upload="' + esc(record.id) + '" multiple></label></div>';
}

function editButton(record, label = '编辑') {
  return '<button class="text-button" type="button" data-edit="' + esc(record.id) + '">' + esc(label) + '</button>';
}

function render() {
  const expanded = new Set([...document.querySelectorAll('details[data-panel][open]')].map(el => el.dataset.panel));
  const ofKind = kind => workspace.records.filter(record => record.kind === kind);
  $('scheduleRows').innerHTML = ofKind('route').sort((a, b) =>
    (a.payload.order ?? Infinity) - (b.payload.order ?? Infinity)
  ).map(record => {
    const p = record.payload;
    return '<tr>' + [p.date, p.location, p.activity, p.group, p.status].map(value => '<td>' + esc(value || '待确定') + '</td>').join('') +
      '<td>' + esc(p.next || '待补充') + '<br>' + editButton(record) + '</td></tr>';
  }).join('');
  $('pointGrid').innerHTML = ofKind('point').map(record => {
    const p = record.payload;
    return '<article class="point-card"><div class="point-top"><h3>' + esc(p.name) + '</h3><span class="status">' +
      (p.confirmed ? '已确定' : '待确定') + '</span></div><div class="point-meta"><div><span>地点</span><b>' + esc(p.location || '待确定') +
      '</b></div><div><span>联系方式</span><b>' + esc(p.contact || '待补充') +
      '</b></div><div><span>对应研究方向</span><b>' + esc(p.direction || '待补充') +
      '</b></div></div><p class="point-desc">' + esc(p.description || '待补充') +
      '</p><details data-panel="' + esc(record.id) + '"><summary>外联进展与调研材料</summary><p class="point-desc">' + esc(p.outreach || '待补充') +
      '</p>' + filesFor(record) + '</details>' + editButton(record, '更新点位或外联状态') + '</article>';
  }).join('');
  $('teamRows').innerHTML = ofKind('task').sort((a, b) => a.payload.order - b.payload.order).map(record => {
    const p = record.payload;
    return '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.role) + '<br>' + esc(p.group) + '</td><td class="preserve">' + esc(p.task || '待分配') +
      '<br>' + editButton(record, '更新任务') + '</td><td><details data-panel="' + esc(record.id) + '"><summary>' + esc(p.status || '未开始') +
      '</summary><label>任务进度<select aria-label="' + esc(p.name) + '的任务进度" data-progress="' + esc(record.id) + '">' +
      choices(progress, p.status) + '</select></label></details></td><td>' + filesFor(record) + '</td></tr>';
  }).join('');
  $('outputGrid').innerHTML = Object.entries(outputs).map(([group, [number, title]]) => {
    const cards = ofKind('output').filter(record => record.payload.category === group).map(record => {
      const p = record.payload;
      const info = forms.output.filter(f => f.key !== 'name' && p[f.key]).map(f =>
        '<dt>' + esc(f.label) + '</dt><dd>' + esc(p[f.key]) + '</dd>').join('');
      return '<div class="output-record"><h4>' + esc(p.name) + '</h4><dl>' + info + '</dl>' + editButton(record) + filesFor(record) + '</div>';
    }).join('');
    return '<article class="output-card"><div class="output-index">' + number + '</div><div><h3>' + title +
      '</h3>' + (cards || '<p class="output-desc">暂无成果记录。</p>') +
      '<button class="button ghost chapter-action" data-add="output" data-category="' + group + '" type="button">新增成果</button></div></article>';
  }).join('');
  renderMessages();
  document.querySelectorAll('details[data-panel]').forEach(el => { el.open = expanded.has(el.dataset.panel); });
}

function renderMessages() {
  const messages = workspace.messages;
  const ids = new Set(messages.map(m => m.id));
  const displayName = message => message.signed_name || message.handbook_members?.display_name || '队员';
  const renderMessage = (message, isReply = false) =>
    '<article class="message' + (isReply ? ' reply' : '') + '"><div class="message-head"><b>' +
    esc(displayName(message)) + '</b><span>' + esc(readableTime(message.created_at)) +
    '</span></div><p>' + esc(message.content) + '</p>' +
    (isReply ? '' : '<button class="text-button" type="button" data-reply="' + esc(message.id) + '">回复</button>') + '</article>';
  $('messages').innerHTML = messages.filter(m => !ids.has(m.parent_id)).map(message =>
    renderMessage(message) + messages.filter(reply => reply.parent_id === message.id).reverse().map(m => renderMessage(m, true)).join('')
  ).join('') || '<div class="empty-message">暂无留言。</div>';
}

function sync({ automatic = false, again = false } = {}) {
  if (!member) return Promise.resolve();
  if (refresh) return again ? refresh.then(() => sync()) : refresh;
  const current = member;
  refresh = api.load().then(data => {
    if (member !== current) return;
    workspace = data;
    // Avoid replacing the upload or dropdown that a member is interacting with.
    if (!automatic || (!dialog.open && !document.activeElement?.matches('[data-upload], [data-progress]'))) render();
    status.textContent = current.display_name + ' · 已连接 · ' + readableTime(Date.now());
  }).catch(error => {
    if (member !== current) return;
    if (!api.hasSession() || error.code === '42501' || error.status === 403) {
      clearWorkspace();
      status.textContent = '访问已失效，请重新输入访问码。';
    } else {
      status.textContent = current.display_name + ' · 同步失败，可手动刷新重试。';
    }
    if (!automatic) toast(error.message);
  }).finally(() => { refresh = null; });
  return refresh;
}

function clearWorkspace() {
  member = null;
  workspace = blank();
  render();
  visibility();
  if (dialog.open) dialog.close();
  resetReply();
  $('boardForm').reset();
}

async function connect() {
  const profile = await api.profile();
  if (!profile) {
    throw new Error('访问已失效，请重新输入访问码。');
  }
  member = profile;
  visibility();
  await sync();
}

function choices(options, selected) {
  return options.map(value => '<option' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>').join('');
}

function renderField(f, value, required = false) {
  const input = f.type === 'textarea' ? '<textarea name="' + f.key + '" rows="3" maxlength="5000">' + esc(value) + '</textarea>'
    : f.type === 'select' ? '<select name="' + f.key + '">' + choices(f.options, value) + '</select>'
    : '<input name="' + f.key + '" type="' + f.type + '"' +
       (f.type === 'checkbox' ? (value ? ' checked' : '') : ' maxlength="500" value="' + esc(value) + '"') +
       (required ? ' required' : '') +
       (f.type === 'password' ? ' autocomplete="current-password" autocapitalize="none" spellcheck="false"' : '') + '>';
  return '<label' + (f.type === 'checkbox' ? ' class="checkbox-field">' + input + esc(f.label) : '>' + esc(f.label) + input) + '</label>';
}

function openEditor(kind, record, category) {
  edit = { kind, record, category };
  const signingIn = kind === 'login';
  $('dialogTitle').textContent = signingIn ? '输入访问码'
    : (record ? '更新' : '新增') + names[kind];
  $('dialogSubmit').textContent = signingIn ? '进入协作' : '保存';
  const fields = signingIn ? [field('code', '支队访问码', 'password')] : forms[kind];
  $('dialogFields').innerHTML = fields.map(f => renderField(f, record?.payload[f.key], signingIn || f.key === 'name' ||
    (kind === 'route' && f.key === 'location'))).join('');
  $('dialogError').textContent = '';
  dialog.showModal();
}

function resetReply() {
  replyTo = null;
  $('replyHeading').hidden = true;
  $('cancelReply').hidden = true;
}

async function run(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

$('workspaceForm').addEventListener('submit', async event => {
  event.preventDefault();
  const active = edit;
  const data = new FormData(event.currentTarget);
  const button = $('dialogSubmit');
  button.disabled = true;
  $('cancelDialog').disabled = true;
  $('closeDialog').disabled = true;
  $('dialogError').textContent = '';
  try {
    const { kind, record, category } = active;
    if (kind === 'login') {
      await api.unlock(data.get('code'));
      await connect();
    } else {
      const payload = { ...record?.payload };
      if (category) payload.category = category;
      for (const f of forms[kind]) payload[f.key] = f.type === 'checkbox' ? data.has(f.key) : data.get(f.key).trim();
      if ((kind === 'point' || kind === 'output') && !payload.name) throw new Error('请填写名称。');
      if (kind === 'route' && !payload.location) throw new Error('请填写城市或地区。');
      await api.saveRecord(kind, payload, record);
      toast('已保存到队内协作空间。');
      await sync({ again: true });
    }
    dialog.close();
  } catch (error) {
    $('dialogError').textContent = error.message;
    visibility();
  } finally {
    button.disabled = false;
    $('cancelDialog').disabled = false;
    $('closeDialog').disabled = false;
  }
});

for (const id of ['closeDialog', 'cancelDialog']) $(id).addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if ($('dialogSubmit').disabled) event.preventDefault(); });
dialog.addEventListener('close', () => { $('dialogFields').replaceChildren(); });
$('loginButton').addEventListener('click', () => openEditor('login'));
$('refreshButton').addEventListener('click', () => sync());
$('logoutButton').addEventListener('click', event => run(event.currentTarget, async () => {
  try { await api.signOut(); } finally { clearWorkspace(); }
}));
$('cancelReply').addEventListener('click', resetReply);

document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!member || !target) return;
  const { add, edit: id, file, reply } = target.dataset;
  if (add) openEditor(add, undefined, target.dataset.category);
  if (id) {
    const record = workspace.records.find(r => r.id === id);
    if (record) openEditor(record.kind, record);
  }
  if (file) run(target, async () => {
    const attachment = workspace.files.find(f => f.id === file);
    if (!attachment) return;
    const bytes = await api.download(attachment.object_path);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = attachment.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  if (reply) {
    const message = workspace.messages.find(m => m.id === reply);
    if (!message) return;
    replyTo = reply;
    $('replyHeading').textContent = '回复 ' + (message.signed_name || message.handbook_members?.display_name || '队员');
    $('replyHeading').hidden = false;
    $('cancelReply').hidden = false;
    $('boardForm').elements.content.focus();
  }
});

document.addEventListener('change', event => {
  const control = event.target;
  if (!member) return;
  if (control.dataset.progress) run(control, async () => {
    const record = workspace.records.find(r => r.id === control.dataset.progress);
    if (!record) return;
    try {
      await api.saveRecord('task', { ...record.payload, status: control.value }, record);
      toast('已更新任务进度。');
    } finally {
      await sync({ again: true });
    }
  });
  if (control.dataset.upload && control.files.length) run(control, async () => {
    const files = [...control.files];
    const failures = [];
    for (const file of files) {
      if (file.size === 0 || file.size > 20 * 1024 * 1024) {
        failures.push(file.name + '（大小需在 0–20 MB 之间）');
        continue;
      }
      try { await api.upload(control.dataset.upload, file); }
      catch { failures.push(file.name); }
    }
    control.value = '';
    await sync({ again: true });
    toast(failures.length ? '未上传：' + failures.join('、') : '附件已上传，全队可下载。');
  });
});

$('boardForm').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const content = form.elements.content.value.trim();
  if (!member || !content) return;
  const parent = replyTo;
  run(form.querySelector('button[type=submit]'), async () => {
    const signature = form.elements.signature.value.trim();
    await api.addMessage(content, parent, signature);
    form.elements.content.value = '';
    resetReply();
    toast('留言已发布。');
    await sync({ again: true });
  });
});

visibility();
if (api?.hasSession()) connect().catch(error => { visibility(); status.textContent = error.message; });
setInterval(() => { if (!document.hidden) sync({ automatic: true }); }, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync({ automatic: true }); });

