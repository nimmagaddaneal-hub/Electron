// Meridian — main process
const { app, BrowserWindow, ipcMain, Menu, safeStorage, shell, nativeTheme, clipboard, dialog } = require('electron');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk').default;

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let win;
const activeStreams = new Map();

// ---------- Settings (API key encrypted with OS keychain via safeStorage) ----------
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch { return {}; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2));
}
function getApiKey() {
  const s = readSettings();
  if (s.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(s.apiKeyEnc, 'base64')); } catch {}
  }
  return process.env.ANTHROPIC_API_KEY || null;
}

ipcMain.handle('settings:get', async () => {
  const s = readSettings();
  return {
    hasKey: !!getApiKey(),
    keyFromEnv: !s.apiKeyEnc && !!process.env.ANTHROPIC_API_KEY,
    model: s.model || 'claude-opus-5-5',
    provider: s.provider || 'plan',
    folder: s.folder || null,
    plan: await planStatus(),
  };
});
ipcMain.handle('settings:setProvider', (_e, provider) => { const s = readSettings(); s.provider = provider; writeSettings(s); return true; });
ipcMain.handle('settings:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Let companions read this folder', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const s = readSettings(); s.folder = r.filePaths[0]; writeSettings(s);
  return s.folder;
});
ipcMain.handle('settings:clearFolder', () => { const s = readSettings(); delete s.folder; writeSettings(s); return true; });

