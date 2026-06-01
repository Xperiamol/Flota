import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { Extension, Mark } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Fragment, Slice } from '@tiptap/pm/model'
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
import { Markdown } from 'tiptap-markdown'
import { common, createLowlight } from 'lowlight'
import { Box, IconButton, Typography as MuiTypography, TextField, Tooltip, Portal } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import LinkOffIcon from '@mui/icons-material/LinkOff'
import LinkIcon from '@mui/icons-material/Link'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { urlToWav } from '../utils/audioCodec'
import { imageAPI } from '../api/imageAPI'
import { replaceDataImagesInHtml } from '../utils/dataUrlImage'
import { getImageResolver } from '../utils/ImageProtocolResolver'
import { RICH_TEXT_EMPTY_LINE_SENTINEL, finalizeMarkdownForStorage, prepareMarkdownForDisplay } from '../markdown/index.js'
import { useStore } from '../store/useStore'
import { useError } from './ErrorProvider'
import AIAssistPanel from './AIAssistPanel'
import ImagePreviewModal, { canvasToPngBlob } from './ImagePreviewModal'

const lowlight = createLowlight(common)

export const DEFAULT_CONTEXT_MENU_ITEMS = [
  'undo', 'redo', 'cut', 'copy', 'paste', 'pastePlain', 'selectAll',
  'bold', 'italic', 'link', 'blockSelect', 'table',
]

export const ALL_CONTEXT_MENU_ITEMS = [
  'undo', 'redo', 'cut', 'copy', 'paste', 'pastePlain', 'selectAll',
  'bold', 'italic', 'code', 'link',
  'heading1', 'heading2', 'bulletList', 'orderedList', 'taskList', 'blockquote',
  'paragraph', 'blockSelect', 'copyBlock', 'duplicateBlock', 'deleteBlock', 'callout', 'table',
]

export const CONTEXT_MENU_ITEM_LABELS = {
  undo: '撤销',
  redo: '重做',
  cut: '剪切',
  copy: '复制',
  paste: '粘贴',
  pastePlain: '无格式粘贴',
  selectAll: '全选',
  bold: '加粗',
  italic: '斜体',
  code: '行内代码',
  link: '链接',
  heading1: '标题 1',
  heading2: '标题 2',
  bulletList: '项目符号列表',
  orderedList: '编号列表',
  taskList: '任务列表',
  blockquote: '引用',
  paragraph: '正文',
  blockSelect: '块多选',
  copyBlock: '复制当前块',
  duplicateBlock: '复制一份当前块',
  deleteBlock: '删除当前块',
  callout: 'Callout',
  table: '表格操作',
}

// ─── 自定义 TextColor Mark（前景文字颜色，不需要额外安装包）───────────────
// rgb(r,g,b) / rgba → #hex 转换
const rgbToHex = (c) => {
  if (!c) return c
  const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return c
  return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('')
}

// 加载 markdown 前的预处理：将自定义格式转回 HTML，使 TipTap parser 识别
// 使用更严格的正则，限制不跨段落，避免误匹配跨行内容
const getLocalPathFromFileUrl = (fileUrl) => {
  try {
    return decodeURIComponent(String(fileUrl).replace(/^file:\/\//i, ''))
  } catch (_) {
    return String(fileUrl).replace(/^file:\/\//i, '')
  }
}

const preprocessMarkdown = (md) => {
  if (!md) return md
  return prepareMarkdownForDisplay(md)
    // 带颜色高亮：限制不跨行
    .replace(/==(?:\{([^}\n]+)\})([^\n=]+?)==/g, (_, color, text) =>
      `<mark data-color="${color}">${text}</mark>`)
    // 普通高亮：限制不跨行
    .replace(/==([^\n=]+?)==/g, (_, text) => `<mark>${text}</mark>`)
    // 下划线：限制不跨行
    .replace(/\+\+([^\n+]+?)\+\+/g, (_, text) => `<u>${text}</u>`)
}

// 序列化后处理：prosemirror-markdown 会把 [!type] 转义为 \[!type\]，需要还原
const postprocessMarkdown = (md) => {
  if (!md) return md
  // 支持多层嵌套引用 > > \[!type\]
  return finalizeMarkdownForStorage(
    md.replace(/^((?:>\s*)+)\\\[!(\w+)\\\]/gm, '$1[!$2]')
  )
}

// ─── Highlight / Underline 扩展序列化 ─────────────────────────────────────────
const CustomHighlight = Highlight.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_, mark) {
            const c = mark.attrs.color
            return c ? `=={${rgbToHex(c)}}` : '=='
          },
          close() { return '==' },
        },
        parse: {},
      },
    }
  },
})

const CustomUnderline = Underline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: '++', close: '++' },
        parse: {},
      },
    }
  },
})

const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: el => el.style.color || null,
        renderHTML: attrs => attrs.color ? { style: `color: ${attrs.color}` } : {},
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[style*="color"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0]
  },
  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_, mark) { return `<span style="color:${rgbToHex(mark.attrs.color)}">` },
          close() { return '</span>' },
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    }
  },
  addCommands() {
    return {
      setTextColor: (color) => ({ commands }) => commands.setMark('textColor', { color }),
      unsetTextColor: () => ({ commands }) => commands.unsetMark('textColor'),
      toggleTextColor: (color) => ({ chain }) => {
        return chain().toggleMark('textColor', { color }).run()
      },
    }
  },
})

// ─── 自定义图片 NodeView ────────────────────────────────────────────────────────
// 修复：TipTap 直接渲染 <img src="images/xxx.png"> 浏览器无法加载本地路径
// 方案：NodeView 组件异步解析路径 → app:// 协议；序列化时仍用原相对路径（attrs.src 不变）

// 音频扩展名集合
const AUDIO_EXTS = new Set(['.m4a', '.mp3', '.ogg', '.wav', '.aac', '.opus', '.flac', '.webm'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico'])

const getExtFromSrc = (src) => {
  if (!src) return ''
  const lower = String(src).toLowerCase()
  const m = lower.match(/\.([a-z0-9]+)(?:\?|$)/)
  return m ? '.' + m[1] : ''
}

const isAttachmentRef = (src) => {
  if (!src) return false
  const s = String(src)
  return s.startsWith('attachments/') || s.startsWith('app://attachments/')
}

// ─── Callout 装饰插件 ─────────────────────────────────────────────────────────
// 在 WYSIWYG 中检测 blockquote 内的 [!type] 标记,渲染为彩色卡片
import { CALLOUT_TYPES } from '../markdown/calloutConfig.js'

const calloutPluginKey = new PluginKey('calloutDecoration')

function buildCalloutHeader(type, cfg) {
  const header = document.createElement('div')
  header.className = `callout-header callout-${type}-header`
  header.setAttribute('data-callout-header', type)
  header.setAttribute('contenteditable', 'false')
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '600',
    fontSize: '12.5px',
    letterSpacing: '0.02em',
    color: cfg.color,
    marginBottom: '6px',
    userSelect: 'none',
    fontFamily: 'inherit',
    lineHeight: '1',
  })

  const iconWrap = document.createElement('span')
  Object.assign(iconWrap.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    borderRadius: '6px',
    background: `${cfg.color}1f`,
    fontSize: '12px',
    lineHeight: '1',
  })
  iconWrap.textContent = cfg.icon

  const labelSpan = document.createElement('span')
  labelSpan.textContent = cfg.label
  labelSpan.style.fontWeight = '600'
  labelSpan.style.letterSpacing = '0.02em'

  header.appendChild(iconWrap)
  header.appendChild(labelSpan)
  return header
}

const CalloutDecoration = Extension.create({
  name: 'calloutDecoration',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: calloutPluginKey,
        props: {
          decorations(state) {
            const decorations = []
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'blockquote') return
              const firstChild = node.firstChild
              if (!firstChild?.isTextblock) return
              const firstText = firstChild.firstChild
              if (!firstText?.isText) return
              const match = firstText.text.match(/^\[!(\w+)\]/)
              if (!match) return
              const type = match[1].toLowerCase()
              const cfg = CALLOUT_TYPES[type]
              if (!cfg) return

              // 现代卡片样式：细边框 + 浅 tint + 大圆角，accent 由 header 承担
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: `callout-block callout-${type}`,
                  'data-callout-type': type,
                  style: [
                    `border: 1px solid ${cfg.color}33`,
                    `background: ${cfg.color}0f`,
                    'border-radius: 12px',
                    'padding: 12px 16px 14px',
                    'margin: 12px 0',
                    'font-style: normal',
                    'color: inherit',
                  ].join('; ') + ';',
                })
              )

              // header widget：在 blockquote 内部、首段前插入"图标+标题"
              decorations.push(
                Decoration.widget(pos + 1, () => buildCalloutHeader(type, cfg), {
                  side: -1,
                  ignoreSelection: true,
                  key: `callout-header-${type}`,
                })
              )

              // 隐藏源码标签 [!type] 及其后紧邻空格，保持 Markdown 序列化原样
              const textStart = pos + 2 // blockquote 起 + paragraph 起
              const tagLen = match[0].length
              const trailingSpace = firstText.text[tagLen] === ' ' ? 1 : 0
              decorations.push(
                Decoration.inline(textStart, textStart + tagLen + trailingSpace, {
                  nodeName: 'span',
                  class: 'callout-source-tag',
                  style: 'display:none;',
                  'aria-hidden': 'true',
                })
              )
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

const EmptyParagraphPreserver = Extension.create({
  name: 'emptyParagraphPreserver',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('emptyParagraphPreserver'),
        appendTransaction(_transactions, _oldState, newState) {
          const emptyTopLevelParagraphs = []
          newState.doc.descendants((node, pos, parent) => {
            if (parent !== newState.doc) return
            if (node.type.name === 'paragraph' && node.content.size === 0) {
              emptyTopLevelParagraphs.push(pos)
            }
          })
          if (!emptyTopLevelParagraphs.length) return null

          const tr = newState.tr
          emptyTopLevelParagraphs
            .sort((a, b) => b - a)
            .forEach((pos) => {
              tr.insertText(RICH_TEXT_EMPTY_LINE_SENTINEL, pos + 1)
            })
          return tr
        },
      }),
    ]
  },
})

function isAudioSrc(src) {
  if (!src) return false
  const lower = String(src).toLowerCase()
  return AUDIO_EXTS.has(getExtFromSrc(lower)) || lower.startsWith('audio/') || lower.startsWith('app://audio/')
}

function isImageSrc(src) {
  if (!src) return false
  const lower = String(src).toLowerCase()
  // 已确知是图片协议（base64、远程图）也按图片处理
  if (lower.startsWith('data:image') || lower.startsWith('http://') || lower.startsWith('https://')) return true
  return IMAGE_EXTS.has(getExtFromSrc(lower))
}

