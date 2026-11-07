<div align="center">

[中文](./README.md) · [English](./README_EN.md)

<br />

<img src="./logo.png" width="92" alt="Flota" />

# Flota

**A local-first personal workspace and agent that grows with you.**

Bring notes, todos, canvases, and an AI agent under one roof.<br />
Capture fleeting thoughts, let Flota learn your preferences over time, and turn scattered ideas into your next step.

<p>
  <a href="https://github.com/Xperiamol/Flota/releases"><img src="https://img.shields.io/github/v/release/Xperiamol/Flota?style=flat-square&label=Release&color=1976D2" alt="GitHub Release" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-2E3440?style=flat-square" alt="Windows | macOS | Linux" />
  <img src="https://img.shields.io/badge/Data-Local--First%20SQLite-0F766E?style=flat-square" alt="Local-First SQLite" />
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Xperiamol/Flota?style=flat-square&color=555555" alt="License" /></a>
</p>

<p>
  <a href="https://github.com/Xperiamol/Flota/releases"><strong>Download Desktop App</strong></a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="./CHANGELOG.md">Changelog</a>
  ·
  <a href="./PRIVACY.md#english">Privacy</a>
  ·
  <a href="./docs/history/README.md#english">Nostalgia Edition</a>
</p>

</div>

<br />

![Flota note editor with a checklist and linked notes](./docs/images/notes-light-en.png)

## Why Flota?

In most tools, capturing ideas and acting on them live in separate worlds: thoughts stay buried in notes, tasks pile up in a todo app, and every AI chat starts from a blank slate.

Flota connects the dots in one local-first desktop app:

- **Remembers how you work**: Stop repeating your background in every prompt. Your writing style, preferred output format, and ongoing projects can be saved as manageable long-term memories.
- **Works directly with your notes**: Instead of copy-pasting back and forth, let the agent search your notes, read full texts, extract todos, or update a canvas—always showing a confirmation card before writing changes.
- **From checklist to action**: Turn any checklist item in a note into a tracked todo with two-way sync. Connect ideas effortlessly through wiki links, tags, and an interactive knowledge graph.
- **Shapes itself around your workflow**: Need a custom tracker? Describe it in plain language and let AI generate an interactive, data-persisting widget for your home page or notes.

---

## Core Experience

### 1. Long-Term Memory, Under Your Control

Most AI assistants forget everything the moment you close the chat. With Flota, you can tell it how you like to write, whether you prefer conclusions first, and what you are working on long-term.

- **Learn naturally, recall when relevant**: With automatic memory enabled, Flota picks up lasting preferences and context from daily conversations—or you can simply say *"Remember this."* In future chats, it pulls in only the memories relevant to your topic.
- **Transparent, editable, and reversible**: Every memory stays on your machine. You can search, edit, or delete memories in Settings at any time, or undo a newly saved memory right from the chat thread.

![Flota memory settings with sample preferences and editable memories](./docs/images/memory-personal-zh.png)

### 2. An Agent That Acts on Your Workspace

Flota's agent works alongside your local notes, todos, and canvases. Whenever an action creates or modifies content, Flota presents a **confirmation card** first so you stay in the driver's seat.

Here are a few ways you can talk to it:

> *"Remember: I prefer a one-sentence conclusion first, followed by at most three action items."*
>
> *"Find this week's release notes, read them in full, and turn the unfinished items into todos for my review."*
>
> *"Turn this rollout plan into a flowchart—keep the existing nodes on the canvas and only fill in the missing steps."*

![Flota personal agent with custom prompt shortcuts and a request ready to send](./docs/images/ai-agent-en.png)

### 3. Need a Custom Dashboard? Ask AI to Build One

No two workflows are identical. Instead of settling for rigid templates, tell AI what you want to track and let it build an interactive widget that stores its own data:

> *"Build me a reading tracker with book titles, progress, and a one-line takeaway. On the home page, show how many days I read this week and add a one-click check-in button."*

Pick from several design directions, then keep chatting to tweak the layout, colors, or behavior. Pin your widget to the home page, embed it inside a note, or pop it out as a floating desktop window—and create multiple instances to track different projects separately.

---

