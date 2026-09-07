import { alpha } from '@mui/material/styles'

export const createWhiteboardSurfaceTokens = ({ isDark, primaryColor }) => {
  const accent = primaryColor || '#1976d2'
  const text = isDark ? '#f1f5f9' : '#1e293b'
  const muted = isDark ? '#94a3b8' : '#64748b'
  const glassBackground = isDark ? alpha('#172033', 0.92) : alpha('#f8fafc', 0.94)
  const glassBackgroundImage = isDark
    ? `linear-gradient(145deg, ${alpha('#ffffff', 0.075)} 0%, ${alpha('#ffffff', 0.018)} 46%, ${alpha(accent, 0.055)} 100%)`
    : `linear-gradient(145deg, ${alpha('#ffffff', 0.38)} 0%, ${alpha('#ffffff', 0.08)} 48%, ${alpha(accent, 0.028)} 100%)`
  const glassBorder = isDark
    ? '1px solid rgba(255, 255, 255, 0.11)'
    : '1px solid rgba(255, 255, 255, 0.68)'
  const glassShadow = isDark
    ? '0 16px 44px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255,255,255,0.055)'
    : '0 16px 44px rgba(15, 23, 42, 0.13), inset 0 1px 0 rgba(255,255,255,0.74)'
  const hover = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)'
  const pressed = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.10)'
  const selected = alpha(accent, isDark ? 0.22 : 0.12)
  const selectedBorder = alpha(accent, isDark ? 0.52 : 0.34)

  return {
    accent,
    text,
    muted,
    glassBackground,
    glassBackgroundImage,
    glassBorder,
    glassBlur: 'blur(20px) saturate(165%)',
    glassShadow,
    hover,
    pressed,
    selected,
    selectedBorder,
  }
}