// ─── 音频播放器组件 ──────────────────────────────────────────────────────────
const AudioPlayerWidget = ({ src, selected, originalSrc, editor, getPos, nodeSize }) => {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [sttStatus, setSttStatus] = useState('idle') // idle | loading | done | error

  const handleTranscribe = async () => {
    if (!window.electronAPI?.stt?.transcribe) return
    setSttStatus('loading')
    try {
      const sttSrc = (originalSrc || '').replace(/^app:\/\//, '')
      // WebM 格式火山引擎不支持，用 Web Audio API 在渲染进程解码为 WAV
      const needDecode = /\.webm$/i.test(sttSrc)
      const sttArg = needDecode ? await urlToWav(src) : sttSrc
      const result = await window.electronAPI.stt.transcribe(sttArg)
      if (result?.success && result?.data?.text) {
        const text = result.data.text
        setSttStatus('done')
        // 插入转写文本到音频节点后方
        if (editor && getPos) {
          const pos = getPos() + nodeSize
          editor.chain().focus().insertContentAt(pos, {
            type: 'paragraph',
            content: [{ type: 'text', text }],
          }).run()
        }
      } else {
        setSttStatus('error')
        setTimeout(() => setSttStatus('idle'), 2000)
      }
    } catch {
      setSttStatus('error')
      setTimeout(() => setSttStatus('idle'), 2000)
    }
  }

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => {
      setCurrentTime(a.currentTime)
      // WebM duration 可能延迟可用，timeupdate 时再检查
      if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration)
    }
    const onMeta = () => {
      if (isFinite(a.duration) && a.duration > 0) {
        setDuration(a.duration)
      } else {
        // WebM MediaRecorder 录制的文件无 duration header，
        // 用 seek-to-end 技巧让 Chromium 计算真实时长
        a.currentTime = 1e10
        a.addEventListener('seeked', function fix() {
          a.removeEventListener('seeked', fix)
          if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration)
          a.currentTime = 0
        }, { once: true })
      }
    }
    const onEnd  = () => setPlaying(false)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('durationchange', () => {
      if (isFinite(a.duration) && a.duration > 0) setDuration(a.duration)
    })
    a.addEventListener('ended', onEnd)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnd)
    }
  }, [src])

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
      <audio ref={audioRef} preload="metadata" src={src} />
      <IconButton size="small" onClick={toggle} sx={{ p: '2px', flexShrink: 0 }} aria-label="播放暂停">
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
      <IconButton
        size="small"
        onClick={handleTranscribe}
        disabled={sttStatus === 'loading'}
        sx={{ p: '2px', flexShrink: 0, ml: 0.5 }}
        title={sttStatus === 'done' ? '重新转文字' : '转文字'}
      >
        <RecordVoiceOverIcon sx={{ fontSize: 18, color: sttStatus === 'done' ? 'success.main' : sttStatus === 'loading' ? 'text.disabled' : 'text.secondary' }} />
      </IconButton>
    </Box>
  )
}

// ─── 附件卡片（PDF/文档等非图片非音频） ───────────────────────────────────────
const AttachmentCard = ({ src, alt, selected }) => {
  const filename = (alt || '').trim() || (String(src).split('/').pop() || '附件').replace(/^[a-f0-9]{40}\.?/, '')
  const ext = getExtFromSrc(src).replace('.', '').toUpperCase() || '文件'
  const handleOpen = async (e) => {
    e.preventDefault(); e.stopPropagation()
    try {
      const result = await window.electronAPI?.attachments?.open?.(src)
      if (result && result.success === false) {
        try { window.alert(`打开附件失败：${result.error || '未知原因'}`) } catch {}
      }
    } catch (err) {
      try { window.alert(`打开附件失败：${err?.message || err}`) } catch {}
    }
  }
  return (
    <Box
      component="span"
      onClick={handleOpen}
      onMouseDown={(e) => e.stopPropagation()}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 1,
        my: 0.75, px: 1.5, py: 1, borderRadius: '10px',
        backgroundColor: 'action.hover', cursor: 'pointer',
        outline: selected ? '2px solid #1976d2' : 'none',
        maxWidth: '100%', overflow: 'hidden',
        '&:hover': { backgroundColor: 'action.selected' },
      }}
      title={`打开 ${filename}`}
    >
      <Box sx={{
        flexShrink: 0, width: 32, height: 32, borderRadius: '6px',
        background: '#1976d2', color: '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
      }}>{ext.slice(0, 4)}</Box>
      <Box sx={{
        fontSize: 13, lineHeight: 1.3, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{filename}</Box>
    </Box>
  )
}

