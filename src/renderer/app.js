// Meridian — renderer
const $ = (s) => document.querySelector(s);
const NEWTAB = 'meridian://newtab';
const PAGE_CHAR_LIMIT = 120000;
const fav = (url) => { try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; } catch { return ''; } };

const LINKS = {
  dev: [
    ['GitHub', 'https://github.com'], ['MDN', 'https://developer.mozilla.org'], ['Stack Overflow', 'https://stackoverflow.com'],
    ['npm', 'https://www.npmjs.com'], ['Claude Docs', 'https://platform.claude.com/docs'], ['Hacker News', 'https://news.ycombinator.com'],
  ],
  biz: [
    ['LinkedIn', 'https://www.linkedin.com'], ['Gmail', 'https://mail.google.com'], ['Calendar', 'https://calendar.google.com'],
    ['Notion', 'https://www.notion.so'], ['Bloomberg', 'https://www.bloomberg.com'], ['Figma', 'https://www.figma.com'],
  ],
  life: [
    ['YouTube', 'https://www.youtube.com'], ['Wikipedia', 'https://www.wikipedia.org'], ['Reddit', 'https://www.reddit.com'],
    ['Spotify', 'https://open.spotify.com'], ['Medium', 'https://medium.com'], ['Maps', 'https://maps.google.com'],
  ],
};

// ---------------- State ----------------
const state = {
  ws: 'dev',
  workspaces: { dev: { tabs: [], active: null }, biz: { tabs: [], active: null }, life: { tabs: [], active: null } },
  closed: [],
  companion: 'atlas',
  threads: {},
  model: 'claude-opus-5-5',
  hasKey: false,
  provider: 'plan',
  plan: { installed: false, loggedIn: false },
  folder: null,
  sessions: {},
};
let tabSeq = 0;
const companion = () => COMPANIONS.find((c) => c.id === state.companion) || COMPANIONS[0];
const wsState = () => state.workspaces[state.ws];
const activeTab = () => wsState().tabs.find((t) => t.id === wsState().active);

function save() {
  try {
    const out = { ws: state.ws, companion: state.companion, workspaces: {}, threads: {}, sessions: state.sessions };
    for (const [k, w] of Object.entries(state.workspaces)) {
      out.workspaces[k] = { tabs: w.tabs.map((t) => ({ url: t.url, title: t.title, favicon: t.favicon })), active: w.tabs.findIndex((t) => t.id === w.active) };
    }
    for (const [k, msgs] of Object.entries(state.threads)) out.threads[k] = msgs.slice(-40);
    localStorage.setItem('meridian.state', JSON.stringify(out));
  } catch {}
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem('meridian.state') || 'null');
    if (!s) return false;
    state.ws = s.ws || 'dev';
    state.companion = s.companion || 'atlas';
    state.threads = s.threads || {};
    state.sessions = s.sessions || {};
    for (const [k, w] of Object.entries(s.workspaces || {})) {
      if (!state.workspaces[k]) continue;
      const tabs = w.tabs.map((t) => makeTab(t.url, k, t));
      state.workspaces[k].tabs = tabs;
      state.workspaces[k].active = tabs[w.active]?.id ?? tabs[0]?.id ?? null;
    }
    return true;
  } catch { return false; }
}

// ---------------- Tabs ----------------
function makeTab(url, ws, meta = {}) {
  return { id: ++tabSeq, url, ws, title: meta.title || (url === NEWTAB ? 'New Tab' : url), favicon: meta.favicon || '', loading: false, webview: null };
}

function ensureWebview(tab) {
  if (tab.webview || tab.url === NEWTAB) return;
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:meridian');
  wv.setAttribute('allowpopups', '');
  wv.setAttribute('src', tab.url);
  wv.addEventListener('did-start-loading', () => { tab.loading = true; renderTabs(); if (tab === activeTab()) progress('on'); });
  wv.addEventListener('did-stop-loading', () => { tab.loading = false; renderTabs(); if (tab === activeTab()) { progress('done'); syncNav(); } });
  wv.addEventListener('page-title-updated', (e) => { tab.title = e.title; renderTabs(); save(); });
  wv.addEventListener('page-favicon-updated', (e) => { tab.favicon = e.favicons[0] || ''; renderTabs(); save(); });
  const onNav = (e) => { if (!e.isMainFrame && e.isMainFrame !== undefined) return; tab.url = e.url; if (tab === activeTab()) syncUrl(); syncNav(); save(); };
  wv.addEventListener('did-navigate', onNav);
  wv.addEventListener('did-navigate-in-page', onNav);
  wv.addEventListener('did-fail-load', (e) => { if (e.errorCode !== -3 && e.isMainFrame) toast(`Couldn’t load page (${e.errorDescription})`); });
  $('#webviews').appendChild(wv);
  tab.webview = wv;
}