// Apply Flota's shared floating-surface vocabulary to Excalidraw's controls.
export const createWhiteboardSurfaceSx = ({ isDark, primaryColor }) => {
  const tokens = createWhiteboardSurfaceTokens({ isDark, primaryColor })
  const {
    accent,
    text,
    muted,
    glassBackground,
    glassBackgroundImage,
    glassBorder,
    glassBlur,
    glassShadow,
    hover,
    pressed,
    selected,
    selectedBorder,
  } = tokens

  return {
    '--color-primary': accent,
    '--color-primary-hover': accent,
    '--color-primary-darker': accent,
    '--color-primary-darkest': accent,
    '--color-selection': accent,
    '--color-on-primary-container': accent,
    '--color-surface-primary-container': selected,
    '--button-selected-bg': selected,
    '--button-selected-hover-bg': alpha(accent, isDark ? 0.28 : 0.17),
    '--button-selected-border': selectedBorder,
    '--button-color': accent,
    '--island-bg-color': glassBackground,
    '--popup-bg-color': glassBackground,
    '--text-primary-color': text,
    '--icon-fill-color': muted,
    '--keybinding-color': muted,

    '& .excalidraw .HintViewer': { display: 'none !important' },
    '& .excalidraw .App-menu_top': {
      position: 'relative !important',
      alignItems: 'center !important',
      gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr) !important',
      gap: '12px !important',
    },
    '& .excalidraw .App-menu_top > *': { alignSelf: 'center' },
    '& .excalidraw .App-menu_top > .App-menu_top__left': {
      gridColumn: '1 !important',
    },
    '& .excalidraw .App-menu_top > .shapes-section': {
      position: 'absolute !important',
      top: '0 !important',
      left: '50% !important',
      transform: 'translateX(-50%) !important',
      zIndex: 3,
    },
    '& .excalidraw .shapes-section > :not(.flota-whiteboard-toolbar)': {
      display: 'none !important',
    },
    '& .excalidraw .layer-ui__wrapper__top-right': {
      gridColumn: '3 !important',
      alignItems: 'center',
      justifyContent: 'flex-end',
      zIndex: 2,
    },

    // The native toolbar remains mounted for Excalidraw internals. Flota's
    // toolbar is portalled into the same stable slot and owns the visible UI.
    '& .excalidraw footer.App-toolbar': {
      background: 'transparent !important',
      border: 'none !important',
      boxShadow: 'none !important',
    },
    '& .excalidraw .Island.App-toolbar': {
      height: 'fit-content',
      padding: '4px !important',
      backgroundColor: `${glassBackground} !important`,
      backgroundImage: `${glassBackgroundImage} !important`,
      backdropFilter: `${glassBlur} !important`,
      WebkitBackdropFilter: `${glassBlur} !important`,
      border: `${glassBorder} !important`,
      borderRadius: '12px !important',
      boxShadow: `${glassShadow} !important`,
      overflow: 'visible',
    },
    '& .excalidraw .Island.App-toolbar::before': { display: 'none !important' },
    '& .excalidraw .App-toolbar-content': {
      gap: '2px',
      background: 'transparent !important',
    },
    '& .excalidraw .App-toolbar-container .ToolIcon__icon': {
      border: '1px solid transparent !important',
      borderRadius: '8px !important',
      background: 'transparent !important',
      boxShadow: 'none !important',
      transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
    },
    '& .excalidraw .App-toolbar-container .ToolIcon__icon:hover': {
      background: `${hover} !important`,
      color: `${text} !important`,
    },
    '& .excalidraw .App-toolbar-container .ToolIcon .ToolIcon_type_radio:checked + .ToolIcon__icon, & .excalidraw .App-toolbar-container .ToolIcon .ToolIcon_type_checkbox:checked + .ToolIcon__icon, & .excalidraw .App-toolbar-container .ToolIcon--selected .ToolIcon__icon': {
      background: `${selected} !important`,
      borderColor: `${selectedBorder} !important`,
      color: `${accent} !important`,
      '--icon-fill-color': accent,
      '--keybinding-color': accent,
    },
    '& .excalidraw .App-toolbar__divider': {
      marginInline: '4px',
      opacity: 1,
      borderColor: `${isDark ? alpha('#ffffff', 0.08) : alpha('#0f172a', 0.08)} !important`,
    },

    // Main menu and library use the same control geometry.
    '& .excalidraw .main-menu-trigger, & .excalidraw .sidebar-trigger': {
      minWidth: '40px',
      height: '40px',
      padding: '0 11px',
      border: `${glassBorder} !important`,
      borderRadius: '10px !important',
      backgroundColor: `${glassBackground} !important`,
      backgroundImage: `${glassBackgroundImage} !important`,
      backdropFilter: `${glassBlur} !important`,
      WebkitBackdropFilter: `${glassBlur} !important`,
      color: `${muted} !important`,
      boxShadow: `${glassShadow} !important`,
      fontSize: '12px',
      fontWeight: 650,
      whiteSpace: 'nowrap',
    },
    '& .excalidraw .main-menu-trigger:hover, & .excalidraw .sidebar-trigger:hover': {
      backgroundColor: `${hover} !important`,
      color: `${text} !important`,
      borderColor: `${alpha(accent, 0.28)} !important`,
    },
    '& .excalidraw .sidebar-trigger.active': {
      background: `${selected} !important`,
      color: `${accent} !important`,
      borderColor: `${selectedBorder} !important`,
    },

    // Bottom action groups, including Flota's fit and restore buttons.
    '& .excalidraw .zoom-actions, & .excalidraw .undo-redo-buttons': {
      display: 'flex',
      alignItems: 'stretch',
      backgroundColor: `${glassBackground} !important`,
      backgroundImage: `${glassBackgroundImage} !important`,
      backdropFilter: `${glassBlur} !important`,
      WebkitBackdropFilter: `${glassBlur} !important`,
      border: `${glassBorder} !important`,
      borderRadius: '10px !important',
      boxShadow: `${glassShadow} !important`,
      overflow: 'hidden',
    },
    '& .excalidraw .zoom-actions .zoom-button, & .excalidraw .undo-redo-buttons button, & .excalidraw .flota-native-control': {
      width: '36px',
      height: '36px',
      minWidth: '36px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      border: '0 !important',
      borderRight: `1px solid ${isDark ? alpha('#ffffff', 0.08) : alpha('#0f172a', 0.08)} !important`,
      borderRadius: '0 !important',
      background: 'transparent !important',
      color: `${muted} !important`,
      cursor: 'pointer',
    },
    '& .excalidraw .zoom-actions > :last-child, & .excalidraw .undo-redo-buttons > :last-child button': {
      borderRight: '0 !important',
    },
    '& .excalidraw .zoom-actions .zoom-button:hover, & .excalidraw .undo-redo-buttons button:hover, & .excalidraw .flota-native-control:hover': {
      background: `${hover} !important`,
      color: `${text} !important`,
    },
    '& .excalidraw .zoom-actions .zoom-button:active, & .excalidraw .undo-redo-buttons button:active, & .excalidraw .flota-native-control:active': {
      background: `${pressed} !important`,
    },
    '& .excalidraw .reset-zoom-button': { width: '56px !important' },
    '& .excalidraw .flota-native-control svg': { width: 18, height: 18 },
    '& .excalidraw .flota-native-control:focus-visible': {
      outline: `2px solid ${accent}`,
      outlineOffset: '-3px',
    },

    // Contextual property card
    '& .excalidraw .App-menu__left': {
      width: '220px',
      padding: '44px 12px 12px !important',
      backgroundColor: `${glassBackground} !important`,
      backgroundImage: `${glassBackgroundImage} !important`,
      backdropFilter: `${glassBlur} !important`,
      WebkitBackdropFilter: `${glassBlur} !important`,
      border: `${glassBorder} !important`,
      borderRadius: '12px',
      boxShadow: `${glassShadow} !important`,
      overflowY: 'auto',
      overscrollBehavior: 'contain',
    },
    '& .excalidraw .App-menu__left .panelColumn': {
      padding: '0 !important',
      background: 'transparent !important',
      border: '0 !important',
      boxShadow: 'none !important',
      overflow: 'visible',
    },
    '& .excalidraw .flota-properties-header': {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 6px 0 12px',
      color: text,
      borderBottom: `1px solid ${isDark ? alpha('#ffffff', 0.08) : alpha('#0f172a', 0.08)}`,
      fontSize: '12px',
      fontWeight: 650,
      letterSpacing: '.02em',
    },
    '& .excalidraw .flota-properties-header button': {
      width: '30px', height: '30px', minWidth: '30px', borderRight: '0 !important', borderRadius: '7px !important',
    },

    // Native popups keep their behavior while sharing Flota's glass menu style.
    '& .excalidraw .dropdown-menu .dropdown-menu-container, & .excalidraw .context-menu, & .excalidraw [data-radix-popper-content-wrapper] .Island, & .excalidraw .Modal__content': {
      backgroundColor: `${glassBackground} !important`,
      backgroundImage: `${glassBackgroundImage} !important`,
      border: `${glassBorder} !important`,
      borderRadius: '12px !important',
      boxShadow: `${glassShadow} !important`,
      backdropFilter: `${glassBlur} !important`,
      WebkitBackdropFilter: `${glassBlur} !important`,
    },
    '& .excalidraw .dropdown-menu-item, & .excalidraw .context-menu-item': {
      minHeight: '36px',
      margin: '2px 6px',
      width: 'calc(100% - 12px)',
      borderRadius: '10px',
    },
    '& .excalidraw .dropdown-menu-item:hover, & .excalidraw .context-menu-item:hover, & .excalidraw .dropdown-menu-item:focus, & .excalidraw .context-menu-item:focus': {
      background: `${hover} !important`,
      color: `${text} !important`,
    },
    '& .excalidraw .dropdown-menu-item:active, & .excalidraw .context-menu-item:active': {
      background: `${pressed} !important`,
    },
    '& .excalidraw .context-menu-item:hover .context-menu-item__label, & .excalidraw .context-menu-item:hover .context-menu-item__shortcut': {
      color: `${text} !important`,
    },
    '& .excalidraw .flota-context-menu-item': {
      color: `${text} !important`,
    },
    '& .excalidraw .flota-context-menu-host': {
      marginBottom: '4px',
      paddingBottom: '4px',
      borderBottom: `1px solid ${isDark ? alpha('#ffffff', 0.08) : alpha('#0f172a', 0.08)}`,
    },
    '& .excalidraw input, & .excalidraw textarea, & .excalidraw select': {
      borderRadius: '8px',
    },
    '@media (max-width: 760px)': {
      '& .excalidraw .App-menu_top': { gap: '6px !important' },
    },
  }
}