const ImageNodeView = ({ node, selected, editor, getPos }) => {
  const { src, alt, title } = node.attrs
  // ✅ 初始值 null，避免 <img src=""> 触发浏览器下载当前页面的报错
  const [displaySrc, setDisplaySrc] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const { showSuccess, showError } = useError()
  const isAudio = isAudioSrc(src)
  const isAttachment = !isAudio && isAttachmentRef(src) && !isImageSrc(src)

  useEffect(() => {
    if (!src) return
    if (isAttachment) return // 附件无需异步解析图片源
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
    // 解析未完成前不设置 displaySrc，避免浏览器对原始相对路径直接发起失败请求
    setDisplaySrc(null)
    const resolver = getImageResolver()
    resolver.resolve(src).then((resolved) => {
      if (!cancelled && resolved) setDisplaySrc(resolved)
    }).catch(() => {
      if (!cancelled) setDisplaySrc(null)
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
        const blob = await canvasToPngBlob(canvas)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        showSuccess('图片已复制到剪贴板')
      } catch (err) {
        showError(err, '复制图片失败')
      }
    }
  }

  return (
    <NodeViewWrapper as="span" style={{ display: 'block' }} data-drag-handle>
      {/* 附件文件（PDF/文档等）：渲染为卡片块 */}
      {isAttachment && (
        <AttachmentCard src={src} alt={alt} selected={selected} />
      )}
      {/* 音频文件：渲染为自定义播放器 */}
      {!isAttachment && isAudio && displaySrc && (
        <AudioPlayerWidget src={displaySrc} selected={selected} originalSrc={src} editor={editor} getPos={getPos} nodeSize={node.nodeSize} />
      )}
      {/* 普通图片 */}
      {!isAttachment && !isAudio && displaySrc && (
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
      {!isAttachment && !displaySrc && src && (
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

// ─── 编辑器状态订阅 hook ────────────────────────────────────────────────────────
// 监听 editor 的 selection/transaction 更新，触发使用者重渲染。
// 关键点：拖拽鼠标进行选区（尤其是表格 CellSelection）时，ProseMirror 会持续
// 派发 selectionUpdate / transaction。如果此时直接 force re-render 整个宿主
// 组件，会重建 BubbleMenu 等子树，并扰动浏览器原生选区与表格 CellSelection
// 的 decoration，导致选区高亮"选着选着就没了"。因此在拖拽期间挂起 force()，
// 并在 mouseup 后进行一次性补偿渲染，确保浮层最终同步且不破坏选区。
const useEditorState = (editor) => {
  const [, force] = useState(0)
  useEffect(() => {
    if (!editor) return
    let isDragging = false
    let hasPendingRender = false
    let rafId = 0

    const flush = () => {
      hasPendingRender = false
      force((v) => v + 1)
    }

    const handler = () => {
      if (isDragging) {
        hasPendingRender = true
        return
      }
      flush()
    }

    const onMouseDown = (e) => {
      // 仅左键拖拽视为选区拖拽
      if (e.button !== 0) return
      isDragging = true
    }
    const endDrag = () => {
      if (!isDragging) return
      isDragging = false
      // 等当前事件循环结束（让 ProseMirror 完成最后一次 transaction）后补一次
      if (hasPendingRender) {
        if (rafId) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(flush)
      }
    }

    const dom = editor.view?.dom
    dom?.addEventListener('mousedown', onMouseDown)
    // mouseup 必须挂在 window，因为拖拽常在编辑器外松开
    window.addEventListener('mouseup', endDrag, true)
    window.addEventListener('dragend', endDrag, true)
    window.addEventListener('blur', endDrag, true)

    editor.on('selectionUpdate', handler)
    editor.on('transaction', handler)
    editor.on('focus', handler)
    editor.on('blur', handler)
    return () => {
      editor.off('selectionUpdate', handler)
      editor.off('transaction', handler)
      editor.off('focus', handler)
      editor.off('blur', handler)
      dom?.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', endDrag, true)
      window.removeEventListener('dragend', endDrag, true)
      window.removeEventListener('blur', endDrag, true)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [editor])
}

// 通用：根据 editor 当前 selection 计算 viewport 坐标（用于浮动菜单定位）
const getSelectionRect = (editor) => {
  if (!editor || !editor.view) return null
  const { from, to } = editor.state.selection
  try {
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    return {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
    }
  } catch {
    return null
  }
}

const getNodeAtSelection = (editor) => {
  try {
    const dom = editor?.view?.domAtPos?.(editor.state.selection.from)?.node
    return dom?.nodeType === Node.TEXT_NODE ? dom.parentElement : dom
  } catch {
    return null
  }
}

const getLinkAnchorRect = (editor) => {
  const node = getNodeAtSelection(editor)
  const link = node?.closest?.('a')
  return link?.getBoundingClientRect?.() || getSelectionRect(editor)
}

const getTableCellAnchorRect = (editor) => {
  const node = getNodeAtSelection(editor)
  const cell = node?.closest?.('td, th')
  return cell?.getBoundingClientRect?.() || getSelectionRect(editor)
}

const getCalloutAnchorRect = (editor) => {
  const node = getNodeAtSelection(editor)
  const callout = node?.closest?.('blockquote.callout-block')
  if (!callout) return null
  const rect = callout.getBoundingClientRect()
  return {
    top: rect.top,
    bottom: rect.top,
    left: rect.left,
    right: rect.left,
  }
}

// ─── 浮动菜单定位 ────────────────────────────────────────────────────────────
// 设计：所有浮层都定位在编辑器滚动容器内部，避免侧栏/右侧面板影响视口坐标。
const FLOATING_MARGIN = 8
const CONTEXT_MENU_WIDTH = 196

const floatingGlassSx = ({ radius = '12px', shadow = 'default' } = {}) => ({
  borderRadius: radius,
  bgcolor: (theme) => theme.palette.mode === 'dark'
    ? 'rgba(15, 23, 42, 0.78)'
    : 'rgba(255, 255, 255, 0.78)',
  border: '1px solid',
  borderColor: (theme) => theme.palette.mode === 'dark'
    ? 'rgba(148, 163, 184, 0.18)'
    : 'rgba(148, 163, 184, 0.24)',
  boxShadow: shadow === 'menu'
    ? '0 18px 56px rgba(15, 23, 42, 0.22), 0 4px 16px rgba(15, 23, 42, 0.10)'
    : '0 10px 36px rgba(15, 23, 42, 0.18), 0 2px 10px rgba(15, 23, 42, 0.08)',
  backdropFilter: 'blur(18px) saturate(160%)',
  WebkitBackdropFilter: 'blur(18px) saturate(160%)',
  backgroundClip: 'padding-box',
})

const useFloatingMenuPosition = (anchorRect, { containerRef, placement = 'bottom', align = 'left', offset = 6 } = {}) => {
  const menuRef = useRef(null)
  const [position, setPosition] = useState({ top: 0, left: 0, maxWidth: undefined, visibility: 'hidden' })
  const anchorTop = anchorRect?.top ?? null
  const anchorBottom = anchorRect?.bottom ?? null
  const anchorLeft = anchorRect?.left ?? null
  const anchorRight = anchorRect?.right ?? null

  const compute = useCallback(() => {
    const node = menuRef.current
    const container = containerRef?.current
    if (!node || !container || anchorTop == null || anchorLeft == null || typeof window === 'undefined') {
      setPosition((p) => (p.visibility === 'hidden' ? p : { top: 0, left: 0, maxWidth: undefined, visibility: 'hidden' }))
      return
    }
    const m = node.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const scrollTop = container.scrollTop || 0
    const scrollLeft = container.scrollLeft || 0
    const safeTop = scrollTop + FLOATING_MARGIN
    const safeBottom = scrollTop + container.clientHeight - FLOATING_MARGIN
    const safeLeft = scrollLeft + FLOATING_MARGIN
    const safeRight = scrollLeft + container.clientWidth - FLOATING_MARGIN
    const maxWidth = Math.max(160, safeRight - safeLeft)
    const al = anchorLeft - containerRect.left + scrollLeft
    const ar = (anchorRight ?? anchorLeft) - containerRect.left + scrollLeft
    const at = anchorTop - containerRect.top + scrollTop
    const ab = (anchorBottom ?? anchorTop) - containerRect.top + scrollTop

    // 水平：根据 align 选择起点，再钳到视口内
    let left
    if (align === 'center') left = (al + ar) / 2 - m.width / 2
    else if (align === 'right') left = ar - m.width
    else left = al
    const maxLeft = Math.max(safeLeft, safeRight - m.width)
    left = Math.min(Math.max(left, safeLeft), maxLeft)

    // 垂直：preferredPlacement 放不下就翻面，最后再钳一次
    let top = placement === 'top' ? at - m.height - offset : ab + offset
    if (top < safeTop) top = ab + offset
    if (top + m.height > safeBottom) top = at - m.height - offset
    const maxTop = Math.max(safeTop, safeBottom - m.height)
    top = Math.min(Math.max(top, safeTop), maxTop)

    setPosition((p) =>
      p.top === top && p.left === left && p.maxWidth === maxWidth && p.visibility === 'visible'
        ? p
        : { top, left, maxWidth, visibility: 'visible' }
    )
  }, [
    anchorBottom,
    anchorLeft,
    anchorRight,
    anchorTop,
    align,
    containerRef,
    offset,
    placement,
  ])

  // 渲染后立即测量；RAF 兜底一次首次挂载的尺寸稳定。
  useLayoutEffect(() => {
    compute()
    const raf = requestAnimationFrame(compute)
    return () => cancelAnimationFrame(raf)
  }, [compute])

  // 监听窗口与编辑器滚动变化；浮层跟随编辑器局部坐标重排。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const container = containerRef?.current
    window.addEventListener('resize', compute)
    container?.addEventListener('scroll', compute, { passive: true })
    return () => {
      window.removeEventListener('resize', compute)
      container?.removeEventListener('scroll', compute)
    }
  }, [compute, containerRef])

  return { menuRef, position }
}

const placePointMenuInRect = (x, y, rect, width = CONTEXT_MENU_WIDTH, height = 0) => {
  const margin = FLOATING_MARGIN
  const minLeft = rect.left + margin
  const minTop = rect.top + margin
  const maxLeft = Math.max(minLeft, rect.right - width - margin)
  const maxTop = Math.max(minTop, rect.bottom - height - margin)
  const spaceRight = rect.right - margin - x
  const spaceLeft = x - minLeft
  const spaceBelow = rect.bottom - margin - y
  const spaceAbove = y - minTop
  const preferLeft = spaceRight < width && spaceLeft > spaceRight
  const preferAbove = height > 0 && spaceBelow < height && spaceAbove > spaceBelow
  const rawLeft = preferLeft ? x - width : x
  const rawTop = preferAbove ? y - height : y
  return {
    left: Math.min(Math.max(rawLeft, minLeft), maxLeft),
    top: Math.min(Math.max(rawTop, minTop), maxTop),
  }
}

// ─── 链接 Bubble Menu ─────────────────────────────────────────────────────────
const LinkBubbleMenu = ({ editor, containerRef }) => {
  const [editing, setEditing] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')

  const isLinkActive = editor?.isActive('link') ?? false
  const rect = (editor && (isLinkActive || editing)) ? getLinkAnchorRect(editor) : null
  const { menuRef, position } = useFloatingMenuPosition(rect, {
    containerRef,
    placement: 'bottom',
    align: editing ? 'center' : 'left',
    offset: 6,
  })

  if (!editor || (!isLinkActive && !editing) || !rect) return null

  const currentHref = editor.getAttributes('link').href || ''

  const startEdit = () => {
    setDraftUrl(currentHref || 'https://')
    setEditing(true)
  }
  const applyUrl = () => {
    const url = (draftUrl || '').trim()
    if (!url) {
      editor.chain().focus().unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    setEditing(false)
  }
  const cancel = () => setEditing(false)
  const open = () => { if (currentHref) window.open(currentHref, '_blank', 'noopener,noreferrer') }
  const copy = () => { if (currentHref) navigator.clipboard?.writeText(currentHref) }
  const remove = () => { editor.chain().focus().extendMarkRange('link').unsetLink().run() }

  return (
    <Box
      ref={menuRef}
      sx={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        maxWidth: position.maxWidth,
        visibility: position.visibility,
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        p: '4px 6px',
        ...floatingGlassSx({ radius: '12px' }),
        overflowX: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {editing ? (
        <>
          <TextField
            autoFocus
            size="small"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyUrl() }
              if (e.key === 'Escape') { e.preventDefault(); cancel() }
            }}
            placeholder="https://"
            sx={{
              minWidth: 240
            }}
          />
          <Tooltip title="确定 (Enter)"><IconButton size="small" onClick={applyUrl} sx={{ color: 'primary.main' }}><LinkIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
          <Tooltip title="取消 (Esc)"><IconButton size="small" onClick={cancel}><CloseIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
        </>
      ) : (
        <>
          <MuiTypography
            variant="body2"
            sx={{
              maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 12, color: 'text.secondary', px: 0.5, fontFamily: 'monospace',
            }}
            title={currentHref}
          >
            {currentHref || '未设置链接'}
          </MuiTypography>
          <Tooltip title="打开链接"><span><IconButton size="small" onClick={open} disabled={!currentHref}><OpenInNewIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
          <Tooltip title="复制链接"><span><IconButton size="small" onClick={copy} disabled={!currentHref}><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
          <Tooltip title="编辑链接"><IconButton size="small" onClick={startEdit}><LinkIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          <Tooltip title="移除链接"><IconButton size="small" onClick={remove} sx={{ color: 'error.main' }}><LinkOffIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        </>
      )}
    </Box>
  )
}

// ─── 表格 Bubble Menu ─────────────────────────────────────────────────────────
const TableBubbleMenu = ({ editor, containerRef }) => {
  const isTableActive = editor?.isActive('table') ?? false
  const rect = (editor && isTableActive) ? getTableCellAnchorRect(editor) : null
  const { menuRef, position } = useFloatingMenuPosition(rect, {
    containerRef,
    placement: 'top',
    align: 'center',
    offset: 8,
  })

  if (!editor || !isTableActive || !rect) return null

  const c = () => editor.chain().focus()
  const items = [
    { tip: '在上方添加行', label: '上行', onClick: () => c().addRowBefore().run() },
    { tip: '在下方添加行', label: '下行', onClick: () => c().addRowAfter().run() },
    { tip: '在左侧添加列', label: '左列', onClick: () => c().addColumnBefore().run() },
    { tip: '在右侧添加列', label: '右列', onClick: () => c().addColumnAfter().run() },
    { tip: '删除当前行', label: '删行', onClick: () => c().deleteRow().run(), danger: true },
    { tip: '删除当前列', label: '删列', onClick: () => c().deleteColumn().run(), danger: true },
    { tip: '删除整个表格', label: '删表', onClick: () => c().deleteTable().run(), danger: true, icon: true },
  ]

  return (
    <Box
      ref={menuRef}
      sx={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        maxWidth: position.maxWidth,
        visibility: position.visibility,
        zIndex: 1300,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        p: '4px',
        ...floatingGlassSx({ radius: '12px' }),
        overflowX: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <Tooltip key={i} title={it.tip}>
          <Box
            component="button"
            type="button"
            onClick={it.onClick}
            sx={{
              border: 0,
              borderRadius: '7px',
              px: it.icon ? 0.75 : 1,
              height: 28,
              minWidth: it.icon ? 28 : 42,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.25,
              flex: '0 0 auto',
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1,
              color: it.danger ? 'error.main' : 'text.secondary',
              bgcolor: 'transparent',
              cursor: 'pointer',
              '&:hover': {
                bgcolor: it.danger ? 'rgba(239,68,68,0.10)' : 'action.hover',
              },
            }}
          >
            {it.icon ? <DeleteOutlineIcon sx={{ fontSize: 16 }} /> : it.label}
          </Box>
        </Tooltip>
      ))}
    </Box>
  )
}

// ─── Callout 类型切换 Bubble Menu ─────────────────────────────────────────────
// 检测光标是否在 callout（首段以 [!type] 开头的 blockquote）内，提供类型切换
const CalloutBubbleMenu = ({ editor, containerRef }) => {
  // 所有 hooks 必须在条件 return 之前调用
  let calloutRect = null
  let currentType = ''
  let blockquotePos = -1
  let matchLen = 0

  if (editor) {
    const { $from } = editor.state.selection
    let depth = $from.depth
    let blockquoteNode = null
    while (depth > 0) {
      const node = $from.node(depth)
      if (node.type.name === 'blockquote') {
        blockquoteNode = node
        blockquotePos = $from.before(depth)
        break
      }
      depth -= 1
    }
    if (blockquoteNode) {
      const firstChild = blockquoteNode.firstChild
      const text = firstChild?.textContent || ''
      const m = text.match(/^\[!(\w+)\]/)
      if (m && CALLOUT_TYPES[m[1].toLowerCase()]) {
        currentType = m[1].toLowerCase()
        matchLen = m[0].length
        calloutRect = getCalloutAnchorRect(editor)
      }
    }
  }

  const { menuRef, position } = useFloatingMenuPosition(calloutRect, {
    containerRef,
    placement: 'top',
    align: 'left',
    offset: 8,
  })

  if (!editor || !calloutRect || !currentType) return null

  const types = Object.keys(CALLOUT_TYPES)
  const switchType = (newType) => {
    if (newType === currentType) return
    // 替换 blockquote 第一段开头的 [!type] 标记
    const tagStart = blockquotePos + 2 // 进入 blockquote、再进入 paragraph
    const tagEnd = tagStart + matchLen
    editor.chain().focus().insertContentAt({ from: tagStart, to: tagEnd }, `[!${newType}]`).run()
  }

  return (
    <Box
      ref={menuRef}
      sx={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        maxWidth: position.maxWidth,
        visibility: position.visibility,
        zIndex: 1300,
        display: 'flex', gap: 0.25, p: '3px 6px',
        ...floatingGlassSx({ radius: '999px' }),
        overflowX: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {types.map((t) => {
        const c = CALLOUT_TYPES[t]
        const active = t === currentType
        return (
          <Tooltip key={t} title={t}>
            <IconButton
              size="small"
              onClick={() => switchType(t)}
              sx={{
                width: 24, height: 24,
                bgcolor: active ? `${c.color}26` : 'transparent',
                border: active ? `1px solid ${c.color}` : '1px solid transparent',
                '&:hover': { bgcolor: `${c.color}1a` },
              }}
            >
              <Box component="span" sx={{ fontSize: 13, lineHeight: 1, color: c.color }}>{c.icon || '•'}</Box>
            </IconButton>
          </Tooltip>
        )
      })}
    </Box>
  )
}

const ContextMenuButton = ({ children, active = false, danger = false, disabled = false, shortcut, onClick }) => (
  <Box
    component="button"
    type="button"
    disabled={disabled}
    onClick={onClick}
    sx={{
      width: '100%',
      border: 0,
      borderRadius: '8px',
      px: 1.25,
      py: 0.8,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 2,
      fontSize: 13,
      fontWeight: 600,
      color: disabled ? 'text.disabled' : danger ? 'error.main' : active ? 'primary.main' : 'text.primary',
      bgcolor: active ? 'rgba(59,130,246,0.10)' : 'transparent',
      cursor: disabled ? 'default' : 'pointer',
      '&:hover': {
        bgcolor: disabled ? 'transparent' : danger ? 'rgba(239,68,68,0.10)' : active ? 'rgba(59,130,246,0.14)' : 'action.hover',
      },
    }}
  >
    <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
    {shortcut && (
      <Box component="span" sx={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'text.disabled' }}>
        {shortcut}
      </Box>
    )}
  </Box>
)

const ContextMenuSection = ({ children }) => (
  <MuiTypography
    component="div"
    sx={{
      px: 1.25,
      pt: 0.7,
      pb: 0.35,
      fontSize: 11,
      fontWeight: 800,
      letterSpacing: '0.04em',
      color: 'text.disabled',
    }}
  >
    {children}
  </MuiTypography>
)

const ContextMenuDivider = () => (
  <Box sx={{ height: 1, my: 0.5, bgcolor: 'divider', opacity: 0.7 }} />
)

const BlockSelectActionButton = ({ children, danger = false, disabled = false, onClick }) => (
  <Box
    component="button"
    type="button"
    disabled={disabled}
    onClick={onClick}
    sx={{
      border: 0,
      borderRadius: '9px',
      px: 1.25,
      height: 30,
      flex: '0 0 auto',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 12,
      fontWeight: 800,
      color: disabled ? 'text.disabled' : danger ? 'error.main' : 'text.primary',
      bgcolor: 'transparent',
      cursor: disabled ? 'default' : 'pointer',
      '&:hover': {
        bgcolor: disabled ? 'transparent' : danger ? 'rgba(239,68,68,0.10)' : 'action.hover',
      },
    }}
  >
    {children}
  </Box>
)

const insertPlainText = (editor, text) => {
  if (!text) return
  const { from, to } = editor.state.selection
  editor.view.dispatch(editor.state.tr.insertText(text, from, to).scrollIntoView())
  editor.view.focus()
}

const getEditorMarkdown = (editor) => postprocessMarkdown(editor?.storage?.markdown?.getMarkdown?.() ?? '')

const isAtUndoBaseline = (editor, baseline) => getEditorMarkdown(editor) === (baseline ?? '')

const safeUndo = (editor, baseline) => {
  if (!editor || isAtUndoBaseline(editor, baseline)) return false
  return editor.chain().focus().undo().run()
}

const getCurrentBlockRange = (editor) => {
  if (!editor) return null
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node?.isBlock) {
      return { from: $from.before(depth), to: $from.after(depth), node }
    }
  }
  return null
}

const copyCurrentBlock = async (editor) => {
  const range = getCurrentBlockRange(editor)
  if (!range) return
  const text = editor.state.doc.textBetween(range.from, range.to, '\n').trim()
  if (text) await navigator.clipboard?.writeText(text)
}

const duplicateCurrentBlock = (editor) => {
  const range = getCurrentBlockRange(editor)
  if (!range) return false
  const slice = editor.state.doc.slice(range.from, range.to)
  editor.view.dispatch(editor.state.tr.insert(range.to, slice.content).scrollIntoView())
  editor.view.focus()
  return true
}

const deleteCurrentBlock = (editor) => {
  const range = getCurrentBlockRange(editor)
  if (!range) return false
  editor.chain().focus().deleteRange({ from: range.from, to: range.to }).run()
  return true
}

const getTopLevelBlocks = (editor, container) => {
  if (!editor?.view || !container) return []
  const containerRect = container.getBoundingClientRect()
  const scrollTop = container.scrollTop || 0
  const scrollLeft = container.scrollLeft || 0
  const blocks = []
  editor.state.doc.forEach((node, offset, index) => {
    const from = offset
    const to = offset + node.nodeSize
    const dom = editor.view.nodeDOM(from)
    if (!dom?.getBoundingClientRect) return
    const rect = dom.getBoundingClientRect()
    if (!rect.width && !rect.height) return
    blocks.push({
      id: `${from}:${to}:${index}`,
      from,
      to,
      node,
      top: rect.top - containerRect.top + scrollTop,
      left: rect.left - containerRect.left + scrollLeft,
      width: rect.width,
      height: rect.height,
    })
  })
  return blocks
}

const copyBlockRanges = async (editor, ranges) => {
  if (!editor || !ranges.length) return
  const text = ranges
    .sort((a, b) => a.from - b.from)
    .map(({ from, to }) => editor.state.doc.textBetween(from, to, '\n').trim())
    .filter(Boolean)
    .join('\n\n')
  if (text) await navigator.clipboard?.writeText(text)
}

const duplicateBlockRanges = (editor, ranges) => {
  if (!editor || !ranges.length) return false
  let tr = editor.state.tr
  ranges
    .sort((a, b) => b.from - a.from)
    .forEach(({ from, to }) => {
      tr = tr.insert(to, editor.state.doc.slice(from, to).content)
    })
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}

const deleteBlockRanges = (editor, ranges) => {
  if (!editor || !ranges.length) return false
  if (ranges.length >= editor.state.doc.childCount) {
    editor.commands.clearContent(true)
    return true
  }
  let tr = editor.state.tr
  ranges
    .sort((a, b) => b.from - a.from)
    .forEach(({ from, to }) => { tr = tr.delete(from, to) })
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}

const moveTopLevelBlocks = (editor, blocks, movingIds, targetIndex) => {
  if (!editor || !blocks.length || !movingIds.length) return false
  const movingIdSet = new Set(movingIds)
  const movingIndexes = blocks
    .map((block, index) => (movingIdSet.has(block.id) ? index : -1))
    .filter(index => index >= 0)
  if (!movingIndexes.length) return false
  const movingIndexSet = new Set(movingIndexes)

  const childNodes = []
  editor.state.doc.forEach((node) => { childNodes.push(node) })

  const movingNodes = movingIndexes.map(index => childNodes[index]).filter(Boolean)
  if (!movingNodes.length) return false

  const remainingNodes = childNodes.filter((_, index) => !movingIndexSet.has(index))
  const clampedTarget = Math.max(0, Math.min(targetIndex, remainingNodes.length))
  const currentStartInRemaining = blocks
    .slice(0, movingIndexes[0])
    .filter(block => !movingIdSet.has(block.id)).length
  if (clampedTarget === currentStartInRemaining) return false

  const nextNodes = [
    ...remainingNodes.slice(0, clampedTarget),
    ...movingNodes,
    ...remainingNodes.slice(clampedTarget),
  ]
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, Fragment.fromArray(nextNodes))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  return true
}

const insertCalloutBlock = (editor, type = 'note') => {
  return editor.chain().focus().insertContent({
    type: 'blockquote',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text: `[!${type}] ` }],
    }],
  }).run()
}