function openTab(url = NEWTAB, { activate = true, ws = state.ws } = {}) {
  const tab = makeTab(url, ws);
  state.workspaces[ws].tabs.push(tab);
  if (activate) activate_(tab.id);
  else renderTabs();
  save();
  return tab;
}

function activate_(id) {
  wsState().active = id;
  const tab = activeTab();
  if (tab) ensureWebview(tab);
  document.querySelectorAll('webview').forEach((w) => w.classList.toggle('active', !!tab && w === tab.webview));
  $('#newtab').classList.toggle('show', !tab || tab.url === NEWTAB);
  renderTabs(); syncUrl(); syncNav();
  if (tab?.url === NEWTAB) setTimeout(() => $('#ntInput').focus(), 30);
  save();
}

function closeTab(id = wsState().active) {
  const w = wsState();
  const idx = w.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const [tab] = w.tabs.splice(idx, 1);
  if (tab.url !== NEWTAB) state.closed.push({ url: tab.url, ws: tab.ws });
  tab.webview?.remove();
  if (w.active === id) {
    const next = w.tabs[idx] || w.tabs[idx - 1];
    if (next) activate_(next.id); else { w.active = null; openTab(); }
  } else renderTabs();
  save();
}

function navigate(input, tab = activeTab()) {
  const raw = input.trim();
  if (!raw) return;
  const ask = raw.match(/^@(\w+)\s*(.*)$/) || raw.match(/^(\?)\s*(.+)$/);
  if (ask) {
    const c = COMPANIONS.find((x) => x.id === ask[1].toLowerCase() || x.name.toLowerCase() === ask[1].toLowerCase());
    if (c) setCompanion(c.id);
    openAI(true);
    if (ask[2]) sendPrompt(ask[2]);
    return;
  }
  let url;
  if (/^[a-z]+:\/\//i.test(raw) || /^about:/.test(raw)) url = raw;
  else if (/^localhost(:\d+)?(\/|$)/.test(raw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?/.test(raw)) url = 'http://' + raw;
  else if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(raw)) url = 'https://' + raw;
  else url = 'https://www.google.com/search?q=' + encodeURIComponent(raw);

  if (!tab) tab = openTab(url);
  if (tab.webview) tab.webview.loadURL(url);
  else { tab.url = url; ensureWebview(tab); activate_(tab.id); }
  tab.url = url;
  $('#urlInput').blur();
  save();
}

function switchWorkspace(ws) {
  state.ws = ws;
  document.body.dataset.ws = ws;
  document.querySelectorAll('#wsSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.ws === ws));
  if (!wsState().tabs.length) openTab();
  else activate_(wsState().active ?? wsState().tabs[0].id);
  renderPinned(); renderNewtab(); tickClock();
  save();
}

// ---------------- Rendering ----------------
function favEl(tab) {
  const src = tab.favicon || (tab.url !== NEWTAB ? fav(tab.url) : '');
  return src ? `<img src="${escAttr(src)}">` : (tab.url === NEWTAB ? '✦' : (tab.title || '?')[0].toUpperCase());
}
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function renderTabs() {
  const w = wsState();
  $('#tabCount').textContent = w.tabs.length;
  $('#tabs').innerHTML = w.tabs.map((t) => `
    <div class="tab ${t.id === w.active ? 'active' : ''} ${t.loading ? 'loading' : ''}" data-id="${t.id}" title="${escAttr(t.url)}">
      <span class="fav">${favEl(t)}</span>
      <span class="title">${escHtml(t.title || t.url)}</span>
      <button class="close" data-close="${t.id}"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
    </div>`).join('');
  const cur = activeTab();
  document.querySelectorAll('.pin').forEach((p) => p.classList.toggle('active', !!cur && sameHost(cur.url, p.dataset.url)));
}
function sameHost(a, b) { try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; } }

function renderPinned() {
  $('#pinned').innerHTML = LINKS[state.ws].slice(0, 4).map(([n, u]) => `<button class="pin" data-url="${u}" title="${n}"><img src="${fav(u)}"></button>`).join('');
}

function renderNewtab() {
  $('#ntLinks').innerHTML = LINKS[state.ws].map(([n, u]) => `<button class="nt-link" data-url="${u}"><span class="ic"><img src="${fav(u)}"></span><span>${n}</span></button>`).join('');
  $('#ntCompanions').innerHTML = COMPANIONS.map((c) => `
    <button class="nt-comp" data-comp="${c.id}">
      <span class="orb" style="--c1:${c.colors[0]};--c2:${c.colors[1]}"></span>
      <span><b>${c.name}</b><br><small>${c.role} · ${c.tagline}</small></span>
    </button>`).join('');
}

function tickClock() {
  const d = new Date();
  $('#ntTime').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, '');
  const h = d.getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const wsLabel = { dev: 'Ready to ship.', biz: 'Let’s make moves.', life: 'Take it easy.' }[state.ws];
  $('#ntGreet').textContent = `${part}. ${wsLabel}`;
}

