import React, { useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import { Image } from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table'
import { TableHeader } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Typography from '@tiptap/extension-typography'
import { Markdown } from 'tiptap-markdown'
import { common, createLowlight } from 'lowlight'
import { Box, Modal, IconButton, Typography as MuiTypography } from '@mui/material'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import CloseIcon from '@mui/icons-material/Close'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import { scrollbar } from '../styles/commonStyles'
import { imageAPI } from '../api/imageAPI'
import { getImageResolver } from '../utils/ImageProtocolResolver'
import { useError } from './ErrorProvider'
import AIAssistPanel from './AIAssistPanel'

const lowlight = createLowlight(common)

// ─── 图片放大预览模态框（从 MarkdownPreview 移植）──────────────────────────────
const ImagePreviewModal = ({ src, onClose }) => {
  const [zoom, setZoom] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const modalRef = useRef(null)

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.deltaY < 0) {
      setZoom(z => Math.min(z + 0.1, 3))
    } else {
      setZoom(z => {
        const next = Math.max(z - 0.1, 0.5)
        if (next <= 1) setPosition({ x: 0, y: 0 })
        return next
      })
    }
  }, [])

  const setRef = useCallback((node) => {
    if (modalRef.current) modalRef.current.removeEventListener('wheel', handleWheel)
    modalRef.current = node
    if (node) node.addEventListener('wheel', handleWheel, { passive: false })
  }, [handleWheel])

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <Modal open onClose={onClose} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box
        ref={setRef}
        sx={{
          position: 'relative', width: '100vw', height: '100vh', outline: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
        }}
        onClick={onClose}
        onMouseMove={(e) => { if (dragging && zoom > 1) setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }) }}
        onMouseUp={() => setDragging(false)}
        onMouseLeave={() => setDragging(false)}
      >
        {/* 工具栏 */}
        <Box
          sx={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 1,
            backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 2, padding: '4px 8px', zIndex: 10 }}
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton size="small" onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))} sx={{ color: 'white' }} title="缩小">
            <ZoomOutIcon />
          </IconButton>
          <MuiTypography
            sx={{ color: 'white', lineHeight: '32px', minWidth: 60, textAlign: 'center', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
            onClick={() => { setZoom(1); setPosition({ x: 0, y: 0 }) }}
            title="点击重置"
          >
            {Math.round(zoom * 100)}%
          </MuiTypography>
          <IconButton size="small" onClick={() => setZoom(z => Math.min(z + 0.25, 3))} sx={{ color: 'white' }} title="放大">
            <ZoomInIcon />
          </IconButton>
          <IconButton size="small" onClick={onClose} sx={{ color: 'white' }} title="关闭 (Esc)">
            <CloseIcon />
          </IconButton>
        </Box>
        {zoom > 1 && (
          <MuiTypography sx={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(0,0,0,0.5)', padding: '4px 12px',
            borderRadius: 2, fontSize: '12px', zIndex: 10 }}>
            拖动查看 · 滚轮缩放 · 点击背景关闭
          </MuiTypography>
        )}
        <img
          src={src}
          alt="预览"
          draggable={false}
          style={{
            maxWidth: zoom <= 1 ? '95vw' : 'none',
            maxHeight: zoom <= 1 ? '90vh' : 'none',
            objectFit: 'contain',
            transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
            transition: dragging ? 'none' : 'transform 0.2s ease',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            userSelect: 'none',
          }}
          onClick={(e) => {
            // 单击：已放大时拖动；不做缩放切换
            if (zoom > 1) e.stopPropagation()
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (zoom <= 1) {
              setZoom(2)
            } else {
              // 已放大，双击缩回原尺寸
              setZoom(1)
              setPosition({ x: 0, y: 0 })
            }
          }}
          onMouseDown={(e) => {
            if (zoom > 1) {
              e.preventDefault()
              setDragging(true)
              setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
            }
          }}
        />
      </Box>
    </Modal>
  )
}

// ─── 自定义图片 NodeView ────────────────────────────────────────────────────────
// 修复：TipTap 直接渲染 <img src="images/xxx.png"> 浏览器无法加载本地路径
// 方案：NodeView 组件异步解析路径 → app:// 协议；序列化时仍用原相对路径（attrs.src 不变）

// 音频扩展名集合
const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.ogg', '.wav', '.aac', '.opus', '.flac', '.webm'])