const getSlashState = (editor) => {
  if (!editor || !editor.state.selection.empty || editor.isActive('codeBlock')) return null
  const { $from } = editor.state.selection
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const slashIndex = textBefore.lastIndexOf('/')
  if (slashIndex < 0) return null
  const query = textBefore.slice(slashIndex + 1)
  if (/\s/.test(query) || query.length > 24) return null
  const beforeSlash = textBefore[slashIndex - 1]
  if (beforeSlash && !/\s/.test(beforeSlash)) return null
  return {
    query,
    range: {
      from: $from.start() + slashIndex,
      to: $from.pos,
    },
  }
}

const SLASH_COMMANDS = [
  { id: 'paragraph', title: '正文', hint: '普通段落', keywords: 'text paragraph p', run: (editor) => editor.chain().focus().setParagraph().run() },
  { id: 'h1', title: '标题 1', hint: '大标题', keywords: 'heading h1 title', run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
  { id: 'h2', title: '标题 2', hint: '章节标题', keywords: 'heading h2 subtitle', run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
  { id: 'h3', title: '标题 3', hint: '小标题', keywords: 'heading h3', run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
  { id: 'bullet', title: '项目符号列表', hint: '无序列表', keywords: 'ul bullet list', run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { id: 'ordered', title: '编号列表', hint: '有序列表', keywords: 'ol ordered list', run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { id: 'task', title: '任务列表', hint: '可勾选事项', keywords: 'todo task checkbox', run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { id: 'quote', title: '引用', hint: '突出一段话', keywords: 'quote blockquote', run: (editor) => editor.chain().focus().toggleBlockquote().run() },
  { id: 'codeblock', title: '代码块', hint: '多行代码', keywords: 'code pre', run: (editor) => editor.chain().focus().setCodeBlock().run() },
  { id: 'table', title: '表格', hint: '3 x 3 表格', keywords: 'table grid', run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: 'callout-note', title: '备注 Callout', hint: '现代提示块', keywords: 'callout note info', run: (editor) => insertCalloutBlock(editor, 'note') },
  { id: 'callout-warning', title: '警告 Callout', hint: '强调风险', keywords: 'callout warning danger', run: (editor) => insertCalloutBlock(editor, 'warning') },
  { id: 'hr', title: '分割线', hint: '分隔内容', keywords: 'divider hr line', run: (editor) => editor.chain().focus().setHorizontalRule().run() },
  { id: 'image', title: '图片链接', hint: '插入图片 URL', keywords: 'image img picture', run: (editor) => {
    const url = window.prompt('输入图片地址')
    return url ? editor.chain().focus().setImage({ src: url.trim() }).run() : false
  } },
]

const runSlashCommand = (editor, slashState, command) => {
  if (!editor || !slashState || !command) return false
  editor.chain().focus().deleteRange(slashState.range).run()
  return command.run(editor)
}

const SlashCommandMenu = ({ editor, containerRef }) => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const slashState = getSlashState(editor)
  const query = slashState?.query?.toLowerCase() || ''
  const commands = SLASH_COMMANDS.filter((cmd) => {
    const haystack = `${cmd.title} ${cmd.hint} ${cmd.keywords}`.toLowerCase()
    return haystack.includes(query)
  }).slice(0, 9)
  const rect = slashState ? getSelectionRect(editor) : null
  const { menuRef, position } = useFloatingMenuPosition(rect, {
    containerRef,
    placement: 'bottom',
    align: 'left',
    offset: 8,
  })

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (!slashState || !commands.length) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        editor.chain().focus().deleteRange(slashState.range).run()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % commands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + commands.length) % commands.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        runSlashCommand(editor, slashState, commands[selectedIndex] || commands[0])
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [commands, editor, selectedIndex, slashState])

  if (!editor || !slashState || !commands.length || !rect) return null

  return (
    <Box
      ref={menuRef}
      sx={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: 260,
        maxWidth: position.maxWidth,
        maxHeight: 360,
        overflowY: 'auto',
        visibility: position.visibility,
        zIndex: 1450,
        p: 0.65,
        ...floatingGlassSx({ radius: '14px', shadow: 'menu' }),
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <ContextMenuSection>插入</ContextMenuSection>
      {commands.map((cmd, index) => (
        <ContextMenuButton
          key={cmd.id}
          active={index === selectedIndex}
          shortcut={cmd.hint}
          onClick={() => runSlashCommand(editor, slashState, cmd)}
        >
          {cmd.title}
        </ContextMenuButton>
      ))}
    </Box>
  )
}

const BlockMultiSelectOverlay = ({
  editor,
  containerRef,
  active,
  selectedBlocks,
  setSelectedBlocks,
  onExit,
}) => {
  const container = containerRef?.current
  const [toolbarFrame, setToolbarFrame] = useState(null)
  const [dragState, setDragState] = useState(null)
  const suppressBlockClickRef = useRef(false)
  const [blocks, setBlocks] = useState([])
  const selectedRanges = blocks.filter((block) => selectedBlocks.includes(block.id))
  const selectedCount = selectedRanges.length
  const allBlockIds = useMemo(() => blocks.map((block) => block.id), [blocks])

  useLayoutEffect(() => {
    if (!active || !editor || !container) {
      setBlocks([])
      return undefined
    }

    const updateBlocks = () => {
      setBlocks(getTopLevelBlocks(editor, container))
    }

    updateBlocks()
    editor.on('transaction', updateBlocks)
    editor.on('selectionUpdate', updateBlocks)
    editor.on('focus', updateBlocks)
    container.addEventListener('scroll', updateBlocks, { passive: true })
    window.addEventListener('resize', updateBlocks)
    return () => {
      editor.off('transaction', updateBlocks)
      editor.off('selectionUpdate', updateBlocks)
      editor.off('focus', updateBlocks)
      container.removeEventListener('scroll', updateBlocks)
      window.removeEventListener('resize', updateBlocks)
    }
  }, [active, container, editor])

  useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onExit()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelectedBlocks(allBlockIds)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, allBlockIds, onExit, setSelectedBlocks])

  useLayoutEffect(() => {
    if (!active || !container) {
      setToolbarFrame(null)
      return undefined
    }
    const updateFrame = () => {
      const rect = container.getBoundingClientRect()
      const next = {
        top: rect.top + FLOATING_MARGIN,
        left: rect.left + 16,
        width: Math.max(240, rect.width - 32),
      }
      setToolbarFrame((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.width === next.width ? prev : next
      )
    }
    updateFrame()
    window.addEventListener('resize', updateFrame)
    return () => window.removeEventListener('resize', updateFrame)
  }, [active, container])

  if (!active || !editor || !container) return null

  const toggleBlock = (id) => {
    setSelectedBlocks((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }
  const selectAll = () => setSelectedBlocks(allBlockIds)
  const selectNone = () => setSelectedBlocks([])
  const getDropIndexFromPointer = (clientY, movingIds) => {
    const rect = container.getBoundingClientRect()
    const localY = clientY - rect.top + (container.scrollTop || 0)
    const movingIdSet = new Set(movingIds)
    return blocks
      .filter(block => !movingIdSet.has(block.id))
      .reduce((index, block) => (localY > block.top + block.height / 2 ? index + 1 : index), 0)
  }
  const startDrag = (event, block) => {
    event.preventDefault()
    event.stopPropagation()
    const movingIds = selectedBlocks.includes(block.id) && selectedBlocks.length ? selectedBlocks : [block.id]
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragState({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hasMoved: false,
      movingIds,
      dropIndex: getDropIndexFromPointer(event.clientY, movingIds),
    })
  }
  const updateDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return
    event.preventDefault()
    setDragState((current) => current
      ? {
          ...current,
          hasMoved: current.hasMoved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4,
          dropIndex: getDropIndexFromPointer(event.clientY, current.movingIds),
        }
      : current)
  }
  const finishDrag = (event) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return
    event.preventDefault()
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (dragState.hasMoved) {
      suppressBlockClickRef.current = true
      moveTopLevelBlocks(editor, blocks, dragState.movingIds, dragState.dropIndex)
      setSelectedBlocks([])
      window.setTimeout(() => { suppressBlockClickRef.current = false }, 0)
    }
    setDragState(null)
  }
  const cancelDrag = (event) => {
    if (dragState?.pointerId === event.pointerId) setDragState(null)
  }
  const afterAction = () => {
    setSelectedBlocks([])
    onExit()
  }
  const dropIndicatorTop = (() => {
    if (!dragState) return null
    const remainingBlocks = blocks.filter(block => !dragState.movingIds.includes(block.id))
    const targetBlock = remainingBlocks[dragState.dropIndex]
    if (targetBlock) return targetBlock.top - 5
    const lastBlock = remainingBlocks[remainingBlocks.length - 1]
    return lastBlock ? lastBlock.top + lastBlock.height + 5 : 8
  })()
  const blockBounds = blocks.reduce((bounds, block) => ({
    left: Math.min(bounds.left, block.left),
    right: Math.max(bounds.right, block.left + block.width),
  }), { left: Infinity, right: 0 })
  const dropIndicatorLeft = Number.isFinite(blockBounds.left) ? Math.max(6, blockBounds.left) : 6
  const dropIndicatorWidth = Math.max(160, blockBounds.right - (Number.isFinite(blockBounds.left) ? blockBounds.left : 0))

  return (
    <>
      <Portal>
        <Box
          sx={{
            position: 'fixed',
            top: toolbarFrame?.top ?? FLOATING_MARGIN,
            left: toolbarFrame?.left ?? FLOATING_MARGIN,
            width: toolbarFrame?.width ?? 'auto',
            zIndex: 1500,
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            p: '6px 8px',
            overflowX: 'auto',
            ...floatingGlassSx({ radius: '14px', shadow: 'menu' }),
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <MuiTypography sx={{ px: 0.75, fontSize: 12, fontWeight: 800, color: 'text.secondary' }}>
            已选 {selectedCount} / {blocks.length} 块
          </MuiTypography>
          <BlockSelectActionButton disabled={!blocks.length} onClick={selectAll}>全选</BlockSelectActionButton>
          <BlockSelectActionButton disabled={!selectedCount} onClick={selectNone}>取消</BlockSelectActionButton>
          <BlockSelectActionButton
            disabled={!selectedCount}
            onClick={async () => { await copyBlockRanges(editor, selectedRanges); afterAction() }}
          >
            复制
          </BlockSelectActionButton>
          <BlockSelectActionButton
            disabled={!selectedCount}
            onClick={() => { duplicateBlockRanges(editor, selectedRanges); afterAction() }}
          >
            复制一份
          </BlockSelectActionButton>
          <BlockSelectActionButton
            danger
            disabled={!selectedCount}
            onClick={() => { deleteBlockRanges(editor, selectedRanges); afterAction() }}
          >
            删除
          </BlockSelectActionButton>
          <BlockSelectActionButton onClick={onExit}>退出</BlockSelectActionButton>
        </Box>
      </Portal>
      {dropIndicatorTop !== null && (
        <Box
          sx={{
            position: 'absolute',
            top: dropIndicatorTop,
            left: dropIndicatorLeft,
            width: dropIndicatorWidth,
            height: 3,
            borderRadius: 999,
            bgcolor: 'primary.main',
            boxShadow: '0 0 0 3px rgba(59,130,246,0.14)',
            pointerEvents: 'none',
            zIndex: 1520,
          }}
        />
      )}
      {blocks.map((block) => {
        const selected = selectedBlocks.includes(block.id)
        const dragging = dragState?.movingIds.includes(block.id)
        return (
          <Box key={block.id}>
            {selected && (
              <Box
                sx={{
                  position: 'absolute',
                  top: block.top - 4,
                  left: block.left - 6,
                  width: block.width + 12,
                  height: block.height + 8,
                  borderRadius: '10px',
                  bgcolor: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.24)',
                  opacity: dragging ? 0.55 : 1,
                  pointerEvents: 'none',
                  zIndex: 20,
                }}
              />
            )}
            <Box
              component="button"
              type="button"
              aria-label={selected ? '取消选择块' : '选择块'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault()
                if (suppressBlockClickRef.current) return
                toggleBlock(block.id)
              }}
              onPointerDown={(e) => startDrag(e, block)}
              onPointerMove={updateDrag}
              onPointerUp={finishDrag}
              onPointerCancel={cancelDrag}
              sx={{
                position: 'absolute',
                top: block.top + Math.max(0, block.height / 2 - 11),
                left: Math.max(6, block.left - 34),
                width: 22,
                height: 22,
                borderRadius: '50%',
                border: '1.5px solid',
                borderColor: selected ? 'primary.main' : 'rgba(100,116,139,0.48)',
                bgcolor: selected ? 'primary.main' : 'rgba(255,255,255,0.78)',
                color: selected ? 'primary.contrastText' : 'transparent',
                boxShadow: '0 6px 18px rgba(15,23,42,0.14)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                cursor: dragState ? 'grabbing' : 'grab',
                zIndex: 1510,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 900,
                lineHeight: 1,
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: selected ? 'primary.main' : 'rgba(59,130,246,0.12)',
                },
              }}
            >
              ✓
            </Box>
          </Box>
        )
      })}
    </>
  )
}

const EditorContextMenu = ({ editor, menu, containerRef, undoBaseline, blockSelectActive, onToggleBlockSelect, onClose }) => {
  const configuredItems = useStore((state) => state.contextMenuItems)
  const enabledItems = useMemo(() => {
    if (!configuredItems) return DEFAULT_CONTEXT_MENU_ITEMS
    const missingDefaults = DEFAULT_CONTEXT_MENU_ITEMS.filter(id => !configuredItems.includes(id))
    return missingDefaults.length ? [...configuredItems, ...missingDefaults] : configuredItems
  }, [configuredItems])
  const isEnabled = (id) => enabledItems.includes(id)
  const menuRef = useRef(null)
  const [sizeOffset, setSizeOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!menu) return undefined
    const close = () => onClose()
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu, onClose])

  useLayoutEffect(() => {
    if (!menu) {
      setSizeOffset((prev) => prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 })
      return
    }
    const node = menuRef.current
    const container = containerRef?.current
    if (!node || !container) return

    const rect = node.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const minLeft = containerRect.left + FLOATING_MARGIN
    const minTop = containerRect.top + FLOATING_MARGIN
    const maxRight = containerRect.right - FLOATING_MARGIN
    const maxBottom = containerRect.bottom - FLOATING_MARGIN
    let dx = Math.min(0, maxRight - (menu.left + rect.width))
    let dy = Math.min(0, maxBottom - (menu.top + rect.height))
    if (menu.left + dx < minLeft) dx = minLeft - menu.left
    if (menu.top + dy < minTop) dy = minTop - menu.top
    const next = {
      x: Number.isFinite(dx) ? dx : 0,
      y: Number.isFinite(dy) ? dy : 0,
    }
    setSizeOffset((prev) =>
      prev.x === next.x && prev.y === next.y ? prev : next
    )
  }, [containerRef, menu])

  if (!editor || !menu) return null

  const selectedText = editor.state.doc.textBetween(
    editor.state.selection.from,
    editor.state.selection.to,
    '\n'
  )
  const hasSelection = Boolean(selectedText)
  const isLink = editor.isActive('link')
  const isTable = editor.isActive('table')
  const isBold = editor.isActive('bold')
  const isItalic = editor.isActive('italic')
  const isCode = editor.isActive('code')
  const isBulletList = editor.isActive('bulletList')
  const isOrderedList = editor.isActive('orderedList')
  const isTaskList = editor.isActive('taskList')
  const isBlockquote = editor.isActive('blockquote')
  const linkHref = editor.getAttributes('link')?.href || ''
  const hasBlockTransformContext = Boolean(
    hasSelection ||
    editor.isActive('heading') ||
    isBulletList ||
    isOrderedList ||
    isTaskList ||
    isBlockquote
  )
  const run = async (fn) => {
    await fn()
    onClose()
  }

  const copyText = () => run(async () => {
    if (selectedText) navigator.clipboard?.writeText(selectedText)
  })
  const cutText = () => run(async () => {
    if (!selectedText) return
    await navigator.clipboard?.writeText(selectedText)
    editor.chain().focus().deleteSelection().run()
  })
  const pasteText = () => run(async () => {
    const text = await navigator.clipboard?.readText?.()
    // 用 insertContentAt 而非 insertContent，让 tiptap-markdown 按 markdown 解析剪贴板文本
    if (text) editor.chain().focus().insertContentAt(editor.state.selection.from, text).run()
  })
  const pastePlainText = () => run(async () => {
    const text = await navigator.clipboard?.readText?.()
    insertPlainText(editor, text)
  })
  const createLink = () => run(async () => {
    const url = window.prompt('输入链接地址', linkHref || 'https://')
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  })
  const showEdit = ['undo', 'redo', 'cut', 'copy', 'paste', 'pastePlain', 'selectAll'].some(isEnabled)
  const showFormat = (hasSelection || isLink) && ['bold', 'italic', 'code', 'link'].some(isEnabled)
  const showBlockTransforms = hasBlockTransformContext && [
    'paragraph', 'heading1', 'heading2', 'bulletList', 'orderedList', 'taskList', 'blockquote',
  ].some(isEnabled)
  const showBlockSelectAction = isEnabled('blockSelect')
  const showBlockActions = hasSelection && [
    'copyBlock', 'duplicateBlock', 'deleteBlock', 'callout',
  ].some(isEnabled)

  return (
    <Portal>
      <Box
        ref={menuRef}
        data-editor-context-menu
        sx={{
          position: 'fixed',
          top: menu.top,
          left: menu.left,
          width: CONTEXT_MENU_WIDTH,
          maxHeight: menu.maxHeight || 360,
          overflowY: 'auto',
          transform: `translate(${sizeOffset.x}px, ${sizeOffset.y}px)`,
          zIndex: 1400,
          pointerEvents: 'auto',
          p: 0.55,
          ...floatingGlassSx({ radius: '14px', shadow: 'menu' }),
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
      {showEdit && (
        <>
          <ContextMenuSection>编辑</ContextMenuSection>
          {isEnabled('undo') && <ContextMenuButton shortcut="⌘Z" onClick={() => run(async () => safeUndo(editor, undoBaseline))}>撤销</ContextMenuButton>}
          {isEnabled('redo') && <ContextMenuButton shortcut="⇧⌘Z" onClick={() => run(async () => editor.chain().focus().redo().run())}>重做</ContextMenuButton>}
          {isEnabled('cut') && <ContextMenuButton disabled={!hasSelection} shortcut="⌘X" onClick={cutText}>剪切</ContextMenuButton>}
          {isEnabled('copy') && <ContextMenuButton disabled={!hasSelection} shortcut="⌘C" onClick={copyText}>复制</ContextMenuButton>}
          {isEnabled('paste') && <ContextMenuButton shortcut="⌘V" onClick={pasteText}>粘贴</ContextMenuButton>}
          {isEnabled('pastePlain') && <ContextMenuButton shortcut="⇧⌘V" onClick={pastePlainText}>无格式粘贴</ContextMenuButton>}
          {isEnabled('selectAll') && <ContextMenuButton shortcut="⌘A" onClick={() => run(async () => editor.chain().focus().selectAll().run())}>全选</ContextMenuButton>}
        </>
      )}
      {showFormat && (
        <>
          {showEdit && <ContextMenuDivider />}
          <ContextMenuSection>格式</ContextMenuSection>
          {isEnabled('bold') && <ContextMenuButton active={isBold} shortcut="⌘B" onClick={() => run(async () => editor.chain().focus().toggleBold().run())}>加粗</ContextMenuButton>}
          {isEnabled('italic') && <ContextMenuButton active={isItalic} shortcut="⌘I" onClick={() => run(async () => editor.chain().focus().toggleItalic().run())}>斜体</ContextMenuButton>}
          {isEnabled('code') && <ContextMenuButton active={isCode} shortcut="⌘E" onClick={() => run(async () => editor.chain().focus().toggleCode().run())}>行内代码</ContextMenuButton>}
          {isEnabled('link') && <ContextMenuButton active={isLink} shortcut="⌘K" onClick={createLink}>{isLink ? '编辑链接' : '添加链接'}</ContextMenuButton>}
          {isLink && isEnabled('link') && (
            <>
              <ContextMenuButton onClick={() => run(async () => navigator.clipboard?.writeText(linkHref))}>复制链接</ContextMenuButton>
              <ContextMenuButton danger onClick={() => run(async () => editor.chain().focus().extendMarkRange('link').unsetLink().run())}>移除链接</ContextMenuButton>
            </>
          )}
        </>
      )}
      {(showBlockTransforms || showBlockSelectAction || showBlockActions) && (
        <>
          {(showEdit || showFormat) && <ContextMenuDivider />}
          <ContextMenuSection>块</ContextMenuSection>
          {showBlockTransforms && isEnabled('paragraph') && <ContextMenuButton active={editor.isActive('paragraph')} onClick={() => run(async () => editor.chain().focus().setParagraph().run())}>转为正文</ContextMenuButton>}
          {showBlockTransforms && isEnabled('heading1') && <ContextMenuButton active={editor.isActive('heading', { level: 1 })} onClick={() => run(async () => editor.chain().focus().toggleHeading({ level: 1 }).run())}>转为标题 1</ContextMenuButton>}
          {showBlockTransforms && isEnabled('heading2') && <ContextMenuButton active={editor.isActive('heading', { level: 2 })} onClick={() => run(async () => editor.chain().focus().toggleHeading({ level: 2 }).run())}>转为标题 2</ContextMenuButton>}
          {showBlockTransforms && isEnabled('bulletList') && <ContextMenuButton active={isBulletList} onClick={() => run(async () => editor.chain().focus().toggleBulletList().run())}>项目符号列表</ContextMenuButton>}
          {showBlockTransforms && isEnabled('orderedList') && <ContextMenuButton active={isOrderedList} onClick={() => run(async () => editor.chain().focus().toggleOrderedList().run())}>编号列表</ContextMenuButton>}
          {showBlockTransforms && isEnabled('taskList') && <ContextMenuButton active={isTaskList} onClick={() => run(async () => editor.chain().focus().toggleTaskList().run())}>任务列表</ContextMenuButton>}
          {showBlockTransforms && isEnabled('blockquote') && <ContextMenuButton active={isBlockquote} onClick={() => run(async () => editor.chain().focus().toggleBlockquote().run())}>引用</ContextMenuButton>}
          {showBlockActions && isEnabled('callout') && <ContextMenuButton onClick={() => run(async () => insertCalloutBlock(editor, 'note'))}>插入 Callout</ContextMenuButton>}
          {showBlockSelectAction && <ContextMenuButton active={blockSelectActive} onClick={() => run(async () => onToggleBlockSelect?.())}>{blockSelectActive ? '退出块多选' : '进入块多选'}</ContextMenuButton>}
          {showBlockActions && isEnabled('copyBlock') && <ContextMenuButton onClick={() => run(async () => copyCurrentBlock(editor))}>复制当前块</ContextMenuButton>}
          {showBlockActions && isEnabled('duplicateBlock') && <ContextMenuButton onClick={() => run(async () => duplicateCurrentBlock(editor))}>复制一份当前块</ContextMenuButton>}
          {showBlockActions && isEnabled('deleteBlock') && <ContextMenuButton danger onClick={() => run(async () => deleteCurrentBlock(editor))}>删除当前块</ContextMenuButton>}
        </>
      )}
      {isTable && isEnabled('table') && (
        <>
          <ContextMenuDivider />
          <ContextMenuSection>表格</ContextMenuSection>
          <ContextMenuButton onClick={() => run(async () => editor.chain().focus().addRowAfter().run())}>下方插入行</ContextMenuButton>
          <ContextMenuButton onClick={() => run(async () => editor.chain().focus().addColumnAfter().run())}>右侧插入列</ContextMenuButton>
          <ContextMenuButton danger onClick={() => run(async () => editor.chain().focus().deleteRow().run())}>删除当前行</ContextMenuButton>
          <ContextMenuButton danger onClick={() => run(async () => editor.chain().focus().deleteColumn().run())}>删除当前列</ContextMenuButton>
          <ContextMenuButton danger onClick={() => run(async () => editor.chain().focus().deleteTable().run())}>删除表格</ContextMenuButton>
        </>
      )}
      </Box>
    </Portal>
  )
}

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
const WYSIWYGEditor = forwardRef(({ noteId, content, onChange, onEditorReady, onBlockSelectModeChange, placeholder = '开始输入...' }, ref) => {
  // 用 ref 追踪最新 onChange，避免在 useEditor 回调中因闭包失效而用到旧 handler
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // 同步锁：外部 setContent 期间为 true，屏蔽 onUpdate → onChange
  const isSyncingRef = useRef(false)

  // 记录上次"已处理过"的 content 字符串，用于幂等判断
  const lastExternalContentRef = useRef(content ?? '')
  // 当前笔记的 undo 基线：撤销最多只能回到这里，不能继续撤到空文档/上一状态
  const undoBaselineRef = useRef(content ?? '')

  // 用户是否正在编辑（区分本地编辑和外部同步）
  // - 用户输入后置 true
  // - 外部 content 与本地一致或显式应用更新后置 false
  const userEditingRef = useRef(false)

  // 远端待合并的内容（dirty + 不一致时挂起，由用户决定）
  const [pendingExternalContent, setPendingExternalContent] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [blockSelectMode, setBlockSelectMode] = useState(false)
  const [selectedBlocks, setSelectedBlocks] = useState([])

  // 当前编辑器所对应的笔记 id，用于区分“切换笔记”和“同笔记外部更新”
  const lastNoteIdRef = useRef(noteId ?? null)

  // 始终指向最新 editor，供粘贴/拖放等异步回调使用
  const editorRef = useRef(null)
  const overlayContainerRef = useRef(null)

  // 始终指向最新 handleImageUpload，供 editorProps 闭包使用
  const handleImageUploadRef = useRef(null)
  // ── 图片保存并插入编辑器 ─────────────────────────────────────────────────────
  // pos 可选：指定插入位置（拖放时按鼠标落点；粘贴/工具栏时 undefined 表示当前光标）
  const handleImageUpload = async (blob, pos) => {
    const ed = editorRef.current
    if (!ed) return
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      const fileName = `paste_${Date.now()}.png`
      const imagePath = await imageAPI.saveFromBuffer(buffer, fileName)
      if (imagePath) {
        // 插入原始相对路径，NodeView 会异步解析为可显示 URL
        if (typeof pos === 'number') {
          ed.chain().focus().insertContentAt(pos, {
            type: 'image',
            attrs: { src: imagePath, alt: fileName },
          }).run()
        } else {
          ed.chain().focus().setImage({ src: imagePath, alt: fileName }).run()
        }
      }
    } catch (error) {
      console.error('[WYSIWYGEditor] 图片保存失败:', error)
    }
  }

  // ── 通用附件保存并插入卡片 ───────────────────────────────────────────────────
  // 把非图片文件复制到 userData/attachments/，再插入图片节点（序列化回 markdown 是 ![name](attachments/xxx.ext)）
  // 复用图片管线：ImageNodeView 检测到附件后渲染为 AttachmentCard
  const handleAttachmentUpload = async (file, pos) => {
    const ed = editorRef.current
    if (!ed || !file) return
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const fileName = file.name || `attachment_${Date.now()}`
      const result = await window.electronAPI?.attachments?.saveFromBuffer?.(buffer, fileName)
      if (!result?.success || !result.data?.relativePath) {
        const msg = result?.error || '未知原因'
        console.warn('[WYSIWYGEditor] 附件保存失败:', msg)
        try { window.alert(`附件保存失败：${msg}`) } catch {}
        return
      }
      const { relativePath, displayName } = result.data
      const label = (displayName || fileName).replace(/[\[\]]/g, '')
      // 直接传 markdown：tiptap-markdown 重写了 insertContentAt 会按 markdown 解析
      const insertPos = typeof pos === 'number' ? pos : ed.state.selection.from
      ed.chain().focus().insertContentAt(insertPos, `![${label}](${relativePath})`).run()
    } catch (error) {
      console.error('[WYSIWYGEditor] 附件保存失败:', error)
    }
  }

  const handleAttachmentUploadRef = useRef(null)

  // 每次渲染都更新 ref，确保 editorProps 闭包用到的是最新版本
  handleImageUploadRef.current = handleImageUpload
  handleAttachmentUploadRef.current = handleAttachmentUpload

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: { depth: 50, newGroupDelay: 500 },
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: false, // 由 CodeBlockLowlight 接管
        link: false,
        underline: false,
        // 行内代码关闭拼写检查（避免代码标识符被划红线）
        code: { HTMLAttributes: { spellcheck: 'false' } },
      }),
      Placeholder.configure({ placeholder }),
      CustomHighlight.configure({ multicolor: true }),
      TextColor,
      CustomUnderline,
      Link.configure({
        openOnClick: false,
        protocols: ['file', 'app'],
        isAllowedUri: (url, ctx) => (
          /^file:\/\//i.test(url) ||
          /^app:\/\//i.test(url) ||
          ctx.defaultValidate(url)
        ),
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
      CodeBlockLowlight.configure({
        lowlight,
        // 代码块关闭拼写检查
        HTMLAttributes: { spellcheck: 'false' },
      }),
      // Callout 装饰插件（blockquote 中的 [!type] 渲染为彩色卡片）
      CalloutDecoration,
      // 空段落保护：tiptap-markdown 会丢弃空 paragraph，存储前再剥离该不可见字符。
      EmptyParagraphPreserver,
      // 核心：Markdown ↔ TipTap 双向序列化
      Markdown.configure({
        html: true,
        tightLists: true,
        tightListClass: 'tight',
        bulletListMarker: '-',
        // 关闭 linkify / breaks / 粘贴文本二次解析：避免日志/代码类纯文本
        // 在序列化时被反向 autolink、追加行尾续行符 \、或被识别成 emphasis。
        linkify: false,
        breaks: false,
        transformPastedText: false,
        transformCopiedText: true,
      }),
    ],

    // 以当前笔记内容创建 editor；noteId 变化时重建实例，从根上隔离 undo/redo history。
    content: preprocessMarkdown(content ?? ''),

    onUpdate: ({ editor: ed }) => {
      // isSyncingRef 为 true 时：是外部 setContent 触发，不回调 onChange（防循环）
      if (isSyncingRef.current) return
      const markdown = postprocessMarkdown(ed.storage.markdown.getMarkdown())
      lastExternalContentRef.current = markdown
      // 标记用户正在编辑，外部 content 变化时进入 dirty gate
      userEditingRef.current = true
      onChangeRef.current(markdown)
    },

    editorProps: {
      // 默认开启拼写检查（更现代）；代码块/行内代码已通过节点配置关闭
      attributes: { class: 'wysiwyg-editor-content', spellcheck: 'true' },

      // ── 拦截图片粘贴 ──────────────────────────────────────────────────────────
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false

        const items = data.items || []
        const plainText = data.getData('text/plain') || ''
        const htmlText = data.getData('text/html') || ''
        const hasTextualContent = Boolean(plainText.trim() || htmlText.trim())

        // 1) 图片：仅在没有文本时拦截上传，避免把图文混排里的占位图替换掉文本
        for (let i = 0; i < items.length; i++) {
          if (items[i].type?.startsWith('image/')) {
            if (hasTextualContent) return false
            event.preventDefault()
            const blob = items[i].getAsFile()
            if (blob) handleImageUpload(blob)
            return true
          }
        }

        // 1.5) 非图片文件粘贴：导入到 attachments/ 并插入链接
        const files = Array.from(data.files || [])
        const nonImageFiles = files.filter(f => f && !f.type?.startsWith('image/'))
        if (nonImageFiles.length > 0 && !hasTextualContent) {
          event.preventDefault()
          nonImageFiles.forEach(file => handleAttachmentUploadRef.current?.(file))
          return true
        }

        // 2) 纯文本（无 HTML 富文本）：以原样字面量插入，绕开 markdown 二次解析。
        //    避免 [], *, _, {color}, URL 等被识别后在保存时反向转义/包裹。
        if (plainText && !htmlText.trim()) {
          event.preventDefault()
          const { state } = view
          const { schema } = state
          const lines = plainText.replace(/\r\n?/g, '\n').split('\n')
          const paragraph = schema.nodes.paragraph
          const nodes = lines.map((line) => paragraph.create(
            null,
            line ? schema.text(line) : null,
          ))
          const slice = new Slice(Fragment.fromArray(nodes), 1, 1)
          view.dispatch(state.tr.replaceSelection(slice).scrollIntoView())
          return true
        }

        // 3) 富文本 HTML：若包含 <img src="data:image/..."> 这种 base64 内联图（如飞书复制），
        //    先把 data URL 持久化为本地图片文件，避免超长 data URL 被写入 markdown 后续被序列化破坏。
        if (htmlText && /<img[^>]+src=(["'])data:image\//i.test(htmlText)) {
          event.preventDefault()
          replaceDataImagesInHtml(htmlText).then((processedHtml) => {
            const ed = editorRef.current
            if (!ed || ed.isDestroyed) return
            // 用替换后的 HTML 走 TipTap 默认 HTML 解析路径（pasteHTML）
            ed.commands.insertContent(processedHtml, {
              parseOptions: { preserveWhitespace: 'full' },
            })
          }).catch((err) => {
            console.warn('[WYSIWYGEditor] 处理粘贴 data URL 图片失败:', err)
            const ed = editorRef.current
            if (ed && !ed.isDestroyed) ed.commands.insertContent(htmlText)
          })
          return true
        }

        // 4) 其余（带 HTML 的富文本）交给 TipTap 默认 HTML 解析路径
        return false
      },

      handleKeyDown: (_view, event) => {
        const key = event.key?.toLowerCase?.()
        const isModZ = (event.metaKey || event.ctrlKey) && !event.altKey && key === 'z'
        if (!isModZ || event.shiftKey) return false
        if (isAtUndoBaseline(editorRef.current, undoBaselineRef.current)) {
          event.preventDefault()
          return true
        }
        event.preventDefault()
        safeUndo(editorRef.current, undoBaselineRef.current)
        return true
      },

      handleClickOn: (_view, _pos, _node, _nodePos, event, direct) => {
        if (!direct || !event?.target?.closest) return false
        const link = event.target.closest('a[href]')
        if (!link) return false

        const href = String(link.getAttribute('href') || '')
        if (!href) return false

        if (/^file:\/\//i.test(href)) {
          event.preventDefault()
          event.stopPropagation()
          // file:// → 转为本地路径走 openPath
          try {
            const localPath = decodeURIComponent(new URL(href).pathname)
            window.electronAPI?.system?.openPath?.(localPath)
          } catch {
            window.electronAPI?.system?.openPath?.(href.replace(/^file:\/\//, ''))
          }
          return true
        }

        // 应用内附件（attachments/、audio/、images/ 或 app:// 前缀）：走专用 IPC
        const cleaned = href.replace(/^app:\/\//, '')
        if (/^(?:attachments|audio|images)\//i.test(cleaned)) {
          event.preventDefault()
          event.stopPropagation()
          window.electronAPI?.attachments?.open?.(cleaned).then((r) => {
            if (r && r.success === false) {
              try { window.alert(`打开失败：${r.error || '未知原因'}`) } catch {}
            }
          }).catch(() => {})
          return true
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
  }, [noteId])

  // 始终同步最新 editor 到 ref
  useEffect(() => {
    editorRef.current = editor
  }, [editor])

  // 通知外层 editor 实例已就绪/销毁（供工具栏等组件订阅，避免 ref 时序问题）
  useEffect(() => {
    if (!onEditorReady) return
    onEditorReady(editor || null)
    return () => onEditorReady(null)
  }, [editor, onEditorReady])

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
      if (!files.length) return
      const imageFiles = files.filter(f => f.type.startsWith('image/'))
      const otherFiles = files.filter(f => !f.type.startsWith('image/'))
      if (!imageFiles.length && !otherFiles.length) return
      e.preventDefault()
      e.stopPropagation()
      // 计算鼠标落点对应的文档位置（按落点插入，不再插到当前光标）
      let dropPos
      try {
        const view = editor?.view
        const coords = view?.posAtCoords({ left: e.clientX, top: e.clientY })
        if (coords) dropPos = coords.pos
      } catch {
        // posAtCoords 在边界可能抛错，回退到当前光标
      }
      imageFiles.forEach(file => handleImageUploadRef.current?.(file, dropPos))
      otherFiles.forEach(file => handleAttachmentUploadRef.current?.(file, dropPos))
    }

    dom.addEventListener('dragover', onDragOver, { capture: true })
    dom.addEventListener('drop', onDrop, { capture: true })
    return () => {
      dom.removeEventListener('dragover', onDragOver, { capture: true })
      dom.removeEventListener('drop', onDrop, { capture: true })
    }
  }, [editor])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 外部 content 变化时同步（切换笔记、云端同步等）────────────────────────────
  useEffect(() => {
    if (!editor) return
    const incoming = content ?? ''
    const prevNoteId = lastNoteIdRef.current
    const noteChanged = prevNoteId !== (noteId ?? null)

    if (noteChanged) {
      lastNoteIdRef.current = noteId ?? null
      lastExternalContentRef.current = incoming
      undoBaselineRef.current = incoming
      userEditingRef.current = false
      setPendingExternalContent(null)
      setContextMenu(null)
      setBlockSelectMode(false)
      setSelectedBlocks([])
      return
    }

    // 与上次已处理的内容完全一致，跳过（幂等）
    if (incoming === lastExternalContentRef.current) return

    // 如果用户正在编辑且编辑器有焦点，不直接覆盖——挂起等用户确认
    if (userEditingRef.current && editor.isFocused) {
      setPendingExternalContent(incoming)
      return
    }

    // 安全更新
    lastExternalContentRef.current = incoming
    undoBaselineRef.current = incoming
    userEditingRef.current = false
    setPendingExternalContent(null)
    const timer = setTimeout(() => {
      isSyncingRef.current = true
      editor.commands.setContent(preprocessMarkdown(incoming))
      isSyncingRef.current = false
    }, 0)
    return () => clearTimeout(timer)
  }, [editor, noteId, content])

  // 订阅编辑器状态变化（供 BubbleMenu 等基于 selection 的浮层重渲染）
  useEditorState(editor)

  useEffect(() => {
    onBlockSelectModeChange?.(blockSelectMode)
  }, [blockSelectMode, onBlockSelectModeChange])

  useEffect(() => () => onBlockSelectModeChange?.(false), [onBlockSelectModeChange])

  const toggleBlockSelectMode = useCallback(() => {
    setContextMenu(null)
    setSelectedBlocks([])
    setBlockSelectMode((active) => !active)
  }, [])

  const exitBlockSelectMode = useCallback(() => {
    setSelectedBlocks([])
    setBlockSelectMode(false)
  }, [])

  const handleEditorContextMenu = useCallback((e) => {
    if (!editor?.view?.dom || !editor.view.dom.contains(e.target)) return
    if (e.target?.closest?.('[data-editor-context-menu]')) return
    e.preventDefault()
    e.stopPropagation()
    const container = overlayContainerRef.current

    const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
    if (coords) {
      const { from, to } = editor.state.selection
      const clickedOutsideSelection = coords.pos < from || coords.pos > to
      if (editor.state.selection.empty || clickedOutsideSelection) {
        editor.chain().focus().setTextSelection(coords.pos).run()
      } else {
        editor.commands.focus()
      }
    }
    if (!container) return
    const rect = container.getBoundingClientRect()
    const maxHeight = Math.max(180, rect.height - FLOATING_MARGIN * 2)
    const local = placePointMenuInRect(
      e.clientX,
      e.clientY,
      rect,
      CONTEXT_MENU_WIDTH,
      Math.min(360, maxHeight)
    )
    setContextMenu({
      ...local,
      maxHeight,
    })
  }, [editor])

  // ── 对外暴露接口 ─────────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    getEditor: () => editor,
    getMarkdown: () => postprocessMarkdown(editor?.storage?.markdown?.getMarkdown?.() ?? ''),
    focus: () => editor?.commands?.focus?.(),
    toggleBlockSelect: toggleBlockSelectMode,
    exitBlockSelect: exitBlockSelectMode,
    // 供外层（NoteEditor）的 onDrop 调用，与源码模式保持一致
    // pos 可选：外层若计算了鼠标落点可一并传入
    insertImageFiles: (files, pos) => {
      Array.from(files)
        .filter(f => f.type.startsWith('image/'))
        .forEach(file => handleImageUploadRef.current?.(file, pos))
    },
  }))

  if (!editor) return null

  return (
    <Box
      ref={overlayContainerRef}
      sx={{
        flex: 1,
        overflow: 'auto',
        position: 'relative',
        '& .ProseMirror': {
          outline: 'none',
          minHeight: '100%',
          padding: '16px',
          fontFamily: '"OPPOSans R", "OPPOSans", system-ui, -apple-system, sans-serif',
          // 保留多空格（NBSP 之外的普通空格在编辑期间也不被折叠）
          whiteSpace: 'pre-wrap',
          // 防止超长无断词文本把 flex 布局撑破（导致侧栏/按钮不可点击）
          maxWidth: '100%',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',

          // ── 标题 ──────────────────────────────────────────────────────────────
          '& h1': { fontSize: '2rem', fontWeight: 700, lineHeight: 1.3, marginTop: '1.25rem', marginBottom: '0.5rem' },
          '& h2': { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, marginTop: '1rem', marginBottom: '0.4rem' },
          '& h3': { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3, marginTop: '0.8rem', marginBottom: '0.3rem' },
          '& h4': { fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.4 },
          '& h5, & h6': { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },

          // ── 段落/行内 ─────────────────────────────────────────────────────────
          '& p': { lineHeight: 1.7, margin: '0.25rem 0' },
          '& a': {
            color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main),
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
            textDecorationThickness: 'from-font',
            cursor: 'pointer',
            '&:visited': {
              color: (theme) => (theme.palette.mode === 'dark' ? theme.palette.primary.light : theme.palette.primary.main),
            },
            '&:hover': {
              textDecorationThickness: '2px',
            },
            // 默认的选中高亮会让暗色下的链接变得不清晰，这里为链接单独设置更易读的选中样式。
            '&::selection': {
              backgroundColor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgba(96, 165, 250, 0.35)' : 'rgba(25, 118, 210, 0.25)',
              color: (theme) => theme.palette.text.primary,
            },
          },
          '& a[href^="file://"], & a[href^="app://attachments/"], & a[href^="attachments/"]': {
            display: 'inline-flex',
            alignItems: 'center',
            maxWidth: '100%',
            px: 1,
            py: 0.35,
            mx: 0.25,
            my: 0.15,
            borderRadius: '8px',
            color: 'text.primary',
            textDecoration: 'none',
            verticalAlign: 'middle',
            backgroundColor: (theme) =>
              theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.055)',
            boxShadow: (theme) =>
              `inset 0 0 0 1px ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)'}`,
            '&::before': {
              content: '"📎"',
              marginRight: '6px',
              fontSize: '0.9em',
              lineHeight: 1,
            },
            '&:hover': {
              textDecoration: 'none',
              backgroundColor: (theme) =>
                theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.085)',
            },
          },

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

          // ── 引用块（普通 blockquote，callout 由装饰插件覆盖样式）──────────────
          '& blockquote': {
            borderLeft: '3px solid',
            borderColor: 'primary.main',
            paddingLeft: '1rem',
            margin: '0.5rem 0',
            fontStyle: 'italic',
            color: 'text.secondary',
          },
          // callout 装饰覆盖：移除默认 blockquote 的斜体和浅色，header widget 承担类型标识
          '& blockquote.callout-block': {
            fontStyle: 'normal',
            color: 'text.primary',
            borderColor: 'transparent', // 由 decoration style 控制
            paddingLeft: 0,
          },
          '& blockquote.callout-block p:first-of-type': {
            fontWeight: 'inherit',
            marginTop: 0,
            marginBottom: 0,
          },
          '& blockquote.callout-block p': {
            margin: '4px 0',
          },
          '& blockquote.callout-block p:last-of-type': {
            marginBottom: 0,
          },
          '& .callout-header': {
            pointerEvents: 'none',
          },

          // ── 高亮 ──────────────────────────────────────────────────────────────
          '& mark': {
            backgroundColor: '#fef08a',
            padding: '0.1em 0.2em',
            borderRadius: '2px',
          },
          // ── 彩色文本（TextColor mark）──────────────────────────────────────────────────
          '& span[style*="color"]': {
            fontWeight: 500,
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
            // 表格自带选区样式，避免 contenteditable 默认选区与之冲突
            tableLayout: 'fixed',
          },
          '& th, & td': {
            border: '1px solid',
            borderColor: 'divider',
            padding: '6px 12px',
            textAlign: 'left',
            position: 'relative',
            verticalAlign: 'top',
          },
          '& th': { fontWeight: 600, backgroundColor: 'action.hover' },
          // 关键：跨单元格拖选时，ProseMirror 会清掉浏览器原生选区，
          // 改用 CellSelection 给单元格打上 .selectedCell 类。
          // 没有这条 CSS，跨单元格拖选会"看起来什么都没选中"。
          '& td.selectedCell, & th.selectedCell': {
            position: 'relative',
          },
          '& td.selectedCell::after, & th.selectedCell::after': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(80, 140, 255, 0.22)',
            pointerEvents: 'none',
            zIndex: 2,
          },
          // 列宽拖动时给 body 的辅助类（prosemirror-tables 默认）
          '& .column-resize-handle': {
            position: 'absolute',
            right: '-2px',
            top: 0,
            bottom: 0,
            width: '4px',
            backgroundColor: 'primary.main',
            opacity: 0.4,
            pointerEvents: 'none',
          },
          '& .tableWrapper': {
            overflowX: 'auto',
            margin: '0.5rem 0',
          },

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
      <Box onContextMenu={handleEditorContextMenu}>
        <EditorContent editor={editor} />
      </Box>
      <EditorContextMenu
        editor={editor}
        menu={contextMenu}
        containerRef={overlayContainerRef}
        undoBaseline={undoBaselineRef.current}
        blockSelectActive={blockSelectMode}
        onToggleBlockSelect={toggleBlockSelectMode}
        onClose={() => setContextMenu(null)}
      />
      {/* 上下文 Bubble Menus：链接 / 表格 / Callout */}
      <LinkBubbleMenu editor={editor} containerRef={overlayContainerRef} />
      <TableBubbleMenu editor={editor} containerRef={overlayContainerRef} />
      <CalloutBubbleMenu editor={editor} containerRef={overlayContainerRef} />
      <SlashCommandMenu editor={editor} containerRef={overlayContainerRef} />
      <BlockMultiSelectOverlay
        editor={editor}
        containerRef={overlayContainerRef}
        active={blockSelectMode}
        selectedBlocks={selectedBlocks}
        setSelectedBlocks={setSelectedBlocks}
        onExit={exitBlockSelectMode}
      />
      {/* 远端待合并通知：用户正在编辑时收到外部同步内容，挂起等用户决定 */}
      {pendingExternalContent !== null && (
        <Box
          sx={{
            position: 'sticky',
            top: 8,
            mx: 2,
            mb: 1,
            p: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            borderRadius: '10px',
            border: '1px solid',
            borderColor: 'warning.light',
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(245,158,11,0.12)' : 'rgba(254,243,199,0.95)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            zIndex: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}
        >
          <MuiTypography variant="body2" sx={{ flex: 1, fontSize: 13, color: 'text.primary' }}>
            远端有新版本，未合并到当前编辑
          </MuiTypography>
          <IconButton
            size="small"
            onClick={() => {
              // 应用远端版本（覆盖本地编辑）
              const incoming = pendingExternalContent
              setPendingExternalContent(null)
              userEditingRef.current = false
              lastExternalContentRef.current = incoming
              undoBaselineRef.current = incoming
              isSyncingRef.current = true
              editor.commands.setContent(preprocessMarkdown(incoming))
              isSyncingRef.current = false
              // 通知父组件本地内容已变为远端版本
              onChangeRef.current?.(incoming)
            }}
            sx={{
              fontSize: 12, px: 1.2, py: 0.4, borderRadius: '6px',
              color: 'warning.dark', fontWeight: 600,
              '&:hover': { bgcolor: 'rgba(245,158,11,0.18)' },
            }}
          >
            <span style={{ fontSize: 12 }}>应用</span>
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setPendingExternalContent(null)}
            sx={{
              fontSize: 12, px: 1.2, py: 0.4, borderRadius: '6px',
              color: 'text.secondary',
              '&:hover': { bgcolor: 'rgba(0,0,0,0.06)' },
            }}
          >
            <span style={{ fontSize: 12 }}>忽略</span>
          </IconButton>
        </Box>
      )}
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