function syncUrl() {
  const tab = activeTab();
  const input = $('#urlInput');
  if (document.activeElement !== input) input.value = !tab || tab.url === NEWTAB ? '' : tab.url;
  $('#lockIcon').classList.toggle('secure', !!tab && tab.url.startsWith('https://'));
}
function syncNav() {
  const wv = activeTab()?.webview;
  let back = false, fwd = false;
  try { back = !!wv && wv.canGoBack(); fwd = !!wv && wv.canGoForward(); } catch {}
  $('#backBtn').disabled = !back; $('#fwdBtn').disabled = !fwd;
}
function progress(mode) {
  const p = $('#urlProgress');
  p.className = 'url-progress';
  void p.offsetWidth;
  p.classList.add(mode);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------- Companions ----------------
function orbStyle(c) { return `--c1:${c.colors[0]};--c2:${c.colors[1]}`; }

function setCompanion(id) {
  state.companion = id;
  const c = companion();
  for (const el of [$('#chipOrb'), $('#toggleOrb')]) el.setAttribute('style', orbStyle(c));
  $('#chipName').textContent = c.name; $('#chipRole').textContent = c.role;
  $('#roster').innerHTML = COMPANIONS.map((x) => `<button class="roster-btn ${x.id === id ? 'on' : ''}" data-comp="${x.id}" title="${x.name} · ${x.role}"><span class="orb" style="${orbStyle(x)}"></span></button>`).join('');
  $('#aiIdentity').innerHTML = `<span class="orb large" id="idOrb" style="${orbStyle(c)}"></span><div><h3>${c.name}</h3><p>${c.role} · ${c.tagline}</p></div>`;
  $('#quick').innerHTML = c.quick.map((q, i) => `<button class="chip" data-quick="${i}">${q.label}</button>`).join('');
  $('#prompt').placeholder = `Message ${c.name}…`;
  renderThread();
  save();
}

function thread() { return (state.threads[state.companion] ||= []); }

function renderThread() {
  const c = companion();
  const msgs = thread();
  const el = $('#thread');
  if (!msgs.length) {
    el.innerHTML = `<div class="ai-empty"><span class="orb large" style="${orbStyle(c)}"></span><h4>Hi, I’m ${c.name}.</h4><div>${c.tagline}<br>I can read the page you’re on. Ask me anything.</div></div>`;
    return;
  }
  el.innerHTML = msgs.map((m) => m.role === 'user'
    ? `<div class="msg user"><div class="bubble">${escHtml(m.display)}${m.ctx ? `<span class="ctx-tag">↳ ${escHtml(m.ctx)}</span>` : ''}</div></div>`
    : `<div class="msg ai"><span class="orb" style="${orbStyle(c)}"></span><div class="body ${m.error ? 'err' : ''}">${m.error ? escHtml(m.content) : renderMarkdown(m.content)}</div></div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function openAI(open = !document.body.classList.contains('ai-open')) {
  document.body.classList.toggle('ai-open', open);
  if (open) setTimeout(() => $('#prompt').focus(), 200);
}

async function getPageContext() {
  const tab = activeTab();
  if (!tab?.webview || tab.url === NEWTAB) return null;
  try {
    const data = await tab.webview.executeJavaScript(`(() => ({ title: document.title, url: location.href, text: (document.body && document.body.innerText) || '', selection: String(window.getSelection() || '') }))()`);
    const trimmed = data.text.length > PAGE_CHAR_LIMIT;
    return { ...data, text: data.text.slice(0, PAGE_CHAR_LIMIT), trimmed };
  } catch { return null; }
}

let streaming = null;

async function sendPrompt(text) {
  text = text.trim();
  if (!text || streaming) return;
  if (!aiReady()) {
    openSettings();
    toast(state.provider === 'plan' ? 'Sign in with your Claude plan to wake up the companions.' : 'Add your Anthropic API key to wake up the companions.');
    return;
  }
  const c = companion();
  const usePage = $('#ctxPage').checked;
  const page = usePage ? await getPageContext() : null;

  const userMsg = { role: 'user', display: text, text, page: page ? { url: page.url, title: page.title } : null };
  if (page) userMsg.ctx = `${page.title || page.url}${page.trimmed ? ' (long page — first 120k chars)' : ''}`;
  thread().push(userMsg);
  const aiMsg = { role: 'assistant', content: '' };
  thread().push(aiMsg);
  renderThread();

  // Build API messages: only the newest user turn carries full page text.
  const msgs = thread().slice(0, -1);
  const apiMessages = msgs.map((m, i) => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content || '(no reply)' };
    const isLast = i === msgs.length - 1;
    if (isLast && page) {
      const sel = page.selection ? `\n<selection>\n${page.selection}\n</selection>\n` : '';
      return { role: 'user', content: `<page title="${page.title.replace(/"/g, "'")}" url="${page.url}">\n${page.text}\n</page>${sel}\n\n${m.text}` };
    }
    return { role: 'user', content: m.page ? `[I was viewing: ${m.page.title} — ${m.page.url}]\n${m.text}` : m.text };
  });

  const id = 'r' + Date.now();
  const bodyEl = $('#thread').lastElementChild.querySelector('.body');
  const orbEl = $('#thread').lastElementChild.querySelector('.orb');
  bodyEl.classList.add('cursor'); orbEl.classList.add('thinking'); $('#idOrb')?.classList.add('thinking');
  streaming = { id, aiMsg, bodyEl, orbEl, companion: c.id };
  setSendMode(true);

  if (state.provider === 'plan') {
    // Claude Code keeps the conversation; resume it and send only the new turn.
    const sessionId = state.sessions[c.id] || null;
    let prompt = apiMessages[apiMessages.length - 1].content;
    if (!sessionId && apiMessages.length > 1) {
      const history = apiMessages.slice(0, -1).map((m) => `${m.role === 'user' ? 'User' : c.name}: ${m.content}`).join('\n\n');
      prompt = `<earlier_conversation>\n${history}\n</earlier_conversation>\n\n${prompt}`;
    }
    window.meridian.ai.planChat({ id, model: state.model, system: c.system, prompt, sessionId, folderAccess: !!state.folder })
      .catch((err) => finishStream({ type: 'error', message: err.message }));
    return;
  }
  window.meridian.ai.chat({ id, model: state.model, system: c.system, messages: apiMessages, effort: c.effort })
    .catch((err) => finishStream({ type: 'error', message: err.message.includes('NO_KEY') ? 'No API key set. Open Settings (⌘,).' : err.message }));
}