function isAudioSrc(src) {
  if (!src) return false
  const lower = src.toLowerCase()
  const extMatch = lower.match(/\.([a-z0-9]+)(?:\?|$)/)
  const ext = extMatch ? '.' + extMatch[1] : ''
  return AUDIO_EXTS.has(ext) || lower.startsWith('audio/') || lower.startsWith('app://audio/')
}

// ─── 音频播放器组件 ──────────────────────────────────────────────────────────
const AudioPlayerWidget = ({ src, selected }) => {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setCurrentTime(a.currentTime)
    const onMeta = () => { if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration) }
    const onEnd  = () => setPlaying(false)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('durationchange', onMeta)
    a.addEventListener('ended', onEnd)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('durationchange', onMeta)
      a.removeEventListener('ended', onEnd)
    }
  }, [])

  const fmt = s => (isFinite(s) && s >= 0)
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
    : '–:--'

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { a.play().then(() => setPlaying(true)).catch(() => {}) }
  }

  const seek = e => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Number(e.target.value)
    setCurrentTime(a.currentTime)
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <Box sx={{
      my: 1, borderRadius: '10px', backgroundColor: 'action.hover',
      p: '4px 10px', display: 'flex', alignItems: 'center', gap: 1,
      outline: selected ? '2px solid #1976d2' : 'none',
      '& input[type=range]': {
        WebkitAppearance: 'none', appearance: 'none',
        flex: 1, height: '4px', borderRadius: '2px', cursor: 'pointer',
        border: 'none', outline: 'none', overflow: 'visible', padding: 0, margin: 0,
        '&::-webkit-slider-thumb': {
          WebkitAppearance: 'none',
          width: '12px', height: '12px',
          borderRadius: '50%', background: '#1976d2', cursor: 'pointer',
        },
      },
    }}>
      <audio ref={audioRef} preload="none" src={src} />
      <IconButton size="small" onClick={toggle} sx={{ p: '2px', flexShrink: 0 }}>
        {playing ? <PauseIcon sx={{ fontSize: 20 }} /> : <PlayArrowIcon sx={{ fontSize: 20 }} />}
      </IconButton>
      <input
        type="range" min={0} max={duration || 1} step={0.01} value={currentTime}
        onChange={seek}
        style={{ background: `linear-gradient(to right,#1976d2 ${pct}%,rgba(0,0,0,.15) ${pct}%)` }}
      />
      <span style={{ fontSize: 11, minWidth: 70, textAlign: 'right', whiteSpace: 'nowrap', opacity: 0.55 }}>
        {fmt(currentTime)} / {fmt(duration)}
      </span>
    </Box>
  )
}

const ImageNodeView = ({ node, selected }) => {
  const { src, alt, title } = node.attrs
  // ✅ 初始值 null，避免 <img src=""> 触发浏览器下载当前页面的报错
  const [displaySrc, setDisplaySrc] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const { showSuccess, showError } = useError()
  const isAudio = isAudioSrc(src)

  useEffect(() => {
    if (!src) return
    let cancelled = false

    // 已经是可显示 URL（base64、http、app://）直接使用
    if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('app://')) {
      setDisplaySrc(src)
      return
    }

    // 音频文件：直接用 app:// 协议，Electron protocol handler 已支持
    if (isAudio) {
      setDisplaySrc(`app://${src}`)
      return
    }

    // 相对路径（images/xxx.png）通过 ImageProtocolResolver 异步解析
    const resolver = getImageResolver()
    resolver.resolve(src).then((resolved) => {
      if (!cancelled) setDisplaySrc(resolved || src)
    }).catch(() => {
      if (!cancelled) setDisplaySrc(src)
    })

    return () => { cancelled = true }
  }, [src])

  // 右键：复制图片
  const handleContextMenu = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!displaySrc) return
    try {
      const response = await fetch(displaySrc)
      const blob = await response.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
      showSuccess('图片已复制到剪贴板')
    } catch {
      try {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.src = displaySrc
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        canvas.toBlob(async (b) => {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
          showSuccess('图片已复制到剪贴板')
        })
      } catch (err) {
        showError(err, '复制图片失败')
      }
    }
  }

  return (
    <NodeViewWrapper as="span" style={{ display: 'block' }} data-drag-handle>
      {/* 音频文件：渲染为自定义播放器 */}
      {isAudio && displaySrc && (
        <AudioPlayerWidget src={displaySrc} selected={selected} />
      )}
      {/* 普通图片 */}
      {!isAudio && displaySrc && (
        <img
          src={displaySrc}
          alt={alt || ''}
          title={title || ''}
          draggable={false}
          onDoubleClick={(e) => { e.stopPropagation(); setModalOpen(true) }}
          onContextMenu={handleContextMenu}
          style={{
            maxWidth: '100%',
            maxHeight: '400px',
            width: 'auto',
            height: 'auto',
            borderRadius: '6px',
            display: 'block',
            margin: '8px auto',
            objectFit: 'contain',
            cursor: 'zoom-in',
            outline: selected ? '2px solid #1976d2' : 'none',
            transition: 'opacity 0.2s',
          }}
        />
      )}
      {/* 加载中占位 */}
      {!displaySrc && src && (
        <Box sx={{ width: '100%', height: 80, backgroundColor: 'action.hover', borderRadius: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center', my: 1,
          fontSize: 12, color: 'text.disabled' }}>
          {isAudio ? '音频加载中...' : '图片加载中...'}
        </Box>
      )}
      {/* 双击放大模态框（仅图片） */}
      {!isAudio && modalOpen && displaySrc && (
        <ImagePreviewModal src={displaySrc} onClose={() => setModalOpen(false)} />
      )}
    </NodeViewWrapper>
  )
}

