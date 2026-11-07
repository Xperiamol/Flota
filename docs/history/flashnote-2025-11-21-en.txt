# FlashNote 2.0

[中文](./README.md) | English

A modern desktop note-taking application designed for efficient note recording and management.
The old 1.x version has been phased out. Welcome to the new version that is more open and visually appealing!
<img width="1492" height="995" alt="image" src="https://github.com/user-attachments/assets/7b81f992-9684-42da-8eb2-624d6d702bea" />

## Special Thanks to Baidu Comate for Support! 🙏

## 🌟 Key Features

### 📝 Smart Note Editing
- **Rich Text Editor**: Supports Markdown syntax with real-time preview
- **Whiteboard Editor**: Excalidraw as the whiteboard engine, supporting drawing, annotations, and more
- **Quick Formatting**: One-click application of bold, italic, underline, and other formats
- **Rich MD Formats**: Wiki links, tags, colored text, Callout, etc.
- **Auto-save**: Real-time saving, never lose content

### 🎯 Efficient Operations
- **Global Shortcuts**: Quickly create notes anytime, anywhere
- **System Tray**: Minimize to tray, run in background without occupying taskbar
- **Quick Search**: Full-text search to quickly locate needed content

### 🎨 Personalized Customization
- **Theme Switching**: Support for light/dark themes/accent colors
- **Shortcut Configuration**: Personalized shortcut settings
- **Interface Layout**: Flexible window layout options
- **Pre-installed Background Plugins**: Provides multiple texture background plugins to beautify your note interface

### 📊 Data Management
- **Local SQLITE Storage**: Data is securely stored locally
- **Vector Storage**: Uses @xenova/transformers for text vectorization on local devices
- **Local Mem0Service Integration**: Implements semantic search and memory management system based on cosine similarity
- **Category Management**: Supports tag and category organization
- **Import/Export**: Supports data migration in multiple formats
- **Backup/Recovery**: Automatic backup, one-click recovery

### 📅 Calendar Sync
- **CalDAV Protocol**: Supports standard CalDAV services like iCloud, Nextcloud
- **Google Calendar**: OAuth 2.0 secure authorization, no password required
- **Two-way Sync**: Todo items and calendar events sync automatically
- **Multi-device Synchronization**: Achieve multi-device data sync through calendar services

### 🎤 Speech-to-Text (v2.2.2+)
- **Multiple Service Support**: OpenAI Whisper, Alibaba Cloud speech recognition, etc.
- **High Accuracy**: Supports automatic multi-language recognition
- **Plugin Invocation**: Provides API support for voice note scenarios
- **Flexible Configuration**: Supports custom service endpoints

## 🚀 Quick Start

### System Requirements
- Windows 10 or higher
- At least 100MB of available disk space

### Installation Methods

#### Method 1: Download Installer (Recommended)
1. Go to the [Releases](https://github.com/Xperiamol/FlashNote/releases) page
2. Download the latest version of `FlashNote 2.x.x. Setup 2.x.x.exe`
3. Run the installer and follow the prompts to complete installation
4. After installation, the app will start automatically

#### Method 2: Portable Version (Temporarily Deprecated)
1. Download the `win-unpacked` folder
2. Extract to any directory
3. Run `FlashNote 2.0.exe` to use

### First Use
1. **Start App**: Double-click the desktop icon or start from the start menu
2. **Create Note**: Use shortcut `Ctrl+N` or click "New Note"
3. **Quick Input**: Use shortcut `Ctrl+Shift+N` to open the quick input window
4. **System Tray**: The app will minimize to system tray, right-click to see more options

## 🛠️ Developer Guide

### Tech Stack
- **Frontend Framework**: React + Vite
- **Desktop Framework**: Electron
- **Database**: SQLite (better-sqlite3)
- **UI Components**: Material-UI
- **State Management**: Zustand

### Local Development

```bash
# Clone the project
git clone https://github.com/Xperiamol/FlashNote.git
cd FlashNote

# Install dependencies
npm install

# Start development server
npm run dev

# Start Electron in development mode
npm run electron-dev
```

### Build and Package

```bash
# Build frontend
npm run build

# Package Electron application
npm run electron-build
```

### 🔌 Plugin Development

FlashNote 2+ supports a powerful plugin system. You can create your own plugins to extend functionality!

#### Quick Start

```javascript
// Create plugins/examples/my-plugin/manifest.json and index.js
runtime.onActivate(async () => {
  runtime.registerCommand({
    id: 'hello',
    title: 'Say Hello'
  }, async () => {
    await runtime.notifications.show({
      title: 'Hello!',
      body: 'Welcome to FlashNote plugin system',
      type: 'success'
    })
  })
})
```

#### Plugin Documentation

- 📚 **[Plugin Development Documentation](./plugins/docs/README.md)** - Complete documentation index
- 🚀 **[Development Guide](./plugins/docs/development-guide.md)** - Complete developer guide
- 💡 **[Example Plugins](./plugins/examples/)** - Learning references
  - [random-note](./plugins/examples/random-note/) - Simple command example
  - [ai-task-planner](./plugins/examples/ai-task-planner/) - Custom window example

#### Plugin Features

- ✅ **Secure Sandbox**: Plugins run in isolated Workers
- ✅ **Permission System**: Fine-grained permission control
- ✅ **Runtime API**: Access notes, todos, tags, and other data
- ✅ **Custom UI**: Create Dialog windows to display interfaces
- ✅ **Hot Reload**: No need to restart app during development
- ✅ **Local Development**: Convenient local debugging tools

Start creating your first plugin! Check the [Complete Developer Guide](./plugins/docs/development-guide.md) for details.

### Project Structure

```
FlashNote/
├── src/                    # Frontend source code
│   ├── components/         # React components
│   ├── utils/             # Utility functions
│   ├── styles/            # Style files
│   └── main.jsx           # Entry file
├── electron/              # Electron main process
│   └── main.js            # Main process entry
├── public/                # Static assets
└── dist-electron/         # Build output
```

## 🤝 Contributing Guidelines

We welcome all forms of contributions! Please submit issues directly. The plugin system currently only supports local additions. You can install after local development.

### How to Contribute
1. Fork this project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Create a Pull Request

### Issue Reporting
- Found a bug? Please create an Issue
- Have a new idea? Welcome to discuss in Discussions

## 🙏 Acknowledgments

Thanks to all users who have used this project demo! We are committed to creating a note-taking app with minimal interaction for recording and intentional design focus.

---

**FlashNote 2** - Make note-taking more efficient and enjoyable!

If this project helps you, please give us a ⭐️!