let renderQueued = false;
window.meridian.ai.onEvent((ev) => {
  if (!streaming || ev.id !== streaming.id) return;
  if (ev.type === 'delta') {
    streaming.aiMsg.content += ev.text;
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(() => {
        renderQueued = false;
        if (!streaming) return;
        streaming.bodyEl.innerHTML = renderMarkdown(streaming.aiMsg.content);
        const t = $('#thread'); if (t.scrollHeight - t.scrollTop - t.clientHeight < 140) t.scrollTop = t.scrollHeight;
      });
    }
  } else if (ev.type === 'tool') {
    const label = { Read: 'Reading a file', Glob: 'Looking through your folder', Grep: 'Searching your files' }[ev.name] || `Using ${ev.name}`;
    if (!streaming.aiMsg.content) streaming.bodyEl.innerHTML = `<p class="tool-note">${label}…</p>`;
  } else if (ev.type === 'refusal') {
    streaming.aiMsg.content += `\n\n_${companion().name} can’t help with that request._`;
  } else if (ev.type === 'done' || ev.type === 'error') finishStream(ev);
});

function finishStream(ev) {
  if (!streaming) return;
  const s = streaming; streaming = null;
  const msgs = state.threads[s.companion];
  if (ev.sessionId) state.sessions[s.companion] = ev.sessionId;
  if (ev.type === 'error') {
    // Drop the failed exchange from history so roles stay valid; show error inline.
    msgs.splice(msgs.length - 2, 2);
    msgs.push({ role: 'assistant', content: ev.message, error: true, ephemeral: true });
  } else if (!s.aiMsg.content) {
    s.aiMsg.content = ev.stop === 'aborted' ? '_Stopped._' : '_(empty reply)_';
  }
  setSendMode(false);
  if (state.companion === s.companion) renderThread();
  // Ephemeral errors are display-only.
  state.threads[s.companion] = msgs.filter((m, i) => !(m.ephemeral && i < msgs.length - 1));
  $('#idOrb')?.classList.remove('thinking');
  save();
}

