import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Box,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Excalidraw, exportToSvg, THEME } from '@excalidraw/excalidraw'
import { useStore } from '../../store/useStore'
import { useStandaloneContext } from '../common/StandaloneProvider'
import { useDebouncedSave } from '../../hooks/useDebouncedSave'
import {
  WHITEBOARD_AI_GENERATE_EVENT,
  buildWhiteboardContent,
  generateWhiteboardElementsByAction,
  parseWhiteboardContent,
  summarizeWhiteboardElementsForAI,
} from '../../utils/whiteboardAI'
import { canvasToPngBlob } from '../common/ImagePreviewModal'
import '@excalidraw/excalidraw/index.css'
import logger from '../../utils/logger'
import { renderMermaidNative } from '../../utils/diagrams/mermaidNative'

const createExcalidrawGlassTokens = ({ isDark, accent }) => {
  const islandBg = isDark
    ? alpha('#1e293b', 0.55)
    : alpha('#ffffff', 0.62)
  const islandBorder = isDark
    ? `1px solid ${alpha('#ffffff', 0.08)}`
    : `1px solid ${alpha('#0f172a', 0.08)}`
  const islandShadow = isDark
    ? `0 8px 24px ${alpha('#000000', 0.18)}, inset 0 1px 0 ${alpha('#ffffff', 0.04)}`
    : `0 8px 22px ${alpha('#0f172a', 0.05)}, inset 0 1px 0 ${alpha('#ffffff', 0.52)}`
  const islandBlur = 'blur(18px) saturate(180%)'

  const buttonBg = isDark
    ? alpha('#ffffff', 0.04)
    : alpha('#ffffff', 0.34)
  const buttonHoverBg = isDark
    ? alpha('#ffffff', 0.08)
    : alpha('#ffffff', 0.56)
  const buttonPressedBg = isDark
    ? alpha('#ffffff', 0.11)
    : alpha('#ffffff', 0.7)
  const buttonBorder = isDark
    ? alpha('#ffffff', 0.08)
    : alpha('#0f172a', 0.08)
  const buttonShadow = isDark
    ? `0 2px 8px ${alpha('#000000', 0.12)}, inset 0 1px 0 ${alpha('#ffffff', 0.03)}`
    : `0 2px 8px ${alpha('#0f172a', 0.04)}, inset 0 1px 0 ${alpha('#ffffff', 0.45)}`
  const buttonPressedShadow = isDark
    ? `0 1px 4px ${alpha('#000000', 0.12)}, inset 0 1px 0 ${alpha('#ffffff', 0.02)}`
    : `0 1px 4px ${alpha('#0f172a', 0.035)}, inset 0 1px 0 ${alpha('#ffffff', 0.4)}`
  const toolbarButtonHoverBg = isDark
    ? alpha('#ffffff', 0.08)
    : alpha('#ffffff', 0.72)
  const toolbarButtonPressedBg = isDark
    ? alpha('#ffffff', 0.12)
    : alpha('#ffffff', 0.84)
  const toolbarButtonBorder = isDark
    ? alpha('#ffffff', 0.06)
    : alpha('#ffffff', 0.72)
  const toolbarButtonShadow = isDark
    ? `0 2px 6px ${alpha('#000000', 0.1)}`
    : `0 2px 8px ${alpha('#0f172a', 0.035)}`
  const bottomButtonBg = isDark
    ? alpha('#ffffff', 0.035)
    : alpha('#ffffff', 0.28)
  const bottomButtonHoverBg = isDark
    ? alpha('#ffffff', 0.06)
    : alpha('#ffffff', 0.44)
  const bottomButtonPressedBg = isDark
    ? alpha('#ffffff', 0.09)
    : alpha('#ffffff', 0.56)
  const bottomButtonBorder = isDark
    ? alpha('#ffffff', 0.06)
    : alpha('#ffffff', 0.5)
  const bottomButtonShadow = isDark
    ? `0 1px 4px ${alpha('#000000', 0.08)}`
    : `0 1px 4px ${alpha('#0f172a', 0.025)}`
  const menuBg = isDark
    ? alpha('#1e293b', 0.64)
    : alpha('#ffffff', 0.74)
  const menuBorder = isDark
    ? `1px solid ${alpha('#ffffff', 0.08)}`
    : `1px solid ${alpha('#ffffff', 0.62)}`
  const menuShadow = isDark
    ? `0 10px 28px ${alpha('#000000', 0.18)}, inset 0 1px 0 ${alpha('#ffffff', 0.04)}`
    : `0 10px 24px ${alpha('#0f172a', 0.06)}, inset 0 1px 0 ${alpha('#ffffff', 0.56)}`
  const menuItemHoverBg = isDark
    ? alpha('#ffffff', 0.07)
    : alpha('#ffffff', 0.72)
  const menuItemDangerBg = isDark
    ? alpha('#ef4444', 0.14)
    : alpha('#ef4444', 0.08)
  const toolIconActiveBg = isDark
    ? alpha(accent, 0.18)
    : alpha(accent, 0.12)
  const toolIconActiveBorder = alpha(accent, isDark ? 0.38 : 0.24)
  const toolIconActiveShadow = isDark
    ? `0 3px 10px ${alpha(accent, 0.14)}, inset 0 1px 0 ${alpha('#ffffff', 0.03)}`
    : `0 3px 10px ${alpha(accent, 0.1)}, inset 0 1px 0 ${alpha('#ffffff', 0.4)}`
  const selectedSurface = alpha(accent, isDark ? 0.28 : 0.14)
  const selectedSurfaceHover = alpha(accent, isDark ? 0.36 : 0.2)

  return {
    islandBg,
    islandBorder,
    islandShadow,
    islandBlur,
    buttonBg,
    buttonHoverBg,
    buttonPressedBg,
    buttonBorder,
    buttonShadow,
    buttonPressedShadow,
    toolbarButtonHoverBg,
    toolbarButtonPressedBg,
    toolbarButtonBorder,
    toolbarButtonShadow,
    bottomButtonBg,
    bottomButtonHoverBg,
    bottomButtonPressedBg,
    bottomButtonBorder,
    bottomButtonShadow,
    menuBg,
    menuBorder,
    menuShadow,
    menuItemHoverBg,
    menuItemDangerBg,
    toolIconActiveBg,
    toolIconActiveBorder,
    toolIconActiveShadow,
    selectedSurface,
    selectedSurfaceHover,
  }
}

