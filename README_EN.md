<div align="center">
  <p>
    <a href="./README.md">中文</a>
    ·
    <a href="./README_EN.md">English</a>
  </p>

  <img src="./logo.png" width="96" alt="Flota Logo" />

  <h1>Flota</h1>
  <p><strong>A clean, efficient, and extensible desktop capture app</strong></p>
  <p>
    A local-first workspace for notes, todos, whiteboards, calendar sync, plugins, and AI workflows.
  </p>

  <p>
    <img src="https://img.shields.io/badge/version-3.5.0-5B8DEF?style=flat-square" alt="Version 3.5.0" />
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-2E3440?style=flat-square" alt="Platforms" />
    <img src="https://img.shields.io/badge/stack-React%20%2B%20Electron-61DAFB?style=flat-square" alt="React + Electron" />
    <img src="https://img.shields.io/badge/storage-SQLite-003B57?style=flat-square" alt="SQLite" />
  </p>

  <p>
    <a href="https://github.com/Xperiamol/Flota/releases"><strong>Download</strong></a>
    ·
    <a href="#quick-start"><strong>Quick Start</strong></a>
    ·
    <a href="#plugin-development"><strong>Plugin Development</strong></a>
    ·
    <a href="./docs/RELEASE_FLOW.md"><strong>Release Flow</strong></a>
  </p>
</div>

<br />

<div align="center">
  <img width="1492" alt="Flota light preview" src="https://github.com/user-attachments/assets/7b81f992-9684-42da-8eb2-624d6d702bea" />
  <br />
  <br />
  <img width="1495" alt="Flota dark preview" src="https://github.com/user-attachments/assets/ed2c6353-447a-4621-93d7-0a0aa7a79774" />
</div>

<br />

<a id="overview"></a>

<h2>✨ Overview</h2>

<p>
  Flota is a modern desktop note-taking and productivity app designed for capturing ideas,
  organizing knowledge, planning todos, and connecting AI-assisted workflows.
  Compared with the legacy 1.x line, the current version provides a more open plugin system,
  richer sync capabilities, and a more polished user experience.
</p>

<table>
  <tr>
    <td><strong>📝 Local-first</strong></td>
    <td>Core data such as notes, todos, and settings is stored locally in SQLite for privacy and control.</td>
  </tr>
  <tr>
    <td><strong>🧠 AI-enhanced</strong></td>
    <td>Supports AI chat, contextual understanding, todo planning, rewriting, meeting action extraction, and whiteboard generation.</td>
  </tr>
  <tr>
    <td><strong>🔌 Extensible plugins</strong></td>
    <td>Extend notes, todos, tags, UI, and commands through a sandboxed runtime and permission-based APIs.</td>
  </tr>
  <tr>
    <td><strong>☁️ Multi-service sync</strong></td>
    <td>Supports WebDAV, CalDAV, and Google Calendar for different synchronization scenarios.</td>
  </tr>
</table>

<a id="features"></a>