function setSendMode(isStreaming) {
  const b = $('#sendBtn');
  b.classList.toggle('stop', isStreaming);
  b.innerHTML = isStreaming ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  b.title = isStreaming ? 'Stop' : 'Send (↵)';
}

function cleanThreadForSend() {
  // Remove display-only error bubbles before a new send.
  state.threads[state.companion] = thread().filter((m) => !m.ephemeral);
}

// ---------------- Command palette ----------------
let pItems = [], pSel = 0;
function paletteCommands(q) {
  const ql = q.toLowerCase();
  const match = (s) => !ql || s.toLowerCase().includes(ql);
  const cmds = [
    ['Actions', '+', 'New tab', '⌘T', () => openTab()],
    ['Actions', '×', 'Close tab', '⌘W', () => closeTab()],
    ['Actions', '↺', 'Reopen closed tab', '⇧⌘T', () => reopen()],
    ['Actions', '✦', 'Summarize this page', '', () => quickAsk(0)],
    ['Actions', '◐', 'Toggle companions panel', '⌘J', () => openAI()],
    ['Actions', '▢', 'Toggle focus mode', '⇧⌘F', () => document.body.classList.toggle('focus-mode')],
    ['Actions', '▤', 'Toggle sidebar', '⌘S', () => document.body.classList.toggle('no-sidebar')],
    ['Developer', '</>', 'Open page DevTools', '⌥⌘I', () => devtools()],
    ['Developer', '▯', 'Viewport: mobile (390px)', '', () => setViewport('mobile')],
    ['Developer', '▭', 'Viewport: tablet (820px)', '', () => setViewport('tablet')],
    ['Developer', '▬', 'Viewport: full width', '', () => setViewport('full')],
    ['Developer', '⧉', 'Copy page URL', '', () => { navigator.clipboard.writeText(activeTab()?.url || ''); toast('URL copied'); }],
    ['Workspaces', '●', 'Switch to Dev', '', () => switchWorkspace('dev')],
    ['Workspaces', '●', 'Switch to Business', '', () => switchWorkspace('biz')],
    ['Workspaces', '●', 'Switch to Personal', '', () => switchWorkspace('life')],
    ['Settings', '⚙', 'Settings & API key', '⌘,', () => openSettings()],
  ].filter((c) => match(c[2])).map(([group, icon, label, hint, run]) => ({ group, icon, label, hint, run }));

  const comps = COMPANIONS.filter((c) => match(c.name) || match(c.role) || match('ask ' + c.name)).map((c) => ({
    group: 'Companions', icon: `<span class="orb" style="${orbStyle(c)}"></span>`, label: `Talk to ${c.name} — ${c.role}`, hint: '', run: () => { setCompanion(c.id); openAI(true); },
  }));
  const tabs = Object.values(state.workspaces).flatMap((w) => w.tabs).filter((t) => t.url !== NEWTAB && (match(t.title) || match(t.url))).map((t) => ({
    group: 'Open tabs', icon: `<img src="${escAttr(t.favicon || fav(t.url))}">`, label: t.title, hint: t.ws, run: () => { if (t.ws !== state.ws) switchWorkspace(t.ws); activate_(t.id); },
  }));
  const extra = q ? [
    { group: 'Go', icon: '⌕', label: `Search or open “${q}”`, hint: '↵', run: () => navigate(q) },
    { group: 'Go', icon: `<span class="orb" style="${orbStyle(companion())}"></span>`, label: `Ask ${companion().name}: “${q}”`, hint: '', run: () => { openAI(true); sendPrompt(q); } },
  ] : [];
  return [...extra, ...comps, ...cmds, ...tabs];
}
function renderPalette() {
  const q = $('#paletteInput').value;
  pItems = paletteCommands(q);
  pSel = Math.min(pSel, Math.max(0, pItems.length - 1));
  let last = '';
  $('#paletteList').innerHTML = pItems.map((it, i) => {
    const head = it.group !== last ? `<div class="p-group">${it.group}</div>` : '';
    last = it.group;
    return `${head}<div class="p-item ${i === pSel ? 'sel' : ''}" data-i="${i}"><span class="p-ic">${it.icon}</span><span class="p-label">${escHtml(it.label)}</span><span class="p-hint">${it.hint}</span></div>`;
  }).join('');
  $('#paletteList .sel')?.scrollIntoView({ block: 'nearest' });
}
function openPalette() { $('#palette').hidden = false; $('#paletteInput').value = ''; pSel = 0; renderPalette(); $('#paletteInput').focus(); }
function closePalette() { $('#palette').hidden = true; }
function runPalette(i) { const it = pItems[i]; closePalette(); it?.run(); }

