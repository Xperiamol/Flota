import { useEffect, useRef, useState } from 'react'
import { Alert, IconButton, Snackbar, Tooltip } from '@mui/material'
import { FolderOpen } from '../common/AppIcons'
import { createTransitionString, ANIMATIONS } from '../../utils/animationConfig'
import { useStore } from '../../store/useStore'
import { sanitizeMarkdownHtml } from '../../markdown/sanitizeHtml'

const supported = (file) => /\.(md|markdown|txt|html?|excalidraw)$/i.test(file.name)

export default function OpenNoteButton() {
  const inputRef = useRef(null)
  const busyRef = useRef(false)
  const [notice, setNotice] = useState(null)
  const openFiles = async (files) => {
    if (busyRef.current) return
    busyRef.current = true
    let count = 0
    let lastId = null
    const errors = []
    try {
      await window.__saveBeforeClose?.()
      for (const file of files) {
        try {
          if (!supported(file)) throw new Error('不支持此格式')
          if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB')
          let content = (await file.text()).replace(/^\uFEFF/, '')
          const whiteboard = /\.excalidraw$/i.test(file.name)
          if (whiteboard) {
            const data = JSON.parse(content)
            if (!Array.isArray(data.elements)) throw new Error('画布格式无效')
          }
          if (/\.html?$/i.test(file.name)) content = sanitizeMarkdownHtml(content)
          const result = await useStore.getState().createNote({
            title: file.name.replace(/\.[^.]+$/, ''), content,
            note_type: whiteboard ? 'whiteboard' : 'markdown',
            selectAfterCreate: false,
          })
          if (!result?.success) throw new Error(result?.error || '保存失败')
          count++
          lastId = result.data.id
        } catch (error) { errors.push(`${file.name}：${error.message}`) }
      }
      if (count) {
        useStore.getState().setSelectedNoteId(lastId)
        useStore.getState().setCurrentView('notes')
      }
      setNotice({ severity: errors.length ? 'warning' : 'success', message: [`已打开 ${count} 个文件并保存为笔记`, ...errors].join('；') })
    } catch (error) {
      setNotice({ severity: 'error', message: error.message })
    } finally { busyRef.current = false }
  }
  useEffect(() => {
    let activeList = null
    const clearFeedback = () => {
      activeList?.removeAttribute('data-file-drag-over')
      activeList = null
    }
    const drop = (event) => {
      const onList = Boolean(event.target?.closest?.('[data-note-file-drop]'))
      clearFeedback()
      const files = Array.from(event.dataTransfer?.files || [])
      if (!files.length || (!onList && !files.some(supported))) return
      event.preventDefault()
      event.stopPropagation()
      void openFiles(files)
    }
    const over = (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      const list = event.target?.closest?.('[data-note-file-drop]') || null
      if (list !== activeList) {
        clearFeedback()
        activeList = list
        activeList?.setAttribute('data-file-drag-over', 'true')
      }
    }
    const leave = (event) => { if (!event.relatedTarget) clearFeedback() }
    window.addEventListener('drop', drop, true)
    window.addEventListener('dragover', over, true)
    window.addEventListener('dragleave', leave, true)
    window.addEventListener('dragend', clearFeedback, true)
    return () => {
      clearFeedback()
      window.removeEventListener('drop', drop, true)
      window.removeEventListener('dragover', over, true)
      window.removeEventListener('dragleave', leave, true)
      window.removeEventListener('dragend', clearFeedback, true)
    }
  }, [])
  return <>
    <input ref={inputRef} hidden type="file" multiple accept=".md,.markdown,.txt,.html,.htm,.excalidraw" onChange={(event) => {
      void openFiles(Array.from(event.target.files || []))
      event.target.value = ''
    }} />
    <Tooltip title="打开文件（Markdown / TXT / HTML / Excalidraw）">
      <IconButton aria-label="打开文件" size="small" disableRipple onClick={() => inputRef.current?.click()} sx={(theme) => ({
        width: 28, height: 28, p: 0, borderRadius: '7px', color: 'text.secondary', opacity: 0.58,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'transparent',
        transition: createTransitionString(ANIMATIONS.button),
        '&:hover': {
          opacity: 1,
          backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
        },
        '&:active': {
          backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
        },
      })}>
        <FolderOpen sx={{ fontSize: 16, display: 'block' }} />
      </IconButton>
    </Tooltip>
    <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice(null)}>
      <Alert severity={notice?.severity || 'success'} onClose={() => setNotice(null)}>{notice?.message}</Alert>
    </Snackbar>
  </>
}