<h2>🌟 Key Features</h2>

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>📝 Smart Note Editing</h3>
      <ul>
        <li><strong>Rich text editor</strong>: Markdown-friendly editing with real-time preview.</li>
        <li><strong>WYSIWYG experience</strong>: Continuous editing powered by TipTap.</li>
        <li><strong>Whiteboard editor</strong>: Excalidraw-powered canvas for drawing, sketching, and structured thinking.</li>
        <li><strong>Extended Markdown</strong>: Wiki links, tags, colored text, callouts, and more.</li>
        <li><strong>Auto-save</strong>: Real-time persistence to reduce the risk of losing content.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>🎯 Efficient Operations</h3>
      <ul>
        <li><strong>Global shortcuts</strong>: Quickly create notes or todos from anywhere.</li>
        <li><strong>System tray</strong>: Keep Flota running in the background without occupying the taskbar.</li>
        <li><strong>Full-text search</strong>: Locate notes, todos, and contextual content quickly.</li>
        <li><strong>Multi-select management</strong>: Batch delete, restore, complete, and tag items.</li>
        <li><strong>Standalone windows</strong>: Useful for quick capture, focused editing, and floating workflows.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🎨 Personalization</h3>
      <ul>
        <li><strong>Themes</strong>: Light, dark, system theme, and accent color support.</li>
        <li><strong>Shortcut configuration</strong>: Customize global and in-app shortcuts.</li>
        <li><strong>Flexible layout</strong>: Adjustable sidebars, toolbars, and view composition.</li>
        <li><strong>Background plugins</strong>: Built-in texture and pattern plugins for a richer workspace.</li>
        <li><strong>Seasonal mode</strong>: Lightweight decorative effects for special occasions.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>📊 Data Management</h3>
      <ul>
        <li><strong>Local SQLite storage</strong>: Core data is stored securely on your device.</li>
        <li><strong>Vector retrieval</strong>: Uses @xenova/transformers for local text vectorization.</li>
        <li><strong>Semantic memory</strong>: Similarity-based search and memory recall through cosine similarity.</li>
        <li><strong>Tag organization</strong>: Organize knowledge assets with tags and categories.</li>
        <li><strong>Import / export</strong>: Supports data migration, backup, and recovery workflows.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📅 Todos and Calendar Sync</h3>
      <ul>
        <li><strong>CalDAV</strong>: Works with standard services such as iCloud and Nextcloud.</li>
        <li><strong>Google Calendar</strong>: OAuth 2.0 authorization without storing your account password.</li>
        <li><strong>Two-way sync</strong>: Todos and calendar events can be synchronized automatically.</li>
        <li><strong>Recurring todos</strong>: Suitable for habits, periodic tasks, and long-term routines.</li>
        <li><strong>Notifications</strong>: System notifications for due todos.</li>
      </ul>
    </td>
    <td width="50%" valign="top">
      <h3>🎤 Voice and AI Workflows</h3>
      <ul>
        <li><strong>Speech-to-text</strong>: Supports OpenAI Whisper, Alibaba Cloud speech recognition, and compatible services.</li>
        <li><strong>AI command center</strong>: Summarize notes, plan todos, generate daily reports, and discover related content.</li>
        <li><strong>Whiteboard generation</strong>: Generate diagrams, flowcharts, and mind maps from natural language.</li>
        <li><strong>Context awareness</strong>: Combines the current note, upcoming todos, related memories, and conversation history.</li>
        <li><strong>Plugin invocation</strong>: Provides APIs for voice notes, automation, and custom workflows.</li>
      </ul>
    </td>
  </tr>
</table>

<a id="quick-start"></a>

<h2>🚀 Quick Start</h2>

<h3>System Requirements</h3>

<table>
  <tr>
    <th>Platform</th>
    <th>Recommended environment</th>
  </tr>
  <tr>
    <td>Windows</td>
    <td>Windows 10 or later</td>
  </tr>
  <tr>
    <td>macOS</td>
    <td>A macOS version supported by the current Electron runtime</td>
  </tr>
  <tr>
    <td>Linux</td>
    <td>Mainstream desktop distributions with AppImage support</td>
  </tr>
  <tr>
    <td>Disk space</td>
    <td>300MB+ recommended; models, plugins, and attachments may require more space</td>
  </tr>
</table>

<h3>Installation</h3>

<ol>
  <li>Go to the <a href="https://github.com/Xperiamol/Flota/releases">GitHub Releases</a> page.</li>
  <li>Download the package that matches your operating system.</li>
  <li>Run the installer and follow the instructions.</li>
  <li>Launch Flota and create your first note or todo.</li>
</ol>

<h3>Recommended First Steps</h3>

<table>
  <tr>
    <td><strong>1. Create a note</strong></td>
    <td>Use <code>Ctrl/Cmd + N</code> or click “New Note”.</td>
  </tr>
  <tr>
    <td><strong>2. Quick capture</strong></td>
    <td>Use <code>Ctrl/Cmd + Shift + N</code> to open the quick input window.</td>
  </tr>
  <tr>
    <td><strong>3. Manage todos</strong></td>
    <td>Use <code>Ctrl/Cmd + T</code> to create todos and manage them in quadrant or calendar views.</td>
  </tr>
  <tr>
    <td><strong>4. Configure sync</strong></td>
    <td>Enable WebDAV, CalDAV, or Google Calendar in settings as needed.</td>
  </tr>
  <tr>
    <td><strong>5. Use plugins</strong></td>
    <td>Install or develop plugins to extend your capture workflow.</td>
  </tr>
