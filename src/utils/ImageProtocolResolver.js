/**
 * 图片协议解析器
 * 支持 app:// 协议，自动处理本地和云端图片
 */
import logger from './logger';

class ImageProtocolResolver {
  constructor() {
    this.cache = new Map(); // 图片缓存
    this.pendingRequests = new Map(); // 防止重复请求
  }

  /**
   * 解析图片 URL
   * @param {string} src - 原始图片路径
   * @returns {Promise<string>} file:// URL 或其他 URL
   */
  async resolve(src) {
    if (!src) return null;

    // 1. 如果已经是 base64，直接返回
    if (src.startsWith('data:image/')) {
      return src;
    }

    // 2. 如果是 HTTP/HTTPS URL，直接返回
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }

    // 3. 如果已经是 file:// 协议，直接返回
    if (src.startsWith('file://')) {
      return src;
    }

    // 4. 处理 app:// 协议
    if (src.startsWith('app://')) {
      return await this.resolveAppProtocol(src);
    }

    // 5. 处理相对路径（如 images/xxx.png）
    if (src.startsWith('images/')) {
      return await this.resolveLocalPath(src);
    }

    // 6. 其他情况，尝试作为本地路径处理
    return await this.resolveLocalPath(src);
  }

  /**
   * 解析 app:// 协议
   * @param {string} appUrl - app://images/xxx.png
   */
  async resolveAppProtocol(appUrl) {
    const relativePath = appUrl.replace('app://', '');
    
    // 检查缓存
    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath);
    }

    // 检查是否有正在进行的请求
    if (this.pendingRequests.has(relativePath)) {
      return await this.pendingRequests.get(relativePath);
    }

    // 创建新的请求
    const requestPromise = this.fetchImage(relativePath);
    this.pendingRequests.set(relativePath, requestPromise);

    try {
      const base64Data = await requestPromise;
      
      // 缓存结果
      this.cache.set(relativePath, base64Data);
      
      return base64Data;
    } finally {
      this.pendingRequests.delete(relativePath);
    }
  }

  /**
   * 解析本地路径
   */
  async resolveLocalPath(relativePath) {
    // 检查缓存
    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath);
    }

    // 检查是否有正在进行的请求
    if (this.pendingRequests.has(relativePath)) {
      return await this.pendingRequests.get(relativePath);
    }

    // 创建新的请求
    const requestPromise = this.fetchImage(relativePath);
    this.pendingRequests.set(relativePath, requestPromise);

    try {
      const base64Data = await requestPromise;
      
      // 缓存结果
      this.cache.set(relativePath, base64Data);
      
      return base64Data;
    } finally {
      this.pendingRequests.delete(relativePath);
    }
  }

  /**
   * 获取图片本地文件路径
   * 优先从本地加载，失败则尝试从云端下载
   */
  async fetchImage(relativePath) {
    logger.log(`[ImageResolver] fetchImage 开始:`, relativePath)
    
    try {
      // 1. 检查本地文件是否存在
      logger.log(`[ImageResolver] 调用 images.getPath:`, relativePath)
      const pathResult = await window.electronAPI.images.getPath(relativePath);
      logger.log(`[ImageResolver] getPath 返回:`, pathResult)
      
      if (pathResult.success && pathResult.data) {
        // 返回 app:// 协议（Electron 会处理）
        const appUrl = `app://${relativePath}`;
        logger.log(`[ImageResolver] 返回 app:// URL:`, appUrl)
        return appUrl;
      }
    } catch (localError) {
      console.warn(`[ImageResolver] 获取本地图片路径失败 (${relativePath}):`, localError.message);
    }

    try {
      // 2. 本地不存在，尝试从云端下载
      logger.log(`[ImageResolver] 尝试从云端下载图片: ${relativePath}`);
      
      const downloadResult = await window.electronAPI.sync.downloadImage(relativePath);
      logger.log(`[ImageResolver] 云端下载结果:`, downloadResult)
      
      if (downloadResult.success) {
        // 下载成功后，返回 app:// URL
        const appUrl = `app://${relativePath}`;
        logger.log(`[ImageResolver] 下载成功，返回 app:// URL:`, appUrl)
        return appUrl;
      }
    } catch (cloudError) {
      console.warn(`[ImageResolver] 云端下载图片失败 (${relativePath}):`, cloudError.message);
    }

    // 3. 都失败了，返回占位图
    console.error(`[ImageResolver] 图片加载完全失败:`, relativePath)
    return this.getPlaceholderImage();
  }

  /**
   * 获取占位图（图片加载失败时显示）
   */
  getPlaceholderImage() {
    // 返回一个简单的灰色占位图 SVG
    const svg = `
      <svg width="200" height="150" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="150" fill="#f0f0f0"/>
        <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#999" font-family="Arial" font-size="14">
          图片加载失败
        </text>
      </svg>
    `;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 预加载图片
   */
  async preload(srcList) {
    const promises = srcList.map(src => this.resolve(src));
    await Promise.allSettled(promises);
  }
}

// 单例模式
let instance = null;

export function getImageResolver() {
  if (!instance) {
    instance = new ImageProtocolResolver();
  }
  return instance;
}

export default ImageProtocolResolver;