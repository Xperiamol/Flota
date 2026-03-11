/**
 * Markdown 到白板（Excalidraw）的转换工具
 * 将 Markdown 文本内容转换为 Excalidraw 元素
 * 支持：标题、段落、列表、代码块、图片
 */
import logger from './logger';

/**
 * 解析 Markdown 内容，提取标题、段落、列表、代码块和图片
 * @param {string} content - Markdown 内容
 * @returns {Array} 解析后的文本块数组
 */
function parseMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return []
  }

  const lines = content.split('\n')
  const blocks = []
  let inCodeBlock = false
  let codeBlockContent = []
  let codeBlockLang = ''
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()
    
    // 处理代码块
    if (trimmedLine.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockLang = trimmedLine.slice(3).trim()
        codeBlockContent = []
      } else {
        inCodeBlock = false
        blocks.push({
          type: 'codeblock',
          text: codeBlockContent.join('\n'),
          language: codeBlockLang,
          fontSize: 14
        })
      }
      continue
    }
    
    if (inCodeBlock) {
      codeBlockContent.push(line)
      continue
    }
    
    // 跳过空行
    if (trimmedLine === '') continue
    
    // 识别独立行的图片 ![alt](url)
    const standaloneImageMatch = trimmedLine.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
    if (standaloneImageMatch) {
      blocks.push({
        type: 'image',
        alt: standaloneImageMatch[1],
        url: standaloneImageMatch[2]
      })
      continue
    }
    
    // 检查行内是否包含图片，如果有则分割处理
    const inlineImageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
    if (inlineImageRegex.test(trimmedLine)) {
      // 重置 regex
      inlineImageRegex.lastIndex = 0
      
      // 分割文本和图片
      let lastIndex = 0
      let match
      
      while ((match = inlineImageRegex.exec(trimmedLine)) !== null) {
        // 添加图片前的文本
        const textBefore = trimmedLine.substring(lastIndex, match.index).trim()
        if (textBefore) {
          blocks.push({
            type: 'paragraph',
            text: textBefore,
            fontSize: 16
          })
        }
        
        // 添加图片
        blocks.push({
          type: 'image',
          alt: match[1],
          url: match[2]
        })
        
        lastIndex = match.index + match[0].length
      }
      
      // 添加图片后的文本
      const textAfter = trimmedLine.substring(lastIndex).trim()
      if (textAfter) {
        blocks.push({
          type: 'paragraph',
          text: textAfter,
          fontSize: 16
        })
      }
      continue
    }
    
    // 识别标题级别 (# H1, ## H2, etc.)
    const headerMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      const level = headerMatch[1].length
      const text = headerMatch[2]
      blocks.push({
        type: 'header',
        level: level,
        text: text,
        fontSize: getHeaderFontSize(level)
      })
      continue
    }
    
    // 识别无序列表
    const ulMatch = trimmedLine.match(/^[-*+]\s+(.+)$/)
    if (ulMatch) {
      blocks.push({
        type: 'listitem',
        text: '• ' + ulMatch[1],
        fontSize: 16
      })
      continue
    }
    
    // 识别有序列表
    const olMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/)
    if (olMatch) {
      blocks.push({
        type: 'listitem',
        text: olMatch[1] + '. ' + olMatch[2],
        fontSize: 16
      })
      continue
    }
    
    // 识别引用
    const quoteMatch = trimmedLine.match(/^>\s*(.*)$/)
    if (quoteMatch) {
      blocks.push({
        type: 'quote',
        text: quoteMatch[1],
        fontSize: 16
      })
      continue
    }
    
    // 识别分隔线
    if (/^[-*_]{3,}$/.test(trimmedLine)) {
      blocks.push({
        type: 'divider'
      })
      continue
    }
    
    // 普通文本段落（移除行内格式标记用于显示）
    let cleanText = trimmedLine
      .replace(/\*\*([^*]+)\*\*/g, '$1')  // 粗体
      .replace(/\*([^*]+)\*/g, '$1')       // 斜体
      .replace(/`([^`]+)`/g, '$1')         // 行内代码
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 链接
    
    blocks.push({
      type: 'paragraph',
      text: cleanText,
      fontSize: 16
    })
  }
  
  return blocks
}

/**
 * 根据标题级别获取字体大小
 * @param {number} level - 标题级别 (1-6)
 * @returns {number} 字体大小（px）
 */
function getHeaderFontSize(level) {
  const sizes = {
    1: 32,
    2: 28,
    3: 24,
    4: 20,
    5: 18,
    6: 16
  }
  return sizes[level] || 16
}

/**
 * 生成唯一的元素 ID
 * @returns {string} 唯一 ID
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 将解析的文本块转换为 Excalidraw 元素
 * @param {Array} blocks - 解析后的文本块数组
 * @param {Object} imageDataMap - 图片数据映射 {url: {dataURL, mimeType}}
 * @returns {Object} { elements, fileMap }
 */
function generateExcalidrawElements(blocks, imageDataMap = {}) {
  const elements = []
  const fileMap = {}
  let currentY = 100 // 起始Y坐标
  const startX = 100 // 起始X坐标
  const lineSpacing = 20 // 基础行间距
  const maxWidth = 800 // 文本框最大宽度
  
  blocks.forEach((block) => {
    // 处理分隔线
    if (block.type === 'divider') {
      const element = {
        id: generateId(),
        type: 'line',
        x: startX,
        y: currentY + 10,
        width: 600,
        height: 0,
        angle: 0,
        strokeColor: '#cccccc',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        strokeStyle: 'solid',
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        roundness: { type: 2 },
        seed: Math.floor(Math.random() * 1000000),
        version: 1,
        versionNonce: Math.floor(Math.random() * 1000000),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
        points: [[0, 0], [600, 0]],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: null
      }
      elements.push(element)
      currentY += 40
      return
    }
    
    // 处理图片
    if (block.type === 'image') {
      const imageData = imageDataMap[block.url]
      if (imageData && imageData.dataURL) {
        const fileId = generateId()
        const imgWidth = 400
        const imgHeight = 300
        
        // 创建图片元素
        const element = {
          id: generateId(),
          type: 'image',
          x: startX,
          y: currentY,
          width: imgWidth,
          height: imgHeight,
          angle: 0,
          strokeColor: 'transparent',
          backgroundColor: 'transparent',
          fillStyle: 'solid',
          strokeWidth: 0,
          strokeStyle: 'solid',
          roughness: 0,
          opacity: 100,
          groupIds: [],
          frameId: null,
          roundness: null,
          seed: Math.floor(Math.random() * 1000000),
          version: 1,
          versionNonce: Math.floor(Math.random() * 1000000),
          isDeleted: false,
          boundElements: null,
          updated: Date.now(),
          link: null,
          locked: false,
          status: 'saved',
          fileId: fileId,
          scale: [1, 1]
        }
        
        elements.push(element)
        
        // 添加到 fileMap
        fileMap[fileId] = {
          mimeType: imageData.mimeType || 'image/png',
          id: fileId,
          dataURL: imageData.dataURL,
          created: Date.now()
        }
        
        currentY += imgHeight + lineSpacing * 2
      }
      return
    }
    
    // 处理文本类型的块
    if (!block.text) return
    
    // 计算文本框高度（根据字体大小）
    const lineHeight = block.fontSize * 1.5
    const estimatedLines = Math.ceil(block.text.length / 50) // 粗略估算行数
    const height = lineHeight * Math.max(1, estimatedLines)
    
    // 根据类型设置不同的样式
    let strokeColor = '#1e1e1e'
    let xOffset = 0
    
    if (block.type === 'quote') {
      strokeColor = '#666666'
      xOffset = 20
    } else if (block.type === 'codeblock') {
      strokeColor = '#0066cc'
    }
    
    // 创建 Excalidraw 文本元素
    const element = {
      id: generateId(),
      type: 'text',
      x: startX + xOffset,
      y: currentY,
      width: maxWidth,
      height: height,
      angle: 0,
      strokeColor: strokeColor,
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: Math.floor(Math.random() * 1000000),
      version: 1,
      versionNonce: Math.floor(Math.random() * 1000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      text: block.text,
      fontSize: block.fontSize,
      fontFamily: block.type === 'codeblock' ? 3 : 1, // 代码块使用等宽字体
      textAlign: 'left',
      verticalAlign: 'top',
      baseline: block.fontSize,
      containerId: null,
      originalText: block.text,
      lineHeight: 1.25
    }
    
    elements.push(element)
    
    // 计算下一个元素的Y坐标
    currentY += height + lineSpacing
    
    // 标题后额外间距
    if (block.type === 'header') {
      currentY += lineSpacing * 1.5
    }
    // 代码块后额外间距
    if (block.type === 'codeblock') {
      currentY += lineSpacing
    }
  })
  
  return { elements, fileMap }
}

/**
 * 将 Markdown 内容转换为白板数据
 * @param {string} markdownContent - Markdown 文本内容
 * @param {Object} imageDataMap - 图片数据映射（可选）
 * @returns {string} JSON 格式的白板数据
 */
export function convertMarkdownToWhiteboard(markdownContent, imageDataMap = {}) {
  try {
    logger.log('[convertMarkdownToWhiteboard] 输入内容长度:', markdownContent?.length || 0)
    logger.log('[convertMarkdownToWhiteboard] 输入内容前100字符:', markdownContent?.substring(0, 100))
    
    // 1. 解析 Markdown
    const blocks = parseMarkdown(markdownContent)
    logger.log('[convertMarkdownToWhiteboard] 解析得到的blocks数量:', blocks.length)
    logger.log('[convertMarkdownToWhiteboard] 解析得到的blocks:', blocks)
    
    // 如果没有内容，返回空白板
    if (blocks.length === 0) {
      logger.log('[convertMarkdownToWhiteboard] blocks为空，返回空白板')
      return JSON.stringify({
        type: 'excalidraw',
        version: 2,
        source: 'Flota-local',
        elements: [],
        appState: {
          viewBackgroundColor: '#ffffff',
          currentItemFontFamily: 1,
          gridSize: null
        },
        fileMap: {}
      })
    }
    
    // 2. 生成 Excalidraw 元素（包括图片）
    const { elements, fileMap } = generateExcalidrawElements(blocks, imageDataMap)
    logger.log('[convertMarkdownToWhiteboard] 生成的elements数量:', elements.length)
    logger.log('[convertMarkdownToWhiteboard] 生成的fileMap:', Object.keys(fileMap))
    
    // 3. 构建完整的白板数据
    const whiteboardData = {
      type: 'excalidraw',
      version: 2,
      source: 'Flota-local',
      elements: elements,
      appState: {
        viewBackgroundColor: '#ffffff',
        currentItemFontFamily: 1,
        gridSize: null
      },
      fileMap: fileMap
    }
    
    return JSON.stringify(whiteboardData)
  } catch (error) {
    console.error('[markdownToWhiteboardConverter] 转换失败:', error)
    throw new Error('Markdown 转换失败: ' + error.message)
  }
}

/**
 * 将白板数据转换为 Markdown 内容
 * @param {string} whiteboardContent - JSON 格式的白板数据
 * @returns {Object} { markdown, imageMap } - Markdown 文本和图片映射
 */
export function convertWhiteboardToMarkdown(whiteboardContent) {
  try {
    if (!whiteboardContent) {
      return { markdown: '', imageMap: {} }
    }
    
    const data = typeof whiteboardContent === 'string' 
      ? JSON.parse(whiteboardContent) 
      : whiteboardContent
    
    if (!data.elements || data.elements.length === 0) {
      return { markdown: '', imageMap: {} }
    }
    
    const elements = data.elements.filter(el => !el.isDeleted)
    const fileMap = data.fileMap || {}
    const imageMap = {}
    
    // 按 Y 坐标排序元素
    const sortedElements = [...elements].sort((a, b) => {
      const yDiff = a.y - b.y
      if (Math.abs(yDiff) < 20) {
        return a.x - b.x
      }
      return yDiff
    })
    
    const markdownLines = []
    
    for (const element of sortedElements) {
      if (element.type === 'text' && element.text) {
        // 根据字体大小推断标题级别
        const fontSize = element.fontSize || 16
        let text = element.text.trim()
        
        if (fontSize >= 32) {
          markdownLines.push(`# ${text}`)
        } else if (fontSize >= 28) {
          markdownLines.push(`## ${text}`)
        } else if (fontSize >= 24) {
          markdownLines.push(`### ${text}`)
        } else if (fontSize >= 20) {
          markdownLines.push(`#### ${text}`)
        } else {
          // 检测是否是列表项
          if (text.startsWith('• ') || text.startsWith('- ')) {
            markdownLines.push(`- ${text.replace(/^[•\-]\s*/, '')}`)
          } else if (/^\d+\.\s/.test(text)) {
            markdownLines.push(text)
          } else {
            markdownLines.push(text)
          }
        }
        markdownLines.push('')
      } else if (element.type === 'image' && element.fileId) {
        // 处理图片
        const fileData = fileMap[element.fileId]
        if (fileData) {
          // 白板存储格式有两种：
          // 1. 从 Markdown 转换来的：{ dataURL, mimeType }
          // 2. 从文件系统保存的：{ fileName, mimeType, created }
          
          const imageName = `whiteboard_image_${element.fileId.substring(0, 8)}`
          const ext = (fileData.mimeType || 'image/png').split('/')[1] || 'png'
          const outputFileName = `${imageName}.${ext}`
          
          // 保存图片数据供后续处理
          imageMap[outputFileName] = {
            dataURL: fileData.dataURL || null,  // 可能为空
            mimeType: fileData.mimeType || 'image/png',
            // 如果是文件系统存储的，保存原始文件名以便加载
            sourceFileName: fileData.fileName || null,
            fileId: element.fileId
          }
          
          // 使用占位符，后续会替换为实际路径
          markdownLines.push(`![${imageName}]({{IMAGE_PLACEHOLDER:${outputFileName}}})`)
          markdownLines.push('')
        }
      } else if (element.type === 'line') {
        // 分隔线
        markdownLines.push('---')
        markdownLines.push('')
      }
    }
    
    // 清理多余的空行
    let markdown = markdownLines.join('\n')
    markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()
    
    return { markdown, imageMap }
  } catch (error) {
    console.error('[whiteboardToMarkdownConverter] 转换失败:', error)
    return { markdown: '', imageMap: {} }
  }
}

/**
 * 从 Markdown 中提取图片 URL 列表
 * @param {string} markdownContent - Markdown 内容
 * @returns {Array} 图片 URL 数组
 */
export function extractImageUrls(markdownContent) {
  if (!markdownContent) return []
  
  const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g
  const urls = []
  let match
  
  while ((match = imageRegex.exec(markdownContent)) !== null) {
    urls.push(match[1])
  }
  
  return urls
}

/**
 * 预览转换结果（用于调试）
 * @param {string} markdownContent - Markdown 文本内容
 * @returns {Object} 包含元素数量和预览信息的对象
 */
export function previewConversion(markdownContent) {
  const blocks = parseMarkdown(markdownContent)
  const { elements } = generateExcalidrawElements(blocks)
  
  return {
    blockCount: blocks.length,
    elementCount: elements.length,
    blocks: blocks,
    preview: elements.map(el => ({
      type: el.type,
      text: el.text ? el.text.substring(0, 50) + (el.text.length > 50 ? '...' : '') : '',
      fontSize: el.fontSize,
      position: { x: el.x, y: el.y }
    }))
  }
}