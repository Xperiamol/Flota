import { createTheme, alpha } from '@mui/material/styles';
import { EASING, DURATION_MS } from '../utils/animationConfig';

/**
 * Create the application theme based on mode and primary color
 * @param {string} mode - 'light' or 'dark'
 * @param {string} primaryColor - Hex color string
 * @returns {object} MUI Theme object
 */
export const createAppTheme = (mode = 'light', primaryColor = '#1976d2') => {
    // Ensure mode is valid
    const validMode = mode === 'dark' ? 'dark' : 'light';
    const isDark = validMode === 'dark';

    // Modern color palettes
    // Dark: Slate 900 / 800
    // Light: Cool Gray / White
    const backgroundDefault = isDark ? '#0f172a' : '#f0f4f8';
    const backgroundPaper = isDark ? '#1e293b' : '#ffffff';

    // Glassmorphism tokens (subtle / refined)
    // Make frosted effect more delicate: smaller blur and lower white overlay
    const glassBackground = isDark
        ? alpha('#1e293b', 0.45)
        : alpha('#ffffff', 0.85); // Increased opacity for better visibility in light mode
    const glassBorder = isDark
        ? '1px solid rgba(255, 255, 255, 0.06)'
        : '1px solid rgba(0, 0, 0, 0.08)'; // Darker border for light mode
    const glassBlur = 'blur(6px)';

    // Surface tokens — 用于替换全应用的 rgba(255,255,255,0.x) / rgba(0,0,0,0.x) 硬编码
    const surface = {
        // 玻璃态：浅/重两档
        glassLight: isDark ? alpha('#1e293b', 0.58) : alpha('#ffffff', 0.74),
        glassHeavy: isDark ? alpha('#1e293b', 0.82) : alpha('#ffffff', 0.92),
        // 半透明覆盖：用于 hover/active/selected 等
        hover:    isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)',
        active:   isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.06)',
        pressed:  isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)',
        // 细分割线
        subtleBorder:  isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
        strongBorder:  isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.12)',
        // 阴影
        shadowSoft:   isDark ? '0 4px 16px rgba(0,0,0,0.32)' : '0 4px 16px rgba(15,23,42,0.06)',
        shadowMedium: isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(15,23,42,0.10)',
    };

    return createTheme({
        palette: {
            mode: validMode,
            primary: {
                main: primaryColor,
            },
            secondary: {
                main: isDark ? '#a78bfa' : '#7c3aed',
            },
            error: {
                main: isDark ? '#f87171' : '#dc2626',
            },
            warning: {
                main: isDark ? '#fbbf24' : '#d97706',
            },
            info: {
                main: isDark ? '#60a5fa' : '#2563eb',
            },
            success: {
                main: isDark ? '#34d399' : '#059669',
            },
            divider: surface.subtleBorder,
            background: {
                default: backgroundDefault,
                paper: backgroundPaper,
            },
            text: {
                primary: isDark ? '#f1f5f9' : '#1e293b',
                secondary: isDark ? '#94a3b8' : '#64748b',
            },
            action: {
                hover: surface.hover,
                selected: surface.active,
                disabledBackground: surface.hover,
                focus: alpha(primaryColor, 0.16),
            },
        },
        shape: {
            borderRadius: 16,
        },
        transitions: {
            easing: {
                easeInOut: EASING.standard,
                easeOut: EASING.decelerate,
                easeIn: EASING.accelerate,
                sharp: EASING.emphasize,
            },
            duration: {
                shortest: DURATION_MS.fast,
                shorter: DURATION_MS.fast,
                short: DURATION_MS.normal,
                standard: DURATION_MS.normal,
                complex: DURATION_MS.slow,
                enteringScreen: DURATION_MS.slow,
                leavingScreen: DURATION_MS.normal,
            },
        },
        typography: {
            fontFamily: [
                '"OPPOSans"',
                '-apple-system',
                'BlinkMacSystemFont',
                '"Segoe UI"',
                'Roboto',
                '"PingFang SC"',
                '"Microsoft YaHei"',
                '"Noto Sans SC"',
                '"Helvetica Neue"',
                'Arial',
                'sans-serif',
                '"Apple Color Emoji"',
                '"Segoe UI Emoji"',
                '"Segoe UI Symbol"',
            ].join(','),
            h1: { fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 },
            h2: { fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 },
            h3: { fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 },
            h4: { fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3 },
            h5: { fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.4 },
            h6: { fontWeight: 600, letterSpacing: '0em', lineHeight: 1.4 },
            button: { fontWeight: 600, textTransform: 'none', letterSpacing: '0.01em' },
            body1: { letterSpacing: '0.01em', lineHeight: 1.6 },
            body2: { letterSpacing: '0.01em', lineHeight: 1.6 },
        },
        components: {
            MuiCssBaseline: {
                styleOverrides: {
                    body: {
                        backgroundColor: backgroundDefault,
                    },
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root: {
                        backgroundImage: 'none',
                    },
                    elevation1: {
                        boxShadow: isDark
                            ? '0 4px 20px -2px rgba(0, 0, 0, 0.4)' // Softer dark shadow
                            : '0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0,0,0,0.02)', // Ultra soft light shadow
                    },
                    elevation2: {
                        boxShadow: isDark
                            ? '0 10px 30px -4px rgba(0, 0, 0, 0.5)'
                            : '0 10px 30px -4px rgba(0, 0, 0, 0.08)',
                    }
                }
            },
            MuiButton: {
                styleOverrides: {
                    root: {
                        borderRadius: 10,
                        boxShadow: 'none',
                        transition: 'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, color 160ms ease',
                        // 禁止 hover 位移/缩放：有些页面会在 sx 里写 transform，这里统一压掉，避免“按钮飘动”
                        '&:hover': {
                            transform: 'none !important',
                            boxShadow: 'none',
                        },
                        '&:active': {
                            transform: 'none !important',
                            boxShadow: 'none',
                        },
                    },
                    text: {
                        '&:hover': {
                            backgroundColor: alpha(primaryColor, isDark ? 0.12 : 0.08),
                        },
                    },
                    outlined: {
                        borderColor: alpha(primaryColor, isDark ? 0.26 : 0.22),
                        backgroundColor: alpha(primaryColor, isDark ? 0.04 : 0.03),
                        '&:hover': {
                            borderColor: alpha(primaryColor, isDark ? 0.42 : 0.36),
                            backgroundColor: alpha(primaryColor, isDark ? 0.10 : 0.07),
                        },
                    },
                    contained: {
                        boxShadow: `0 1px 2px ${alpha('#000000', isDark ? 0.28 : 0.10)}`,
                        '&:hover': {
                            boxShadow: `0 2px 8px ${alpha('#000000', isDark ? 0.24 : 0.10)}`,
                        },
                    },
                    containedPrimary: {
                        background: `linear-gradient(135deg, ${alpha(primaryColor, 0.95)} 0%, ${alpha(primaryColor, 0.82)} 100%)`,
                        boxShadow: `0 2px 8px ${alpha(primaryColor, isDark ? 0.22 : 0.18)}`,
                        '&:hover': {
                            background: `linear-gradient(135deg, ${primaryColor} 0%, ${alpha(primaryColor, 0.88)} 100%)`,
                            boxShadow: `0 3px 10px ${alpha(primaryColor, isDark ? 0.26 : 0.20)}`,
                        }
                    }
                },
            },
            MuiIconButton: {
                styleOverrides: {
                    // 注意：不要在 root 设置 borderRadius，让 IconButton 维持 MUI 默认的 50%（圆形），
                    // 否则像 CalendarView / TodoList 里完成任务的勾选按钮会变成圆角方形。
                    root: {
                        transition: 'background-color 160ms ease, color 160ms ease, box-shadow 160ms ease',
                        '&:hover': {
                            backgroundColor: alpha(primaryColor, isDark ? 0.12 : 0.08),
                            boxShadow: 'none',
                        },
                        '&:active': {
                            boxShadow: 'none',
                        },
                    },
                },
            },
            MuiFab: {
                styleOverrides: {
                    root: {
                        // 保留现有定位/布局 transform，避免绝对定位组件在 hover 时跳动。
                    },
                },
            },
            MuiSwitch: {
                styleOverrides: {
                    root: {
                        width: 46,
                        height: 28,
                        padding: 0,
                        overflow: 'visible',
                    },
                    switchBase: {
                        padding: 3,
                        transitionDuration: '180ms',
                        '&.Mui-checked': {
                            transform: 'translateX(18px)',
                            color: '#fff',
                            '& + .MuiSwitch-track': {
                                opacity: 1,
                                borderColor: alpha(primaryColor, isDark ? 0.28 : 0.22),
                                background: `linear-gradient(135deg, ${alpha(primaryColor, isDark ? 0.92 : 0.88)} 0%, ${alpha(primaryColor, isDark ? 0.72 : 0.68)} 100%)`,
                                boxShadow: `0 4px 12px ${alpha(primaryColor, isDark ? 0.18 : 0.16)}`,
                            },
                            '& .MuiSwitch-thumb': {
                                backgroundColor: '#ffffff',
                                boxShadow: isDark
                                    ? '0 2px 8px rgba(2, 6, 23, 0.28)'
                                    : '0 2px 8px rgba(15, 23, 42, 0.16)',
                            },
                        },
                        '&.Mui-disabled': {
                            opacity: 0.42,
                            '& + .MuiSwitch-track': {
                                opacity: 0.52,
                            },
                        },
                    },
                    thumb: {
                        width: 22,
                        height: 22,
                        backgroundColor: isDark ? '#f8fafc' : '#ffffff',
                        boxShadow: isDark
                            ? '0 2px 8px rgba(2, 6, 23, 0.22)'
                            : '0 2px 6px rgba(15, 23, 42, 0.12)',
                    },
                    track: {
                        borderRadius: 999,
                        opacity: 1,
                        boxSizing: 'border-box',
                        border: `1px solid ${alpha(isDark ? '#ffffff' : '#0f172a', isDark ? 0.08 : 0.10)}`,
                        background: isDark
                            ? 'linear-gradient(135deg, rgba(148,163,184,0.14), rgba(71,85,105,0.18))'
                            : 'linear-gradient(135deg, rgba(203,213,225,0.58), rgba(226,232,240,0.9))',
                        boxShadow: isDark
                            ? 'inset 0 1px 1px rgba(255,255,255,0.04)'
                            : 'inset 0 1px 1px rgba(255,255,255,0.72)',
                        transition: 'background 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
                    },
                },
            },
            MuiOutlinedInput: {
                styleOverrides: {
                    root: {
                        borderRadius: 12,
                        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                        transition: 'background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                        '&:hover': {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                        },
                        '&.Mui-focused': {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.8)',
                            boxShadow: `0 0 0 2px ${alpha(primaryColor, 0.2)}`,
                        }
                    },
                    notchedOutline: {
                        border: 'none', // Remove default border
                    },
                }
            },
            MuiDialog: {
                styleOverrides: {
                    paper: {
                        borderRadius: 20,
                        backdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        border: glassBorder,
                        boxShadow: isDark
                            ? '0 28px 70px rgba(0,0,0,0.36)'
                            : '0 28px 70px rgba(15,23,42,0.18)',
                    }
                }
            },
            MuiDialogTitle: {
                styleOverrides: {
                    root: {
                        padding: '20px 24px 12px',
                        fontSize: '1.05rem',
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                    }
                }
            },
            MuiDialogContent: {
                styleOverrides: {
                    root: {
                        padding: '12px 24px 20px',
                        fontSize: '0.9rem',
                    },
                    dividers: {
                        borderTopColor: alpha(isDark ? '#ffffff' : '#000000', isDark ? 0.08 : 0.10),
                        borderBottomColor: alpha(isDark ? '#ffffff' : '#000000', isDark ? 0.08 : 0.10),
                    }
                }
            },
            MuiDialogActions: {
                styleOverrides: {
                    root: {
                        padding: '0 24px 20px',
                        gap: 8,
                    }
                }
            },
            MuiMenu: {
                styleOverrides: {
                    paper: {
                        backdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        border: glassBorder,
                        borderRadius: 12,
                        boxShadow: isDark
                            ? '0 14px 42px rgba(0,0,0,0.32)'
                            : '0 14px 42px rgba(15,23,42,0.14)',
                    }
                }
            },
            MuiMenuList: {
                styleOverrides: {
                    root: {
                        paddingTop: 8,
                        paddingBottom: 8,
                    }
                }
            },
            MuiMenuItem: {
                styleOverrides: {
                    root: {
                        // 恢复接近 MUI 默认密度，避免菜单/列表项过窄
                        minHeight: 48,
                        fontSize: '0.875rem',
                        lineHeight: 1.6,
                        borderRadius: 10,
                        marginLeft: 6,
                        marginRight: 6,
                        marginTop: 2,
                        marginBottom: 2,
                    }
                }
            },
            MuiInputLabel: {
                styleOverrides: {
                    root: {
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        letterSpacing: '0.005em',
                    }
                }
            },
            MuiSelect: {
                styleOverrides: {
                    select: {
                        fontSize: '0.9rem',
                        paddingTop: 10,
                        paddingBottom: 10,
                    },
                    icon: {
                        opacity: 0.75,
                    }
                }
            },
            MuiDrawer: {
                styleOverrides: {
                    paper: {
                        backgroundColor: isDark ? '#0f172a' : '#f0f4f8',
                        borderRight: 'none',
                    }
                }
            },
            MuiListItemButton: {
                styleOverrides: {
                    root: {
                        borderRadius: 12,
                        margin: '4px 8px',
                        transition: 'background-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease',
                        '&:hover': {
                            transform: 'none !important',
                        },
                        '&:active': {
                            transform: 'none !important',
                        },
                        '&.Mui-selected': {
                            backgroundColor: alpha(primaryColor, 0.15),
                            '&:hover': {
                                backgroundColor: alpha(primaryColor, 0.25),
                                transform: 'none !important',
                            },
                        },
                    }
                }
            },
            MuiListItemText: {
                defaultProps: {
                    primaryTypographyProps: {
                        variant: 'body2',
                        fontWeight: 600,
                    },
                    secondaryTypographyProps: {
                        variant: 'caption',
                        color: 'text.secondary',
                    },
                },
                styleOverrides: {
                    root: {
                        // 恢复列表项的默认“呼吸感”，避免整体高度被压扁
                        marginTop: 4,
                        marginBottom: 4,
                    },
                    primary: {
                        lineHeight: 1.6,
                    },
                    secondary: {
                        display: 'block',
                        marginTop: 4,
                        lineHeight: 1.6,
                    }
                }
            }
        },
        // Custom theme properties for easy access in components
        custom: {
            glass: {
                background: glassBackground,
                backdropFilter: glassBlur,
                border: glassBorder,
            },
            surface,
            gradients: {
                primary: `linear-gradient(135deg, ${primaryColor} 0%, ${alpha(primaryColor, 0.8)} 100%)`,
            }
        }
    });
};