// ---------------- Misc actions ----------------
function reopen() { const c = state.closed.pop(); if (c) { if (c.ws !== state.ws) switchWorkspace(c.ws); openTab(c.url); } }
function devtools() { const wv = activeTab()?.webview; if (wv) wv.isDevToolsOpened() ? wv.closeDevTools() : wv.openDevTools(); else toast('Open a page first'); }
function setViewport(vp) {
  $('#viewport').className = 'vp-' + vp;
  document.querySelectorAll('#viewportSeg button').forEach((b) => b.classList.toggle('on', b.dataset.vp === vp));
}
function zoom(delta) {
  const wv = activeTab()?.webview; if (!wv) return;
  const z = delta === 0 ? 0 : wv.getZoomLevel() + delta;
  wv.setZoomLevel(z); toast(`Zoom ${Math.round(Math.pow(1.2, z) * 100)}%`);
}
function quickAsk(i) {
  const q = companion().quick[i];
  openAI(true);
  if (q.prompt.endsWith('\n\n')) { $('#prompt').value = q.prompt; autosize(); $('#prompt').focus(); }
  else { cleanThreadForSend(); sendPrompt(q.prompt); }
}

function aiReady() { return state.provider === 'plan' ? state.plan.loggedIn : state.hasKey; }

async function refreshSettings() {
  const st = await window.meridian.settings.get();
  Object.assign(state, { hasKey: st.hasKey, model: st.model, provider: st.provider, plan: st.plan, folder: st.folder });
  $('#modelSel').value = st.model;
  return st;
}

