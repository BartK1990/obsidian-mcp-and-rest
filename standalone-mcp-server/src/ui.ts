export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Obsidian Vault MCP Server</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1115;
    --panel: #171a21;
    --border: #2a2e38;
    --text: #e4e6eb;
    --muted: #9aa1ac;
    --accent: #5b8cff;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f5f6f8; --panel: #ffffff; --border: #dde1e7; --text: #1a1d23; --muted: #5a616e; --accent: #3060e0; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 2rem 1rem 4rem;
  }
  main { max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  .sub { color: var(--muted); margin: 0; font-size: .9rem; }
  section {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 1.25rem;
  }
  section h2 { font-size: .95rem; margin: 0 0 1rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
  .vault-name { font-size: 1.4rem; font-weight: 600; margin: 0 0 .5rem; }
  .badge {
    display: inline-block; padding: .15rem .6rem; border-radius: 999px;
    font-size: .8rem; font-weight: 600;
  }
  .badge.gray { background: #6b727e33; color: var(--muted); }
  .badge.blue { background: #5b8cff33; color: var(--accent); }
  .badge.green { background: #2ecc7133; color: #2ecc71; }
  .badge.red { background: #ff5c5c33; color: #ff5c5c; }
  .row { margin-top: .6rem; color: var(--muted); font-size: .9rem; }
  .row.error { color: #ff5c5c; word-break: break-word; }
  label { display: block; font-size: .85rem; color: var(--muted); margin: .9rem 0 .3rem; }
  label:first-of-type { margin-top: 0; }
  input {
    width: 100%; padding: .55rem .7rem; border-radius: 6px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text); font-size: .9rem;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  button {
    margin-top: 1rem; padding: .55rem 1.1rem; border-radius: 6px; border: none;
    background: var(--accent); color: white; font-size: .9rem; font-weight: 600; cursor: pointer;
  }
  button.secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
  button:hover { filter: brightness(1.08); }
  .actions { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
  #config-result, #token-hint { font-size: .85rem; color: var(--muted); margin-top: .6rem; }
  form.inline { display: flex; gap: .5rem; }
  form.inline input { flex: 1; }
  form.inline button { margin-top: 0; }
</style>
</head>
<body>
<main>
  <div>
    <h1>Obsidian Vault MCP Server</h1>
    <p class="sub">Standalone MCP server syncing a vault with a git remote.</p>
  </div>

  <section>
    <h2>Access</h2>
    <form id="token-form" class="inline">
      <input id="token-input" type="password" placeholder="Bearer token (if MCP_BEARER_TOKEN is set)" autocomplete="off">
      <button type="submit">Use token</button>
    </form>
    <p id="token-hint">Stored only in this browser tab's session storage, sent as an Authorization header to the API below.</p>
  </section>

  <section>
    <h2>Vault status</h2>
    <p class="vault-name" id="vault-name">—</p>
    <div id="status-body">Loading…</div>
    <div class="actions">
      <button type="button" class="secondary" id="refresh-btn">Refresh</button>
    </div>
  </section>

  <section>
    <h2>Git repository connection</h2>
    <form id="config-form">
      <label for="repoUrl">Repository URL</label>
      <input id="repoUrl" required placeholder="https://github.com/you/your-vault.git">

      <label for="repoBranch">Branch</label>
      <input id="repoBranch" placeholder="main">

      <label for="gitUsername">Git username</label>
      <input id="gitUsername" placeholder="x-access-token">

      <label for="gitToken">Personal access token</label>
      <input id="gitToken" type="password" autocomplete="off">

      <label for="authorName">Commit author name</label>
      <input id="authorName">

      <label for="authorEmail">Commit author email</label>
      <input id="authorEmail" type="email">

      <button type="submit">Save &amp; connect</button>
      <div id="config-result"></div>
    </form>
  </section>
</main>

<script>
  const $ = (id) => document.getElementById(id);

  function getToken() { try { return sessionStorage.getItem('mcpToken') || ''; } catch { return ''; } }
  function setToken(t) { try { sessionStorage.setItem('mcpToken', t); } catch {} }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers);
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body) headers['Content-Type'] = 'application/json';
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    if (res.status === 401) throw new Error('Unauthorized — set the access token above.');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed: ' + res.status));
    return data;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function badge(state) {
    const map = {
      unconfigured: ['Not configured', 'gray'],
      connecting: ['Connecting…', 'blue'],
      connected: ['Connected', 'green'],
      error: ['Error', 'red'],
    };
    const entry = map[state] || [state, 'gray'];
    return '<span class="badge ' + entry[1] + '">' + entry[0] + '</span>';
  }

  async function refreshStatus() {
    const statusEl = $('status-body');
    statusEl.textContent = 'Loading…';
    try {
      const s = await api('/api/status');
      $('vault-name').textContent = s.vaultName || '(not configured)';
      let html = badge(s.state);
      if (s.git) {
        const pending = s.git.modified.length + s.git.created.length + s.git.deleted.length + s.git.notAdded.length;
        html += '<div class="row">Branch: <b>' + escapeHtml(s.git.branch || '—') + '</b> &middot; ahead ' + s.git.ahead + ' &middot; behind ' + s.git.behind + '</div>';
        html += '<div class="row">Pending changes: ' + pending + '</div>';
      }
      if (s.remoteReachable !== undefined) {
        html += '<div class="row">Remote reachable: ' + (s.remoteReachable ? 'yes' : 'no') + '</div>';
      }
      if (s.lastError) {
        html += '<div class="row error">' + escapeHtml(s.lastError) + '</div>';
      }
      statusEl.innerHTML = html;

      $('repoUrl').value = s.repoUrl || '';
      $('repoBranch').value = s.repoBranch || 'main';
      $('gitUsername').value = s.gitUsername || '';
      $('gitToken').placeholder = s.gitTokenSet ? 'Set — leave blank to keep it' : 'Personal access token';
      $('authorName').value = s.authorName || '';
      $('authorEmail').value = s.authorEmail || '';
    } catch (err) {
      statusEl.innerHTML = '<div class="row error">' + escapeHtml(err.message) + '</div>';
    }
  }

  $('token-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setToken($('token-input').value.trim());
    refreshStatus();
  });

  $('refresh-btn').addEventListener('click', refreshStatus);

  $('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const resultEl = $('config-result');
    resultEl.textContent = 'Saving…';
    const body = {
      repoUrl: $('repoUrl').value.trim(),
      repoBranch: $('repoBranch').value.trim() || 'main',
      gitUsername: $('gitUsername').value.trim() || 'x-access-token',
      gitToken: $('gitToken').value,
      authorName: $('authorName').value.trim(),
      authorEmail: $('authorEmail').value.trim(),
    };
    try {
      await api('/api/config', { method: 'POST', body: JSON.stringify(body) });
      $('gitToken').value = '';
      resultEl.textContent = 'Saved.';
      await refreshStatus();
    } catch (err) {
      resultEl.textContent = 'Error: ' + err.message;
    }
  });

  $('token-input').value = getToken();
  refreshStatus();
</script>
</body>
</html>
`;
