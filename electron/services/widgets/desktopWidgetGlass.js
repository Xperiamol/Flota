const CORNER_RADIUS = 14;

/** 原生材质只装在窗口底层，页面保留透明；每个窗口仅挂载一次。 */
function createDesktopWidgetGlass({
  platform = process.platform,
  release = require('os').release(),
  nativeTheme,
  loadGlass = () => require('electron-liquid-glass'),
  logger = console,
  setCorners = require('./nativeDesktopLayer').setDesktopGlassCorners,
} = {}) {
  let glass;
  let loaded = false;
  const wantsBlur = (appearance) => appearance?.blur === true && appearance?.blurSupported !== false;
  const liquidGlass = () => {
    // macOS 26 对应 Darwin 25；旧系统无需加载原生模块。
    if (platform !== 'darwin' || Number(release.split('.')[0]) < 25
      || nativeTheme?.prefersReducedTransparency || nativeTheme?.shouldUseHighContrastColors) return null;
    if (!loaded) {
      loaded = true;
      try {
        const module = loadGlass();
        const candidate = module.default || module;
        if (candidate.isGlassSupported()) glass = candidate;
      } catch (error) {
        logger.warn?.('[DesktopWidgets] 液态玻璃不可用，使用系统毛玻璃:', error.message);
      }
    }
    return glass;
  };

  return {
    options(appearance = {}) {
      const transparent = { transparent: true, backgroundColor: '#00000000' };
      if (platform === 'darwin') {
        return {
          ...transparent,
          roundedCorners: true,
          ...(wantsBlur(appearance) ? { visualEffectState: 'active' } : {}),
          ...(wantsBlur(appearance) && !liquidGlass()
            ? { vibrancy: 'under-window' } : {}),
        };
      }
      if (platform === 'win32' && wantsBlur(appearance)) {
        return { backgroundColor: '#00000000', backgroundMaterial: 'acrylic', roundedCorners: true };
      }
      return transparent;
    },

    attach(win, appearance = {}) {
      if (!wantsBlur(appearance)) return;
      const material = liquidGlass();
      if (!material) return;
      try {
        // 不与 Electron vibrancy 叠加，也不使用库的实验性 variant 接口。
        const id = material.addView(win.getNativeWindowHandle(), { cornerRadius: CORNER_RADIUS, opaque: false });
        if (Number.isInteger(id) && id >= 0) {
          setCorners(win, CORNER_RADIUS);
          return true;
        }
      } catch (error) {
        logger.warn?.('[DesktopWidgets] 液态玻璃挂载失败，使用系统毛玻璃:', error.message);
      }
      win.setVibrancy('under-window');
      return false;
    },
  };
}

module.exports = { createDesktopWidgetGlass };