</table>

<a id="development"></a>

<h2>🛠️ Developer Guide</h2>

<h3>Tech Stack</h3>

<table>
  <tr>
    <th>Area</th>
    <th>Technology</th>
  </tr>
  <tr>
    <td>Frontend</td>
    <td>React 18 + Vite</td>
  </tr>
  <tr>
    <td>Desktop runtime</td>
    <td>Electron</td>
  </tr>
  <tr>
    <td>UI</td>
    <td>Material UI + Emotion</td>
  </tr>
  <tr>
    <td>Editor</td>
    <td>TipTap + Markdown-it + Excalidraw</td>
  </tr>
  <tr>
    <td>State management</td>
    <td>Zustand</td>
  </tr>
  <tr>
    <td>Local storage</td>
    <td>SQLite / better-sqlite3</td>
  </tr>
  <tr>
    <td>AI / vectorization</td>
    <td>@xenova/transformers + OpenAI-compatible APIs</td>
  </tr>
  <tr>
    <td>Sync</td>
    <td>WebDAV, CalDAV, Google Calendar</td>
  </tr>
</table>

<h3>Local Development</h3>

<pre><code class="language-bash"># Clone the project
git clone https://github.com/Xperiamol/Flota.git
cd Flota

# Install dependencies
npm install

# Start the Vite development server
npm run dev

# Start Electron in development mode
npm run electron-dev
</code></pre>

<h3>Build and Package</h3>

<pre><code class="language-bash"># Build frontend assets
npm run build

# Package the Electron app
npm run electron-build

# Repair local database indexes or corruption issues
npm run repair-db
</code></pre>

<h3>Common Scripts</h3>

<table>
  <tr>
    <th>Command</th>
    <th>Description</th>
  </tr>
  <tr>
    <td><code>npm run dev</code></td>
    <td>Start the Vite development server.</td>
  </tr>
  <tr>
    <td><code>npm run electron-dev</code></td>
    <td>Start the full Electron development environment.</td>
  </tr>
  <tr>
    <td><code>npm run build</code></td>
    <td>Build frontend static assets.</td>
  </tr>
  <tr>
    <td><code>npm run electron-build</code></td>
    <td>Pre-download models, build the frontend, and package the desktop app.</td>
  </tr>
  <tr>
    <td><code>npm run repair-db</code></td>
    <td>Attempt to repair the local database and FTS indexes.</td>
  </tr>
  <tr>
    <td><code>npm run release:notes</code></td>
    <td>Extract release notes.</td>
  </tr>
</table>

<a id="plugin-development"></a>

<h2>🔌 Plugin Development</h2>

<p>
  Flota 2+ supports a powerful plugin system. Plugins can extend commands, views, notifications,
  notes, todos, tags, and custom UI.
</p>

<h3>Quick Example</h3>

<pre><code class="language-javascript">// Create plugins/examples/my-plugin/manifest.json and index.js
runtime.onActivate(async () =&gt; {
  runtime.registerCommand({
    id: 'hello',
    title: 'Say Hello'
  }, async () =&gt; {
    await runtime.notifications.show({
      title: 'Hello!',
      body: 'Welcome to Flota plugin system',
      type: 'success'
    })
  })
})
</code></pre>

<h3>Plugin Capabilities</h3>

<table>
  <tr>
    <td><strong>✅ Secure sandbox</strong></td>
    <td>Plugins run in isolated Workers to reduce impact on the main application.</td>
  </tr>
  <tr>
    <td><strong>✅ Permission system</strong></td>
    <td>Fine-grained permissions for notes, todos, tags, attachments, events, and more.</td>
  </tr>
  <tr>
    <td><strong>✅ Runtime API</strong></td>
    <td>Access notes, todos, tags, analytics, and UI capabilities.</td>
  </tr>
  <tr>
    <td><strong>✅ Custom UI</strong></td>
    <td>Create dialogs, plugin views, and richer interactive interfaces.</td>
  </tr>
  <tr>
    <td><strong>✅ Hot reload</strong></td>
    <td>Develop locally without restarting the app repeatedly.</td>
  </tr>
