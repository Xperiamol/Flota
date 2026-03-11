/**
 * Plugin Theme Manager
 * 
 * 管理插件注入的全局样式，支持：
 * 1. 动态注册/注销样式
 * 2. 样式优先级管理
 * 3. 插件卸载时自动清理
 * 4. 样式热更新
 */
import logger from './logger';

class PluginThemeManager {
  constructor() {
    // 存储插件样式: Map<pluginId, Map<styleId, {css, priority, element}>>
    this.pluginStyles = new Map()

    // 样式容器元素
    this.containerElement = null

    // 初始化容器
    this.initializeContainer()
  }

  /**
   * 初始化样式容器
   */
  initializeContainer() {
    // 创建或获取样式容器
    let container = document.getElementById('Flota-plugin-themes')

    if (!container) {
      container = document.createElement('div')
      container.id = 'Flota-plugin-themes'
      container.style.display = 'none'
      document.head.appendChild(container)
    }

    this.containerElement = container
  }

  /**
   * 注册插件样式
   * @param {string} pluginId - 插件ID
   * @param {string} styleId - 样式ID（插件内唯一）
   * @param {string} css - CSS内容
   * @param {number} priority - 优先级（数字越大优先级越高）
   * @returns {boolean} 是否成功注册
   */
  registerStyle(pluginId, styleId, css, priority = 0) {
    if (!pluginId || !styleId || !css) {
      console.error('[PluginThemeManager] 参数不完整', { pluginId, styleId })
      return false
    }

    // 确保插件的样式Map存在
    if (!this.pluginStyles.has(pluginId)) {
      this.pluginStyles.set(pluginId, new Map())
    }

    const pluginStylesMap = this.pluginStyles.get(pluginId)

    // 如果样式已存在，先移除旧的
    if (pluginStylesMap.has(styleId)) {
      this.unregisterStyle(pluginId, styleId)
    }

    // 创建样式元素
    const styleElement = document.createElement('style')
    styleElement.id = `plugin-theme-${pluginId}-${styleId}`
    styleElement.setAttribute('data-plugin-id', pluginId)
    styleElement.setAttribute('data-style-id', styleId)
    styleElement.setAttribute('data-priority', priority.toString())
    styleElement.textContent = css

    // 根据优先级插入到合适位置
    this.insertStyleByPriority(styleElement, priority)

    // 保存引用
    pluginStylesMap.set(styleId, {
      css,
      priority,
      element: styleElement
    })

    logger.log(`[PluginThemeManager] 已注册样式: ${pluginId}/${styleId} (优先级: ${priority})`)
    return true
  }

  /**
   * 根据优先级插入样式元素
   * @param {HTMLStyleElement} newElement - 新样式元素
   * @param {number} priority - 优先级
   */
  insertStyleByPriority(newElement, priority) {
    const existingStyles = Array.from(this.containerElement.children)

    // 找到第一个优先级更低的位置
    let insertBefore = null
    for (const style of existingStyles) {
      const stylePriority = parseInt(style.getAttribute('data-priority') || '0', 10)
      if (stylePriority < priority) {
        insertBefore = style
        break
      }
    }

    if (insertBefore) {
      this.containerElement.insertBefore(newElement, insertBefore)
    } else {
      this.containerElement.appendChild(newElement)
    }
  }

  /**
   * 注销插件样式
   * @param {string} pluginId - 插件ID
   * @param {string} styleId - 样式ID
   * @returns {boolean} 是否成功注销
   */
  unregisterStyle(pluginId, styleId) {
    if (!pluginId || !styleId) {
      console.warn('[PluginThemeManager] unregisterStyle: 参数不完整', { pluginId, styleId })
      return false
    }

    const pluginStylesMap = this.pluginStyles.get(pluginId)

    // 即使内存中没有记录，也尝试从 DOM 中移除（兜底）
    const elementId = `plugin-theme-${pluginId}-${styleId}`
    const existingElement = document.getElementById(elementId)
    if (existingElement) {
      logger.log(`[PluginThemeManager] 从DOM移除样式元素: ${elementId}`)
      existingElement.remove()
    }

    if (!pluginStylesMap || !pluginStylesMap.has(styleId)) {
      logger.log(`[PluginThemeManager] 样式未在内存中注册: ${pluginId}/${styleId}`)
      return existingElement ? true : false
    }

    const styleInfo = pluginStylesMap.get(styleId)

    // 移除DOM元素
    if (styleInfo.element && styleInfo.element.parentNode) {
      styleInfo.element.parentNode.removeChild(styleInfo.element)
    }

    // 移除引用
    pluginStylesMap.delete(styleId)

    // 如果插件没有其他样式了，清理插件Map
    if (pluginStylesMap.size === 0) {
      this.pluginStyles.delete(pluginId)
    }

    logger.log(`[PluginThemeManager] 已注销样式: ${pluginId}/${styleId}`)
    return true
  }