const createExcalidrawSurfaceSx = ({ isDark, primaryColor }) => {
  const accent = primaryColor || '#1976d2'

  const {
    islandBg,
    islandBorder,
    islandShadow,
    islandBlur,
    buttonBg,
    buttonHoverBg,
    buttonPressedBg,
    buttonBorder,
    buttonShadow,
    buttonPressedShadow,
    toolbarButtonHoverBg,
    toolbarButtonPressedBg,
    toolbarButtonBorder,
    toolbarButtonShadow,
    bottomButtonBg,
    bottomButtonHoverBg,
    bottomButtonPressedBg,
    bottomButtonBorder,
    bottomButtonShadow,
    menuBg,
    menuBorder,
    menuShadow,
    menuItemHoverBg,
    menuItemDangerBg,
    toolIconActiveBg,
    toolIconActiveBorder,
    toolIconActiveShadow,
    selectedSurface,
    selectedSurfaceHover,
  } = createExcalidrawGlassTokens({ isDark, accent })

  return {
    // CSS 变量层：让 Excalidraw 内部跟随主题色
    '--color-primary': accent,
    '--color-primary-hover': accent,
    '--color-primary-darker': accent,
    '--color-primary-darkest': accent,
    '--color-primary-light': alpha(accent, 0.18),
    '--color-primary-light-darker': alpha(accent, 0.28),
    '--color-selection': accent,
    '--color-brand-hover': accent,
    '--color-brand-active': accent,
    '--color-promo': accent,
    '--color-logo-icon': accent,
    '--color-on-primary-container': accent,
    '--color-surface-primary-container': selectedSurface,
    '--button-selected-bg': selectedSurface,
    '--button-selected-hover-bg': selectedSurfaceHover,
    '--button-selected-border': alpha(accent, isDark ? 0.58 : 0.42),
    '--button-color': accent,
    '--button-active-bg': buttonPressedBg,

    // Island 玻璃面板（顶部工具栏 / 左上菜单 / 右上小岛 / 缩放条 / 画布操作）
    '& .excalidraw .Island': {
      backgroundColor: `${islandBg} !important`,
      backdropFilter: islandBlur,
      WebkitBackdropFilter: islandBlur,
      border: islandBorder,
      boxShadow: `${islandShadow} !important`,
      borderRadius: '14px !important',
    },
    '& .excalidraw .App-menu_top .App-menu_top__left .Island': {
      padding: '6px !important',
    },
    '& .excalidraw .App-menu_top': {
      alignItems: 'center !important',
    },
    '& .excalidraw .App-menu_top > *': {
      alignSelf: 'center',
    },
    '& .excalidraw .App-menu_top > *:first-of-type, & .excalidraw .App-menu_top > *:last-of-type': {
      display: 'flex',
      alignItems: 'center',
      minHeight: '48px',
    },
    '& .excalidraw .layer-ui__wrapper__top-right': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    '& .excalidraw .layer-ui__wrapper__top-right > *': {
      display: 'flex',
      alignItems: 'center',
    },
    '& .excalidraw .layer-ui__wrapper__top-right .default-sidebar-trigger, & .excalidraw .layer-ui__wrapper__top-right .sidebar-trigger': {
      alignSelf: 'center',
      marginTop: '0 !important',
      transform: 'translateY(4px)',
      height: '40px',
      minHeight: '40px',
      paddingTop: '0',
      paddingBottom: '0',
      paddingInline: '14px',
      lineHeight: 1,
    },
    '& .excalidraw .layer-ui__wrapper__top-right .sidebar-trigger__label-element, & .excalidraw .layer-ui__wrapper__top-right .sidebar-trigger__label': {
      display: 'flex',
      alignItems: 'center',
      lineHeight: 1,
    },
    '& .excalidraw .App-toolbar, & .excalidraw .App-toolbar-content': {
      alignItems: 'center',
    },
    '& .excalidraw .layer-ui__wrapper__top-center, & .excalidraw .App-toolbar-container': {
      background: 'transparent !important',
    },
    // 外层 footer.App-toolbar 仅作布局用，不要再画一层玻璃，避免和内层 Island 叠成两层
    '& .excalidraw footer.App-toolbar': {
      background: 'transparent !important',
      backgroundColor: 'transparent !important',
      border: 'none !important',
      boxShadow: 'none !important',
      backdropFilter: 'none !important',
      WebkitBackdropFilter: 'none !important',
    },
    // 真正的工具岛：内层 .Island.App-toolbar
    '& .excalidraw .Island.App-toolbar': {
      position: 'relative',
      isolation: 'isolate',
      background: 'transparent !important',
      backgroundColor: 'transparent !important',
      border: 'none !important',
      boxShadow: 'none !important',
      borderRadius: '16px !important',
      overflow: 'visible',
      // 仅按内容高度撑开，避免被父级 grid/flex 容器拉伸（大屏下尤其明显）
      height: 'fit-content',
      alignSelf: 'center',
      justifySelf: 'center',
    },
    // 工具岛父容器（Stack.Row.App-toolbar-container）也按内容收缩
    '& .excalidraw .App-toolbar-container': {
      height: 'fit-content',
      alignSelf: 'center',
      alignItems: 'center',
    },
    // 工具岛内部按钮一行（Stack.Row）也按内容收缩
    '& .excalidraw .Island.App-toolbar > .Stack_horizontal': {
      alignItems: 'center',
      height: 'fit-content',
    },
    // HintViewer：Excalidraw 在工具栏正下方挂的提示文案，宽窗口下会变得很长很占视野，统一隐藏
    '& .excalidraw .HintViewer': {
      display: 'none !important',
    },
    '& .excalidraw .Island.App-toolbar::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      zIndex: 0,
      background: buttonBg,
      backdropFilter: 'blur(14px) saturate(160%)',
      WebkitBackdropFilter: 'blur(14px) saturate(160%)',
      border: `1px solid ${buttonBorder}`,
      borderRadius: '16px',
      boxShadow: buttonShadow,
      pointerEvents: 'none',
    },
    '& .excalidraw .App-toolbar-content': {
      position: 'relative',
      zIndex: 1,
      gap: '4px',
      background: 'transparent !important',
    },
    '& .excalidraw .App-toolbar-container .ToolIcon': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    '& .excalidraw .App-toolbar-container .ToolIcon__icon': {
      margin: 0,
    },
    '& .excalidraw .App-toolbar .App-toolbar__divider': {
      opacity: 0.45,
      borderColor: alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08),
      marginInline: '4px',
    },

    // 全部按钮统一成清爽毛玻璃体系
    '& .excalidraw .ToolIcon__icon, & .excalidraw .ToolIcon_type_button, & .excalidraw .dropdown-menu-button, & .excalidraw .excalidraw-button, & .excalidraw button.standalone, & .excalidraw .sidebar-trigger, & .excalidraw .buttonList label, & .excalidraw .buttonList button, & .excalidraw .buttonList .zIndexButton, & .excalidraw .RadioGroup__choice, & .excalidraw .scroll-back-to-content, & .excalidraw .help-icon, & .excalidraw .undo-redo-buttons button .ToolIcon__icon': {
      borderRadius: '10px !important',
      background: `${buttonBg} !important`,
      border: `1px solid ${buttonBorder} !important`,
      boxShadow: `${buttonShadow} !important`,
      backdropFilter: 'blur(14px) saturate(160%)',
      WebkitBackdropFilter: 'blur(14px) saturate(160%)',
      transition: 'background-color 160ms ease, box-shadow 160ms ease, color 160ms ease, border-color 160ms ease',
    },

    // 顶部工具栏默认态更轻：无明显底色、无明显边框，只在交互时浮起
    '& .excalidraw .App-toolbar-container .ToolIcon:not(.ToolIcon--selected) .ToolIcon__icon, & .excalidraw .App-toolbar__extra-tools-trigger:not(.App-toolbar__extra-tools-trigger--selected)': {
      background: 'transparent !important',
      borderColor: 'transparent !important',
      boxShadow: 'none !important',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    },

    // hover 统一偏清爽，不做过重高亮
    '& .excalidraw .ToolIcon:not(.ToolIcon--selected) .ToolIcon__icon:hover, & .excalidraw .ToolIcon_type_button:hover, & .excalidraw .dropdown-menu-button:hover, & .excalidraw .excalidraw-button:hover, & .excalidraw button.standalone:hover, & .excalidraw .sidebar-trigger:hover, & .excalidraw .buttonList label:hover, & .excalidraw .buttonList button:hover, & .excalidraw .buttonList .zIndexButton:hover, & .excalidraw .RadioGroup__choice:hover, & .excalidraw .scroll-back-to-content:hover, & .excalidraw .help-icon:hover, & .excalidraw .undo-redo-buttons button .ToolIcon__icon:hover': {
      background: `${buttonHoverBg} !important`,
      borderColor: `${alpha(accent, isDark ? 0.18 : 0.14)} !important`,
      boxShadow: `${buttonShadow} !important`,
      color: `${accent} !important`,
    },
    '& .excalidraw .App-toolbar-container .ToolIcon:not(.ToolIcon--selected) .ToolIcon__icon:hover, & .excalidraw .App-toolbar__extra-tools-trigger:not(.App-toolbar__extra-tools-trigger--selected):hover': {
      background: `${toolbarButtonHoverBg} !important`,
      borderColor: `${toolbarButtonBorder} !important`,
      boxShadow: `${toolbarButtonShadow} !important`,
      backdropFilter: 'blur(10px) saturate(145%)',
      WebkitBackdropFilter: 'blur(10px) saturate(145%)',
    },

    // 按下态统一，底部按钮也共用
    '& .excalidraw .ToolIcon .ToolIcon__icon:active, & .excalidraw .ToolIcon_type_button:active, & .excalidraw .dropdown-menu-button:active, & .excalidraw .excalidraw-button:active, & .excalidraw button.standalone:active, & .excalidraw .sidebar-trigger:active, & .excalidraw .buttonList label:active, & .excalidraw .buttonList button:active, & .excalidraw .buttonList .zIndexButton:active, & .excalidraw .RadioGroup__choice:active, & .excalidraw .scroll-back-to-content:active, & .excalidraw .help-icon:active, & .excalidraw .undo-redo-buttons button .ToolIcon__icon:active': {
      background: `${buttonPressedBg} !important`,
      borderColor: `${alpha(accent, isDark ? 0.22 : 0.16)} !important`,
      boxShadow: `${buttonPressedShadow} !important`,
    },
    '& .excalidraw .App-toolbar-container .ToolIcon:not(.ToolIcon--selected) .ToolIcon__icon:active, & .excalidraw .App-toolbar__extra-tools-trigger:not(.App-toolbar__extra-tools-trigger--selected):active': {
      background: `${toolbarButtonPressedBg} !important`,
      borderColor: `${toolbarButtonBorder} !important`,
      boxShadow: `${toolbarButtonShadow} !important`,
    },

    // selected 统一为轻主题色玻璃，不再用过重渐变
    '& .excalidraw .ToolIcon--selected .ToolIcon__icon, & .excalidraw .ToolIcon_type_button.ToolIcon--selected, & .excalidraw .ToolIcon__icon[aria-pressed="true"], & .excalidraw .ToolIcon .ToolIcon_type_radio:checked + .ToolIcon__icon, & .excalidraw .ToolIcon .ToolIcon_type_checkbox:checked + .ToolIcon__icon': {
      background: `${toolIconActiveBg} !important`,
      color: `${accent} !important`,
      border: `1px solid ${toolIconActiveBorder} !important`,
      boxShadow: `${toolIconActiveShadow} !important`,
      '--icon-fill-color': accent,
      '--keybinding-color': accent,
    },
    '& .excalidraw .ToolIcon--selected .ToolIcon__icon svg, & .excalidraw .ToolIcon_type_button.ToolIcon--selected svg, & .excalidraw .ToolIcon .ToolIcon_type_radio:checked + .ToolIcon__icon svg, & .excalidraw .ToolIcon .ToolIcon_type_checkbox:checked + .ToolIcon__icon svg': {
      color: `${accent} !important`,
    },
    '& .excalidraw button.standalone.active, & .excalidraw .excalidraw-button.active, & .excalidraw .dropdown-menu-button.active, & .excalidraw .sidebar-trigger.active, & .excalidraw .sidebar__header__buttons button.active, & .excalidraw .buttonList label.active, & .excalidraw .buttonList button.active, & .excalidraw .buttonList .zIndexButton.active, & .excalidraw .RadioGroup__choice.active, & .excalidraw .help-icon.active, & .excalidraw .App-toolbar__extra-tools-trigger--selected': {
      backgroundColor: `${selectedSurface} !important`,
      borderColor: `${toolIconActiveBorder} !important`,
      color: `${accent} !important`,
      boxShadow: `${toolIconActiveShadow} !important`,
    },
    '& .excalidraw button.standalone.active:hover, & .excalidraw .excalidraw-button.active:hover, & .excalidraw .dropdown-menu-button.active:hover, & .excalidraw .sidebar-trigger.active:hover, & .excalidraw .sidebar__header__buttons button.active:hover, & .excalidraw .buttonList label.active:hover, & .excalidraw .buttonList button.active:hover, & .excalidraw .buttonList .zIndexButton.active:hover, & .excalidraw .RadioGroup__choice.active:hover, & .excalidraw .help-icon.active:hover, & .excalidraw .App-toolbar__extra-tools-trigger--selected:hover': {
      backgroundColor: `${selectedSurfaceHover} !important`,
    },
    '& .excalidraw button.standalone.active svg, & .excalidraw .excalidraw-button.active svg, & .excalidraw .dropdown-menu-button.active svg, & .excalidraw .sidebar-trigger.active svg, & .excalidraw .sidebar__header__buttons button.active svg, & .excalidraw .buttonList label.active svg, & .excalidraw .buttonList button.active svg, & .excalidraw .buttonList .zIndexButton.active svg, & .excalidraw .RadioGroup__choice.active svg, & .excalidraw .help-icon.active svg, & .excalidraw .App-toolbar__extra-tools-trigger--selected svg': {
      color: `${accent} !important`,
    },

    // 下拉菜单 / Popover 玻璃化
    '& .excalidraw .dropdown-menu .dropdown-menu-container, & .excalidraw .Popover, & .excalidraw .Popover__contextMenu, & .excalidraw .context-menu, & .excalidraw .App-toolbar__extra-tools-dropdown': {
      backgroundColor: `${menuBg} !important`,
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: menuBorder,
      boxShadow: `${menuShadow} !important`,
      borderRadius: '14px !important',
    },
    '& .excalidraw .App-menu_top .dropdown-menu, & .excalidraw .App-menu_top .dropdown-menu .dropdown-menu-container': {
      backgroundColor: `${menuBg} !important`,
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: menuBorder,
      boxShadow: `${menuShadow} !important`,
      borderRadius: '16px !important',
      overflow: 'hidden',
    },
    '& .excalidraw .App-menu_top .dropdown-menu .dropdown-menu-item-custom, & .excalidraw .App-menu_top .dropdown-menu .dropdown-menu-group, & .excalidraw .App-menu_top .dropdown-menu .ActiveFile': {
      backgroundColor: 'transparent !important',
    },
    '& .excalidraw .dropdown-menu .dropdown-menu-container, & .excalidraw .context-menu, & .excalidraw .App-toolbar__extra-tools-dropdown': {
      padding: '6px !important',
    },
    '& .excalidraw .dropdown-menu .dropdown-menu-item, & .excalidraw .context-menu-item': {
      borderRadius: '10px',
      minHeight: '34px',
      paddingInline: '10px',
      transition: 'background-color 140ms ease, color 140ms ease',
    },
    '& .excalidraw .dropdown-menu .dropdown-menu-item:hover, & .excalidraw .dropdown-menu .dropdown-menu-item--hovered, & .excalidraw .context-menu-item:hover, & .excalidraw .context-menu-item:focus': {
      backgroundColor: `${menuItemHoverBg} !important`,
      color: accent,
    },
    '& .excalidraw .dropdown-menu .dropdown-menu-item--selected': {
      backgroundColor: `${selectedSurface} !important`,
      color: `${accent} !important`,
    },
    '& .excalidraw .dropdown-menu .dropdown-menu-group:has(a[href="https://github.com/excalidraw/excalidraw"])': {
      display: 'none !important',
    },
    '& .excalidraw .dropdown-menu .dropdown-menu-container > div[style*="height: 1px"]:has(+ .dropdown-menu-group:has(a[href="https://github.com/excalidraw/excalidraw"]))': {
      display: 'none !important',
    },
    '& .excalidraw .dropdown-menu .dropdown-menu-group:has(a[href="https://github.com/excalidraw/excalidraw"]) + div[style*="height: 1px"]': {
      display: 'none !important',
    },
    '& .excalidraw .context-menu-item.dangerous:hover, & .excalidraw .context-menu-item:hover.dangerous': {
      backgroundColor: `${menuItemDangerBg} !important`,
    },
    '& .excalidraw .context-menu-item-separator, & .excalidraw .dropdown-menu .dropdown-menu-group:not(:first-of-type)': {
      borderColor: alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08),
    },

    // 素材库面板
    '& .excalidraw .layer-ui__library': {
      borderRadius: '18px',
      background: isDark
        ? `linear-gradient(180deg, ${alpha('#1e293b', 0.78)} 0%, ${alpha('#0f172a', 0.72)} 100%)`
        : `linear-gradient(180deg, ${alpha('#ffffff', 0.84)} 0%, ${alpha('#f8fafc', 0.76)} 100%)`,
      border: isDark
        ? `1px solid ${alpha('#ffffff', 0.08)}`
        : `1px solid ${alpha('#ffffff', 0.62)}`,
      boxShadow: isDark
        ? `0 14px 34px ${alpha('#000000', 0.18)}, inset 0 1px 0 ${alpha('#ffffff', 0.04)}`
        : `0 14px 34px ${alpha('#0f172a', 0.07)}, inset 0 1px 0 ${alpha('#ffffff', 0.62)}`,
      backdropFilter: 'blur(22px) saturate(180%)',
      WebkitBackdropFilter: 'blur(22px) saturate(180%)',
      overflow: 'hidden',
    },
    '& .excalidraw .sidebar-tabs-root > .sidebar__header': {
      position: 'relative',
      zIndex: 3,
    },
    '& .excalidraw .sidebar-tabs-root [role=tablist]': {
      position: 'relative',
      zIndex: 3,
      gap: '8px',
    },
    '& .excalidraw .sidebar-tabs-root [role=tabpanel]': {
      position: 'relative',
      zIndex: 1,
      overflow: 'hidden',
      minHeight: 0,
    },
    '& .excalidraw .default-sidebar .sidebar-triggers': {
      padding: 0,
      marginTop: 0,
      marginBottom: 0,
      border: 'none',
      background: 'transparent',
      boxShadow: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      borderRadius: 0,
      gap: '6px',
    },
    '& .excalidraw .default-sidebar .sidebar-triggers .sidebar-tab-trigger': {
      height: '40px',
      width: '40px',
      minWidth: '40px',
      minHeight: '40px',
      borderRadius: '12px',
      color: alpha(accent, 0.96),
      border: `1px solid ${alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08)}`,
      background: isDark ? alpha('#ffffff', 0.04) : alpha('#ffffff', 0.72),
      boxShadow: isDark
        ? `0 2px 8px ${alpha('#000000', 0.08)}`
        : `0 2px 8px ${alpha('#0f172a', 0.035)}`,
      backdropFilter: 'blur(14px) saturate(160%)',
      WebkitBackdropFilter: 'blur(14px) saturate(160%)',
      position: 'relative',
      zIndex: 2,
    },
    '& .excalidraw .default-sidebar .sidebar-triggers .sidebar-tab-trigger:hover': {
      background: isDark ? alpha('#ffffff', 0.08) : alpha('#ffffff', 0.88),
      borderColor: alpha(accent, isDark ? 0.18 : 0.14),
      color: accent,
    },
    '& .excalidraw .default-sidebar .sidebar-triggers .sidebar-tab-trigger[data-state=active]': {
      background: isDark
        ? `linear-gradient(135deg, ${alpha(accent, 0.18)} 0%, ${alpha(accent, 0.12)} 100%)`
        : `linear-gradient(135deg, ${alpha(accent, 0.12)} 0%, ${alpha(accent, 0.08)} 100%)`,
      borderColor: alpha(accent, isDark ? 0.26 : 0.18),
      color: accent,
      boxShadow: isDark
        ? `0 4px 12px ${alpha(accent, 0.12)}`
        : `0 4px 12px ${alpha(accent, 0.08)}`,
    },
    '& .excalidraw .default-sidebar .sidebar-triggers .sidebar-tab-trigger svg': {
      color: 'currentColor',
    },
    '& .excalidraw .sidebar__header__buttons': {
      position: 'relative',
      zIndex: 3,
      gap: '6px',
    },
    '& .excalidraw .sidebar__header__buttons button': {
      background: isDark ? alpha('#ffffff', 0.04) : alpha('#ffffff', 0.72),
      border: `1px solid ${alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08)} !important`,
      color: `${accent} !important`,
      boxShadow: isDark
        ? `0 2px 8px ${alpha('#000000', 0.08)}`
        : `0 2px 8px ${alpha('#0f172a', 0.035)}`,
      backdropFilter: 'blur(14px) saturate(160%)',
      WebkitBackdropFilter: 'blur(14px) saturate(160%)',
    },
    '& .excalidraw .sidebar__header__buttons button:hover': {
      background: isDark ? alpha('#ffffff', 0.08) : alpha('#ffffff', 0.88),
      borderColor: `${alpha(accent, isDark ? 0.18 : 0.14)} !important`,
    },
    '& .excalidraw .sidebar__header__buttons button svg': {
      color: `${accent} !important`,
    },
    '& .excalidraw .layer-ui__library .library-menu-items-container__header': {
      padding: '12px 14px 10px',
      borderBottom: `1px solid ${alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08)}`,
    },
    '& .excalidraw .layer-ui__library .library-menu-dropdown-container--in-heading': {
      top: '12px',
      right: '12px',
    },
    '& .excalidraw .layer-ui__library .library-menu-items-container__items, & .excalidraw .layer-ui__library .library-menu-items-private-library-container': {
      padding: '10px 12px 12px',
    },
    '& .excalidraw .layer-ui__library .library-menu-items-container__grid': {
      gap: '10px',
    },
    '& .excalidraw .layer-ui__library .library-unit': {
      borderRadius: '14px',
      background: isDark
        ? alpha('#ffffff', 0.04)
        : alpha('#ffffff', 0.58),
      border: `1px solid ${alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.06 : 0.08)}`,
      boxShadow: isDark
        ? `0 4px 12px ${alpha('#000000', 0.08)}`
        : `0 4px 12px ${alpha('#0f172a', 0.035)}`,
      transition: 'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease',
    },
    '& .excalidraw .layer-ui__library .library-unit--hover': {
      background: isDark
        ? alpha('#ffffff', 0.06)
        : alpha('#ffffff', 0.72),
      borderColor: alpha(accent, isDark ? 0.18 : 0.14),
      boxShadow: isDark
        ? `0 8px 18px ${alpha('#000000', 0.1)}`
        : `0 8px 18px ${alpha('#0f172a', 0.05)}`,
      transform: 'translateY(-1px)',
    },
    '& .excalidraw .layer-ui__library .library-unit--selected': {
      background: `${selectedSurface} !important`,
      borderColor: `${toolIconActiveBorder} !important`,
      boxShadow: `${toolIconActiveShadow} !important`,
    },
    '& .excalidraw .layer-ui__library .library-unit__checkbox .Checkbox-box': {
      borderRadius: '10px',
      borderColor: alpha(accent, isDark ? 0.16 : 0.14),
      background: isDark ? alpha('#ffffff', 0.04) : alpha('#ffffff', 0.72),
    },
    '& .excalidraw .layer-ui__library .library-unit__checkbox.Checkbox:hover .Checkbox-box': {
      background: isDark ? alpha('#ffffff', 0.08) : alpha('#ffffff', 0.9),
      borderColor: alpha(accent, isDark ? 0.22 : 0.18),
    },
    '& .excalidraw .layer-ui__library .library-unit__checkbox.is-checked .Checkbox-box': {
      background: `${selectedSurface} !important`,
      borderColor: `${toolIconActiveBorder} !important`,
    },
    '& .excalidraw .layer-ui__library .library-unit__checkbox.is-checked .Checkbox-box svg': {
      color: `${accent} !important`,
    },
    '& .excalidraw .layer-ui__library .library-actions-counter': {
      background: accent,
      color: isDark ? '#0f172a' : '#ffffff',
      boxShadow: `0 4px 10px ${alpha(accent, isDark ? 0.2 : 0.18)}`,
    },
    '& .excalidraw .layer-ui__library .library-menu-control-buttons': {
      gap: '8px',
      padding: '10px 12px 12px',
    },
    '& .excalidraw .layer-ui__library .library-menu-control-buttons--at-bottom::before': {
      width: 'calc(100% - 24px)',
      top: 0,
      background: alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08),
    },
    '& .excalidraw .layer-ui__library .library-menu-browse-button': {
      borderRadius: '12px',
      background: isDark
        ? `linear-gradient(135deg, ${alpha(accent, 0.26)} 0%, ${alpha(accent, 0.18)} 100%)`
        : `linear-gradient(135deg, ${alpha(accent, 0.16)} 0%, ${alpha(accent, 0.1)} 100%)`,
      color: `${accent} !important`,
      border: `1px solid ${alpha(accent, isDark ? 0.3 : 0.22)}`,
      boxShadow: `0 6px 14px ${alpha(accent, isDark ? 0.14 : 0.1)}`,
    },
    '& .excalidraw .layer-ui__library .library-menu-browse-button:hover': {
      background: isDark
        ? `linear-gradient(135deg, ${alpha(accent, 0.32)} 0%, ${alpha(accent, 0.22)} 100%)`
        : `linear-gradient(135deg, ${alpha(accent, 0.2)} 0%, ${alpha(accent, 0.14)} 100%)`,
    },
    '& .excalidraw .layer-ui__library .dropdown-menu .dropdown-menu-container': {
      width: '208px',
      padding: '6px',
    },
    '& .excalidraw .layer-ui__library-message, & .excalidraw .library-menu-items__no-items': {
      padding: '28px 20px',
      color: alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.7 : 0.58),
    },
    '& .excalidraw .library-menu-items__no-items__label, & .excalidraw .layer-ui__library-message span': {
      fontSize: '0.82rem',
    },

    // 缩放条 + 撤销/重做 等控件
    '& .excalidraw .App-bottom-bar .Island, & .excalidraw .Stack .Island': {
      background: 'transparent !important',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      border: 'none !important',
      boxShadow: 'none !important',
    },
    '& .excalidraw .scroll-back-to-content': {
      color: 'inherit',
    },
    '& .excalidraw .App-bottom-bar > .Island': {
      padding: '6px !important',
    },
    '& .excalidraw .App-bottom-bar > .Island .panelColumn': {
      gap: '6px',
    },
    '& .excalidraw .zoom-actions, & .excalidraw .undo-redo-buttons': {
      gap: '6px',
      background: 'transparent !important',
      border: 'none !important',
      boxShadow: 'none !important',
      borderRadius: 0,
    },
    '& .excalidraw .scroll-back-to-content, & .excalidraw .undo-redo-buttons button .ToolIcon__icon, & .excalidraw .zoom-actions .ToolIcon__icon': {
      background: `${bottomButtonBg} !important`,
      border: `1px solid ${bottomButtonBorder} !important`,
      boxShadow: `${bottomButtonShadow} !important`,
      backdropFilter: 'blur(12px) saturate(150%)',
      WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    },
    '& .excalidraw .scroll-back-to-content:hover, & .excalidraw .undo-redo-buttons button .ToolIcon__icon:hover, & .excalidraw .zoom-actions .ToolIcon__icon:hover': {
      background: `${bottomButtonHoverBg} !important`,
      borderColor: `${alpha(accent, isDark ? 0.16 : 0.12)} !important`,
      boxShadow: `${bottomButtonShadow} !important`,
    },
    '& .excalidraw .scroll-back-to-content:active, & .excalidraw .undo-redo-buttons button .ToolIcon__icon:active, & .excalidraw .zoom-actions .ToolIcon__icon:active': {
      background: `${bottomButtonPressedBg} !important`,
      borderColor: `${alpha(accent, isDark ? 0.22 : 0.16)} !important`,
      boxShadow: `${bottomButtonShadow} !important`,
    },

    // 主操作按钮（Library / Help / Hamburger 等）
    '& .excalidraw .HelpIcon, & .excalidraw .help-icon': {
      color: 'inherit',
    },

    // 选中元素侧边面板（图层属性）
    '& .excalidraw .sidebar, & .excalidraw .App-menu__left': {
      background: `${menuBg} !important`,
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      borderLeft: menuBorder,
      boxShadow: `${menuShadow} !important`,
      overflow: 'visible',
    },
    '& .excalidraw .sidebar': {
      borderTopLeftRadius: '18px',
      borderBottomLeftRadius: '18px',
    },
    '& .excalidraw .App-menu__left': {
      border: menuBorder,
      borderRadius: '18px',
      display: 'flex',
      flexDirection: 'column',
    },
    '& .excalidraw .sidebar__header::after': {
      background: alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08),
    },
    '& .excalidraw .sidebar .panelColumn, & .excalidraw .App-menu__left .panelColumn': {
      background: `${menuBg} !important`,
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: menuBorder,
      borderRadius: '16px',
      boxShadow: `${menuShadow} !important`,
      padding: '12px',
      overflowY: 'auto',
      minHeight: 0,
      flex: 1,
      scrollbarGutter: 'stable',
    },
    '& .excalidraw .App-menu__left, & .excalidraw .layer-ui__wrapper__top-right, & .excalidraw .sidebar': {
      '& .Island': {
        backgroundColor: `${islandBg} !important`,
        backdropFilter: islandBlur,
        WebkitBackdropFilter: islandBlur,
      },
    },

    // 画布内部所有滚动区域统一跟随应用全局滚动条样式
    '& .excalidraw ::-webkit-scrollbar': {
      width: '6px',
      height: '6px',
    },
    '& .excalidraw ::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '& .excalidraw ::-webkit-scrollbar-thumb': {
      background: 'rgba(150, 150, 150, 0.2)',
      borderRadius: '3px',
      transition: 'background 0.3s ease',
    },
    '& .excalidraw ::-webkit-scrollbar-thumb:hover': {
      background: 'rgba(150, 150, 150, 0.4)',
    },
    '& .excalidraw ::-webkit-scrollbar-thumb:active': {
      background: 'rgba(150, 150, 150, 0.5)',
    },
    '& .excalidraw ::-webkit-scrollbar-button': {
      display: 'none',
    },

    // ── 模态层（Dialog / Modal / HelpDialog / ConfirmDialog / Tooltip / ColorPicker） ──
    // Excalidraw 内置的对话框、提示气泡、颜色选择器等弹层统一玻璃化，
    // 与上方 dropdown-menu / context-menu 复用同一套 token，避免视觉割裂。
    // 注意：所有规则都仅作用于 .excalidraw 内部，避免污染外部 MUI Dialog。
    '& .excalidraw .Modal__background': {
      background: isDark
        ? alpha('#000000', 0.36)
        : alpha('#0f172a', 0.18),
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
    },
    '& .excalidraw .Dialog, & .excalidraw .Modal__content, & .excalidraw .HelpDialog, & .excalidraw .ConfirmDialog': {
      backgroundColor: `${menuBg} !important`,
      backdropFilter: 'blur(22px) saturate(180%)',
      WebkitBackdropFilter: 'blur(22px) saturate(180%)',
      border: menuBorder,
      boxShadow: `${menuShadow} !important`,
      borderRadius: '16px !important',
      color: 'inherit',
    },
    '& .excalidraw .Dialog__title, & .excalidraw .HelpDialog__header': {
      borderBottomColor: alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.08),
    },
    '& .excalidraw .Tooltip, & .excalidraw .Tooltip__label': {
      backgroundColor: `${menuBg} !important`,
      backdropFilter: 'blur(14px) saturate(160%)',
      WebkitBackdropFilter: 'blur(14px) saturate(160%)',
      border: menuBorder,
      boxShadow: `${menuShadow} !important`,
      borderRadius: '10px !important',
      color: 'inherit',
    },
    '& .excalidraw .picker, & .excalidraw .color-picker, & .excalidraw .color-picker__container, & .excalidraw .color-picker-content, & .excalidraw .color-picker-popover': {
      backgroundColor: `${menuBg} !important`,
      backdropFilter: 'blur(20px) saturate(180%)',
      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
      border: menuBorder,
      boxShadow: `${menuShadow} !important`,
      borderRadius: '14px !important',
    },
    '& .excalidraw .picker .color-picker-content--default': {
      background: 'transparent !important',
    },
    '& .excalidraw .picker-content, & .excalidraw .picker-container': {
      background: 'transparent !important',
    },
    '& .excalidraw input, & .excalidraw textarea, & .excalidraw select': {
      background: isDark ? alpha('#ffffff', 0.04) : alpha('#ffffff', 0.72),
      border: `1px solid ${alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.1 : 0.1)}`,
      borderRadius: '10px',
      color: 'inherit',
      transition: 'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
    },
    '& .excalidraw input:focus, & .excalidraw textarea:focus, & .excalidraw select:focus': {
      borderColor: alpha(accent, isDark ? 0.4 : 0.32),
      boxShadow: `0 0 0 3px ${alpha(accent, isDark ? 0.18 : 0.14)}`,
      outline: 'none',
    },

    // ── 交互修复：防止某些场景下 Island::before / 半透明伪元素拦截鼠标事件 ──
    // 配合上方 `pointer-events: none`，确保子按钮能正常点击。
    // 这里统一兜底一遍，避免后续 token 调整时遗漏。
    '& .excalidraw .Island.App-toolbar > *': {
      position: 'relative',
      zIndex: 1,
    },
  }

}

