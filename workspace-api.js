export function createWorkspaceApi(config) {
  const sessionKey = 'ydyx-session:' + config.url;
  let session;
  let pendingRefresh;
  try {
    session = JSON.parse(localStorage.getItem(sessionKey));
  } catch {
    session = null;
  }

  function saveSession(value) {
    session = value;
    try {
      if (value) localStorage.setItem(sessionKey, JSON.stringify(value));
      else localStorage.removeItem(sessionKey);
    } catch {
      // The current tab can still stay signed in when browser storage is disabled.
    }
  }

  async function request(path, { method = 'GET', token, body, headers = {}, file = false } = {}) {
    const requestHeaders = { ...headers, apikey: config.publicKey };
    if (token) requestHeaders.Authorization = 'Bearer ' + token;
    let response;
    try {
      response = await fetch(config.url + path, {
        method, headers: requestHeaders, body, cache: 'no-store',
      });
    } catch {
      throw new Error('暂时无法连接协作服务。请检查网络后重试。');
    }
    if (!response.ok) {
      const error = new Error('协作服务未完成本次操作，请稍后重试。');
      error.status = response.status;
      const details = await response.json().catch(() => ({}));
      error.code = details.code || details.error_code;
      if (response.status === 403) error.message = '当前账号没有此项操作的权限。';
      if (response.status === 413) error.message = '文件超过协作空间的大小限制。';
      throw error;
    }
    if (file) return response.blob();
    const payload = await response.text();
    return payload ? JSON.parse(payload) : null;
  }

  function json(value) {
    return { body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } };
  }

  function refresh() {
    if (pendingRefresh) return pendingRefresh;
    const previous = session;
    pendingRefresh = request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', ...json({ refresh_token: previous.refresh_token }),
    }).then(next => {
      if (session === previous) saveSession(next);
    }).catch(error => {
      if (session === previous && [400, 401, 403].includes(error.status)) saveSession(null);
      throw error;
    }).finally(() => {
      pendingRefresh = null;
    });
    return pendingRefresh;
  }

  async function authenticated(path, options) {
    if (session && (session.expires_at <= Date.now() / 1000 + 60)) await refresh();
    if (!session) throw new Error('请登录后操作。');
    try {
      return await request(path, { ...options, token: session.access_token });
    } catch (error) {
      if (error.status !== 401 || !session) throw error;
      await refresh();
      if (!session) throw new Error('登录已失效，请重新登录。');
      return request(path, { ...options, token: session.access_token });
    }
  }

  const rest = '/rest/v1/';
  const bucket = '/storage/v1/object/';
  const objectPath = path => path.split('/').map(encodeURIComponent).join('/');

  async function readAll(query) {
    const rows = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await authenticated(rest + query + '&limit=' + pageSize + '&offset=' + offset);
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  return {
    hasSession: () => Boolean(session?.access_token),
    async signIn(email, password) {
      try {
        saveSession(await request('/auth/v1/token?grant_type=password', {
          method: 'POST', ...json({ email, password }),
        }));
      } catch (error) {
        if ([400, 401].includes(error.status)) error.message = '登录失败，请检查邮箱和密码，并确认账号已开通。';
        throw error;
      }
    },
    async signOut() {
      try {
        if (session) await authenticated('/auth/v1/logout?scope=local', { method: 'POST' });
      } finally {
        saveSession(null);
      }
    },
    changePassword: password => authenticated('/auth/v1/user', { method: 'PUT', ...json({ password }) }),
    async profile() {
      const profiles = await authenticated(rest + 'handbook_members?select=id,display_name&id=eq.' + session.user.id);
      return profiles[0] ?? null;
    },
    async load() {
      const [records, files, messages] = await Promise.all([
        readAll('handbook_records?select=*&order=created_at.asc,id.asc'),
        readAll('handbook_files?select=id,record_id,object_path,filename,size,created_at&order=created_at.desc,id.desc'),
        readAll('handbook_messages?select=id,parent_id,content,created_at,handbook_members(display_name)&order=created_at.desc,id.desc'),
      ]);
      return { records, files, messages };
    },
    async saveRecord(kind, payload, record) {
      const path = rest + 'handbook_records' + (record ? '?id=eq.' + record.id + '&version=eq.' + record.version : '');
      const options = json(record ? { payload } : { kind, payload });
      options.headers.Prefer = 'return=representation';
      const rows = await authenticated(path, { ...options, method: record ? 'PATCH' : 'POST' });
      if (!rows.length) throw new Error('这条记录已被其他队员更新。请关闭表单、刷新后再修改。');
    },
    addMessage: (content, parentId) => authenticated(rest + 'handbook_messages', {
      method: 'POST', ...json({ content, parent_id: parentId }),
    }),
    async upload(recordId, file) {
      const path = session.user.id + '/' + recordId + '/' + crypto.randomUUID();
      await authenticated(bucket + 'handbook-files/' + objectPath(path), {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      try {
        await authenticated(rest + 'handbook_files', {
          method: 'POST',
          ...json({ record_id: recordId, object_path: path, filename: file.name, size: file.size }),
        });
      } catch (error) {
        await authenticated(bucket + 'handbook-files', {
          method: 'DELETE', ...json({ prefixes: [path] }),
        }).catch(() => {});
        throw error;
      }
    },
    download: path => authenticated(bucket + 'authenticated/handbook-files/' + objectPath(path), { file: true }),
  };
}
