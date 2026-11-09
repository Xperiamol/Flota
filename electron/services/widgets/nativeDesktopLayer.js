/**
 * 让桌面卡片在「显示桌面」后仍留在桌面上（Electron 本身没有对应接口，用 koffi 直接调用系统 API）。
 *
 *   Windows：把窗口的所有者设为桌面窗口 Progman。属于桌面的窗口不会被 Win+D、任务栏右下角「显示桌面」收起，
 *            也不进任务栏；置顶时取消所有者，恢复成普通的置顶窗口。
 *   macOS：  给 NSWindow 加上 NSWindowCollectionBehaviorStationary，「显示桌面」（F11、触发角、点墙纸）
 *            和调度中心不再把它推开，像桌面图标一样留在原处。
 *
 * koffi 加载失败（平台不支持、文件缺失）时所有函数安静地返回 false，调用方继续用原来的做法。
 */
let koffi = null;
let loadFailed = false;

const loadKoffi = () => {
  if (koffi || loadFailed) return koffi;
  try {
    koffi = require('koffi');
  } catch (error) {
    loadFailed = true;
    console.warn('[nativeDesktopLayer] koffi 不可用：', error?.message);
  }
  return koffi;
};

/** BrowserWindow 的原生句柄（Windows 是 HWND，macOS 是 NSView*）转成整数 */
const handleOf = (win) => {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0));
};

// ---- Windows ----

let user32 = null;
const loadUser32 = () => {
  if (user32) return user32;
  const ffi = loadKoffi();
  if (!ffi) return null;
  try {
    const lib = ffi.load('user32.dll');
    const is64 = process.arch === 'x64' || process.arch === 'arm64';
    user32 = {
      FindWindowW: lib.func('intptr_t __stdcall FindWindowW(str16 cls, str16 name)'),
      // 32 位系统没有 SetWindowLongPtrW（是 SetWindowLongW 的宏）
      SetOwner: is64
        ? lib.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)')
        : lib.func('long __stdcall SetWindowLongW(intptr_t hwnd, int index, long value)'),
    };
  } catch (error) {
    console.warn('[nativeDesktopLayer] user32 加载失败：', error?.message);
    user32 = null;
  }
  return user32;
};

const GWLP_HWNDPARENT = -8;

function setWindowsDesktopOwner(win, onDesktop) {
  const api = loadUser32();
  if (!api) return false;
  try {
    const hwnd = handleOf(win);
    const owner = onDesktop ? BigInt(api.FindWindowW('Progman', null) || 0) : 0n;
    if (onDesktop && !owner) return false;
    api.SetOwner(hwnd, GWLP_HWNDPARENT, process.arch === 'ia32' ? Number(owner) : owner);
    return true;
  } catch (error) {
    console.warn('[nativeDesktopLayer] 设置桌面所有者失败：', error?.message);
    return false;
  }
}

// ---- macOS ----

let objc = null;
const loadObjc = () => {
  if (objc) return objc;
  const ffi = loadKoffi();
  if (!ffi) return null;
  try {
    const lib = ffi.load('/usr/lib/libobjc.A.dylib');
    objc = {
      sel: lib.func('intptr_t sel_registerName(const char *name)'),
      // objc_msgSend 按每种调用的真实签名分别声明（arm64 上不能用可变参数调用）
      sendGet: lib.func('objc_msgSend', 'intptr_t', ['intptr_t', 'intptr_t']),
      sendSet: lib.func('objc_msgSend', 'void', ['intptr_t', 'intptr_t', 'uint64_t']),
    };
  } catch (error) {
    console.warn('[nativeDesktopLayer] libobjc 加载失败：', error?.message);
    objc = null;
  }
  return objc;
};

const NSWindowCollectionBehaviorStationary = 1n << 4n;

function setMacStationary(win, stationary) {
  const api = loadObjc();
  if (!api) return false;
  try {
    const view = handleOf(win);
    const nsWindow = BigInt(api.sendGet(view, api.sel('window')) || 0);
    if (!nsWindow) return false;
    const current = BigInt(api.sendGet(nsWindow, api.sel('collectionBehavior')));
    const next = stationary ? current | NSWindowCollectionBehaviorStationary : current & ~NSWindowCollectionBehaviorStationary;
    if (next !== current) api.sendSet(nsWindow, api.sel('setCollectionBehavior:'), next);
    return true;
  } catch (error) {
    console.warn('[nativeDesktopLayer] 设置 Stationary 失败：', error?.message);
    return false;
  }
}

/**
 * 把窗口贴到桌面（不被「显示桌面」收起）或取消。
 * @returns {boolean} 是否成功设置（不支持的平台返回 false）
 */
function setStayOnDesktop(win, enabled) {
  if (!win || win.isDestroyed()) return false;
  if (process.platform === 'win32') return setWindowsDesktopOwner(win, enabled);
  if (process.platform === 'darwin') return setMacStationary(win, enabled);
  return false;
}

module.exports = { setStayOnDesktop };