const createImageEditButtonSx = ({ isDark, primaryColor }) => {
  const accent = primaryColor || '#1976d2'

  return {
    minWidth: 0,
    height: 36,
    px: 1.25,
    borderRadius: '12px',
    fontSize: '0.78rem',
    fontWeight: 650,
    lineHeight: 1,
    letterSpacing: '0.01em',
    color: accent,
    background: isDark ? alpha('#ffffff', 0.06) : alpha('#ffffff', 0.72),
    border: `1px solid ${isDark ? alpha('#ffffff', 0.08) : alpha('#ffffff', 0.68)}`,
    boxShadow: isDark
      ? `0 2px 8px ${alpha('#000000', 0.08)}`
      : `0 2px 8px ${alpha('#0f172a', 0.035)}`,
    backdropFilter: 'blur(12px) saturate(160%)',
    WebkitBackdropFilter: 'blur(12px) saturate(160%)',
    '&:hover': {
      background: isDark ? alpha(accent, 0.14) : alpha(accent, 0.1),
      borderColor: alpha(accent, isDark ? 0.24 : 0.18),
      boxShadow: isDark
        ? `0 4px 12px ${alpha('#000000', 0.1)}`
        : `0 4px 12px ${alpha('#0f172a', 0.05)}`,
    },
    '&:active': {
      background: isDark ? alpha(accent, 0.18) : alpha(accent, 0.14),
      boxShadow: isDark
        ? `0 2px 6px ${alpha('#000000', 0.08)}`
        : `0 2px 6px ${alpha('#0f172a', 0.04)}`,
    },
  }
}

