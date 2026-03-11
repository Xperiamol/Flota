/**
 * Plugin UI Bridge
 * 
 * 为插件窗口注入 UI 资源访问接口，让插件能够：
 * 1. 访问主应用的主题配置
 * 2. 使用主题 CSS 变量
 * 3. 使用预构建 CSS 类库
 * 4. 监听主题变化
 * 5. 保持 UI 风格一致
 */

// 导入 CSS 类库（将在打包时内联）
import FlotaUICSS from './flota-ui.css?inline'
import { registerFlotaComponents } from './flota-components'
import { injectReactBridge } from './flota-react-bridge'
import logger from './logger'

/**
 * 将 UI Bridge 注入到插件窗口
 * @param {Window} iframeWindow - 插件窗口的 iframe contentWindow
 * @param {Object} theme - Material-UI 主题对象
 * @param {Object|{pluginManifest?: Object, pluginId?: string, commandExecutor?: Function}} manifestOrOptions - 插件 manifest 或包含额外配置的对象
 */
export function injectUIBridge(iframeWindow, theme, manifestOrOptions = null) {
  if (!iframeWindow || !theme) {
    console.error('injectUIBridge: 缺少必需参数')
    return
  }

  let pluginManifest = null
  let pluginId = null
  let commandExecutor = null

  if (manifestOrOptions && typeof manifestOrOptions === 'object' && !Array.isArray(manifestOrOptions)) {
    const {
      pluginManifest: manifestOption = null,
      pluginId: pluginIdOption = null,
      commandExecutor: commandExecutorOption = null
    } = manifestOrOptions

    // 兼容旧调用方式，允许直接传入 manifest
    if (manifestOption || pluginIdOption || commandExecutorOption) {
      pluginManifest = manifestOption || null
      pluginId = pluginIdOption || null
      commandExecutor = typeof commandExecutorOption === 'function' ? commandExecutorOption : null
    } else {
      pluginManifest = manifestOrOptions
    }
  } else {
    pluginManifest = manifestOrOptions
  }

  /**
   * 生成 CSS 变量映射
   */
  const getCSSVariables = () => ({
    // 主色调
    '--fn-primary-main': theme.palette.primary.main,
    '--fn-primary-light': theme.palette.primary.light,
    '--fn-primary-dark': theme.palette.primary.dark,
    '--fn-primary-contrast': theme.palette.primary.contrastText || '#ffffff',
    
    // 次要色
    '--fn-secondary-main': theme.palette.secondary.main,
    '--fn-secondary-light': theme.palette.secondary.light,
    '--fn-secondary-dark': theme.palette.secondary.dark,
    
    // 背景色
    '--fn-background-default': theme.palette.background.default,
    '--fn-background-paper': theme.palette.background.paper,
    
    // 文字颜色
    '--fn-text-primary': theme.palette.text.primary,
    '--fn-text-secondary': theme.palette.text.secondary,
    '--fn-text-disabled': theme.palette.text.disabled || '#9e9e9e',
    
    // 状态色
    '--fn-error-main': theme.palette.error?.main || '#d32f2f',
    '--fn-error-light': theme.palette.error?.light || '#ef5350',
    '--fn-error-dark': theme.palette.error?.dark || '#c62828',
    '--fn-success-main': theme.palette.success?.main || '#388e3c',
    '--fn-success-light': theme.palette.success?.light || '#66bb6a',
    '--fn-success-dark': theme.palette.success?.dark || '#2e7d32',
    '--fn-warning-main': theme.palette.warning?.main || '#f57c00',
    '--fn-warning-light': theme.palette.warning?.light || '#ff9800',
    '--fn-warning-dark': theme.palette.warning?.dark || '#e65100',
    '--fn-info-main': theme.palette.info?.main || '#0288d1',
    '--fn-info-light': theme.palette.info?.light || '#03a9f4',
    '--fn-info-dark': theme.palette.info?.dark || '#01579b',
    
    // 分隔线
    '--fn-divider': theme.palette.divider || 'rgba(0, 0, 0, 0.12)',
    
    // 形状
    '--fn-border-radius': theme.shape.borderRadius + 'px',
    '--fn-border-radius-lg': (theme.shape.borderRadius * 1.5) + 'px',
    '--fn-border-radius-sm': (theme.shape.borderRadius * 0.5) + 'px',
    
    // 字体
    '--fn-font-family': theme.typography.fontFamily,
    '--fn-font-size': theme.typography.fontSize + 'px',
    
    // 间距
    '--fn-spacing-1': theme.spacing(1) + 'px',
    '--fn-spacing-2': theme.spacing(2) + 'px',
    '--fn-spacing-3': theme.spacing(3) + 'px',
    '--fn-spacing-4': theme.spacing(4) + 'px',
    '--fn-spacing-5': theme.spacing(5) + 'px',
    
    // 阴影
    '--fn-shadow-1': theme.shadows?.[1] || '0 2px 4px rgba(0,0,0,0.1)',
    '--fn-shadow-2': theme.shadows?.[2] || '0 2px 8px rgba(0,0,0,0.1)',
    '--fn-shadow-3': theme.shadows?.[3] || '0 4px 12px rgba(0,0,0,0.15)',
    '--fn-shadow-4': theme.shadows?.[4] || '0 6px 16px rgba(0,0,0,0.2)',
  })

  /**
   * Flota UI Bridge API
   */
  const bridge = {
    version: '2.3.1',
    
    /**
     * 获取当前主题配置
     * @returns {Object} 主题配置对象
     */
    getTheme() {
      return {
        mode: theme.palette.mode,
        colors: {
          primary: theme.palette.primary.main,
          primaryLight: theme.palette.primary.light,
          primaryDark: theme.palette.primary.dark,
          secondary: theme.palette.secondary.main,
          background: theme.palette.background.default,
          paper: theme.palette.background.paper,
          text: theme.palette.text.primary,
          textSecondary: theme.palette.text.secondary,
          error: theme.palette.error?.main || '#d32f2f',
          success: theme.palette.success?.main || '#388e3c',
          warning: theme.palette.warning?.main || '#f57c00',
          info: theme.palette.info?.main || '#0288d1',
          divider: theme.palette.divider || 'rgba(0, 0, 0, 0.12)'
        },
        shape: {
          borderRadius: theme.shape.borderRadius
        },
        typography: {
          fontFamily: theme.typography.fontFamily,
          fontSize: theme.typography.fontSize
        },
        spacing: (factor) => theme.spacing(factor)
      }
    },
    
    /**
     * 获取 CSS 变量映射
     * @returns {Object} CSS 变量键值对
     */
    getCSSVariables,
    
    /**
     * 应用 CSS 变量到当前文档
     */
    applyCSSVariables() {
      const vars = getCSSVariables()
      Object.entries(vars).forEach(([key, value]) => {
        iframeWindow.document.documentElement.style.setProperty(key, value)
      })
    },
    
    /**
     * 监听主题变化
     * @param {Function} callback - 主题变化回调函数
     * @returns {Function} 取消监听的函数
     */
    onThemeChange(callback) {
      if (typeof callback !== 'function') {
        console.error('onThemeChange: callback 必须是函数')
        return () => {}
      }
      
      const handler = (event) => {
        const newTheme = event.detail
        callback(newTheme)
        
        // 自动重新应用 CSS 变量
        this.applyCSSVariables()
      }
      
      window.addEventListener('Flota-theme-changed', handler)
      
      // 返回取消监听函数
      return () => {
        window.removeEventListener('Flota-theme-changed', handler)
      }
    },
    
    /**
     * 获取预设样式类名
     */
    classes: {
      button: 'fn-btn',
      buttonPrimary: 'fn-btn-primary',
      buttonSecondary: 'fn-btn-secondary',
      card: 'fn-card',
      input: 'fn-input',
      textField: 'fn-textfield',
      divider: 'fn-divider'
    },
    
    /**
     * 工具函数
     */
    utils: {
      /**
       * 判断当前是否为暗色主题
       */
      isDark() {
        return theme.palette.mode === 'dark'
      },
      
      /**
       * 获取对比色（用于确保文字可读性）
       */
      getContrastText(backgroundColor) {
        // 简化实现，实际应该根据亮度计算
        return theme.palette.mode === 'dark' ? '#ffffff' : '#000000'
      },
      
      /**
       * 将主题 spacing 单位转换为像素值
       */
      spacing(factor) {
        return theme.spacing(factor)
      }
    }
  }

  // 注入到 iframe 的 window 对象
  iframeWindow.FlotaUI = Object.freeze(bridge)

  const pluginRuntimeBridge = {
    version: '1.0.0',
    pluginId,
    getPluginId() {
      return pluginId
    },
    getManifest() {
      return pluginManifest
    },
    async executeCommand(firstArg, secondArg, thirdArg) {
      if (typeof commandExecutor !== 'function') {
        return Promise.reject(new Error('插件命令执行器不可用'))
      }

      let targetPluginId = pluginId || null
      let commandId = null
      let payload = {}

      const argCount = arguments.length

      if (argCount === 1) {
        commandId = firstArg
      } else if (argCount === 2) {
        if (typeof secondArg === 'string') {
          // executeCommand(pluginId, commandId)
          targetPluginId = firstArg || pluginId
          commandId = secondArg
        } else {
          // executeCommand(commandId, payload)
          commandId = firstArg
          payload = secondArg || {}
        }
      } else {
        // executeCommand(pluginId, commandId, payload)
        targetPluginId = firstArg || pluginId
        commandId = secondArg
        payload = thirdArg || {}
      }

      if (!commandId) {
        return Promise.reject(new Error('缺少 commandId'))
      }

      const resolvedPluginId = targetPluginId || pluginId
      if (!resolvedPluginId) {
        return Promise.reject(new Error('缺少 pluginId'))
      }

      return commandExecutor(resolvedPluginId, commandId, payload)
    }
  }

  iframeWindow.FlotaPlugin = Object.freeze(pluginRuntimeBridge)
  
  // 注入 CSS 类库到 iframe
  try {
    const styleElement = iframeWindow.document.createElement('style')
    styleElement.id = 'Flota-ui-styles'
    styleElement.textContent = FlotaUICSS
    iframeWindow.document.head.appendChild(styleElement)
    logger.log('[Flota UI Bridge] CSS 类库已注入')
  } catch (error) {
    console.error('[Flota UI Bridge] 注入 CSS 类库失败:', error)
  }
  
  // 注册 Web Components 到 iframe
  try {
    registerFlotaComponents(iframeWindow)
    logger.log('[Flota UI Bridge] Web Components 已注册')
  } catch (error) {
    console.error('[Flota UI Bridge] 注册 Web Components 失败:', error)
  }
  
  // 如果插件声明使用 React，注入 React Bridge
  if (pluginManifest && pluginManifest.framework === 'react') {
    try {
      injectReactBridge(iframeWindow)
      logger.log('[Flota UI Bridge] React Bridge 已注入')
    } catch (error) {
      console.error('[Flota UI Bridge] 注入 React Bridge 失败:', error)
    }
  }
  
  // 自动应用 CSS 变量
  try {
    bridge.applyCSSVariables()
    logger.log('[Flota UI Bridge] 已注入，版本:', bridge.version)
  } catch (error) {
    console.error('[Flota UI Bridge] 应用 CSS 变量失败:', error)
  }
  
  try {
    const readyEvent = new iframeWindow.CustomEvent('Flota-plugin-ready', {
      detail: {
        pluginId,
        hasRuntime: typeof commandExecutor === 'function'
      }
    })
    iframeWindow.dispatchEvent(readyEvent)
  } catch (error) {
    console.error('[Flota UI Bridge] 触发插件就绪事件失败:', error)
  }

  return bridge
}

/**
 * 触发主题变化事件
 * @param {Object} newTheme - 新主题对象
 */
export function notifyThemeChange(newTheme) {
  const event = new CustomEvent('Flota-theme-changed', {
    detail: newTheme
  })
  window.dispatchEvent(event)
}