function renderSettings(st) {
  const plan = state.provider === 'plan';
  document.querySelectorAll('#providerSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === state.provider));
  $('#planSection').hidden = !plan; $('#apiSection').hidden = plan;
  $('#keySave').hidden = plan; $('#keyClear').hidden = plan || !st.hasKey;

  const p = state.plan;
  const dot = $('#planDot');
  dot.className = 'plan-dot ' + (p.loggedIn ? 'ok' : p.installed ? 'warn' : '');
  $('#planTitle').textContent = !p.installed ? 'Claude Code not found' : p.loggedIn ? `Connected to your Claude${p.plan ? ' ' + p.plan[0].toUpperCase() + p.plan.slice(1) : ''} plan` : 'Not signed in';
  $('#planSub').textContent = !p.installed ? 'Install Claude Code (claude.com/code), then reopen Settings.' : p.loggedIn ? 'Companions use your subscription. Usage counts toward your plan limits.' : 'Sign in once in your browser. No API key needed.';
  $('#planLogin').hidden = !p.installed || p.loggedIn;

  $('#folderPath').textContent = state.folder || 'None — companions only see web pages';
  $('#folderClear').hidden = !state.folder;

  const ks = $('#keyStatus');
  ks.className = 'key-status' + (st.hasKey ? ' ok' : '');
  ks.textContent = st.hasKey ? (st.keyFromEnv ? '✓ Using ANTHROPIC_API_KEY from environment' : '✓ Key saved and encrypted') : 'No key yet.';
}

async function openSettings() {
  $('#settings').hidden = false;
  $('#keyInput').value = '';
  renderSettings(await refreshSettings());
}

function autosize() { const t = $('#prompt'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }

// ---------------- Events ----------------
$('#tabs').addEventListener('click', (e) => {
  const close = e.target.closest('[data-close]');
  if (close) { e.stopPropagation(); closeTab(+close.dataset.close); return; }
  const t = e.target.closest('.tab'); if (t) activate_(+t.dataset.id);
});
$('#tabs').addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (t && e.button === 1) closeTab(+t.dataset.id); });
$('#newTabBtn').onclick = () => openTab();
$('#pinned').addEventListener('click', (e) => { const p = e.target.closest('.pin'); if (p) { const t = activeTab(); t && t.url === NEWTAB ? navigate(p.dataset.url) : openTab(p.dataset.url); } });
$('#wsSwitch').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchWorkspace(b.dataset.ws); });
$('#backBtn').onclick = () => activeTab()?.webview?.goBack();
$('#fwdBtn').onclick = () => activeTab()?.webview?.goForward();
$('#reloadBtn').onclick = () => activeTab()?.webview?.reload();
$('#devtoolsBtn').onclick = devtools;
$('#paletteBtn').onclick = openPalette;
$('#aiToggle').onclick = () => openAI();
$('#aiClose').onclick = () => openAI(false);
$('#companionChip').onclick = () => openAI(true);
$('#settingsBtn').onclick = openSettings;
$('#urlAiBtn').onclick = () => quickAsk(0);
$('#viewportSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setViewport(b.dataset.vp); });

const urlInput = $('#urlInput');
urlInput.addEventListener('focus', () => setTimeout(() => urlInput.select(), 0));
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') navigate(urlInput.value);
  if (e.key === 'Escape') { syncUrl(); urlInput.blur(); }
});
urlInput.addEventListener('blur', syncUrl);

$('#ntSearch').addEventListener('submit', (e) => { e.preventDefault(); navigate($('#ntInput').value); $('#ntInput').value = ''; });
$('#ntLinks').addEventListener('click', (e) => { const l = e.target.closest('[data-url]'); if (l) navigate(l.dataset.url); });
$('#ntCompanions').addEventListener('click', (e) => { const c = e.target.closest('[data-comp]'); if (c) { setCompanion(c.dataset.comp); openAI(true); } });
$('#roster').addEventListener('click', (e) => { const c = e.target.closest('[data-comp]'); if (c) setCompanion(c.dataset.comp); });
$('#quick').addEventListener('click', (e) => { const q = e.target.closest('[data-quick]'); if (q) quickAsk(+q.dataset.quick); });

$('#compose').addEventListener('submit', (e) => {
  e.preventDefault();
  if (streaming) { window.meridian.ai.abort(streaming.id); return; }
  const t = $('#prompt'); const v = t.value; t.value = ''; autosize();
  cleanThreadForSend(); sendPrompt(v);
});
$('#prompt').addEventListener('input', autosize);
$('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#compose').requestSubmit(); } });
$('#clearChat').onclick = () => { if (streaming) return; state.threads[state.companion] = []; delete state.sessions[state.companion]; renderThread(); save(); };
$('#modelSel').onchange = (e) => { state.model = e.target.value; window.meridian.settings.setModel(state.model); toast(`Companions now on ${e.target.selectedOptions[0].text}`); };
$('#thread').addEventListener('click', (e) => {
  const copy = e.target.closest('.copy');
  if (copy) { navigator.clipboard.writeText(copy.nextElementSibling.textContent); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); return; }
  const a = e.target.closest('a[data-link]');
  if (a) { e.preventDefault(); openTab(a.dataset.link); }
});