// 扩展 Image，注入 ReactNodeView（仅改变渲染，不改变序列化）
const CustomImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },
})

// ─── WYSIWYGEditor ─────────────────────────────────────────────────────────────
/**
 * WYSIWYG Markdown 编辑器
 *
 * 底层存储仍然是纯 Markdown（通过 tiptap-markdown 双向转换）。
 * 用户看到渲染后的富文本，不感知 Markdown 语法。
 *
 * 关键设计：
 * - isSyncingRef：同步外部 content 时置 true，阻止 onUpdate → onChange 回调（防循环）
 * - lastExternalContentRef：记录最近一次从父组件收到/向父组件发出的内容，防止无意义 setContent
 * - editorRef：始终指向当前 editor 实例，供异步回调（粘贴/拖放）使用
 */
const WYSIWYGEditor = React.forwardRef(({ content, onChange, placeholder = '开始输入...' }, ref) => {
  // 用 ref 追踪最新 onChange，避免在 useEditor 回调中因闭包失效而用到旧 handler
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // 同步锁：外部 setContent 期间为 true，屏蔽 onUpdate → onChange
  const isSyncingRef = useRef(false)

  // 记录上次"已处理过"的 content 字符串，用于幂等判断
  const lastExternalContentRef = useRef(content ?? '')

  // 始终指向最新 editor，供粘贴/拖放等异步回调使用
  const editorRef = useRef(null)

  // 始终指向最新 handleImageUpload，供 editorProps 闭包使用
  const handleImageUploadRef = useRef(null)

  // ── 图片保存并插入编辑器 ─────────────────────────────────────────────────────
  const handleImageUpload = async (blob) => {
    const ed = editorRef.current
    if (!ed) return
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      const fileName = `paste_${Date.now()}.png`
      const imagePath = await imageAPI.saveFromBuffer(buffer, fileName)
      if (imagePath) {
        // 插入原始相对路径，NodeView 会异步解析为可显示 URL
        ed.chain().focus().setImage({ src: imagePath, alt: fileName }).run()
      }
    } catch (error) {
      console.error('[WYSIWYGEditor] 图片保存失败:', error)
    }
  }

  // 每次渲染都更新 ref，确保 editorProps 闭包用到的是最新版本
  handleImageUploadRef.current = handleImageUpload

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: { depth: 50, newGroupDelay: 500 },
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false, // 由 CodeBlockLowlight 接管
      }),
      Placeholder.configure({ placeholder }),
      Highlight.configure({ multicolor: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      // 使用自定义 Image（带 NodeView），序列化方式不变
      CustomImage.configure({ inline: false, allowBase64: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockLowlight.configure({ lowlight }),
      Typography,
      // 核心：Markdown ↔ TipTap 双向序列化
      Markdown.configure({
        html: true,
        tightLists: true,
        tightListClass: 'tight',
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,  // 粘贴纯文本时按 Markdown 解析
        transformCopiedText: true,  // 复制时输出 Markdown
      }),
    ],

    content: '',

    onUpdate: ({ editor: ed }) => {
      // isSyncingRef 为 true 时：是外部 setContent 触发，不回调 onChange（防循环）
      if (isSyncingRef.current) return
      const markdown = ed.storage.markdown.getMarkdown()
      lastExternalContentRef.current = markdown
      onChangeRef.current(markdown)
    },

    editorProps: {
      attributes: { class: 'wysiwyg-editor-content', spellcheck: 'false' },

      // ── 拦截图片粘贴 ──────────────────────────────────────────────────────────
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            event.preventDefault()
            const blob = items[i].getAsFile()
            if (blob) handleImageUpload(blob) // 使用 editorRef，无闭包失效问题
            return true
          }
        }
        return false
      },

      // 图片文件拖放由原生 DOM 监听器（capture 阶段）处理，此处不再重复拦截
      handleDrop: (_view, _event, _slice, moved) => {
        // moved=true 时是编辑器内部节点拖移，交给 TipTap 默认处理
        if (moved) return false
        return false  // 其余情况均由 DOM capture 监听器处理
      },
    },
  })

  // 始终同步最新 editor 到 ref
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // ── 在 editor.view.dom 上挂原生 drop 监听（capture 阶段，先于 ProseMirror）────
  // 原因：editorProps.handleDrop 在 Electron/Windows 文件拖入时不稳定；
  //       直接在 DOM 捕获阶段拦截，与源码模式 onDrop 逻辑保持一致
  useEffect(() => {
    if (!editor?.view?.dom) return
    const dom = editor.view.dom

    const onDragOver = (e) => {
      // 让浏览器允许 drop
      if (e.dataTransfer?.types?.includes?.('Files') || Array.from(e.dataTransfer?.items || []).some(i => i.kind === 'file')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    const onDrop = (e) => {
      const files = Array.from(e.dataTransfer?.files || [])
      const imageFiles = files.filter(f => f.type.startsWith('image/'))
      if (!imageFiles.length) return  // 非图片文件，让 ProseMirror 自行处理
      e.preventDefault()
      e.stopPropagation()
      imageFiles.forEach(file => handleImageUploadRef.current?.(file))
    }

    dom.addEventListener('dragover', onDragOver, { capture: true })
    dom.addEventListener('drop', onDrop, { capture: true })
    return () => {
      dom.removeEventListener('dragover', onDragOver, { capture: true })
      dom.removeEventListener('drop', onDrop, { capture: true })
    }
  }, [editor])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 初始加载：编辑器就绪后设置初始内容 ──────────────────────────────────────
  // 用 setTimeout 延迟到渲染周期外，避免 ReactNodeViewRenderer 内部的 flushSync 报警
  useEffect(() => {
    if (!editor) return
    const initial = lastExternalContentRef.current
    if (!initial) return                          // 空内容无需操作
    const timer = setTimeout(() => {
      isSyncingRef.current = true
      editor.commands.setContent(initial)
      isSyncingRef.current = false
    }, 0)
    return () => clearTimeout(timer)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 外部 content 变化时同步（切换笔记、云端同步等）────────────────────────────
  useEffect(() => {
    if (!editor) return
    const incoming = content ?? ''
    // 与上次已处理的内容完全一致，跳过（幂等）
    if (incoming === lastExternalContentRef.current) return

    lastExternalContentRef.current = incoming
    const timer = setTimeout(() => {
      isSyncingRef.current = true
      editor.commands.setContent(incoming)
      isSyncingRef.current = false
    }, 0)
    return () => clearTimeout(timer)
  }, [editor, content])

  // ── 对外暴露接口 ─────────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getEditor: () => editor,
    getMarkdown: () => editor?.storage?.markdown?.getMarkdown?.() ?? '',
    focus: () => editor?.commands?.focus?.(),
    // 供外层（NoteEditor）的 onDrop 调用，与源码模式保持一致
    insertImageFiles: (files) => {
      Array.from(files)
        .filter(f => f.type.startsWith('image/'))
        .forEach(file => handleImageUploadRef.current?.(file))
    },
  }))

  if (!editor) return null

  return (
    <Box
      sx={{
        flex: 1,
        overflow: 'auto',
        position: 'relative',
        ...scrollbar.default,
        '& .ProseMirror': {
          outline: 'none',
          minHeight: '100%',
          padding: '16px',
          fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',

          // ── 标题 ──────────────────────────────────────────────────────────────
          '& h1': { fontSize: '2rem', fontWeight: 700, lineHeight: 1.3, marginTop: '1.25rem', marginBottom: '0.5rem' },
          '& h2': { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, marginTop: '1rem', marginBottom: '0.4rem' },
          '& h3': { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3, marginTop: '0.8rem', marginBottom: '0.3rem' },
          '& h4': { fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.4 },
          '& h5, & h6': { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },

          // ── 段落/行内 ─────────────────────────────────────────────────────────
          '& p': { lineHeight: 1.7, margin: '0.25rem 0' },
          '& a': { color: 'primary.main', textDecoration: 'underline', cursor: 'pointer' },

          // ── 列表 ──────────────────────────────────────────────────────────────
          '& ul, & ol': { paddingLeft: '1.5rem', margin: '0.25rem 0' },
          '& ul[data-type="taskList"]': {
            listStyle: 'none',
            paddingLeft: 0,
            '& li': {
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.5rem',
              '& > label': { marginTop: '2px' },
            },
          },

          // ── 行内代码 ──────────────────────────────────────────────────────────
          '& code': {
            backgroundColor: 'action.hover',
            padding: '0.15em 0.35em',
            borderRadius: '4px',
            fontSize: '0.9em',
            fontFamily: 'Consolas, "SFMono-Regular", "Liberation Mono", Menlo, monospace',
          },

          // ── 代码块 ────────────────────────────────────────────────────────────
          '& pre': {
            backgroundColor: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(30,41,59,0.8)' : 'rgba(241,245,249,0.9)',
            padding: '1rem',
            borderRadius: '6px',
            overflow: 'auto',
            margin: '0.5rem 0',
            '& code': {
              backgroundColor: 'transparent',
              padding: 0,
              borderRadius: 0,
              fontSize: '0.85em',
              lineHeight: 1.6,
            },
          },

          // ── 引用块 ────────────────────────────────────────────────────────────
          '& blockquote': {
            borderLeft: '3px solid',
            borderColor: 'primary.main',
            paddingLeft: '1rem',
            margin: '0.5rem 0',
            fontStyle: 'italic',
            color: 'text.secondary',
          },

          // ── 高亮 ──────────────────────────────────────────────────────────────
          '& mark': {
            backgroundColor: '#fef08a',
            padding: '0.1em 0.2em',
            borderRadius: '2px',
          },

          // ── 图片（NodeView 中是 img，外层 span 由 NodeViewWrapper 生成）─────────
          '& img': {
            maxWidth: '100%',
            height: 'auto',
            borderRadius: '6px',
            display: 'block',
            margin: '8px 0',
          },

          // ── 表格 ──────────────────────────────────────────────────────────────
          '& table': {
            borderCollapse: 'collapse',
            width: '100%',
            margin: '0.5rem 0',
          },
          '& th, & td': {
            border: '1px solid',
            borderColor: 'divider',
            padding: '6px 12px',
            textAlign: 'left',
          },
          '& th': { fontWeight: 600, backgroundColor: 'action.hover' },

          // ── 分割线 ────────────────────────────────────────────────────────────
          '& hr': {
            border: 'none',
            borderTop: '2px solid',
            borderColor: 'divider',
            margin: '1rem 0',
          },

          // ── 占位符 ────────────────────────────────────────────────────────────
          '&.is-editor-empty:first-of-type::before, & .is-editor-empty:first-of-type::before': {
            content: 'attr(data-placeholder)',
            float: 'left',
            color: 'text.disabled',
            pointerEvents: 'none',
            height: 0,
          },
        },
      }}
    >
      <EditorContent editor={editor} />
      {/* 点击编辑器下方空白区域时聚焦到末尾 */}
      <Box
        sx={{ minHeight: '40vh', cursor: 'text' }}
        onClick={() => editor?.commands?.focus?.('end')}
      />
      <AIAssistPanel editor={editor} />
    </Box>
  )
})

WYSIWYGEditor.displayName = 'WYSIWYGEditor'

export default WYSIWYGEditor
