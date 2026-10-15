# Meridian

A modern, dark, glassy desktop browser for developers and business people, with built-in AI companions powered by Claude.

## Download

Get the latest version from **[Releases](https://github.com/nimmagaddaneal-hub/Electron/releases/latest)**:

| Platform | File |
|---|---|
| Mac (Apple silicon: M1, M2, M3, M4) | `Meridian-x.y.z-arm64.dmg` |
| Mac (Intel) | `Meridian-x.y.z-x64.dmg` |
| Windows | `Meridian-Setup-x.y.z.exe` |

**Mac:** open the `.dmg` and drag **Meridian** into **Applications**. Meridian isn't signed with an Apple Developer ID yet, so the first launch is blocked:

1. Open Meridian. When macOS blocks it, click **Done**.
2. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Meridian.
3. Confirm. After that, Meridian opens normally.

**Windows:** run the installer. If SmartScreen appears, click **More info → Run anyway**.

## Set up companions

Open **Settings (⌘,)** and choose how companions connect:

- **API key (default):** pay per use with your own key from console.anthropic.com. The key is encrypted with your OS keychain.
- **Claude plan (personal use):** if you have Claude Code installed, Meridian can run it (`claude -p`) so replies use your own Pro or Max subscription. Click **Sign in with Claude** once. Anthropic's terms allow this only for your own use on your own machine.

**Folder access:** in Settings, choose a folder for companions to read. In plan mode they can search and read files there (Read, Glob and Grep tools only). They can't edit files, run commands, or reach anything outside that folder. The CLI runs with `--restricted --strict-mcp-config`, so your personal Claude Code hooks and plugins are not loaded.

## Features

- **Workspaces**: Dev, Business, and Personal. Each has its own tabs, pinned sites, quick links, and accent color.
- **Vertical tabs** with favicons, loading state, middle-click to close, and ⇧⌘T to reopen.
- **Command palette (⌘K)**: tabs, actions, workspaces, companions, search, or "Ask <companion>: …".
- **Developer tools**: page DevTools (⌥⌘I), responsive viewport presets (full, tablet 820px, mobile 390px), Inspect Element on right-click.
- **Focus mode (⇧⌘F)** and a collapsible sidebar (⌘S).

### AI companions (⌘J)

| Companion | Role | Good for |
|---|---|---|
| Atlas | Engineer | Explaining docs and code, gotchas, code examples |
| Sterling | Strategist | Executive briefs, SWOT, pulling out numbers, next steps |
| Nova | Researcher | Summaries, fact checks, beginner explanations |
| Muse | Writer | Emails, LinkedIn posts, threads, rewrites |

- Companions can **read the current page**. This is on by default; turn it off with the toggle. Pages over 120k characters are trimmed, and the chat shows a note when that happens.
- Each companion keeps its own conversation thread.
- Highlight text, right-click, and choose **Ask Companion about selection**. You can also choose **Summarize page with Companion**.
- In the address bar, type `@sterling what's the pricing here?` or `? explain this`.
- Pick the model in the panel: Opus 5.5 (default), Sonnet 5.5, or Haiku 5.5. Replies stream in, and you can stop them mid-reply.

## Run from source

```bash
npm install
npm start
```

## Build installers

```bash
npm run dist:mac
```

Installers are written to `dist/`. Use `npm run dist:win` for Windows.

**Publish a release:** push a version tag such as `v0.1.0`. The GitHub Action in `.github/workflows/release.yml` then builds the Mac and Windows installers and attaches them to a GitHub Release. Bump `version` in `package.json` before tagging each new release.

## Files

- `src/main.js`: window, menus and shortcuts, guest-page context menu, and Claude streaming through `@anthropic-ai/sdk`
- `src/preload.js`: safe IPC bridge
- `src/renderer/`: UI (`index.html`, `styles.css`, `app.js`), companion definitions (`companions.js`), and the Markdown renderer
