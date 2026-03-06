import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Box, Typography, Modal, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import { scrollbar } from '../styles/commonStyles'
import { imageAPI } from '../api/imageAPI'
import { getImageResolver } from '../utils/ImageProtocolResolver'
import { createMarkdownRenderer } from '../markdown/index.js'
import { useError } from './ErrorProvider'
import '../markdown/markdown.css'
import 'highlight.js/styles/github.css'
import logger from '../utils/logger'

// 自定义图片组件 - 支持 app:// 协议和云端图片
const CustomImage = ({ src, alt, ...props }) => {
  const [imageSrc, setImageSrc] = useState(src)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const loadImage = async () => {
      if (!src) {
        setLoading(false)
        setError(true)
        return
      }

      try {
        // 使用协议解析器处理所有类型的图片路径
        const resolver = getImageResolver()
        const resolvedSrc = await resolver.resolve(src)

        if (resolvedSrc) {
          setImageSrc(resolvedSrc)
          setError(false)
        } else {
          setError(true)
        }
      } catch (err) {
        console.error('加载图片失败:', err)
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    loadImage()
  }, [src])

  if (loading) {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '8px',
          border: '1px dashed #ccc',
          borderRadius: '4px',
          color: '#666'
        }}
      >
        加载中...
      </span>
    )
  }

  if (error) {
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '8px',
          border: '1px solid #f44336',
          borderRadius: '4px',
          color: '#f44336',
          backgroundColor: 'rgba(244, 67, 54, 0.1)'
        }}
      >
        图片加载失败: {alt || src}
      </span>
    )
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      {...props}
      style={{
        maxWidth: '100%',
        height: 'auto',
        borderRadius: '4px',
        ...props.style
      }}
      onError={() => setError(true)}
    />
  )
}

