# Meridian

A modern, dark, glassy desktop browser for developers and business people, with built-in AI companions powered by Claude.

## Run

```bash
npm install
npm start
```

Then open **Settings (⌘,)** and choose how companions connect:

- **Claude plan (default, no API key):** Meridian runs your installed Claude Code CLI (`claude -p`), so replies use your Pro or Max subscription and count toward its usage limits. Click **Sign in with Claude** once, which runs `claude auth login` and opens your browser. This works only on your own machine. If you share Meridian with other people, Anthropic's terms require it to use API keys instead.
- **API key:** pay per use through console.anthropic.com. The key is encrypted with the macOS keychain.

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

## Files

- `src/main.js`: window, menus and shortcuts, guest-page context menu, and Claude streaming through `@anthropic-ai/sdk`
- `src/preload.js`: safe IPC bridge
- `src/renderer/`: UI (`index.html`, `styles.css`, `app.js`), companion definitions (`companions.js`), and the Markdown renderer