  /**
   * 更新插件样式
   * @param {string} pluginId - 插件ID
   * @param {string} styleId - 样式ID
   * @param {string} css - 新的CSS内容
   * @param {number|null} priority - 新的优先级（null表示不改变）
   * @returns {boolean} 是否成功更新
   */
  updateStyle(pluginId, styleId, css, priority = null) {
    if (!pluginId || !styleId || !css) {
      return false
    }

    const pluginStylesMap = this.pluginStyles.get(pluginId)
    if (!pluginStylesMap || !pluginStylesMap.has(styleId)) {
      // 样式不存在，直接注册
      return this.registerStyle(pluginId, styleId, css, priority || 0)
    }

    const styleInfo = pluginStylesMap.get(styleId)
    const newPriority = priority !== null ? priority : styleInfo.priority

    // 如果优先级改变，需要重新插入
    if (newPriority !== styleInfo.priority) {
      // 先移除再重新注册
      this.unregisterStyle(pluginId, styleId)
      return this.registerStyle(pluginId, styleId, css, newPriority)
    }

    // 只更新CSS内容
    styleInfo.css = css
    styleInfo.element.textContent = css

    logger.log(`[PluginThemeManager] 已更新样式: ${pluginId}/${styleId}`)
    return true
  }

  /**
   * 移除插件的所有样式
   * @param {string} pluginId - 插件ID
   * @returns {number} 移除的样式数量
   */
  unregisterAllStyles(pluginId) {
    if (!pluginId) {
      return 0
    }

    let count = 0

    // 先从内存中移除
    const pluginStylesMap = this.pluginStyles.get(pluginId)
    if (pluginStylesMap) {
      const styleIds = Array.from(pluginStylesMap.keys())
      for (const styleId of styleIds) {
        if (this.unregisterStyle(pluginId, styleId)) {
          count++
        }
      }
    }

    // 兜底：直接从 DOM 中查找并移除该插件的所有样式
    const allPluginStyles = document.querySelectorAll(`[data-plugin-id="${pluginId}"]`)
    allPluginStyles.forEach(el => {
      logger.log(`[PluginThemeManager] 兜底移除DOM样式: ${el.id}`)
      el.remove()
      count++
    })

    logger.log(`[PluginThemeManager] 已清理插件所有样式: ${pluginId} (共 ${count} 个)`)
    return count
  }

  /**
   * 获取插件的所有样式
   * @param {string} pluginId - 插件ID
   * @returns {Array} 样式信息数组
   */
  getPluginStyles(pluginId) {
    const pluginStylesMap = this.pluginStyles.get(pluginId)
    if (!pluginStylesMap) {
      return []
    }

    return Array.from(pluginStylesMap.entries()).map(([styleId, info]) => ({
      styleId,
      css: info.css,
      priority: info.priority
    }))
  }

  /**
   * 获取所有插件样式统计
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      totalPlugins: this.pluginStyles.size,
      totalStyles: 0,
      byPlugin: {}
    }

    for (const [pluginId, stylesMap] of this.pluginStyles.entries()) {
      const count = stylesMap.size
      stats.totalStyles += count
      stats.byPlugin[pluginId] = count
    }

    return stats
  }

  /**
   * 清理所有插件样式（谨慎使用）
   */
  clearAll() {
    // 移除所有样式元素
    while (this.containerElement.firstChild) {
      this.containerElement.removeChild(this.containerElement.firstChild)
    }

    // 清空Map
    this.pluginStyles.clear()

    logger.log('[PluginThemeManager] 已清理所有插件样式')
  }
}

// 创建单例
const themeManager = new PluginThemeManager()

// 导出单例和类
export { themeManager as default, PluginThemeManager }