// 与 Excalidraw 内置 Dialog 视觉一致的 MUI Dialog 玻璃 token，
// 复用 createExcalidrawGlassTokens 输出的 menu 系列变量，避免双标。
const createMermaidDialogSlotProps = ({ isDark, primaryColor }) => {
  const accent = primaryColor || '#1976d2'
  const { menuBg, menuBorder, menuShadow } = createExcalidrawGlassTokens({ isDark, accent })
  return {
    paper: {
      sx: {
        backgroundColor: menuBg,
        backdropFilter: 'blur(22px) saturate(180%)',
        WebkitBackdropFilter: 'blur(22px) saturate(180%)',
        border: menuBorder,
        boxShadow: menuShadow,
        borderRadius: '16px',
        backgroundImage: 'none',
      },
    },
    backdrop: {
      sx: {
        backgroundColor: isDark ? alpha('#000000', 0.36) : alpha('#0f172a', 0.18),
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      },
    },
  }
}

/**
 * 画布编辑器组件
 * 直接使用 @excalidraw/excalidraw React 组件
 */
const WhiteboardEditor = ({ noteId, isStandaloneMode = false, onGetContent, onExportPNG }) => {
  const getEditableMermaidImage = useCallback((elements = [], appState = {}) => {
    const selectedIds = Object.keys(appState?.selectedElementIds || {})
    if (selectedIds.length !== 1) return null

    const selected = elements.find((element) => element?.id === selectedIds[0] && !element?.isDeleted)
    if (!selected || selected.type !== 'image') return null

    const customData = selected.customData || {}
    if (customData.kind !== 'mermaid-image' || !customData.mermaidSource) return null

    return selected
  }, [])

  const translateElementsTo = useCallback((elements = [], targetX = 0, targetY = 0) => {
    const validElements = elements.filter((element) => element && !element.isDeleted)
    if (!validElements.length) return elements

    const minX = Math.min(...validElements.map((element) => typeof element.x === 'number' ? element.x : 0))
    const minY = Math.min(...validElements.map((element) => typeof element.y === 'number' ? element.y : 0))
    const deltaX = targetX - minX
    const deltaY = targetY - minY

    return elements.map((element) => {
      if (!element) return element
      return {
        ...element,
        x: typeof element.x === 'number' ? element.x + deltaX : element.x,
        y: typeof element.y === 'number' ? element.y + deltaY : element.y,
      }
    })
  }, [])

  // Get context from either main store or standalone context
  let store
  let actualIsStandaloneMode = isStandaloneMode
  try {
    store = useStandaloneContext()
    actualIsStandaloneMode = true
  } catch (error) {
    // Not in standalone mode, use main store
    store = useStore()
    actualIsStandaloneMode = false
  }
  
  const { notes, updateNote, currentView, theme: themePref, primaryColor, whiteboardStyle } = store
  const styleMode = whiteboardStyle === 'sketchy' ? 'sketchy' : 'neat'

  // 解析实际主题（处理 'system'）
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const isDark = themePref === 'dark' || (themePref === 'system' && systemIsDark)

  const [excalidrawAPI, setExcalidrawAPI] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [initialData, setInitialData] = useState(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [excalidrawKey, setExcalidrawKey] = useState(() => `excalidraw-${noteId || 'unknown'}`)
  const [bridgeActive, setBridgeActive] = useState(false)
  const [selectedMermaidImage, setSelectedMermaidImage] = useState(null)
  const [dslEditorOpen, setDslEditorOpen] = useState(false)
  const [dslDraft, setDslDraft] = useState('')
  const [dslError, setDslError] = useState('')
  const [isRegeneratingDsl, setIsRegeneratingDsl] = useState(false)
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [creatorDraft, setCreatorDraft] = useState('')
  const [creatorError, setCreatorError] = useState('')
  const [isCreatingDiagram, setIsCreatingDiagram] = useState(false)
  const hasUnsavedChangesRef = useRef(false)
  // 保存上一个noteId，用于检测noteId变化（初始为null，避免首次加载时触发保存）
  const prevNoteIdRef = useRef(null)
  // 当前正在编辑的画布noteId（防止异步保存写错对象）
  const activeNoteIdRef = useRef(noteId)
  // 标记是否正在切换笔记，用于避免组件卸载时的重复保存
  const isSwitchingNoteRef = useRef(false)
  // 记录最近一次成功保存/加载的场景数据，用于变更检测
  const lastSavedSceneRef = useRef(null)
  // 标记当前是否正由系统应用远端数据，避免 onChange 误判
  const isApplyingRemoteDataRef = useRef(true)
  // 记录最近一次渲染的完整场景，用于在组件重挂载时仍能保存
  const latestSceneRef = useRef({ elements: [], appState: {}, files: {} })
  // 标记是否正在进行类型转换，用于避免卸载时自动保存覆盖转换结果
  const isTypeConvertingRef = useRef(false)

  const serializeScene = useCallback((elements = [], appState = {}, files = {}) => {
    const sanitizedAppState = {
      viewBackgroundColor: appState.viewBackgroundColor,
      currentItemFontFamily: appState.currentItemFontFamily,
      gridSize: appState.gridSize
    }

    const sortedFileKeys = Object.keys(files || {}).sort()
    const sanitizedFiles = {}
    sortedFileKeys.forEach((key) => {
      sanitizedFiles[key] = files[key]
    })

    return JSON.stringify({
      elements,
      appState: sanitizedAppState,
      files: sanitizedFiles
    })
  }, [])

  const openMermaidDslEditor = useCallback(() => {
    if (!selectedMermaidImage) return
    setDslDraft(selectedMermaidImage.customData?.mermaidSource || '')
    setDslError('')
    setDslEditorOpen(true)
  }, [selectedMermaidImage])

  const closeMermaidDslEditor = useCallback(() => {
    if (isRegeneratingDsl) return
    setDslEditorOpen(false)
    setDslError('')
  }, [isRegeneratingDsl])

  // 根据当前画布风格对生成的元素做规整化处理：
  // - 文本元素：fontFamily 改为 Helvetica（2）
  // - 形状/箭头/线条等：roughness=0、strokeStyle=solid、去掉圆角线
  // - 几何量吸附到更整齐的步长，减少 AI 生成后的小抖动
  // 手绘模式下保持原样不动
  const applyWhiteboardStyleToElements = useCallback((elements) => {
    if (styleMode !== 'neat') return elements
    if (!Array.isArray(elements)) return elements
    const snap = (value, step = 8) => (typeof value === 'number' ? Math.round(value / step) * step : value)
    return elements.map((el) => {
      if (!el || typeof el !== 'object') return el
      const next = { ...el }
      if (typeof next.roughness === 'number') {
        next.roughness = 0
      }
      if (next.type === 'arrow' || next.type === 'line') {
        next.roundness = null
        next.strokeStyle = 'solid'
      }
      if (next.type === 'text' && typeof next.fontFamily === 'number') {
        next.fontFamily = 2
      }
      if (typeof next.x === 'number') next.x = snap(next.x)
      if (typeof next.y === 'number') next.y = snap(next.y)
      if (typeof next.width === 'number' && next.type !== 'arrow' && next.type !== 'line') next.width = snap(next.width)
      if (typeof next.height === 'number' && next.type !== 'arrow' && next.type !== 'line') next.height = snap(next.height)
      if (Array.isArray(next.points)) {
        next.points = next.points.map(([x, y]) => [snap(x), snap(y)])
      }
      return next
    })
  }, [styleMode])

  const regenerateMermaidImage = useCallback(async () => {
    if (!selectedMermaidImage || !dslDraft.trim()) {
      setDslError('请输入 Mermaid DSL')
      return
    }

    if (!excalidrawAPI) return

    setIsRegeneratingDsl(true)
    setDslError('')
    isApplyingRemoteDataRef.current = true

    try {
      const rendered = await renderMermaidNative(dslDraft.trim(), { offsetX: 0, offsetY: 0 })
      const styledElements = applyWhiteboardStyleToElements(rendered.elements)
      const translatedElements = translateElementsTo(
        styledElements,
        selectedMermaidImage.x,
        selectedMermaidImage.y,
      )

      const currentElements = excalidrawAPI.getSceneElements()
      const currentAppState = excalidrawAPI.getAppState()
      const currentFiles = excalidrawAPI.getFiles()
      const nextElements = [
        ...currentElements.filter((element) => element.id !== selectedMermaidImage.id),
        ...translatedElements,
      ]
      const nextFiles = { ...(currentFiles || {}) }

      if (selectedMermaidImage.fileId) {
        delete nextFiles[selectedMermaidImage.fileId]
      }
      Object.assign(nextFiles, rendered.files || {})

      const persistedAppState = {
        viewBackgroundColor: currentAppState.viewBackgroundColor,
        currentItemFontFamily: currentAppState.currentItemFontFamily,
        gridSize: currentAppState.gridSize,
      }

      setSelectedMermaidImage(null)
      setDslEditorOpen(false)
      setInitialData({
        elements: nextElements,
        appState: persistedAppState,
        files: nextFiles,
      })
      setExcalidrawKey(`excalidraw-${noteId || 'unknown'}-${Date.now()}`)

      latestSceneRef.current = {
        elements: nextElements,
        appState: persistedAppState,
        files: nextFiles,
      }
      lastSavedSceneRef.current = serializeScene(nextElements, persistedAppState, nextFiles)
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false

      await updateNote(noteId, {
        content: buildWhiteboardContent({
          elements: nextElements,
          appState: persistedAppState,
          fileMap: nextFiles,
        }),
        note_type: 'whiteboard',
      })
    } catch (error) {
      logger.warn('[WhiteboardEditor] Mermaid DSL 重画失败:', error)
      setDslError(error?.message || 'Mermaid 解析失败，请检查 DSL 语法')
      isApplyingRemoteDataRef.current = false
    } finally {
      setIsRegeneratingDsl(false)
    }

    setTimeout(() => {
      isApplyingRemoteDataRef.current = false
    }, 200)
  }, [
    selectedMermaidImage,
    dslDraft,
    excalidrawAPI,
    translateElementsTo,
    noteId,
    serializeScene,
    updateNote,
    applyWhiteboardStyleToElements,
  ])

  const openMermaidCreator = useCallback(() => {
    setCreatorDraft('')
    setCreatorError('')
    setCreatorOpen(true)
  }, [])

  const closeMermaidCreator = useCallback(() => {
    if (isCreatingDiagram) return
    setCreatorOpen(false)
    setCreatorError('')
  }, [isCreatingDiagram])

  const createMermaidDiagram = useCallback(async () => {
    const dsl = creatorDraft.trim()
    if (!dsl) {
      setCreatorError('请输入 Mermaid DSL')
      return
    }
    if (!excalidrawAPI) return

    setIsCreatingDiagram(true)
    setCreatorError('')
    isApplyingRemoteDataRef.current = true

    try {
      const rendered = await renderMermaidNative(dsl, { offsetX: 0, offsetY: 0 })
      const styledRenderedElements = applyWhiteboardStyleToElements(rendered.elements)

      const currentElements = excalidrawAPI.getSceneElements()
      const currentAppState = excalidrawAPI.getAppState()
      const currentFiles = excalidrawAPI.getFiles()

      // 视口中心（场景坐标）= -scroll + viewport/zoom/2
      const zoom = currentAppState?.zoom?.value || 1
      const viewportW = currentAppState?.width || 0
      const viewportH = currentAppState?.height || 0
      const centerX = -(currentAppState?.scrollX || 0) + viewportW / zoom / 2
      const centerY = -(currentAppState?.scrollY || 0) + viewportH / zoom / 2

      const validNew = styledRenderedElements.filter((el) => el && !el.isDeleted)
      let translatedElements = styledRenderedElements
      if (validNew.length) {
        const minX = Math.min(...validNew.map((el) => typeof el.x === 'number' ? el.x : 0))
        const minY = Math.min(...validNew.map((el) => typeof el.y === 'number' ? el.y : 0))
        const maxX = Math.max(
          ...validNew.map((el) => (typeof el.x === 'number' ? el.x : 0) + (typeof el.width === 'number' ? el.width : 0)),
        )
        const maxY = Math.max(
          ...validNew.map((el) => (typeof el.y === 'number' ? el.y : 0) + (typeof el.height === 'number' ? el.height : 0)),
        )
        const width = maxX - minX
        const height = maxY - minY
        translatedElements = translateElementsTo(
          styledRenderedElements,
          centerX - width / 2,
          centerY - height / 2,
        )
      }

      const nextElements = [...currentElements, ...translatedElements]
      const nextFiles = { ...(currentFiles || {}), ...(rendered.files || {}) }

      // Tier3 回退分支会产 image 元素，需要把图片资源注入 Excalidraw 文件系统
      if (excalidrawAPI?.addFiles && rendered.files && Object.keys(rendered.files).length > 0) {
        try {
          const filesPayload = Object.values(rendered.files).filter(Boolean)
          if (filesPayload.length > 0) excalidrawAPI.addFiles(filesPayload)
        } catch (fileErr) {
          logger.warn('[WhiteboardEditor] Mermaid 成图 addFiles 失败:', fileErr)
        }
      }

      const persistedAppState = {
        viewBackgroundColor: currentAppState.viewBackgroundColor,
        currentItemFontFamily: currentAppState.currentItemFontFamily,
        gridSize: currentAppState.gridSize,
      }

      setCreatorOpen(false)
      setCreatorDraft('')
      setInitialData({
        elements: nextElements,
        appState: persistedAppState,
        files: nextFiles,
      })
      setExcalidrawKey(`excalidraw-${noteId || 'unknown'}-${Date.now()}`)

      latestSceneRef.current = {
        elements: nextElements,
        appState: persistedAppState,
        files: nextFiles,
      }
      lastSavedSceneRef.current = serializeScene(nextElements, persistedAppState, nextFiles)
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false

      await updateNote(noteId, {
        content: buildWhiteboardContent({
          elements: nextElements,
          appState: persistedAppState,
          fileMap: nextFiles,
        }),
        note_type: 'whiteboard',
      })
    } catch (error) {
      logger.warn('[WhiteboardEditor] Mermaid 成图失败:', error)
      setCreatorError(error?.message || 'Mermaid 解析失败，请检查 DSL 语法')
      isApplyingRemoteDataRef.current = false
    } finally {
      setIsCreatingDiagram(false)
    }

    setTimeout(() => {
      isApplyingRemoteDataRef.current = false
    }, 200)
  }, [
    creatorDraft,
    excalidrawAPI,
    translateElementsTo,
    noteId,
    serializeScene,
    updateNote,
    applyWhiteboardStyleToElements,
  ])
  
  // 监听类型转换事件
  useEffect(() => {
    const handleTypeConversion = () => {
      logger.log('[WhiteboardEditor] 收到类型转换事件，标记为正在转换')
      isTypeConvertingRef.current = true
      // 同时清除未保存标记，防止卸载时保存
      hasUnsavedChangesRef.current = false
      setHasUnsavedChanges(false)
    }
    
    window.addEventListener('whiteboard-type-converting', handleTypeConversion)
    return () => {
      window.removeEventListener('whiteboard-type-converting', handleTypeConversion)
    }
  }, [])
  
  // 同步 hasUnsavedChanges 到 ref
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])

  // 当用户在设置中切换画布风格时，实时把 appState 的"当前绘图属性"推送到画布
  // 这样无需切换/刷新笔记，新画的元素就会立刻按新风格渲染
  useEffect(() => {
    if (!excalidrawAPI) return
    try {
      excalidrawAPI.updateScene({
        appState: {
          currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
          currentItemRoughness: styleMode === 'neat' ? 0 : 1,
          currentItemStrokeStyle: 'solid',
        },
      })
    } catch (e) {
      logger.warn('[WhiteboardEditor] 推送画布风格失败', e)
    }
  }, [styleMode, excalidrawAPI])

  useEffect(() => {
    if (!selectedMermaidImage) return
    const currentElements = excalidrawAPI?.getSceneElements?.() || []
    const stillExists = currentElements.some((element) => element.id === selectedMermaidImage.id && !element.isDeleted)
    if (!stillExists) {
      setSelectedMermaidImage(null)
      setDslEditorOpen(false)
      setDslError('')
    }
  }, [selectedMermaidImage, excalidrawAPI, excalidrawKey])

  // 只在开发环境输出调试日志
  if (process.env.NODE_ENV === 'development') {
    logger.log('[WhiteboardEditor] 组件渲染', { 
      noteId, 
      noteIdType: typeof noteId,
      hasExcalidrawAPI: !!excalidrawAPI
    })
  }

  // 定义空画布模板数据（跟随暗黑模式与画布风格设置）
  const blankBoardData = useMemo(() => ({
    elements: [],
    appState: {
      viewBackgroundColor: isDark ? '#1e1e1e' : '#ffffff',
      // 规整模式：默认使用 Helvetica（fontFamily=2）+ 直线（roughness=0）+ 实线（strokeStyle=solid）
      // 手绘模式：保留 Excalidraw 默认（Virgil + roughness=1 + solid）
      currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
      currentItemRoughness: styleMode === 'neat' ? 0 : 1,
      currentItemStrokeStyle: 'solid',
    },
    files: {}
  }), [isDark, styleMode])

  // 重置Excalidraw内容的通用函数
  const resetExcalidrawContent = useCallback(async (api, note) => {
    const applyScene = (elements, appState, files) => {
      if (api && api.updateScene && typeof api.updateScene === 'function') {
        api.updateScene({ elements, appState, files })
      } else if (api && api.resetScene && typeof api.resetScene === 'function') {
        api.resetScene({ elements, appState, files })
      } else {
        setInitialData({ elements, appState, files })
      }

      lastSavedSceneRef.current = serializeScene(elements, appState, files)
      latestSceneRef.current = {
        elements,
        appState,
        files
      }
      setHasUnsavedChanges(false)
      hasUnsavedChangesRef.current = false
    }

    isApplyingRemoteDataRef.current = true

    try {
      const useBlankScene = () => {
        applyScene(
          blankBoardData.elements,
          blankBoardData.appState,
          blankBoardData.files
        )
      }

      // 如果笔记类型不是画布，使用空画布
      if (note.note_type !== 'whiteboard') {
        useBlankScene()
        return
      }

      // 笔记类型是画布，但内容为空
      if (!note.content) {
        useBlankScene()
        return
      }

      // 解析画布数据并更新
      const excalidrawData = JSON.parse(note.content)
      setError(null)
      const elements = applyWhiteboardStyleToElements(excalidrawData.elements || [])
      const appState = {
        ...(excalidrawData.appState || { viewBackgroundColor: '#ffffff' }),
        currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
        currentItemRoughness: styleMode === 'neat' ? 0 : 1,
        currentItemStrokeStyle: 'solid',
      }
      
      // 处理图片文件
      let files = {}
      if (excalidrawData.fileMap && Object.keys(excalidrawData.fileMap).length > 0) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 处理图片文件', {
            filesCount: Object.keys(excalidrawData.fileMap).length
          })
        }
        
        // 检查 fileMap 中是否已经包含 dataURL（从 Markdown 转换过来的情况）
        const hasInlineDataURL = Object.values(excalidrawData.fileMap).some(
          f => f.dataURL && f.dataURL.startsWith('data:')
        )
        
        if (hasInlineDataURL) {
          // fileMap 中已经有 dataURL，直接使用
          for (const [fileId, fileData] of Object.entries(excalidrawData.fileMap)) {
            if (fileData.dataURL && fileData.dataURL.startsWith('data:')) {
              files[fileId] = {
                mimeType: fileData.mimeType || 'image/png',
                id: fileId,
                dataURL: fileData.dataURL,
                created: fileData.created || Date.now()
              }
            }
          }
          logger.log('[WhiteboardEditor] 使用内联 dataURL 图片:', Object.keys(files).length)
        } else {
          // 从文件系统加载图片
          const result = await window.electronAPI.whiteboard.loadImages(excalidrawData.fileMap)
          if (result.success) {
            files = result.data
          } else {
            console.error('[WhiteboardEditor] 加载图片失败', result.error)
          }
        }
      }
      
      applyScene(elements, appState, files)
    } catch (error) {
      console.error('[WhiteboardEditor] 更新Excalidraw内容失败', error)
      setError('画布数据格式错误，无法加载')
    } finally {
      isApplyingRemoteDataRef.current = false
    }
  }, [blankBoardData, serializeScene, setHasUnsavedChanges, setInitialData])

  // 加载画布数据（仅在首次挂载时执行，后续切换通过 useEffect 处理）
  useEffect(() => {
    // 只在首次加载时执行（prevNoteIdRef 为 null）
    if (prevNoteIdRef.current !== null) {
      return
    }
    
    const loadWhiteboardData = async () => {
      if (process.env.NODE_ENV === 'development') {
        logger.log('[WhiteboardEditor] 首次加载数据', { noteId })
      }
      isApplyingRemoteDataRef.current = true
      
      if (!noteId) {
        console.error('[WhiteboardEditor] noteId 无效', { noteId })
        setError('笔记 ID 无效')
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
        return
      }

      const note = notes.find(n => n.id === noteId)

      if (!note) {
        setError('笔记不存在')
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
        return
      }

      // 解析画布数据
      try {
        // 如果笔记类型不是画布，使用空画布
        if (note.note_type !== 'whiteboard') {
          setInitialData(blankBoardData)
          lastSavedSceneRef.current = serializeScene(
            blankBoardData.elements,
            blankBoardData.appState,
            blankBoardData.files
          )
          setHasUnsavedChanges(false)
          hasUnsavedChangesRef.current = false
          activeNoteIdRef.current = null
          setIsLoading(false)
          isApplyingRemoteDataRef.current = false
          return
        }

        // 笔记类型是画布，但内容为空
        if (!note.content) {
          setInitialData(blankBoardData)
          lastSavedSceneRef.current = serializeScene(
            blankBoardData.elements,
            blankBoardData.appState,
            blankBoardData.files
          )
          setHasUnsavedChanges(false)
          hasUnsavedChangesRef.current = false
          activeNoteIdRef.current = noteId
          setIsLoading(false)
          isApplyingRemoteDataRef.current = false
          return
        }

        // 解析画布数据
        const excalidrawData = JSON.parse(note.content)
        setError(null)

        // 处理图片文件
        let files = {}
        if (excalidrawData.fileMap && Object.keys(excalidrawData.fileMap).length > 0) {
          if (process.env.NODE_ENV === 'development') {
            logger.log('[WhiteboardEditor] 初始加载 - 处理图片文件', {
              filesCount: Object.keys(excalidrawData.fileMap).length
            })
          }
          
          // 检查 fileMap 中是否已经包含 dataURL（从 Markdown 转换过来的情况）
          const hasInlineDataURL = Object.values(excalidrawData.fileMap).some(
            f => f.dataURL && f.dataURL.startsWith('data:')
          )
          
          if (hasInlineDataURL) {
            // fileMap 中已经有 dataURL，直接使用
            for (const [fileId, fileData] of Object.entries(excalidrawData.fileMap)) {
              if (fileData.dataURL && fileData.dataURL.startsWith('data:')) {
                files[fileId] = {
                  mimeType: fileData.mimeType || 'image/png',
                  id: fileId,
                  dataURL: fileData.dataURL,
                  created: fileData.created || Date.now()
                }
              }
            }
            logger.log('[WhiteboardEditor] 初始加载 - 使用内联 dataURL 图片:', Object.keys(files).length)
          } else {
            // 从文件系统加载图片
            const result = await window.electronAPI.whiteboard.loadImages(excalidrawData.fileMap)
            if (result.success) {
              files = result.data
              if (process.env.NODE_ENV === 'development') {
                logger.log('[WhiteboardEditor] 图片加载成功', {
                  filesCount: Object.keys(files).length
                })
              }
            } else {
              console.error('[WhiteboardEditor] 加载图片失败', result.error)
            }
          }
        }

        const initialScene = {
          elements: applyWhiteboardStyleToElements(excalidrawData.elements || []),
          appState: {
            ...(excalidrawData.appState || { viewBackgroundColor: '#ffffff' }),
            currentItemFontFamily: styleMode === 'neat' ? 2 : 1,
            currentItemRoughness: styleMode === 'neat' ? 0 : 1,
            currentItemStrokeStyle: 'solid',
          },
          files: files
        }

        setInitialData(initialScene)
        lastSavedSceneRef.current = serializeScene(
          initialScene.elements,
          initialScene.appState,
          initialScene.files
        )
        latestSceneRef.current = initialScene
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
        activeNoteIdRef.current = noteId
        
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
      } catch (error) {
        console.error('[WhiteboardEditor] 解析画布数据失败', error)
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
        activeNoteIdRef.current = noteId
        
        const note = notes.find(n => n.id === noteId)
        if (note?.note_type === 'whiteboard') {
          setError('画布数据格式错误，无法加载')
        } else {
          setError(null)
        }
        
        setIsLoading(false)
        isApplyingRemoteDataRef.current = false
      }
    }

    loadWhiteboardData()
    // 首次加载后设置 prevNoteIdRef
    prevNoteIdRef.current = noteId
  }, [noteId, notes, blankBoardData, serializeScene, setHasUnsavedChanges])

  // 当noteId变化时，先保存旧笔记，再加载新笔记
  useEffect(() => {
    // 跳过首次加载（已在上面的 useEffect 处理）
    if (prevNoteIdRef.current === null) {
      return
    }
    
    // 使用 ref 追踪上一个 noteId
    const prevNoteId = prevNoteIdRef.current
    
    if (excalidrawAPI && noteId && prevNoteId !== noteId) {
      if (process.env.NODE_ENV === 'development') {
        logger.log('[WhiteboardEditor] noteId变化，开始切换', { 
          prevNoteId, 
          newNoteId: noteId,
          hasUnsavedChanges: hasUnsavedChangesRef.current
        })
      }
      
      // 标记正在切换笔记
      isSwitchingNoteRef.current = true
      setBridgeActive(true)
      setIsLoading(true)
      setInitialData(null)
      
      // 使用 async IIFE 确保顺序执行
      ;(async () => {
        try {
          // 如果有未保存的更改，先保存旧笔记
          if (hasUnsavedChangesRef.current) {
            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 切换前保存旧笔记', { prevNoteId })
            }
            
            const sceneSnapshot = latestSceneRef.current || {}
            const elements = sceneSnapshot.elements || []
            const appState = sceneSnapshot.appState || { viewBackgroundColor: '#ffffff' }
            const files = sceneSnapshot.files || {}

            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 获取到的数据', {
                elementsCount: elements?.length || 0,
                filesCount: Object.keys(files || {}).length
              })
            }

            // 将图片保存到文件系统
            let fileMap = {}
            if (files && Object.keys(files).length > 0) {
              const result = await window.electronAPI.whiteboard.saveImages(files)
              if (result.success) {
                fileMap = result.data
              }
            }

            const data = {
              type: 'excalidraw',
              version: 2,
              source: 'Flota-local',
              elements,
              appState: {
                viewBackgroundColor: appState.viewBackgroundColor,
                currentItemFontFamily: appState.currentItemFontFamily,
                gridSize: appState.gridSize
              },
              fileMap
            }

            await updateNote(prevNoteId, {
              content: JSON.stringify(data),
              note_type: 'whiteboard'
            })
            
            hasUnsavedChangesRef.current = false
            setHasUnsavedChanges(false)
            
            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 旧笔记保存完成', { 
                prevNoteId,
                savedElementsCount: elements?.length || 0
              })
            }
          }
          
          // 保存完成后（或无需保存时），加载新笔记
          const note = notes.find(n => n.id === noteId)
          if (note) {
            if (note.note_type !== 'whiteboard') {
              activeNoteIdRef.current = null
              hasUnsavedChangesRef.current = false
              setHasUnsavedChanges(false)
              setIsLoading(false)
              setBridgeActive(false)
              return
            }
            if (process.env.NODE_ENV === 'development') {
              logger.log('[WhiteboardEditor] 开始加载新笔记', { noteId })
            }
            await resetExcalidrawContent(null, note)
            activeNoteIdRef.current = noteId
            setExcalidrawKey(`excalidraw-${noteId || 'unknown'}`)
            setIsLoading(false)
            setBridgeActive(false)
          } else {
            activeNoteIdRef.current = noteId
            setExcalidrawKey(`excalidraw-${noteId || 'unknown'}`)
            setIsLoading(false)
            setBridgeActive(false)
          }
        } catch (error) {
          console.error('[WhiteboardEditor] 切换笔记流程出错', error)
        } finally {
          setIsLoading(false)
          setBridgeActive(false)
          // 更新 prevNoteIdRef
          prevNoteIdRef.current = noteId
          
          // 切换完成，重置标志
          isSwitchingNoteRef.current = false
        }
      })()
    }
  }, [noteId, notes, resetExcalidrawContent, updateNote, setHasUnsavedChanges])

  // 保存函数（稳定引用）
  const performSave = useCallback(async () => {
    // 保存当前正在编辑的noteId的快照，避免切换时写错对象
    const currentNoteId = activeNoteIdRef.current
    if (process.env.NODE_ENV === 'development') {
      logger.log('[WhiteboardEditor] performSave调用', {
        currentNoteId,
        componentNoteId: noteId,
        hasExcalidrawAPI: !!excalidrawAPI,
        hasLatestScene: !!latestSceneRef.current
      })
    }

    // 优先使用 latestSceneRef 中的数据（即使组件卸载也能获取）
    // 注意：elements 可能为空数组（用户清空画布），也必须允许保存。
    let elements, appState, files
    
    if (latestSceneRef.current && Array.isArray(latestSceneRef.current.elements)) {
      elements = latestSceneRef.current.elements
      appState = latestSceneRef.current.appState || { viewBackgroundColor: '#ffffff' }
      files = latestSceneRef.current.files || {}
    } else if (excalidrawAPI) {
      elements = excalidrawAPI.getSceneElements()
      appState = excalidrawAPI.getAppState()
      files = excalidrawAPI.getFiles()
    } else {
      return
    }

    if (!currentNoteId) {
      return
    }

    const currentNote = notes?.find(item => String(item.id) === String(currentNoteId))
    if (currentNote?.note_type !== 'whiteboard') {
      return
    }

    try {

      // 将图片保存到文件系统
      let fileMap = {}
      if (files && Object.keys(files).length > 0) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 保存图片到文件系统', {
            filesCount: Object.keys(files).length
          })
        }
        
        const result = await window.electronAPI.whiteboard.saveImages(files)
        if (result.success) {
          fileMap = result.data
        } else {
          throw new Error(result.error || '保存图片失败')
        }
      }

      const persistedAppState = {
        viewBackgroundColor: appState.viewBackgroundColor,
        currentItemFontFamily: appState.currentItemFontFamily,
        gridSize: appState.gridSize
      }

      const data = {
        type: 'excalidraw',
        version: 2,
        source: 'Flota-local',
        elements,
        appState: persistedAppState,
        fileMap // 保存文件映射而非实际图片数据
      }

      await updateNote(currentNoteId, {
        content: JSON.stringify(data),
        note_type: 'whiteboard'
      })
      
      lastSavedSceneRef.current = serializeScene(elements, persistedAppState, files)
      
      // 只有当当前组件的noteId与保存的noteId一致时，才更新状态
      if (noteId === currentNoteId) {
        setHasUnsavedChanges(false)
        hasUnsavedChangesRef.current = false
      }

      // 异步导出 PNG 预览图供移动端查看（不阻塞保存流程）
      // 使用 SVG→Canvas 方式保证清晰度，scale: 2 兼顾质量与文件大小
      try {
        const note = notes?.find(n => n.id === currentNoteId)
        const syncId = note?.sync_id
        if (syncId && window.electronAPI?.whiteboard?.savePreview) {
          exportToSvg({
            elements,
            appState: { ...appState, exportWithDarkMode: false },
            files: files || {},
          }).then(svgElement => {
              const svgString = new XMLSerializer().serializeToString(svgElement)
              const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
              const svgUrl = URL.createObjectURL(svgBlob)
              return new Promise((resolve, reject) => {
                const img = new Image()
                img.onload = async () => {
                  try {
                    const SCALE = 2
                    const canvas = document.createElement('canvas')
                    canvas.width = img.naturalWidth * SCALE
                    canvas.height = img.naturalHeight * SCALE
                    const ctx = canvas.getContext('2d')
                    ctx.scale(SCALE, SCALE)
                    ctx.drawImage(img, 0, 0)
                    URL.revokeObjectURL(svgUrl)
                    const pngBlob = await canvasToPngBlob(canvas)
                    const reader = new FileReader()
                    reader.onloadend = () => resolve(reader.result.split(',')[1])
                    reader.onerror = reject
                    reader.readAsDataURL(pngBlob)
                  } catch (error) {
                    URL.revokeObjectURL(svgUrl)
                    reject(error)
                  }
                }
                img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e) }
                img.src = svgUrl
              })
            })
            .then(base64 => window.electronAPI.whiteboard.savePreview(syncId, base64))
            .catch(err => console.warn('[WhiteboardEditor] 预览图导出失败:', err))
        }
      } catch (_) { /* 预览导出失败不影响主保存 */ }
    } catch (error) {
      console.error('[WhiteboardEditor] 保存失败', error)
      setError('保存失败: ' + error.message)
    }
  }, [excalidrawAPI, noteId, updateNote, serializeScene, notes])

  // 保存开始日志
  const performSaveWithLog = useCallback(async () => {
    if (process.env.NODE_ENV === 'development') {
      logger.log('[WhiteboardEditor] 开始保存', { 
        noteId, 
        hasUnsavedChanges: hasUnsavedChangesRef.current,
        hasExcalidrawAPI: !!excalidrawAPI 
      })
    }
    
    const result = await performSave()
    
    if (process.env.NODE_ENV === 'development') {
      logger.log('[WhiteboardEditor] 保存完成', { 
        noteId, 
        hasUnsavedChanges: hasUnsavedChangesRef.current 
      })
    }
    
    return result
  }, [performSave, noteId, hasUnsavedChangesRef, excalidrawAPI])

  // 使用防抖保存 Hook，画布保存频率较低（10秒）
  const { debouncedSave, saveNow, cancelSave } = useDebouncedSave(performSaveWithLog, 10000)

  // 独立窗口模式：监听窗口关闭事件
  useEffect(() => {
    if (!actualIsStandaloneMode) {
      logger.log('[WhiteboardEditor] 非独立窗口模式，不监听关闭事件')
      return
    }

    logger.log('[WhiteboardEditor] 独立窗口模式，开始监听 standalone-window-save 事件')

    const handleWindowSave = async () => {
      logger.log('[WhiteboardEditor] 收到 standalone-window-save 事件', { 
        noteId, 
        hasUnsavedChanges: hasUnsavedChangesRef.current 
      })
      
      // 无论是否有未保存的更改，都尝试保存（因为可能有延迟的更改）
      try {
        logger.log('[WhiteboardEditor] 开始执行保存...')
        await saveNow()
        logger.log('[WhiteboardEditor] 保存完成')
        // 通知主进程保存完成
        window.dispatchEvent(new CustomEvent('standalone-save-complete'))
      } catch (error) {
        console.error('[WhiteboardEditor] 保存失败:', error)
        // 即使失败也通知，避免主进程一直等待
        window.dispatchEvent(new CustomEvent('standalone-save-complete'))
      }
    }

    // 监听独立窗口保存事件
    window.addEventListener('standalone-window-save', handleWindowSave)
    logger.log('[WhiteboardEditor] 已添加 standalone-window-save 事件监听器')

    return () => {
      logger.log('[WhiteboardEditor] 移除 standalone-window-save 事件监听器')
      window.removeEventListener('standalone-window-save', handleWindowSave)
    }
  }, [actualIsStandaloneMode, noteId, saveNow])

  // 监听视图切换，从笔记视图切换出去时触发保存（仅非独立窗口模式）
  const prevViewRef = useRef(currentView)
  useEffect(() => {
    // 独立窗口模式下不需要监听视图切换（没有视图概念）
    if (actualIsStandaloneMode || !currentView) {
      return
    }
    
    const prevView = prevViewRef.current
    
    // 如果从笔记视图切换到其他视图，且有选中的笔记且有未保存的更改，立即保存
    if (prevView === 'notes' && currentView !== 'notes' && noteId && hasUnsavedChangesRef.current) {
      logger.log('[WhiteboardEditor] 切换视图前保存画布，从', prevView, '切换到', currentView)
      // 先取消防抖保存
      cancelSave()
      // 立即保存
      saveNow().catch(error => {
        console.error('[WhiteboardEditor] 切换视图时保存失败:', error)
      })
    }
    
    // 更新前一个视图
    prevViewRef.current = currentView
  }, [currentView, noteId, saveNow, cancelSave, actualIsStandaloneMode])

  useEffect(() => {
    const handleExternalGenerate = async (event) => {
      const detail = event.detail
      if (!detail || String(detail.noteId) !== String(noteId) || !excalidrawAPI) return

      detail.handled = true
      try {
        const existingElements = excalidrawAPI.getSceneElements().filter(e => !e.isDeleted)
        const appState = excalidrawAPI.getAppState()
        const files = excalidrawAPI.getFiles()
        const note = notes.find(item => String(item.id) === String(noteId))
        const persistedData = parseWhiteboardContent(note?.content)
        const result = await generateWhiteboardElementsByAction({
          action: detail.action,
          prompt: detail.prompt,
          elements: existingElements,
          appState,
          fileMap: persistedData.fileMap || {},
          currentWhiteboardSummary: summarizeWhiteboardElementsForAI(existingElements, persistedData.fileMap || {}),
        })

        const nextFiles = result.action === 'append'
          ? { ...(files || {}), ...(result.fileMap || {}) }
          : { ...(result.fileMap || {}) }
        const nextScene = {
          elements: result.elements,
          appState: result.appState,
          files: nextFiles,
        }
        latestSceneRef.current = nextScene
        hasUnsavedChangesRef.current = true
        setHasUnsavedChanges(true)

        // 与切换笔记一致，走 initialData + 重挂载路径，确保自研生成器产出的元素
        // 也能被 Excalidraw 内核正确归一化、立即渲染（仅 updateScene 在缺 index 等字段时会失败）
        isApplyingRemoteDataRef.current = true
        setInitialData(nextScene)
        setExcalidrawKey(`excalidraw-${noteId || 'unknown'}-${Date.now()}`)

        // 把生成器产出的图片资源注入 Excalidraw 资源系统（block-beta/gantt/pie 等回退会产 image 元素）
        if (excalidrawAPI?.addFiles && result.fileMap && Object.keys(result.fileMap).length > 0) {
          try {
            const filesPayload = Object.values(result.fileMap).filter(Boolean)
            if (filesPayload.length > 0) excalidrawAPI.addFiles(filesPayload)
          } catch (fileErr) {
            logger.warn('[WhiteboardEditor] addFiles 失败:', fileErr)
          }
        }

        let persistedFileMap = {}
        if (nextFiles && Object.keys(nextFiles).length > 0) {
          const saveImagesResult = await window.electronAPI.whiteboard.saveImages(nextFiles)
          if (saveImagesResult.success) {
            persistedFileMap = saveImagesResult.data || {}
          } else {
            throw new Error(saveImagesResult.error || '保存图片失败')
          }
        }

        const persistedAppState = {
          viewBackgroundColor: nextScene.appState?.viewBackgroundColor,
          currentItemFontFamily: nextScene.appState?.currentItemFontFamily,
          gridSize: nextScene.appState?.gridSize,
        }

        const updateResult = await updateNote(noteId, {
          content: buildWhiteboardContent({
            elements: nextScene.elements,
            appState: persistedAppState,
            fileMap: persistedFileMap,
          }),
          note_type: 'whiteboard',
        })
        if (!updateResult?.success) {
          throw new Error(updateResult?.error || '保存画布失败')
        }

        lastSavedSceneRef.current = serializeScene(
          nextScene.elements,
          persistedAppState,
          nextScene.files,
        )
        hasUnsavedChangesRef.current = false
        setHasUnsavedChanges(false)

        // 重挂载完成后再放开 onChange 拦截，避免误判为用户操作触发自动保存
        setTimeout(() => {
          isApplyingRemoteDataRef.current = false
        }, 200)

        detail.resolve?.(result)
      } catch (error) {
        isApplyingRemoteDataRef.current = false
        detail.reject?.(error)
      }
    }

    window.addEventListener(WHITEBOARD_AI_GENERATE_EVENT, handleExternalGenerate)
    return () => window.removeEventListener(WHITEBOARD_AI_GENERATE_EVENT, handleExternalGenerate)
  }, [excalidrawAPI, noteId, notes, setHasUnsavedChanges, updateNote, serializeScene])

  // 获取当前画布内容（用于类型转换）
  const getCurrentContent = useCallback(async () => {
    if (!excalidrawAPI) return null

    const elements = excalidrawAPI.getSceneElements()
    const appState = excalidrawAPI.getAppState()
    const files = excalidrawAPI.getFiles()

    // 保存图片到文件系统
    let fileMap = {}
    if (files && Object.keys(files).length > 0) {
      const result = await window.electronAPI.whiteboard.saveImages(files)
      if (result.success) {
        fileMap = result.data
      }
    }

    const persistedAppState = {
      viewBackgroundColor: appState.viewBackgroundColor,
      currentItemFontFamily: appState.currentItemFontFamily,
      gridSize: appState.gridSize
    }

    const data = {
      type: 'excalidraw',
      version: 2,
      source: 'Flota-local',
      elements,
      appState: persistedAppState,
      fileMap
    }

    return JSON.stringify(data)
  }, [excalidrawAPI])

  // 导出 PNG
  const exportPNG = useCallback(async () => {
    if (!excalidrawAPI) return

    try {
      logger.log('[WhiteboardEditor] 导出 PNG（SVG→Canvas 高清转换）')

      // 第一步：导出 SVG（矢量，无损）
      const svgElement = await exportToSvg({
        elements: excalidrawAPI.getSceneElements(),
        appState: excalidrawAPI.getAppState(),
        files: excalidrawAPI.getFiles(),
      })

      // 第二步：将 SVG 以 3 倍分辨率光栅化为 PNG
      const svgString = new XMLSerializer().serializeToString(svgElement)
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const svgUrl = URL.createObjectURL(svgBlob)

      await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = async () => {
          try {
            const SCALE = 3
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth * SCALE
            canvas.height = img.naturalHeight * SCALE
            const ctx = canvas.getContext('2d')
            ctx.scale(SCALE, SCALE)
            ctx.drawImage(img, 0, 0)
            URL.revokeObjectURL(svgUrl)

            const pngBlob = await canvasToPngBlob(canvas)
            const url = URL.createObjectURL(pngBlob)
            const a = document.createElement('a')
            a.href = url
            a.download = `whiteboard-${noteId}.png`
            a.click()
            URL.revokeObjectURL(url)
            logger.log('[WhiteboardEditor] 导出 PNG 成功')
            resolve()
          } catch (error) {
            URL.revokeObjectURL(svgUrl)
            reject(error)
          }
        }
        img.onerror = (e) => { URL.revokeObjectURL(svgUrl); reject(e) }
        img.src = svgUrl
      })
    } catch (error) {
      console.error('[WhiteboardEditor] 导出 PNG 失败', error)
    }
  }, [excalidrawAPI, noteId])

  // 将获取内容和导出函数暴露给父组件
  useEffect(() => {
    if (onGetContent) {
      onGetContent(getCurrentContent)
    }
  }, [getCurrentContent, onGetContent])

  useEffect(() => {
    if (onExportPNG) {
      onExportPNG(exportPNG)
    }
  }, [exportPNG, onExportPNG])

  // 组件卸载时保存当前画布
  useEffect(() => {
    return () => {
      // 如果正在切换笔记，不要在卸载时保存（已在切换逻辑中处理）
      if (isSwitchingNoteRef.current) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 组件卸载，但正在切换笔记，跳过保存')
        }
        return
      }
      
      // 如果正在进行类型转换，不要保存（会覆盖转换结果）
      if (isTypeConvertingRef.current) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 组件卸载，但正在类型转换，跳过保存')
        }
        return
      }
      
      if (process.env.NODE_ENV === 'development') {
        logger.log('[WhiteboardEditor] 组件卸载，检查是否需要保存', { 
          noteId: prevNoteIdRef.current,
          hasUnsavedChanges: hasUnsavedChangesRef.current 
        })
      }
      
      if (hasUnsavedChangesRef.current) {
        if (process.env.NODE_ENV === 'development') {
          logger.log('[WhiteboardEditor] 组件卸载，自动保存当前内容', { 
            noteId: prevNoteIdRef.current 
          })
        }
        saveNow()
      }
    }
  }, [saveNow])

  const excalidrawSurfaceSx = useMemo(
    () => createExcalidrawSurfaceSx({ isDark, primaryColor }),
    [isDark, primaryColor],
  )
  const imageEditButtonSx = useMemo(
    () => createImageEditButtonSx({ isDark, primaryColor }),
    [isDark, primaryColor],
  )
  const mermaidDialogSlotProps = useMemo(
    () => createMermaidDialogSlotProps({ isDark, primaryColor }),
    [isDark, primaryColor],
  )

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (isLoading || !initialData || bridgeActive) {
    return (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%'
      }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ 
      position: 'relative', 
      width: '100%', 
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Excalidraw 画布 */}
      <Box sx={{ 
        flex: 1, 
        minHeight: 0,
        width: '100%',
        position: 'relative',
        '& .excalidraw': {
          height: '100% !important',
          width: '100% !important'
        },
        ...excalidrawSurfaceSx,
      }}>
        <Excalidraw
          key={excalidrawKey}
          excalidrawAPI={(api) => {
            if (api) {
              logger.log('[WhiteboardEditor] Excalidraw API 已设置')
              setExcalidrawAPI(api)
            }
          }}
          initialData={initialData}
          onChange={(elements, appState, files) => {
            if (isApplyingRemoteDataRef.current) {
              return
            }

            const editableMermaidImage = getEditableMermaidImage(elements, appState)
            setSelectedMermaidImage((prev) => {
              if (!editableMermaidImage && !prev) return prev
              if (!editableMermaidImage) return null
              if (prev?.id === editableMermaidImage.id && prev?.version === editableMermaidImage.version) {
                return prev
              }
              return editableMermaidImage
            })

            const persistedAppState = {
              viewBackgroundColor: appState.viewBackgroundColor,
              currentItemFontFamily: appState.currentItemFontFamily,
              gridSize: appState.gridSize
            }
            latestSceneRef.current = {
              elements,
              appState: persistedAppState,
              files
            }
            const serializedScene = serializeScene(elements, persistedAppState, files)

            if (serializedScene !== lastSavedSceneRef.current) {
              if (!hasUnsavedChangesRef.current) {
                setHasUnsavedChanges(true)
                hasUnsavedChangesRef.current = true
              }
              debouncedSave()
            }
          }}
          theme={isDark ? THEME.DARK : THEME.LIGHT}
          langCode="zh-CN"
          viewModeEnabled={false}
          zenModeEnabled={false}
          gridModeEnabled={false}
          UIOptions={{
            canvasActions: {
              loadScene: false, // 禁用加载场景按钮（我们有自己的笔记管理）
              export: false, // 禁用导出按钮（我们有自己的导出功能）
              saveAsImage: false, // 禁用另存为图片（我们有自己的PNG导出）
            },
          }}
          renderTopRightUI={() => (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                size="small"
                variant="text"
                onClick={openMermaidCreator}
                sx={imageEditButtonSx}
              >
                Mermaid 成图
              </Button>
              {selectedMermaidImage ? (
                <Button
                  size="small"
                  variant="text"
                  onClick={openMermaidDslEditor}
                  sx={imageEditButtonSx}
                >
                  修改
                </Button>
              ) : null}
            </Box>
          )}
        />
      </Box>
      <Dialog
        open={dslEditorOpen}
        onClose={closeMermaidDslEditor}
        maxWidth="md"
        fullWidth
        slotProps={mermaidDialogSlotProps}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 10 }}
      >
        <DialogTitle>编辑 Mermaid DSL</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            当前图片是官方 Mermaid 图片快照。修改 DSL 后会原位重画并替换旧图。
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={14}
            value={dslDraft}
            onChange={(event) => setDslDraft(event.target.value)}
            placeholder="请输入 Mermaid DSL"
            disabled={isRegeneratingDsl}
          />
          {dslError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {dslError}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeMermaidDslEditor} disabled={isRegeneratingDsl} color="inherit">
            取消
          </Button>
          <Button onClick={regenerateMermaidImage} disabled={isRegeneratingDsl} variant="contained">
            {isRegeneratingDsl ? '重画中...' : '重画替换'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={creatorOpen}
        onClose={closeMermaidCreator}
        maxWidth="md"
        fullWidth
        slotProps={mermaidDialogSlotProps}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 10 }}
      >
        <DialogTitle>Mermaid 代码成图</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            输入 Mermaid DSL，将在画布视口中心生成图形。flowchart / sequence / class / state / er 可拆图元编辑，其余类型以图片快照插入。
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={14}
            value={creatorDraft}
            onChange={(event) => setCreatorDraft(event.target.value)}
            placeholder={'示例：\nflowchart LR\n  A[开始] --> B{是否登录}\n  B -- 是 --> C[进入主页]\n  B -- 否 --> D[跳转登录]'}
            disabled={isCreatingDiagram}
          />
          {creatorError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {creatorError}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeMermaidCreator} disabled={isCreatingDiagram} color="inherit">
            取消
          </Button>
          <Button onClick={createMermaidDiagram} disabled={isCreatingDiagram} variant="contained">
            {isCreatingDiagram ? '生成中...' : '生成到画布'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default WhiteboardEditor