</table>

<h3>Plugin Documentation</h3>

<ul>
  <li>📚 <a href="./plugins/docs/README.md"><strong>Plugin documentation</strong></a>: Complete documentation index.</li>
  <li>🚀 <a href="./plugins/docs/development-guide.md"><strong>Development guide</strong></a>: Full plugin development flow and API reference.</li>
  <li>💡 <a href="./plugins/examples/"><strong>Example plugins</strong></a>: Learn from working examples.</li>
</ul>

<a id="project-structure"></a>

<h2>📁 Project Structure</h2>

<pre><code class="language-text">Flota/
├── src/                    # Frontend source code
│   ├── api/                # Renderer process API wrappers
│   ├── components/         # React components
│   ├── hooks/              # Business and UI hooks
│   ├── locales/            # Localization resources
│   ├── markdown/           # Markdown rendering and extensions
│   ├── store/              # Zustand state management
│   ├── styles/             # Theme and styles
│   └── utils/              # Shared utilities
├── electron/               # Electron main process and services
│   ├── dao/                # SQLite data access layer
│   ├── ipc/                # IPC handlers
│   └── services/           # Sync, AI, plugins, images, and more
├── plugins/                # Built-in plugins, examples, and docs
├── models/                 # Local embedding model assets
├── public/                 # Static assets
├── scripts/                # Build, release, and maintenance scripts
└── docs/                   # Project documentation
</code></pre>

<a id="roadmap"></a>

<h2>🧭 Maintenance Roadmap</h2>

<table>
  <tr>
    <th>Area</th>
    <th>Description</th>
  </tr>
  <tr>
    <td>Testing</td>
    <td>Add automated tests for sync, todos, protocol access, plugin APIs, and core utilities.</td>
  </tr>
  <tr>
    <td>Sync diagnostics</td>
    <td>Improve diagnostic reports, conflict previews, and error localization for WebDAV / CalDAV / Google Calendar.</td>
  </tr>
  <tr>
    <td>Code modularity</td>
    <td>Continue splitting the main process entry, frontend entry, and large page components.</td>
  </tr>
  <tr>
    <td>Plugin ecosystem</td>
    <td>Improve plugin store, permission UI, version compatibility, and example coverage.</td>
  </tr>
  <tr>
    <td>AI stability</td>
    <td>Optimize context assembly, streaming responses, retries, whiteboard generation, and tool calls.</td>
  </tr>
</table>

<a id="contributing"></a>

<h2>🤝 Contributing</h2>

<p>
  Issues, ideas, plugins, and pull requests are welcome.
  If you are developing a plugin, you can test it locally before sharing it with the community.
</p>

<ol>
  <li>Fork this project.</li>
  <li>Create a feature branch: <code>git checkout -b feature/AmazingFeature</code>.</li>
  <li>Commit changes: <code>git commit -m "Add some AmazingFeature"</code>.</li>
  <li>Push to the branch: <code>git push origin feature/AmazingFeature</code>.</li>
  <li>Create a Pull Request.</li>
</ol>

<h3>Issue Reporting</h3>

<ul>
  <li>Found a bug? Please create an <a href="https://github.com/Xperiamol/Flota/issues">Issue</a> with reproduction steps.</li>
  <li>Have a feature idea? Describe your scenario in Issues or Discussions.</li>
  <li>For sync problems, logs, sync provider type, and approximate operation time are especially helpful.</li>
</ul>

<a id="thanks"></a>

<h2>🙏 Acknowledgments</h2>

<p>
  Thanks to everyone who has used, reported issues, or contributed to Flota.
  We hope it becomes a focused tool for capturing, organizing, and turning ideas into action with less friction.
</p>

<hr />

<div align="center">
  <p><strong>Flota 3.5</strong> · Make note-taking more efficient and enjoyable.</p>
  <p>If this project helps you, please give it a ⭐️.</p>
</div>
