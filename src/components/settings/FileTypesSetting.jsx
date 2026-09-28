import { useEffect, useState } from 'react'
import { Switch } from '@mui/material'
import { SettingRow } from './SettingRow'
import { notifyError } from '../../utils/notify'

const DESCRIPTIONS = {
  markdown: '双击或「打开方式」时在独立窗口里预览和编辑，改动写回原文件',
  text: '纯文本和日志，同样在独立窗口里打开',
  html: '只能导入：打开或拖进笔记列表时转换成一篇笔记',
  whiteboard: '在独立窗口里打开 Excalidraw 画布',
}

/** 设置 → 笔记与文件：Flota 接受哪些文件（系统打开方式、打开对话框、拖进笔记列表） */
export default function FileTypesSetting() {
  const [types, setTypes] = useState([])
  const [enabled, setEnabled] = useState([])

  useEffect(() => {
    window.electronAPI?.externalFiles?.getFileTypes?.().then((result) => {
      if (!result?.success) return
      setTypes(result.data.types)
      setEnabled(result.data.enabled)
    })
  }, [])

  const toggle = async (id, on) => {
    const next = on ? [...new Set([...enabled, id])] : enabled.filter((item) => item !== id)
    setEnabled(next)
    const result = await window.electronAPI.externalFiles.setFileTypes(next)
    if (!result?.success) {
      notifyError(result?.error || '保存失败')
      setEnabled(enabled)
      return
    }
    window.dispatchEvent(new Event('flota:file-types-changed'))
  }

  return types.map((type) => (
    <SettingRow
      key={type.id}
      primary={`${type.name}（${type.extensions.map((ext) => `.${ext}`).join(' ')}）`}
      secondary={DESCRIPTIONS[type.id]}
      action={<Switch checked={enabled.includes(type.id)} onChange={(event) => toggle(type.id, event.target.checked)}
        inputProps={{ 'aria-label': `用 Flota 打开${type.name}` }} />}
    />
  ))
}
