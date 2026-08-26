import React from 'react'
import RocketLaunchRounded from '@mui/icons-material/RocketLaunchRounded'
import ExtensionRounded from '@mui/icons-material/ExtensionRounded'
import ShuffleRounded from '@mui/icons-material/ShuffleRounded'
import { Box } from '@mui/material'
import FlotaAIIcon from '../components/common/FlotaAIIcon'

const DEFAULT_ICON = <ExtensionRounded fontSize="small" />

const BUILTIN_ICON_MAP = {
  rocket: RocketLaunchRounded,
  'rocket-launch': RocketLaunchRounded,
  plugin: ExtensionRounded,
  extension: ExtensionRounded,
  sparkles: FlotaAIIcon,
  ai: FlotaAIIcon,
  'auto-awesome': FlotaAIIcon,
  dice: ShuffleRounded,
  'dice-one': ShuffleRounded,
  'dice-1': ShuffleRounded,
  shuffle: ShuffleRounded
}

/**
 * 根据命令的 icon 元数据生成可渲染的 React 节点
 * @param {Object} command 插件命令定义
 * @param {Object} options 渲染选项
 * @param {"inherit"|"small"|"medium"|"large"} [options.fontSize='small'] MUI 图标尺寸
 * @param {number} [options.size=20] 图片图标的宽高
 * @returns {React.ReactNode}
 */
export const getPluginCommandIcon = (command, options = {}) => {
  const { fontSize = 'small', size = 20 } = options
  const iconMeta = command?.icon

  if (!iconMeta) {
    return React.cloneElement(DEFAULT_ICON, { fontSize })
  }

  if (React.isValidElement(iconMeta)) {
    return React.cloneElement(iconMeta, { fontSize })
  }

  if (typeof iconMeta === 'string') {
    const normalized = iconMeta.trim()

    const IconComponent = BUILTIN_ICON_MAP[normalized.toLowerCase()]
    if (IconComponent) {
      return <IconComponent fontSize={fontSize} />
    }

    if (
      normalized.startsWith('http://') ||
      normalized.startsWith('https://') ||
      normalized.startsWith('/') ||
      normalized.startsWith('.')
    ) {
      return (
        <Box
          component="img"
          src={normalized}
          alt={command?.title || command?.commandId || 'plugin command'}
          sx={{
            width: size,
            height: size,
            objectFit: 'cover',
            borderRadius: '50%'
          }}
        />
      )
    }
  }

  return React.cloneElement(DEFAULT_ICON, { fontSize })
}