## Everyday Writing & Organization

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>📝 Rich Editing & Canvases</h4>
      <ul>
        <li><strong>WYSIWYG + Markdown</strong>: Switch seamlessly between rich live editing and raw Markdown source mode.</li>
        <li><strong>Expressive Syntax</strong>: Wiki links <code>[[Note]]</code>, tags, KaTeX math formulas, code blocks, and callouts.</li>
        <li><strong>Excalidraw Canvases</strong>: Sketch diagrams and flowcharts right next to your notes; AI can also incrementally update existing drawings without breaking your layout.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h4>✅ Connected Notes & Todos</h4>
      <ul>
        <li><strong>Two-Way Linked Tasks</strong>: Promote any note checklist item to a todo in one click. Checking off or renaming syncs both ways; deleting the line in the note only unlinks it.</li>
        <li><strong>Embedded Todo Lists</strong>: Embed a single todo or a dynamic list filtered by note or tag directly inside your document.</li>
        <li><strong>Eisenhower Matrix & Calendar</strong>: Prioritize across four quadrants with recurring tasks and system reminders.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h4>🕸️ Knowledge Graph & Timeline</h4>
      <ul>
        <li><strong>Visual Connections</strong>: See how notes and canvases connect through wiki links, inline links, and shared tags—or focus on the local neighborhood of your current note.</li>
        <li><strong>Daily Timeline</strong>: Review chronological thoughts by day, edit in place, merge a day's entries, or convert thoughts into todos.</li>
        <li><strong>Customizable Home Page</strong>: Arrange cards for quick capture, today's todos, recent notes, focus timer, activity heatmaps, and custom AI widgets.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h4>🧰 Clipper, Voice & Extensibility</h4>
      <ul>
        <li><strong>Web Clipper</strong>: Clip full articles, selections, or bookmarks from Chrome / Edge directly to Flota (<a href="./extensions/chrome-clipper/README.md">setup guide</a>).</li>
        <li><strong>Speech to Text</strong>: Run offline recognition locally with downloadable Whisper models, or connect Volcengine cloud speech recognition.</li>
        <li><strong>Broad Import & History</strong>: Import Markdown, Word / WPS / Excel / PowerPoint, PDF, EPUB, and Obsidian vaults; restore earlier snapshots with note history.</li>
        <li><strong>Plugins & MCP</strong>: Extend Flota with sandboxed Worker plugins, or enable the built-in MCP server so external AI clients can read and update your workspace.</li>
      </ul>
    </td>
  </tr>
</table>

### Todos: Prioritize in Four Quadrants

![Flota todo quadrants in dark mode](./docs/images/todos-dark-en.png)

### Home Page: Your Daily Command Center

![Flota home page with quick capture and todo cards](./docs/images/home-light-zh.png)

---

## Local-First & Privacy by Design

- **No Accounts, Zero Telemetry**: Flota requires no sign-up and contains no analytics, tracking, ads, or crash reporting.
- **Your Files Stay on Your Machine**: Notes, todos, canvases, memories, and attachments live in a local SQLite database and folder on your computer. Core note-taking works 100% offline.
- **Bring Your Own Cloud & AI**:
  - **AI & Speech**: Network requests happen only when you configure your own API endpoint and key (OpenAI-compatible providers, DeepSeek, Qwen, etc.) and invoke those features.
  - **Sync & Backups**: Sync across devices via **WebDAV** (Nutstore or self-hosted servers), back up to multiple drives, and sync tasks two-way with **CalDAV** or **Google Calendar**.

Read the full breakdown of network features in our [Privacy Policy](./PRIVACY.md#english).

---

## Quick Start

### 1. Install

Grab the latest package for your platform from [GitHub Releases](https://github.com/Xperiamol/Flota/releases):

| Platform | Installation |
| --- | --- |
| **Windows** (10 or later) | Run the Windows installer (`.exe`), or install **Flota Notes** from the Microsoft Store for automatic Store updates |
| **macOS** (Apple Silicon / Intel) | Download the `arm64` or `x64` `.dmg` and drag Flota into `Applications` |
| **Linux** (x64) | Download the `.AppImage`, mark it executable (`chmod +x`), and launch |

> Note: The Android edition is released separately; this repository and README cover the desktop app.

### 2. First Steps

1. **Capture a thought**: Press `Ctrl/Cmd + N` for a new note, or `Ctrl/Cmd + Shift + N` anywhere for the global quick-input window.
2. **Plan your day**: Press `Ctrl/Cmd + T` to create a todo, or click *"Add to Todos"* on any checklist item inside a note.
3. **Connect services (optional)**: Head to **Settings** whenever you want to hook up your AI API key, WebDAV sync, or offline Whisper voice model.

---

## Development & Contributing

Get the desktop app running locally in four commands (`electron-dev` prepares the native SQLite module and launches Vite + Electron together):

```bash
git clone https://github.com/Xperiamol/Flota.git
cd Flota
npm install
npm run electron-dev
```

- 🛠️ **[Development & Build Guide](./docs/DEVELOPMENT.md#english)**: Prerequisites, test suites, directory layout, and database repair tools
- 🔌 **[Plugin Documentation](./plugins/docs/README.md)** · **[Example Plugins](./plugins/examples/)**: Build sandboxed extensions with the Runtime API
- 📦 **[Release Workflow](./docs/RELEASE_FLOW.md)** · **[Changelog](./CHANGELOG.md)** · **[MIT License](./LICENSE)**
- 💬 **[Issues & Feedback](https://github.com/Xperiamol/Flota/issues)**: When reporting a bug, please include your OS, app version, and reproduction steps

---

## 🕰️ Nostalgia Corner: From FlashNote to Flota

Long-time users might remember that Flota started life under the name **FlashNote**—complete with its old avatar, the leap from `1.x` to `2.0`, and the very first versions of the Excalidraw whiteboard and local plugin system.

If you want a trip down memory lane, visit our **[Nostalgia Edition README & Archive](./docs/history/README.md#english)** to see the classic screenshots and original READMEs side by side.

<div align="center">
  <br />
  <p>If Flota helps you think clearer and get things done, consider giving the repo a ⭐️ Star!</p>
</div>