$('#paletteInput').addEventListener('input', () => { pSel = 0; renderPalette(); });
$('#paletteInput').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); pSel = Math.min(pSel + 1, pItems.length - 1); renderPalette(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); pSel = Math.max(pSel - 1, 0); renderPalette(); }
  if (e.key === 'Enter') runPalette(pSel);
});
$('#paletteList').addEventListener('click', (e) => { const it = e.target.closest('.p-item'); if (it) runPalette(+it.dataset.i); });
$('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });

$('#settingsClose').onclick = () => ($('#settings').hidden = true);
$('#settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') $('#settings').hidden = true; });
$('#keySave').onclick = async () => {
  const k = $('#keyInput').value.trim();
  if (!k) { $('#settings').hidden = true; return; }
  if (!k.startsWith('sk-ant-')) { $('#keyStatus').className = 'key-status'; $('#keyStatus').textContent = 'That doesn’t look like an Anthropic key (sk-ant-…).'; return; }
  try { await window.meridian.settings.setKey(k); await refreshSettings(); $('#settings').hidden = true; toast('Companions are awake ✦'); }
  catch (err) { $('#keyStatus').textContent = err.message; }
};
$('#keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#keySave').click(); });
$('#keyClear').onclick = async () => { await window.meridian.settings.setKey(''); await refreshSettings(); openSettings(); };
$('#providerSeg').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  await window.meridian.settings.setProvider(b.dataset.p);
  renderSettings(await refreshSettings());
});
$('#planLogin').onclick = async () => {
  const btn = $('#planLogin');
  btn.disabled = true; btn.textContent = 'Finish in your browser…';
  const r = await window.meridian.settings.planLogin();
  btn.disabled = false; btn.textContent = 'Sign in with Claude';
  renderSettings(await refreshSettings());
  toast(r.ok ? 'Connected to your Claude plan ✦' : 'Sign-in didn’t finish. Try again.');
};
$('#folderPick').onclick = async () => {
  const f = await window.meridian.settings.pickFolder();
  if (f) { state.sessions = {}; renderSettings(await refreshSettings()); toast('Companions can now read that folder'); }
};
$('#folderClear').onclick = async () => { await window.meridian.settings.clearFolder(); state.sessions = {}; renderSettings(await refreshSettings()); };

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePalette(); $('#settings').hidden = true; }
});

// Commands from the app menu / guest context menus
window.meridian.onCommand((c) => {
  const tab = activeTab();
  switch (c.type) {
    case 'new-tab': openTab(); break;
    case 'close-tab': closeTab(); break;
    case 'reopen-tab': reopen(); break;
    case 'focus-url': urlInput.focus(); break;
    case 'palette': $('#palette').hidden ? openPalette() : closePalette(); break;
    case 'toggle-ai': openAI(); break;
    case 'toggle-sidebar': document.body.classList.toggle('no-sidebar'); break;
    case 'focus-mode': document.body.classList.toggle('focus-mode'); break;
    case 'reload': tab?.webview?.reload(); break;
    case 'back': tab?.webview?.goBack(); break;
    case 'forward': tab?.webview?.goForward(); break;
    case 'zoom-in': zoom(0.5); break;
    case 'zoom-out': zoom(-0.5); break;
    case 'zoom-reset': zoom(0); break;
    case 'devtools': devtools(); break;
    case 'settings': openSettings(); break;
    case 'open-tab': openTab(c.url); break;
    case 'goto-tab': { const t = wsState().tabs[c.n === 9 ? wsState().tabs.length - 1 : c.n - 1]; if (t) activate_(t.id); break; }
    case 'summarize': quickAsk(0); break;
    case 'ask-selection': openAI(true); $('#prompt').value = `About this:\n“${c.text.slice(0, 2000)}”\n\n`; autosize(); $('#prompt').focus(); break;
  }
});

// Broken favicons: hide quietly (inline onerror is blocked by CSP)
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

// ---------------- Boot ----------------
(async function boot() {
  const restored = load();
  document.body.dataset.ws = state.ws;
  document.querySelectorAll('#wsSwitch button').forEach((b) => b.classList.toggle('on', b.dataset.ws === state.ws));
  setCompanion(state.companion);
  renderPinned(); renderNewtab(); tickClock(); setInterval(tickClock, 15000);
  if (!restored || !wsState().tabs.length) openTab();
  else activate_(wsState().active);
  await refreshSettings();
  if (!aiReady()) setTimeout(() => toast(state.provider === 'plan' ? 'Tip: sign in with your Claude plan in Settings (⌘,) to enable companions' : 'Tip: add your Anthropic API key in Settings (⌘,)'), 1200);
})();
