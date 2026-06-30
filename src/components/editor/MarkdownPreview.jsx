import { useState, useEffect, useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import { getImageResolver } from '../../utils/ImageProtocolResolver'
import { createMarkdownRenderer, prepareMarkdownForDisplay } from '../../markdown/index.js'
import { sanitizeMarkdownHtml } from '../../markdown/sanitizeHtml.js'
import { urlToWav } from '../../utils/audioCodec'
import { useError } from '../common/ErrorProvider'
import ImagePreviewModal, { canvasToPngBlob } from '../common/ImagePreviewModal'
import { useStore } from '../../store/useStore'
import '../../markdown/markdown.css'
import 'highlight.js/styles/github.css'
import logger from '../../utils/logger'
import useFloatingTableScrollbar from '../../hooks/useFloatingTableScrollbar'
import { getLocalPathFromFileUrl } from '../../utils/fileUrl'

const MarkdownPreview = ({
  content,
  sx,
  onWikiLinkClick,
  onTagClick,
  showAudioTranscription = true
}) => {
  const { showSuccess, showError } = useError()
  const [renderedHTML, setRenderedHTML] = useState('')
  const previewRef = useRef(null)
  useFloatingTableScrollbar(previewRef, { selector: 'table' })
  const [previewImage, setPreviewImage] = useState(null)
  // 用一份按 lowercase title 索引的 set 来判断 wiki target 是否存在
  const allNotes = useStore((state) => state.notes)
  const noteTitleSet = useMemo(() => {
    const set = new Set()
    allNotes.forEach((n) => {
      if (n.title) set.add(n.title.toLowerCase())
    })
    return set
  }, [allNotes])

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
          baseUrl: '#note/',
          // 目标不存在时返回带 __not_found__ 的 url，让 wikiLinkPlugin 给出 not-found CSS class
          resolveLink: (target) => {
            const exists = target && noteTitleSet.has(target.toLowerCase())
            const encoded = encodeURIComponent(target || '')
            return exists ? `#note/${encoded}` : `#note/${encoded}?__not_found__=1`
          }
        },
        tag: {
          className: 'markdown-tag'
        },
        customContainer: {
          className: 'markdown-container'
        }
      }
    })
  }, [onWikiLinkClick, onTagClick, noteTitleSet])

  // 渲染 Markdown 内容
  // 性能：长文档（>5000 字符）下用户连续打字会触发频繁全量 render；
  // 加一个 80ms 防抖只对长文档生效，短笔记保持立即渲染（体验零变化）。
  useEffect(() => {
    if (!content) {
      setRenderedHTML('')
      return
    }

    const doRender = () => {
      try {
        const html = sanitizeMarkdownHtml(md.render(prepareMarkdownForDisplay(content)))
        // 将需要异步解析的相对路径 src 暂存到 data-original-src，避免浏览器先发起一次失败请求
        const safeHtml = html.replace(/<img\b([^>]*?)\ssrc=(["'])([^"']*)\2/gi, (match, attrs, quote, src) => {
          if (!src) return match
          if (
            src.startsWith('data:') ||
            src.startsWith('http://') ||
            src.startsWith('https://') ||
            src.startsWith('file://') ||
            src.startsWith('app://')
          ) {
            return match
          }
          return `<img${attrs} data-original-src=${quote}${src}${quote}`
        })
        setRenderedHTML(safeHtml)
      } catch (error) {
        console.error('Markdown 渲染失败:', error)
        setRenderedHTML('<div class="markdown-render-error">渲染失败</div>')
      }
    }

    // 短内容立即渲染；长内容稍作防抖
    if (content.length <= 5000) {
      doRender()
      return
    }
    const timer = setTimeout(doRender, 80)
    return () => clearTimeout(timer)
  }, [content, md])

  // 处理 wiki 嵌入 ![[Foo]] / ![[Foo#章节]]：把占位卡片填充为目标笔记内容
  useEffect(() => {
    const previewElement = previewRef.current
    if (!previewElement || !renderedHTML) return undefined
    const embeds = previewElement.querySelectorAll('.markdown-wiki-link-embed[data-embed-target]:not([data-embed-rendered])')
    if (embeds.length === 0) return undefined

    const escapeHtml = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    // 在 markdown 中按 ATX 标题截取指定 section 段（到下一个同级或更高级标题前止）
    const sliceSection = (md, section) => {
      if (!md || !section) return md
      const lines = md.split('\n')
      const want = section.trim().toLowerCase()
      let startIdx = -1
      let startLevel = 0
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/)
        if (!m) continue
        const title = m[2].toLowerCase()
        if (title === want || title.includes(want)) {
          startIdx = i
          startLevel = m[1].length
          break
        }
      }
      if (startIdx === -1) return ''
      let endIdx = lines.length
      for (let i = startIdx + 1; i < lines.length; i++) {
        const m = lines[i].match(/^(#{1,6})\s+/)
        if (m && m[1].length <= startLevel) { endIdx = i; break }
      }
      return lines.slice(startIdx, endIdx).join('\n')
    }

    embeds.forEach((host) => {
      try {
        const target = host.getAttribute('data-embed-target') || ''
        const section = host.getAttribute('data-embed-section') || ''
        host.setAttribute('data-embed-rendered', '1')
        if (!target) return
        const note = allNotes.find((n) => n.title && n.title.toLowerCase() === target.toLowerCase())
        if (!note) {
          host.innerHTML = `<div class="markdown-wiki-link-embed-placeholder markdown-wiki-link-not-found">
            <span class="markdown-wiki-link-embed-icon">📄</span>
            <span class="markdown-wiki-link-embed-title">${escapeHtml(target)}${section ? ` &gt; ${escapeHtml(section)}` : ''}（未找到）</span>
          </div>`
          return
        }
        if (note.note_type === 'whiteboard') {
          host.innerHTML = `<div class="markdown-wiki-link-embed-placeholder">
            <span class="markdown-wiki-link-embed-icon">🗒</span>
            <span class="markdown-wiki-link-embed-title">${escapeHtml(target)}（白板，暂不支持嵌入）</span>
          </div>`
          return
        }
        let mdSrc = String(note.content || '')
        if (section) {
          const sliced = sliceSection(mdSrc, section)
          if (!sliced) {
            host.innerHTML = `<div class="markdown-wiki-link-embed-placeholder markdown-wiki-link-not-found">
              <span class="markdown-wiki-link-embed-icon">📄</span>
              <span class="markdown-wiki-link-embed-title">${escapeHtml(target)} &gt; ${escapeHtml(section)}（章节未找到）</span>
            </div>`
            return
          }
          mdSrc = sliced
        }
        // 防递归：把嵌入语法 ![[...]] 降级成纯文本提示，不再二次嵌套渲染
        const safeMd = mdSrc.replace(/!\[\[([^\]\n]+?)\]\]/g, '[[$1]]')
        const rendered = sanitizeMarkdownHtml(md.render(prepareMarkdownForDisplay(safeMd)))
        // 标题 chip + 渲染内容
        host.innerHTML = `
          <div class="markdown-wiki-link-embed-header">
            <span class="markdown-wiki-link-embed-icon">📄</span>
            <a class="markdown-wiki-link markdown-wiki-link-embed-title"
               data-wiki-target="${escapeHtml(target)}"
               ${section ? `data-wiki-section="${escapeHtml(section)}"` : ''}
               href="#note/${encodeURIComponent(target)}${section ? `#${encodeURIComponent(section)}` : ''}">${escapeHtml(target)}${section ? ` &gt; ${escapeHtml(section)}` : ''}</a>
          </div>
          <div class="markdown-wiki-link-embed-body">${rendered}</div>
        `
      } catch (err) {
        console.warn('[MarkdownPreview] wiki embed 渲染失败:', err)
      }
    })

    return undefined
  }, [renderedHTML, allNotes, md])

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

      const link = target.closest?.('a[href]')
      if (link) {
        const rawHref = link.getAttribute('href') || ''
        const absHref = link.href || ''
        // 优先按原始 href 识别应用内附件（attachments/ / audio/ / images/）
        const cleaned = rawHref.replace(/^app:\/\//, '')
        if (/^(?:attachments|audio|images)\//i.test(cleaned)) {
          e.preventDefault()
          window.electronAPI?.attachments?.open?.(cleaned).then((r) => {
            if (r && r.success === false) {
              try { window.alert(`打开失败：${r.error || '未知原因'}`) } catch {}
            }
          }).catch(() => {})
          return
        }
        if (absHref.startsWith('file://')) {
          e.preventDefault()
          window.electronAPI?.system?.openPath?.(getLocalPathFromFileUrl(absHref))
          return
        }
        if (absHref.startsWith('app://')) {
          // 兜底（理论上已被上面的 cleaned 分支处理）
          e.preventDefault()
          window.electronAPI?.attachments?.open?.(absHref).catch(() => {})
          return
        }
        // 处理外部链接 - 用外部浏览器打开
        if (absHref.startsWith('http://') || absHref.startsWith('https://')) {
          e.preventDefault()
          window.electronAPI?.system?.openExternal?.(absHref)
        }
        return
      }
    }

    const previewElement = previewRef.current
    if (previewElement) {
      previewElement.addEventListener('click', handleClick)
      return () => {
        previewElement.removeEventListener('click', handleClick)
      }
    }
  }, [onWikiLinkClick, onTagClick])

  // 处理图片加载
  useEffect(() => {
    const previewElement = previewRef.current
    if (!previewElement) return undefined

    const loadImages = async () => {
      const images = previewElement.querySelectorAll('img')
      const resolver = getImageResolver()

      logger.log(`[MarkdownPreview] 开始加载 ${images.length} 张图片`)

      // 音频扩展名集合
      const audioExts = new Set(['.m4a', '.mp3', '.ogg', '.wav', '.aac', '.opus', '.flac', '.webm'])
      const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico'])

      for (const img of images) {
        // 优先使用暂存的原始 src（相对路径已被前置处理移到 data-original-src 以避免浏览器预先请求失败）
        const originalSrc = img.getAttribute('data-original-src') || img.getAttribute('src')

        logger.log(`[MarkdownPreview] 图片原始路径:`, originalSrc)

        // ── 附件文件（attachments/xxx.pdf 等非图片非音频）：替换为附件卡片 ──
        if (originalSrc) {
          const srcLower2 = originalSrc.toLowerCase()
          const ext2Match = srcLower2.match(/\.([a-z0-9]+)(?:\?|$)/)
          const ext2 = ext2Match ? '.' + ext2Match[1] : ''
          const isInAttachments = /^(?:attachments|app:\/\/attachments)\//.test(originalSrc)
          const isAttachmentFile = isInAttachments
            && !audioExts.has(ext2)
            && !imageExts.has(ext2)
          if (isAttachmentFile) {
            const filename = (img.getAttribute('alt') || '').trim()
              || (originalSrc.split('/').pop() || '附件').replace(/^[a-f0-9]{40}\.?/, '')
            const extLabel = (ext2.replace('.', '').toUpperCase() || '文件').slice(0, 4)
            const card = document.createElement('span')
            card.style.cssText = 'display:inline-flex;align-items:center;gap:8px;margin:6px 0;padding:8px 12px;border-radius:10px;background:var(--md-audio-bg,rgba(0,0,0,.04));cursor:pointer;max-width:100%;overflow:hidden;'
            card.title = `打开 ${filename}`
            const icon = document.createElement('span')
            icon.style.cssText = 'flex-shrink:0;width:32px;height:32px;border-radius:6px;background:#1976d2;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;letter-spacing:.5px;'
            icon.textContent = extLabel
            const name = document.createElement('span')
            name.style.cssText = 'font-size:13px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
            name.textContent = filename
            card.appendChild(icon)
            card.appendChild(name)
            card.onclick = async (e) => {
              e.preventDefault(); e.stopPropagation()
              try {
                const result = await window.electronAPI?.attachments?.open?.(originalSrc)
                if (result && result.success === false) {
                  try { window.alert(`打开附件失败：${result.error || '未知原因'}`) } catch {}
                }
              } catch (err) {
                try { window.alert(`打开附件失败：${err?.message || err}`) } catch {}
              }
            }
            if (img.parentNode) img.parentNode.replaceChild(card, img)
            logger.log(`[MarkdownPreview] 附件已替换为卡片:`, originalSrc)
            continue
          }
        }

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
            audio.preload = 'metadata'
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
            audio.addEventListener('loadedmetadata', () => {
              if (isFinite(audio.duration) && audio.duration > 0) {
                _applyProg()
              } else {
                audio.currentTime = 1e10
                audio.addEventListener('seeked', function fix() {
                  audio.removeEventListener('seeked', fix)
                  _applyProg()
                  audio.currentTime = 0
                }, { once: true })
              }
            })
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

            if (showAudioTranscription) {
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
                  const sttSrc = originalSrc.replace(/^app:\/\//, '')
                  const sttArg = /\.webm$/i.test(sttSrc) ? await urlToWav(appSrc) : sttSrc
                  const result = await window.electronAPI.stt.transcribe(sttArg)
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
            }

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
    return undefined
  }, [renderedHTML, showAudioTranscription])

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
            const blob = await canvasToPngBlob(canvas)
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            showSuccess('图片已复制到剪贴板')
          } catch (fallbackError) {
            console.error('备用复制方法也失败:', fallbackError)
            showError(fallbackError, '复制图片失败')
          }
        }
      }
    }

    const previewElement = previewRef.current
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
      }
    }

    const previewElement = previewRef.current
    if (previewElement) {
      previewElement.addEventListener('dblclick', handleImageDoubleClick)
      return () => {
        previewElement.removeEventListener('dblclick', handleImageDoubleClick)
      }
    }
  }, [renderedHTML])

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
      ref={previewRef}
      className="markdown-preview-content"
      data-flota-scroll-source="true"
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
        '& a': {
          color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main),
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          textDecorationThickness: 'from-font',
          wordBreak: 'break-all',
        },
        '& a:visited': {
          color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main),
        },
        '& a:hover': {
          textDecorationThickness: '2px',
        },
        '& a[href^="file://"], & a[href^="app://attachments/"], & a[href^="attachments/"]': {
          display: 'inline-flex',
          alignItems: 'center',
          maxWidth: '100%',
          px: 1,
          py: 0.4,
          borderRadius: 1,
          bgcolor: 'action.hover',
          color: 'text.primary',
          textDecoration: 'none',
          verticalAlign: 'middle',
          '&::before': {
            content: '"📎"',
            mr: 0.5,
            fontSize: '0.9em'
          },
          '&:hover': {
            bgcolor: 'action.selected',
            textDecoration: 'none'
          }
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
          whiteSpace: 'nowrap'
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
          transition: 'opacity 180ms cubic-bezier(0.32, 0.72, 0, 1)',
          '&:hover': {
            opacity: 0.9
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

    <ImagePreviewModal src={previewImage} onClose={() => setPreviewImage(null)} />
    </>
  )
}

export default MarkdownPreview
