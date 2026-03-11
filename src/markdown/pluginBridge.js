/**
 * Markdown 插件桥接
 * 将 Markdown 扩展功能暴露给 Flota 插件系统
 */

import { createMarkdownRenderer, registerPlugin } from './index.js'
import logger from '../utils/logger'

/**
 * Markdown 扩展 API
 * 供插件系统使用
 */
export class MarkdownExtensionAPI {
  constructor() {
    this.customPlugins = new Map()
    this.rendererInstance = null
  }

  /**
   * 注册自定义 Markdown 插件
   * @param {string} pluginId - 插件 ID
   * @param {Object} config - 插件配置
   * @param {string} config.name - 插件名称
   * @param {Function} config.plugin - markdown-it 插件函数
   * @param {Object} config.options - 插件选项
   * @returns {Promise<boolean>} 是否成功
   */
  async registerMarkdownPlugin(pluginId, config) {
    try {
      const { name, plugin, options = {} } = config

      if (!name || typeof plugin !== 'function') {
        throw new Error('Invalid plugin configuration')
      }

      // 存储插件配置
      this.customPlugins.set(pluginId, { name, plugin, options })

      // 如果渲染器已存在，重新创建以应用新插件
      if (this.rendererInstance) {
        this.recreateRenderer()
      }

      logger.log(`[MarkdownExtension] 注册插件: ${name} (${pluginId})`)
      return true
    } catch (error) {
      console.error(`[MarkdownExtension] 注册插件失败:`, error)
      return false
    }
  }

  /**
   * 注销 Markdown 插件
   * @param {string} pluginId - 插件 ID
   * @returns {Promise<boolean>} 是否成功
   */
  async unregisterMarkdownPlugin(pluginId) {
    try {
      if (!this.customPlugins.has(pluginId)) {
        return false
      }

      this.customPlugins.delete(pluginId)

      // 重新创建渲染器
      if (this.rendererInstance) {
        this.recreateRenderer()
      }

      logger.log(`[MarkdownExtension] 注销插件: ${pluginId}`)
      return true
    } catch (error) {
      console.error(`[MarkdownExtension] 注销插件失败:`, error)
      return false
    }
  }

  /**
   * 获取渲染器实例
   * @param {Object} options - 渲染器选项
   * @returns {MarkdownIt} 渲染器实例
   */
  getRenderer(options = {}) {
    if (!this.rendererInstance) {
      this.rendererInstance = this.createRendererWithPlugins(options)
    }
    return this.rendererInstance
  }

  /**
   * 重新创建渲染器（应用所有自定义插件）
   */
  recreateRenderer() {
    this.rendererInstance = this.createRendererWithPlugins()
  }

  /**
   * 创建包含所有自定义插件的渲染器
   * @param {Object} options - 渲染器选项
   * @returns {MarkdownIt} 渲染器实例
   */
  createRendererWithPlugins(options = {}) {
    const md = createMarkdownRenderer(options)

    // 应用所有自定义插件
    for (const [pluginId, config] of this.customPlugins.entries()) {
      try {
        registerPlugin(md, config.plugin, config.options)
        logger.log(`[MarkdownExtension] 应用插件: ${config.name}`)
      } catch (error) {
        console.error(`[MarkdownExtension] 应用插件失败 (${pluginId}):`, error)
      }
    }

    return md
  }

  /**
   * 渲染 Markdown 文本
   * @param {string} markdown - Markdown 文本
   * @param {Object} options - 渲染选项
   * @returns {string} HTML 字符串
   */
  render(markdown, options = {}) {
    const md = this.getRenderer(options)
    return md.render(markdown)
  }

  /**
   * 获取已注册的插件列表
   * @returns {Array} 插件列表
   */
  getRegisteredPlugins() {
    return Array.from(this.customPlugins.entries()).map(([id, config]) => ({
      id,
      name: config.name
    }))
  }

  /**
   * 清除所有自定义插件
   */
  clearPlugins() {
    this.customPlugins.clear()
    this.rendererInstance = null
  }
}

// 创建全局实例
export const markdownExtension = new MarkdownExtensionAPI()

/**
 * 为插件系统提供的 Markdown 扩展接口
 */
export function createMarkdownExtensionInterface() {
  return {
    /**
     * 注册自定义 Markdown 插件
     */
    registerPlugin: async (config) => {
      // 从调用栈获取插件 ID（由插件管理器注入）
      const pluginId = config.pluginId || 'unknown'
      return await markdownExtension.registerMarkdownPlugin(pluginId, config)
    },

    /**
     * 注销插件
     */
    unregisterPlugin: async (pluginId) => {
      return await markdownExtension.unregisterMarkdownPlugin(pluginId)
    },

    /**
     * 渲染 Markdown
     */
    render: (markdown, options) => {
      return markdownExtension.render(markdown, options)
    },

    /**
     * 获取已注册的插件
     */
    getPlugins: () => {
      return markdownExtension.getRegisteredPlugins()
    }
  }
}

/**
 * 集成到插件 Runtime API
 * 在 PluginManager 中调用此函数来注册 Markdown 扩展 API
 */
export function integrateMarkdownExtension(pluginManager) {
  // 为每个插件提供 markdown 命名空间
  const originalHandleRpc = pluginManager.handleRpc.bind(pluginManager)

  pluginManager.handleRpc = async function(pluginId, message) {
    const { scope, action, payload } = message

    // 处理 markdown 作用域的 RPC 调用
    if (scope === 'markdown') {
      return await handleMarkdownRpc(pluginId, action, payload, this)
    }

    // 其他作用域使用原始处理器
    return await originalHandleRpc(pluginId, message)
  }

  logger.log('[MarkdownExtension] 已集成到插件系统')
}

/**
 * 处理 Markdown 相关的 RPC 调用
 */
async function handleMarkdownRpc(pluginId, action, payload, pluginManager) {
  try {
    // 检查权限
    pluginManager.assertPermission(pluginId, 'markdown:extend')

    let result

    switch (action) {
      case 'registerPlugin': {
        const { name, plugin, options } = payload
        
        // 注意：plugin 是序列化后的函数字符串，需要在 Worker 中处理
        // 这里只是示例，实际实现需要更复杂的处理
        result = await markdownExtension.registerMarkdownPlugin(pluginId, {
          name,
          plugin: eval(`(${plugin})`), // 注意：生产环境需要更安全的方式
          options
        })
        break
      }

      case 'unregisterPlugin': {
        result = await markdownExtension.unregisterMarkdownPlugin(pluginId)
        break
      }

      case 'render': {
        const { markdown, options } = payload
        result = markdownExtension.render(markdown, options)
        break
      }

      case 'getPlugins': {
        result = markdownExtension.getRegisteredPlugins()
        break
      }

      default:
        throw new Error(`未知的 Markdown RPC 动作: ${action}`)
    }

    return { success: true, result }
  } catch (error) {
    console.error(`[MarkdownExtension] RPC 处理失败 (${pluginId}):`, error)
    return { success: false, error: error.message }
  }
}

export default {
  MarkdownExtensionAPI,
  markdownExtension,
  createMarkdownExtensionInterface,
  integrateMarkdownExtension
}
