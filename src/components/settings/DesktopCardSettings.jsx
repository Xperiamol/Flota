import { useCallback, useEffect, useState } from 'react'
import { Box, Button, List, Paper, Slider, Switch, Typography } from '@mui/material'
import { SettingGroupLabel, SettingRow } from './SettingRow'
import { HOME_BUILTIN_CARDS } from '../../store/useHomeStore'
import { instanceLabel } from '../../utils/widgets/widgetActions'
import { settingsSectionSx } from '../../styles/commonStyles'

const percent = (value) => `${Math.round(value * 100)}%`
const HOME_PREFIX = 'home:'

/** 桌面上那张卡片叫什么：首页内置卡片用卡片名，组件用「组件名 · 实例名」 */
async function cardName(entry) {
  if (entry.cardId) return HOME_BUILTIN_CARDS.find((card) => card.id === entry.cardId)?.name || '首页卡片'
  const result = await window.electronAPI?.widgets?.getInstance?.(entry.instanceId)
  return result?.success ? instanceLabel(result.data.widget.name, result.data.instance.name) : '组件'
}

function SliderAction({ value, min, max, step, onChange, onCommit, label }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: 240 }}>
      <Slider size="small" min={min} max={max} step={step} value={value}
        onChange={(_e, next) => onChange(next)} onChangeCommitted={(_e, next) => onCommit(next)} aria-label={label} />
      <Typography variant="body2" color="text.secondary" sx={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{percent(value)}</Typography>
    </Box>
  )
}

/**
 * 设置 → 桌面卡片：固定在电脑桌面上的卡片（首页卡片和组件）。
 * 启动时是否放回、外观（不透明度、大小、玻璃效果、点击穿透）、当前桌面上有哪些卡片。都只在这台电脑生效。
 */
export default function DesktopCardSettings() {
  const [restore, setRestore] = useState(true)
  const [appearance, setAppearance] = useState(null)
  const [cards, setCards] = useState([])

  const loadCards = useCallback(async () => {
    const result = await window.electronAPI?.widgets?.listDesktop?.()
    if (!result?.success) return
    setCards(await Promise.all(result.data.map(async (entry) => ({ key: entry.key, name: await cardName(entry), top: entry.layer === 'top' }))))
  }, [])

  useEffect(() => {
    const api = window.electronAPI?.widgets
    api?.getDesktopRestore?.().then((res) => res?.success && setRestore(Boolean(res.data)))
    api?.getDesktopAppearance?.().then((res) => res?.success && setAppearance(res.data))
    loadCards()
    const off = api?.onDesktopAppearance?.((next) => next && setAppearance(next))
    // 在桌面上移除、固定卡片后回到设置页时刷新列表
    window.addEventListener('focus', loadCards)
    return () => { off?.(); window.removeEventListener('focus', loadCards) }
  }, [loadCards])

  const saveRestore = async (value) => {
    setRestore(value)
    const res = await window.electronAPI?.widgets?.setDesktopRestore?.(value)
    if (res?.success) setRestore(Boolean(res.data))
  }
  const preview = (changes) => setAppearance((current) => ({ ...current, ...changes }))
  const save = (changes) => {
    preview(changes)
    window.electronAPI?.widgets?.setDesktopAppearance?.(changes)
  }
  const remove = async (key) => {
    await window.electronAPI?.widgets?.unpinFromDesktop?.(key)
    setCards((list) => list.filter((card) => card.key !== key))
  }

  return (
    <Paper elevation={0} sx={settingsSectionSx}>
      <List disablePadding>
        <SettingGroupLabel first>桌面上的卡片</SettingGroupLabel>
        {cards.length === 0 && (
          <SettingRow primary="还没有固定的卡片" secondary="在首页卡片或组件的「…」菜单里选「固定到桌面」" />
        )}
        {cards.map((card) => (
          <SettingRow
            key={card.key}
            primary={card.name}
            secondary={card.key.startsWith(HOME_PREFIX) ? (card.top ? '首页卡片 · 置顶' : '首页卡片') : (card.top ? '组件 · 置顶' : '组件')}
            action={<Button size="small" color="inherit" onClick={() => remove(card.key)}>移除</Button>}
          />
        ))}
        <SettingRow
          primary="启动时放回桌面"
          secondary="打开 Flota 时把卡片放回原来的位置"
          action={<Switch checked={restore} onChange={(e) => saveRestore(e.target.checked)} inputProps={{ 'aria-label': '启动时放回桌面' }} />}
        />

        {appearance && (
          <>
            <SettingGroupLabel>外观</SettingGroupLabel>
            <SettingRow
              primary="不透明度"
              secondary="卡片底色的深浅"
              action={<SliderAction label="不透明度" min={0.15} max={1} step={0.01} value={appearance.opacity}
                onChange={(opacity) => preview({ opacity })} onCommit={(opacity) => save({ opacity })} />}
            />
            <SettingRow
              primary="大小"
              secondary="卡片和文字一起缩放"
              action={<SliderAction label="大小" min={0.7} max={1.25} step={0.05} value={appearance.scale}
                onChange={(scale) => preview({ scale })} onCommit={(scale) => save({ scale })} />}
            />
            <SettingRow
              primary="玻璃效果"
              secondary={appearance.blurSupported ? '支持的 macOS 使用液态玻璃，其他系统使用毛玻璃' : '需要 macOS 或 Windows 11'}
              disabled={!appearance.blurSupported}
              action={<Switch checked={Boolean(appearance.blur)} disabled={!appearance.blurSupported}
                onChange={(e) => save({ blur: e.target.checked })} inputProps={{ 'aria-label': '玻璃效果' }} />}
            />
            <SettingRow
              primary="点击穿透"
              secondary={appearance.blur ? '关闭玻璃效果后可用' : '鼠标点击会穿过卡片，顶部仍可拖动和设置'}
              disabled={Boolean(appearance.blur)}
              action={<Switch checked={Boolean(appearance.clickThrough) && !appearance.blur} disabled={Boolean(appearance.blur)}
                onChange={(e) => save({ clickThrough: e.target.checked })} inputProps={{ 'aria-label': '点击穿透' }} />}
            />
          </>
        )}
      </List>
    </Paper>
  )
}