const MarkdownPreview = ({ content, sx, onWikiLinkClick, onTagClick }) => {
  const { showSuccess, showError } = useError()
  const [renderedHTML, setRenderedHTML] = useState('')
  // 图片预览状态
  const [previewImage, setPreviewImage] = useState(null)
  const [imageZoom, setImageZoom] = useState(1)
  // 图片拖动状态
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
  // 模态框容器引用
  const modalContainerRef = useRef(null)

  // 创建 Markdown 渲染器实例（使用 useMemo 避免重复创建）
  const md = useMemo(() => {
    return createMarkdownRenderer({
      onWikiLinkClick,
      onTagClick,
      pluginOptions: {
        highlight: {
          className: 'markdown-highlight'
        },
        colorText: {
          className: 'markdown-color-text'
        },
        callout: {
          className: 'markdown-callout'
        },
        wikiLink: {
          className: 'markdown-wiki-link',
          baseUrl: '#note/'
        },
        tag: {
          className: 'markdown-tag'
        },
        customContainer: {
          className: 'markdown-container'
        }
      }
    })
  }, [onWikiLinkClick, onTagClick])

  // 渲染 Markdown 内容
  useEffect(() => {
    if (!content || content.trim() === '') {
      setRenderedHTML('')
      return
    }

    try {
      const html = md.render(content)
      setRenderedHTML(html)
    } catch (error) {
      console.error('Markdown 渲染失败:', error)
      setRenderedHTML(`<div style="color: red;">渲染失败: ${error.message}</div>`)
    }
  }, [content, md])

  // 处理点击事件（Wiki 链接、标签和外部链接）
  useEffect(() => {
    const handleClick = (e) => {
      const target = e.target

      // 处理 Wiki 链接点击
      if (target.classList.contains('markdown-wiki-link')) {
        e.preventDefault()
        const wikiTarget = target.getAttribute('data-wiki-target')
        const wikiSection = target.getAttribute('data-wiki-section')

        if (onWikiLinkClick && wikiTarget) {
          onWikiLinkClick(wikiTarget, wikiSection)
        }
        return
      }

      // 处理标签点击
      if (target.classList.contains('markdown-tag')) {
        e.preventDefault()
        const tag = target.getAttribute('data-tag')

        if (onTagClick && tag) {
          onTagClick(tag)
        }
        return
      }

      // 处理外部链接 - 用外部浏览器打开
      if (target.tagName === 'A' && target.href) {
        const href = target.href
        if (href.startsWith('http://') || href.startsWith('https://')) {
          e.preventDefault()
          window.electronAPI?.system?.openExternal?.(href)
        }
        return
      }
    }

    const previewElement = document.querySelector('.markdown-preview-content')
    if (previewElement) {
      previewElement.addEventListener('click', handleClick)
      return () => {
        previewElement.removeEventListener('click', handleClick)
      }
    }
  }, [onWikiLinkClick, onTagClick])

  // 处理图片加载
  useEffect(() => {
    const loadImages = async () => {
      const previewElement = document.querySelector('.markdown-preview-content')
      if (!previewElement) return

      const images = previewElement.querySelectorAll('img')
      const resolver = getImageResolver()

      logger.log(`[MarkdownPreview] 开始加载 ${images.length} 张图片`)

      // 音频扩展名集合
      const audioExts = new Set(['.m4a', '.mp3', '.ogg', '.wav', '.aac', '.opus', '.flac', '.webm'])

      for (const img of images) {
        const originalSrc = img.getAttribute('src')

        logger.log(`[MarkdownPreview] 图片原始路径:`, originalSrc)

        // ── 音频文件：替换为 <audio> 播放器 ──
        if (originalSrc) {
          const srcLower = originalSrc.toLowerCase()
          const extMatch = srcLower.match(/\.([a-z0-9]+)(?:\?|$)/)
          const ext = extMatch ? '.' + extMatch[1] : ''
          // markdown-it 已将 "audio/xxx" 转为 "app://audio/xxx"，需同时检查两种前缀
          const isAudio = audioExts.has(ext) || originalSrc.startsWith('audio/') || originalSrc.startsWith('app://audio/')

          if (isAudio) {
            // 构造 app:// URL：audio/file.m4a → app://audio/file.m4a
            let appSrc = originalSrc
            if (!originalSrc.startsWith('app://') && !originalSrc.startsWith('http')) {
              appSrc = `app://${originalSrc.replace(/^\/+/, '')}`
            }

            // 创建播放器容器（去掉图标和标签）
            const wrapper = document.createElement('div')
            wrapper.style.cssText = 'margin:8px 0;padding:6px 12px;background:var(--md-audio-bg,rgba(0,0,0,.04));border-radius:10px;'

            // 注入 range thumb 样式（仅首次）
            if (!document.getElementById('_md-audio-style')) {
              const _s = document.createElement('style')
              _s.id = '_md-audio-style'
              _s.textContent = '.md-ap-range{-webkit-appearance:none;appearance:none;flex:1;height:4px;border-radius:2px;cursor:pointer;border:none;outline:none;overflow:visible;padding:0;margin:0}.md-ap-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#1976d2;cursor:pointer}'
              document.head.appendChild(_s)
            }

            const audio = document.createElement('audio')
            audio.preload = 'none'
            audio.src = appSrc

            const playerRow = document.createElement('div')
            playerRow.style.cssText = 'display:flex;align-items:center;gap:8px;'

            const playBtn = document.createElement('button')
            playBtn.textContent = '▶'
            playBtn.style.cssText = 'border:none;background:none;cursor:pointer;padding:0 2px;font-size:14px;color:inherit;line-height:1;flex-shrink:0;opacity:.75;'

            const progressEl = document.createElement('input')
            progressEl.type = 'range'
            progressEl.min = 0; progressEl.max = 1; progressEl.step = '0.01'; progressEl.value = 0
            progressEl.className = 'md-ap-range'
            progressEl.style.background = 'rgba(0,0,0,.15)'

            const timeEl = document.createElement('span')
            timeEl.textContent = '0:00 / –:--'
            timeEl.style.cssText = 'font-size:11px;opacity:.55;min-width:70px;text-align:right;white-space:nowrap;'

            const _fmt = s => (isFinite(s) && s >= 0)
              ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:--'
            const _applyProg = () => {
              const dur = isFinite(audio.duration) ? audio.duration : 0
              const pct = dur > 0 ? (audio.currentTime / dur) * 100 : 0
              progressEl.max = dur || 1
              progressEl.value = audio.currentTime
              progressEl.style.background = `linear-gradient(to right,#1976d2 ${pct}%,rgba(0,0,0,.15) ${pct}%)`
              timeEl.textContent = `${_fmt(audio.currentTime)} / ${_fmt(audio.duration)}`
            }
            let _pl = false
            audio.addEventListener('timeupdate', _applyProg)
            audio.addEventListener('loadedmetadata', _applyProg)
            audio.addEventListener('durationchange', _applyProg)
            audio.addEventListener('ended', () => { _pl = false; playBtn.textContent = '▶'; _applyProg() })
            playBtn.onclick = () => {
              if (_pl) { audio.pause(); _pl = false; playBtn.textContent = '▶' }
              else { audio.play().then(() => { _pl = true; playBtn.textContent = '⏸' }).catch(() => {}) }
            }
            progressEl.oninput = () => { audio.currentTime = Number(progressEl.value); _applyProg() }

            playerRow.appendChild(playBtn)
            playerRow.appendChild(progressEl)
            playerRow.appendChild(timeEl)
            wrapper.appendChild(audio)
            wrapper.appendChild(playerRow)

            // 转文字按钮
            const sttRow = document.createElement('div')
            sttRow.style.cssText = 'margin-top:8px;display:flex;align-items:center;gap:8px;'

            const sttBtn = document.createElement('button')
            sttBtn.textContent = '🗣 转文字'
            sttBtn.style.cssText = 'border:1px solid var(--md-audio-btn-border, rgba(0,0,0,.15));background:var(--md-audio-btn-bg,rgba(0,0,0,.04));border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;color:inherit;transition:background .2s;'
            sttBtn.onmouseenter = () => { sttBtn.style.background = 'var(--md-audio-btn-hover,rgba(0,0,0,.08))' }
            sttBtn.onmouseleave = () => { sttBtn.style.background = 'var(--md-audio-btn-bg,rgba(0,0,0,.04))' }

            const sttResult = document.createElement('div')
            sttResult.style.cssText = 'font-size:13px;line-height:1.6;color:inherit;opacity:.85;display:none;margin-top:6px;white-space:pre-wrap;'

            sttBtn.onclick = async () => {
              sttBtn.disabled = true
              sttBtn.textContent = '⏳ 转文字中…'
              try {
                // 剥离 app:// 协议前缀，IPC 端需要相对路径
                const sttSrc = originalSrc.replace(/^app:\/\//, '')
                const result = await window.electronAPI.stt.transcribe(sttSrc)
                if (result?.success && result?.data?.text) {
                  sttResult.textContent = result.data.text
                  sttResult.style.display = 'block'
                  sttBtn.textContent = '🗣 重新转文字'
                } else {
                  sttBtn.textContent = '❌ 转文字失败'
                  setTimeout(() => { sttBtn.textContent = '🗣 转文字' }, 2000)
                }
              } catch (err) {
                console.error('转文字失败:', err)
                sttBtn.textContent = '❌ 转文字失败'
                setTimeout(() => { sttBtn.textContent = '🗣 转文字' }, 2000)
              } finally {
                sttBtn.disabled = false
              }
            }

            sttRow.appendChild(sttBtn)
            wrapper.appendChild(sttRow)
            wrapper.appendChild(sttResult)

            if (img.parentNode) {
              img.parentNode.replaceChild(wrapper, img)
            }
            logger.log(`[MarkdownPreview] 音频文件已替换为播放器:`, appSrc)
            continue
          }
        }

        // 跳过已经是 data:、file:// 或 http(s) 的图片
        if (!originalSrc || originalSrc.startsWith('data:') || originalSrc.startsWith('file://') || originalSrc.startsWith('http://') || originalSrc.startsWith('https://')) {
          logger.log(`[MarkdownPreview] 跳过已处理的图片:`, originalSrc)
          continue
        }

        try {
          // 使用协议解析器加载图片
          logger.log(`[MarkdownPreview] 解析图片路径:`, originalSrc)
          const resolvedSrc = await resolver.resolve(originalSrc)
          logger.log(`[MarkdownPreview] 解析结果:`, resolvedSrc)

          if (resolvedSrc) {
            img.src = resolvedSrc
            logger.log(`[MarkdownPreview] 图片加载成功:`, originalSrc)
          } else {
            throw new Error('图片解析失败')
          }
        } catch (error) {
          console.error('[MarkdownPreview] 加载图片失败:', originalSrc, error)
          img.style.border = '1px solid #f44336'
          img.style.padding = '4px'
          img.alt = `❌ 图片加载失败`
          // 隐藏破损的图片，只显示错误消息
          img.style.display = 'inline-block'
          img.style.width = 'auto'
          img.style.height = 'auto'
        }
      }
    }

    if (renderedHTML) {
      loadImages()
    }
  }, [renderedHTML])

  // 处理图片右键复制
  useEffect(() => {
    const handleImageContextMenu = async (e) => {
      const target = e.target
      if (target.tagName === 'IMG' && target.src) {
        e.preventDefault()
        e.stopPropagation()

        try {
          // 如果是 data: URL，直接使用
          if (target.src.startsWith('data:')) {
            await navigator.clipboard.write([
              new ClipboardItem({
                'image/png': fetch(target.src).then(r => r.blob())
              })
            ])
            showSuccess('图片已复制到剪贴板')
            return
          }

          // 如果是 blob: 或其他协议，需要先转换
          const response = await fetch(target.src)
          const blob = await response.blob()
          await navigator.clipboard.write([
            new ClipboardItem({
              [blob.type]: blob
            })
          ])
          showSuccess('图片已复制到剪贴板')
        } catch (error) {
          console.error('复制图片失败:', error)
          // 尝试使用旧的方法（创建临时 canvas）
          try {
            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.src = target.src
            await new Promise((resolve, reject) => {
              img.onload = resolve
              img.onerror = reject
            })
            
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)
            
            canvas.toBlob(async (blob) => {
              await navigator.clipboard.write([
                new ClipboardItem({
                  'image/png': blob
                })
              ])
              showSuccess('图片已复制到剪贴板')
            })
          } catch (fallbackError) {
            console.error('备用复制方法也失败:', fallbackError)
            showError(fallbackError, '复制图片失败')
          }
        }
      }
    }

    const previewElement = document.querySelector('.markdown-preview-content')
    if (previewElement) {
      previewElement.addEventListener('contextmenu', handleImageContextMenu)
      return () => {
        previewElement.removeEventListener('contextmenu', handleImageContextMenu)
      }
    }
  }, [renderedHTML, showSuccess, showError])

  // 处理图片双击预览
  useEffect(() => {
    const handleImageDoubleClick = (e) => {
      const target = e.target
      if (target.tagName === 'IMG' && target.src) {
        e.preventDefault()
        e.stopPropagation()
        setPreviewImage(target.src)
        setImageZoom(1)
      }
    }

    const previewElement = document.querySelector('.markdown-preview-content')
    if (previewElement) {
      previewElement.addEventListener('dblclick', handleImageDoubleClick)
      return () => {
        previewElement.removeEventListener('dblclick', handleImageDoubleClick)
      }
    }
  }, [renderedHTML])

  // 关闭图片预览
  const handleClosePreview = () => {
    setPreviewImage(null)
    setImageZoom(1)
    setImagePosition({ x: 0, y: 0 })
    setIsDragging(false)
  }

  // 图片缩放
  const handleZoomIn = () => {
    setImageZoom(prev => Math.min(prev + 0.25, 3))
  }

  const handleZoomOut = () => {
    setImageZoom(prev => Math.max(prev - 0.25, 0.5))
    // 缩小时重置位置
    if (imageZoom <= 1) {
      setImagePosition({ x: 0, y: 0 })
    }
  }

  // 图片拖动处理
  const handleMouseDown = (e) => {
    if (imageZoom > 1) {
      e.preventDefault()
      setIsDragging(true)
      setDragStart({
        x: e.clientX - imagePosition.x,
        y: e.clientY - imagePosition.y
      })
    }
  }

  const handleMouseMove = (e) => {
    if (isDragging && imageZoom > 1) {
      setImagePosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // 滚轮缩放 - 使用 useCallback 以便在 useEffect 中使用
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.deltaY < 0) {
      setImageZoom(prev => Math.min(prev + 0.1, 3))
    } else {
      setImageZoom(prev => {
        const newZoom = Math.max(prev - 0.1, 0.5)
        if (newZoom <= 1) {
          setImagePosition({ x: 0, y: 0 })
        }
        return newZoom
      })
    }
  }, [])

  // 使用回调 ref 来确保在 DOM 元素可用时立即绑定事件
  const setModalRef = useCallback((node) => {
    // 清理旧的监听器
    if (modalContainerRef.current) {
      modalContainerRef.current.removeEventListener('wheel', handleWheel)
    }
    
    // 保存新的引用
    modalContainerRef.current = node
    
    // 添加新的监听器
    if (node) {
      node.addEventListener('wheel', handleWheel, { passive: false })
    }
  }, [handleWheel])

  // 重置缩放和位置
  const handleResetZoom = () => {
    setImageZoom(1)
    setImagePosition({ x: 0, y: 0 })
  }

  if (!content || content.trim() === '') {
    return (
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
          ...sx
        }}
      >
        <Typography variant="body2">
          开始输入内容以查看Markdown预览
        </Typography>
      </Box>
    )
  }

  return (
  <>
    <Box
      className="markdown-preview-content"
      sx={{
        height: '100%',
        overflow: 'auto',
        overflowX: 'hidden',
        p: 2,
        minHeight: 0,
        maxWidth: '100%',
        width: '100%',
        boxSizing: 'border-box',
        wordBreak: 'break-word',
        userSelect: 'text',
        WebkitUserSelect: 'text',
        MozUserSelect: 'text',
        msUserSelect: 'text',
        fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
        '& h1, & h2, & h3, & h4, & h5, & h6': {
          marginTop: 2,
          marginBottom: 1,
          fontWeight: 600
        },
        '& h1': {
          fontSize: '2rem',
          borderBottom: '2px solid',
          borderColor: 'divider',
          paddingBottom: 1
        },
        '& h2': {
          fontSize: '1.5rem',
          borderBottom: '1px solid',
          borderColor: 'divider',
          paddingBottom: 0.5
        },
        '& h3': {
          fontSize: '1.25rem'
        },
        '& p': {
          marginBottom: 1,
          lineHeight: 1.6
        },
        '& ul, & ol': {
          paddingLeft: 2,
          marginBottom: 1
        },
        '& li': {
          marginBottom: 0.5
        },
        '& blockquote': {
          borderLeft: '4px solid',
          borderColor: 'primary.main',
          paddingLeft: 2,
          marginLeft: 0,
          marginRight: 0,
          marginBottom: 1,
          fontStyle: 'italic',
          backgroundColor: 'action.hover'
        },
        '& code': {
          backgroundColor: 'action.hover',
          padding: '2px 4px',
          borderRadius: 1,
          fontSize: '0.875rem',
          fontFamily: 'monospace'
        },
        '& pre': {
          backgroundColor: 'action.hover',
          padding: 2,
          borderRadius: 1,
          overflow: 'auto',
          marginBottom: 1,
          maxWidth: '100%',
          width: '100%',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          boxSizing: 'border-box',
          '& code': {
            backgroundColor: 'transparent',
            padding: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            overflowWrap: 'break-word',
            display: 'block',
            maxWidth: '100%'
          }
        },
        '& table': {
          width: '100%',
          borderCollapse: 'collapse',
          marginBottom: 1,
          tableLayout: 'auto',
          overflowX: 'auto',
          display: 'block',
          whiteSpace: 'nowrap',
          ...scrollbar.auto
        },
        '& th, & td': {
          border: '1px solid',
          borderColor: 'divider',
          padding: 1,
          textAlign: 'left'
        },
        '& th': {
          backgroundColor: 'action.hover',
          fontWeight: 600
        },
        '& img': {
          maxWidth: '100%',
          maxHeight: '400px',
          width: 'auto',
          height: 'auto',
          borderRadius: 1,
          cursor: 'zoom-in',
          objectFit: 'contain',
          display: 'block',
          margin: '8px auto',
          transition: 'transform 0.2s ease',
          '&:hover': {
            opacity: 0.9
          }
        },
        '& a': {
          color: 'primary.main',
          textDecoration: 'none',
          '&:hover': {
            textDecoration: 'underline'
          }
        },
        '& hr': {
          border: 'none',
          borderTop: '1px solid',
          borderColor: 'divider',
          margin: '2rem 0'
        },
        ...sx
      }}
      dangerouslySetInnerHTML={{ __html: renderedHTML }}
    />

    {/* 图片预览模态框 */}
    <Modal
      open={!!previewImage}
      onClose={handleClosePreview}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Box
        ref={setModalRef}
        sx={{
          position: 'relative',
          width: '100vw',
          height: '100vh',
          outline: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: imageZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
        }}
        onClick={handleClosePreview}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* 工具栏 */}
        <Box
          sx={{
            position: 'absolute',
            top: 16,
            right: 16,
            display: 'flex',
            gap: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            borderRadius: 2,
            padding: '4px 8px',
            zIndex: 10
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton
            size="small"
            onClick={handleZoomOut}
            sx={{ color: 'white' }}
            title="缩小 (滚轮下)"
          >
            <ZoomOutIcon />
          </IconButton>
          <Typography 
            sx={{ 
              color: 'white', 
              lineHeight: '32px', 
              minWidth: 60, 
              textAlign: 'center',
              cursor: 'pointer',
              '&:hover': { opacity: 0.8 }
            }}
            onClick={handleResetZoom}
            title="点击重置"
          >
            {Math.round(imageZoom * 100)}%
          </Typography>
          <IconButton
            size="small"
            onClick={handleZoomIn}
            sx={{ color: 'white' }}
            title="放大 (滚轮上)"
          >
            <ZoomInIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={handleClosePreview}
            sx={{ color: 'white' }}
            title="关闭 (Esc)"
          >
            <CloseIcon />
          </IconButton>
        </Box>

        {/* 提示信息 */}
        {imageZoom > 1 && (
          <Typography
            sx={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              color: 'rgba(255, 255, 255, 0.7)',
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              padding: '4px 12px',
              borderRadius: 2,
              fontSize: '12px',
              zIndex: 10
            }}
          >
            拖动查看 · 滚轮缩放 · 点击背景关闭
          </Typography>
        )}

        {/* 图片 */}
        <img
          src={previewImage}
          alt="预览"
          draggable={false}
          style={{
            maxWidth: imageZoom <= 1 ? '95vw' : 'none',
            maxHeight: imageZoom <= 1 ? '90vh' : 'none',
            objectFit: 'contain',
            transform: `scale(${imageZoom}) translate(${imagePosition.x / imageZoom}px, ${imagePosition.y / imageZoom}px)`,
            transition: isDragging ? 'none' : 'transform 0.2s ease',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            cursor: imageZoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
            userSelect: 'none'
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (imageZoom <= 1) {
              setImageZoom(2)
            }
          }}
          onMouseDown={handleMouseDown}
        />
      </Box>
    </Modal>
    </>
  )
}

export default MarkdownPreview