// ---------- Claude plan provider: drives the user's own Claude Code CLI ----------
// Uses whatever the user signed in to Claude Code with (Pro/Max plan), so no API key is needed.
let claudeBin;
function findClaude() {
  if (claudeBin !== undefined) return claudeBin;
  const home = os.homedir();
  const candidates = [path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  claudeBin = candidates.find((p) => fs.existsSync(p)) || null;
  if (!claudeBin) {
    try { claudeBin = execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() || null; } catch { claudeBin = null; }
  }
  return claudeBin;
}
function planEnv() {
  // Strip API-key variables so the CLI uses the signed-in subscription.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  env.PATH = `${path.dirname(findClaude() || '/usr/bin')}:${env.PATH || '/usr/bin:/bin'}`;
  return env;
}
function planStatus() {
  const bin = findClaude();
  if (!bin) return Promise.resolve({ installed: false, loggedIn: false });
  return new Promise((resolve) => {
    execFile(bin, ['auth', 'status', '--json'], { env: planEnv(), timeout: 15000 }, (_err, stdout) => {
      try {
        const j = JSON.parse(stdout);
        resolve({ installed: true, loggedIn: !!j.loggedIn, method: j.authMethod, plan: j.subscriptionType || null });
      } catch { resolve({ installed: true, loggedIn: false }); }
    });
  });
}
ipcMain.handle('plan:login', () => new Promise((resolve) => {
  const bin = findClaude();
  if (!bin) return resolve({ ok: false, message: 'Claude Code is not installed.' });
  // Opens the browser for the official Claude sign-in; the user approves there.
  const child = spawn(bin, ['auth', 'login'], { env: planEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; const m = String(d).match(/https:\/\/\S+/); if (m) shell.openExternal(m[0]); });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', async () => { const st = await planStatus(); resolve({ ok: st.loggedIn, message: st.loggedIn ? '' : out.slice(-300) }); });
}));

function companionCwd() {
  const s = readSettings();
  if (s.folder && fs.existsSync(s.folder)) return s.folder;
  const empty = path.join(app.getPath('userData'), 'companion-sandbox');
  fs.mkdirSync(empty, { recursive: true });
  return empty;
}

function planChat(event, { id, model, system, prompt, sessionId, folderAccess }) {
  const bin = findClaude();
  const send = (type, payload) => { if (!event.sender.isDestroyed()) event.sender.send('ai:event', { id, type, ...payload }); };
  if (!bin) { send('error', { message: 'Claude Code is not installed. Install it from claude.com/code, or switch to API key in Settings.' }); return; }

  const cwd = companionCwd();
  const hasFolder = folderAccess && cwd !== path.join(app.getPath('userData'), 'companion-sandbox');
  const sys = system + (hasFolder
    ? `\n\nYou can read files in the user's folder ${cwd} with the Read, Glob and Grep tools. Use them when the question is about the user's files or projects. You cannot modify anything.`
    : '');
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', planModelAlias(model), '--system-prompt', sys, '--restricted', '--strict-mcp-config',
    '--tools', ...(hasFolder ? ['Read', 'Glob', 'Grep'] : ['']), '--max-turns', '12'];
  if (sessionId) args.push('--resume', sessionId);

  const child = spawn(bin, args, { cwd, env: planEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  activeStreams.set(id, { abort: () => child.kill('SIGTERM') });
  child.stdin.end(prompt);

  let buf = '', gotDelta = false, finished = false, stderr = '', newSession = sessionId || null;
  const finish = (type, payload) => { if (finished) return; finished = true; activeStreams.delete(id); send(type, payload); };
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.session_id) newSession = m.session_id;
      if (m.type === 'stream_event') {
        const ev = m.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { gotDelta = true; send('delta', { text: ev.delta.text }); }
        if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use') send('tool', { name: ev.content_block.name });
        if (ev?.type === 'message_start' && gotDelta) send('delta', { text: '\n\n' });
      } else if (m.type === 'assistant' && !gotDelta && m.message?.model !== '<synthetic>') {
        const text = (m.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        if (text) send('delta', { text });
      } else if (m.type === 'result') {
        if (m.is_error) finish('error', { message: humanizePlanError(m.result || m.subtype) });
        else finish('done', { stop: m.subtype, sessionId: newSession });
      }
    }
  });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code, signal) => {
    if (signal) return finish('done', { stop: 'aborted', sessionId: newSession });
    if (code !== 0) return finish('error', { message: humanizePlanError(stderr || `Claude Code exited with code ${code}`) });
    finish('done', { stop: 'end_turn', sessionId: newSession });
  });
}
// The CLI resolves aliases to the newest model your plan can use.
function planModelAlias(model) {
  return model.includes('haiku') ? 'haiku' : model.includes('sonnet') ? 'sonnet' : 'opus';
}
function humanizePlanError(msg) {
  const s = String(msg);
  if (/log ?in|auth|unauthori[sz]ed|401/i.test(s)) return 'Not signed in to your Claude plan. Open Settings (⌘,) and click "Sign in with Claude".';
  if (/usage limit|rate limit|429/i.test(s)) return 'You hit your Claude plan usage limit. It resets soon — or switch to an API key in Settings.';
  return s.trim().slice(0, 400);
}
ipcMain.handle('settings:setKey', (_e, key) => {
  const s = readSettings();
  if (!key) { delete s.apiKeyEnc; writeSettings(s); return true; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable; set ANTHROPIC_API_KEY instead.');
  s.apiKeyEnc = safeStorage.encryptString(key.trim()).toString('base64');
  writeSettings(s);
  return true;
});
ipcMain.handle('settings:setModel', (_e, model) => {
  const s = readSettings(); s.model = model; writeSettings(s); return true;
});

// ---------- AI companions: streaming chat through Claude ----------
ipcMain.handle('ai:chat', async (event, { id, model, system, messages, effort }) => {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_KEY');
  const client = new Anthropic({ apiKey });
  const send = (type, payload) => { if (!event.sender.isDestroyed()) event.sender.send('ai:event', { id, type, ...payload }); };

  const params = {
    model,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort: effort || 'medium' },
  };
  // Server-side refusal fallback (not available for Haiku)
  if (!model.startsWith('claude-haiku')) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  try {
    const stream = client.beta.messages.stream(params);
    activeStreams.set(id, stream);
    stream.on('text', (text) => send('delta', { text }));
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') send('refusal', { detail: final.stop_details?.explanation || '' });
    send('done', { stop: final.stop_reason, usage: final.usage });
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) send('done', { stop: 'aborted' });
    else if (err instanceof Anthropic.AuthenticationError) send('error', { message: 'Invalid API key. Update it in Settings.' });
    else if (err instanceof Anthropic.RateLimitError) send('error', { message: 'Rate limited. Try again in a moment.' });
    else if (err instanceof Anthropic.APIConnectionError) send('error', { message: 'Network error reaching Claude.' });
    else send('error', { message: err.message || String(err) });
  } finally {
    activeStreams.delete(id);
  }
});
ipcMain.handle('ai:planChat', (event, req) => { planChat(event, req); });
ipcMain.handle('ai:abort', (_e, id) => { activeStreams.get(id)?.abort(); });

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

