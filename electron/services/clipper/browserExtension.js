/**
 * 浏览器剪藏扩展的安装辅助。
 *
 * Chrome / Edge 不允许应用替用户静默安装扩展（只有应用商店或企业策略可以），所以做成尽量少操作的引导：
 *   1. 把应用自带的扩展复制到用户目录（应用包里的目录在 macOS 文件选择框里点不进去，Windows 商店版也读不到），
 *      应用升级后自动更新这份副本，浏览器重启后就是新版本；
 *   2. 找到电脑上装了哪些 Chromium 浏览器，一键在它里面打开扩展管理页；
 *   3. 剩下的「打开开发者模式、把文件夹拖进去」由界面上的分步指引说明。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const BUNDLED_CANDIDATES = () => [
  path.join(process.resourcesPath || '', 'extensions', 'chrome-clipper'),
  path.join(__dirname, '..', '..', '..', 'extensions', 'chrome-clipper'),
];
const VERSION_FILE = '.flota-installed-version';

/** 应用里自带的扩展目录 */
const getBundledExtensionDir = () => {
  const candidates = BUNDLED_CANDIDATES();
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'manifest.json'))) || candidates[candidates.length - 1];
};

const readManifestVersion = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version || '';
  } catch (_) {
    return '';
  }
};

/**
 * 用户目录里的扩展副本（浏览器从这里加载）。不存在或版本落后时从应用里复制一份。
 * 复制失败时退回应用里的目录，至少还能用。
 * @param {string} userDataDir
 * @param {string} appVersion 应用版本：开发时扩展改了但 manifest 版本没变，也会随应用版本更新
 */
const prepareExtensionDir = (userDataDir, appVersion = '') => {
  const source = getBundledExtensionDir();
  const target = path.join(userDataDir, 'browser-extension', 'flota-clipper');
  try {
    const wanted = `${readManifestVersion(source)}+${appVersion}`;
    const installed = fs.existsSync(path.join(target, VERSION_FILE)) ? fs.readFileSync(path.join(target, VERSION_FILE), 'utf8').trim() : '';
    if (installed !== wanted || !fs.existsSync(path.join(target, 'manifest.json'))) {
      fs.mkdirSync(target, { recursive: true });
      // 覆盖而不是先删：浏览器正在用这个目录时删除会让扩展暂时失效
      fs.cpSync(source, target, { recursive: true, force: true });
      fs.writeFileSync(path.join(target, VERSION_FILE), wanted);
    }
    return target;
  } catch (error) {
    console.warn('[Clipper] 准备扩展目录失败，改用应用内目录：', error?.message);
    return source;
  }
};

// 支持的 Chromium 系浏览器：扩展管理页地址，以及各平台的常见安装位置
const BROWSERS = [
  {
    id: 'chrome', name: 'Chrome', url: 'chrome://extensions',
    mac: ['Google Chrome.app'],
    win: ['Google\\Chrome\\Application\\chrome.exe'],
    linux: ['google-chrome', 'google-chrome-stable'],
  },
  {
    id: 'edge', name: 'Edge', url: 'edge://extensions',
    mac: ['Microsoft Edge.app'],
    win: ['Microsoft\\Edge\\Application\\msedge.exe'],
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
  },
  {
    id: 'brave', name: 'Brave', url: 'brave://extensions',
    mac: ['Brave Browser.app'],
    win: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    linux: ['brave-browser'],
  },
  {
    id: 'vivaldi', name: 'Vivaldi', url: 'vivaldi://extensions',
    mac: ['Vivaldi.app'],
    win: ['Vivaldi\\Application\\vivaldi.exe'],
    linux: ['vivaldi', 'vivaldi-stable'],
  },
  {
    id: 'arc', name: 'Arc', url: 'arc://extensions',
    mac: ['Arc.app'],
    win: [],
    linux: [],
  },
  {
    id: 'chromium', name: 'Chromium', url: 'chrome://extensions',
    mac: ['Chromium.app'],
    win: ['Chromium\\Application\\chrome.exe'],
    linux: ['chromium', 'chromium-browser'],
  },
];

const findOnPath = (binary) => (process.env.PATH || '').split(path.delimiter)
  .map((dir) => path.join(dir, binary))
  .find((file) => { try { return fs.statSync(file).isFile(); } catch (_) { return false; } });

/** 找到这台电脑上装的浏览器：[{ id, name, url, launch }]，launch 是 .app 路径或可执行文件 */
const detectBrowsers = (platform = process.platform, env = process.env, exists = fs.existsSync) => {
  const found = [];
  for (const browser of BROWSERS) {
    let launch = null;
    if (platform === 'darwin') {
      const roots = ['/Applications', path.join(env.HOME || '', 'Applications')];
      launch = browser.mac.flatMap((app) => roots.map((root) => path.join(root, app))).find((file) => exists(file)) || null;
    } else if (platform === 'win32') {
      const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
      launch = browser.win.flatMap((rel) => roots.map((root) => path.win32.join(root, rel))).find((file) => exists(file)) || null;
    } else {
      launch = browser.linux.map(findOnPath).find(Boolean) || null;
    }
    if (launch) found.push({ id: browser.id, name: browser.name, url: browser.url, launch });
  }
  return found;
};

/** 在指定浏览器里打开扩展管理页（浏览器内部页面不能用普通链接打开，只能把地址作为启动参数交给它） */
const openExtensionsPage = (browser, platform = process.platform) => new Promise((resolve, reject) => {
  const [command, args] = platform === 'darwin'
    ? ['open', ['-a', browser.launch, browser.url]]
    : [browser.launch, [browser.url]];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.once('error', reject);
  child.once('spawn', () => { child.unref(); resolve(true); });
});

module.exports = { prepareExtensionDir, getBundledExtensionDir, detectBrowsers, openExtensionsPage, BROWSERS };