// ---------- Window ----------
function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Dev aid: MERIDIAN_SCREENSHOT=out.png captures the window after load, then quits.
  if (process.env.MERIDIAN_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.MERIDIAN_JS) await win.webContents.executeJavaScript(process.env.MERIDIAN_JS).catch((err) => console.log('js error', err));
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.MERIDIAN_SCREENSHOT, img.toPNG());
        app.quit();
      }, 2500);
    }, 1500));
  }
}

// Guest pages (webviews): popups become tabs, custom context menu
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    win?.webContents.send('cmd', { type: 'open-tab', url });
    return { action: 'deny' };
  });
  contents.on('context-menu', (_ev, p) => {
    const items = [];
    if (p.selectionText) {
      items.push({ label: 'Ask Companion about selection', click: () => win.webContents.send('cmd', { type: 'ask-selection', text: p.selectionText }) });
      items.push({ label: 'Copy', role: 'copy' });
      items.push({ type: 'separator' });
    }
    if (p.linkURL) {
      items.push({ label: 'Open link in new tab', click: () => win.webContents.send('cmd', { type: 'open-tab', url: p.linkURL }) });
      items.push({ label: 'Copy link', click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
    items.push({ label: 'Back', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    items.push({ label: 'Reload', click: () => contents.reload() });
    items.push({ label: 'Summarize page with Companion', click: () => win.webContents.send('cmd', { type: 'summarize' }) });
    items.push({ type: 'separator' });
    items.push({ label: 'Inspect Element', click: () => contents.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup();
  });
});

function sendCmd(type) { return () => win?.webContents.send('cmd', { type }); }

function buildMenu() {
  const template = [
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: sendCmd('settings') }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: sendCmd('new-tab') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: sendCmd('close-tab') },
      { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T', click: sendCmd('reopen-tab') },
      { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: sendCmd('focus-url') },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: sendCmd('palette') },
      { label: 'Toggle Companions', accelerator: 'CmdOrCtrl+J', click: sendCmd('toggle-ai') },
      { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+S', click: sendCmd('toggle-sidebar') },
      { label: 'Toggle Focus Mode', accelerator: 'CmdOrCtrl+Shift+F', click: sendCmd('focus-mode') },
      { type: 'separator' },
      { label: 'Reload Page', accelerator: 'CmdOrCtrl+R', click: sendCmd('reload') },
      { label: 'Back', accelerator: 'CmdOrCtrl+[', click: sendCmd('back') },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: sendCmd('forward') },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: sendCmd('zoom-in') },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: sendCmd('zoom-out') },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: sendCmd('zoom-reset') },
      { type: 'separator' },
      { label: 'Page DevTools', accelerator: 'CmdOrCtrl+Alt+I', click: sendCmd('devtools') },
      { label: 'Browser DevTools', accelerator: 'CmdOrCtrl+Alt+Shift+I', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
      { role: 'togglefullscreen' },
    ] },
    { label: 'Tabs', submenu: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, click: () => win?.webContents.send('cmd', { type: 'goto-tab', n }) })) },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
