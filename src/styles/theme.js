import React from 'react';
import { createTheme, alpha } from '@mui/material/styles';
import { ArrowDropDown, CheckCircle, Error as ErrorIcon, Info, Warning } from '../components/common/AppIcons';
import { EASING, DURATION_MS } from '../utils/animationConfig';

const checkboxIcon = React.createElement('span', { className: 'FlotaCheckbox-icon' });
const checkboxCheckedIcon = React.createElement('span', { className: 'FlotaCheckbox-icon FlotaCheckbox-iconChecked' });
const checkboxIndeterminateIcon = React.createElement('span', { className: 'FlotaCheckbox-icon FlotaCheckbox-iconIndeterminate' });
const radioIcon = React.createElement('span', { className: 'FlotaRadio-icon' });
const radioCheckedIcon = React.createElement('span', { className: 'FlotaRadio-icon FlotaRadio-iconChecked' });

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

    // 统一浮层材质：Dialog / Menu / Popover / AI 浮层共享同一套玻璃参数。
    // 保持背景可辨识，同时用较高透明度保证正文对比度。
    const glassBackground = isDark
        ? alpha('#172033', 0.92)
        : alpha('#f8fafc', 0.94);
    const glassBorder = isDark
        ? '1px solid rgba(255, 255, 255, 0.11)'
        : '1px solid rgba(255, 255, 255, 0.68)';
    const glassBlur = 'blur(20px) saturate(165%)';
    const glassBackgroundImage = isDark
        ? `linear-gradient(145deg, ${alpha('#ffffff', 0.075)} 0%, ${alpha('#ffffff', 0.018)} 46%, ${alpha(primaryColor, 0.055)} 100%)`
        : `linear-gradient(145deg, ${alpha('#ffffff', 0.38)} 0%, ${alpha('#ffffff', 0.08)} 48%, ${alpha(primaryColor, 0.028)} 100%)`;
    const glassShadow = isDark
        ? '0 16px 44px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255,255,255,0.055)'
        : '0 16px 44px rgba(15, 23, 42, 0.13), inset 0 1px 0 rgba(255,255,255,0.74)';

    // Surface tokens — 用于替换全应用的 rgba(255,255,255,0.x) / rgba(0,0,0,0.x) 硬编码
    const surface = {
        // 玻璃态：浅/重两档
        glassLight: isDark ? alpha('#1e293b', 0.58) : alpha('#ffffff', 0.74),
        glassHeavy: isDark ? alpha('#1e293b', 0.82) : alpha('#ffffff', 0.92),
        // 半透明覆盖：用于 hover/active/selected 等
        hover:    isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)',
        active:   isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.06)',
        pressed:  isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)',
        // 表单与嵌入面板使用同一层低对比材质，避免透明、灰底、白底混用。
        control: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(15,23,42,0.025)',
        controlHover: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(15,23,42,0.04)',
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
            // sx 中的数字圆角会乘以该基数：1 / 1.5 / 2 对应 8 / 12 / 16px。
            borderRadius: 8,
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
                            ? '0 3px 12px rgba(0, 0, 0, 0.26)'
                            : '0 3px 12px rgba(15, 23, 42, 0.055)',
                    },
                    elevation2: {
                        boxShadow: isDark
                            ? '0 8px 24px rgba(0, 0, 0, 0.3)'
                            : '0 8px 24px rgba(15, 23, 42, 0.08)',
                    }
                }
            },
            MuiButtonBase: {
                styleOverrides: {
                    root: {
                        '&.Mui-focusVisible': {
                            outline: `2px solid ${primaryColor}`,
                            outlineOffset: -2,
                        },
                    },
                },
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
                        boxShadow: `0 1px 2px ${alpha('#000000', isDark ? 0.24 : 0.08)}`,
                        '&:hover': {
                            boxShadow: `0 2px 6px ${alpha('#000000', isDark ? 0.22 : 0.08)}`,
                        },
                    },
                    containedPrimary: {
                        backgroundColor: primaryColor,
                        backgroundImage: 'none',
                        boxShadow: `0 1px 3px ${alpha(primaryColor, isDark ? 0.2 : 0.14)}`,
                        '&:hover': {
                            backgroundColor: primaryColor,
                            backgroundImage: 'none',
                            filter: 'brightness(0.94)',
                            boxShadow: `0 2px 6px ${alpha(primaryColor, isDark ? 0.22 : 0.16)}`,
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
                                backgroundColor: alpha(primaryColor, isDark ? 0.92 : 0.88),
                                backgroundImage: 'none',
                                boxShadow: `0 1px 4px ${alpha(primaryColor, isDark ? 0.18 : 0.14)}`,
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
                        backgroundColor: isDark
                            ? 'rgba(100,116,139,0.22)'
                            : 'rgba(203,213,225,0.72)',
                        backgroundImage: 'none',
                        boxShadow: isDark
                            ? 'inset 0 1px 1px rgba(255,255,255,0.04)'
                            : 'inset 0 1px 1px rgba(255,255,255,0.72)',
                        transition: 'background 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
                    },
                },
            },
            MuiCheckbox: {
                defaultProps: {
                    icon: checkboxIcon,
                    checkedIcon: checkboxCheckedIcon,
                    indeterminateIcon: checkboxIndeterminateIcon,
                    disableRipple: true,
                },
                styleOverrides: {
                    root: {
                        padding: 6,
                        borderRadius: 8,
                        transition: 'background-color 150ms ease',
                        '& .FlotaCheckbox-icon': {
                            position: 'relative',
                            display: 'inline-block',
                            width: 18,
                            height: 18,
                            boxSizing: 'border-box',
                            borderRadius: 6,
                            border: `1.5px solid ${alpha(isDark ? '#cbd5e1' : '#475569', isDark ? 0.58 : 0.68)}`,
                            backgroundColor: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.42)',
                            boxShadow: isDark
                                ? 'inset 0 1px 0 rgba(255,255,255,0.035)'
                                : 'inset 0 1px 0 rgba(255,255,255,0.72)',
                            transition: 'background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
                        },
                        '& .FlotaCheckbox-iconChecked, & .FlotaCheckbox-iconIndeterminate': {
                            borderColor: primaryColor,
                            backgroundColor: primaryColor,
                            boxShadow: isDark
                                ? `0 1px 4px ${alpha(primaryColor, 0.38)}, inset 0 1px 0 rgba(255,255,255,0.24)`
                                : `0 1px 4px ${alpha(primaryColor, 0.3)}, inset 0 1px 0 rgba(255,255,255,0.16)`,
                        },
                        '& .FlotaCheckbox-iconChecked::after': {
                            content: '""',
                            position: 'absolute',
                            left: 6,
                            top: 2.5,
                            width: 4.5,
                            height: 8.5,
                            border: 'solid #ffffff',
                            borderWidth: '0 2px 2px 0',
                            transform: 'rotate(45deg)',
                            transformOrigin: 'center',
                        },
                        '& .FlotaCheckbox-iconIndeterminate::after': {
                            content: '""',
                            position: 'absolute',
                            left: 4,
                            top: 7,
                            width: 8,
                            height: 2,
                            borderRadius: 2,
                            backgroundColor: '#ffffff',
                        },
                        '&:hover': {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(15,23,42,0.045)',
                        },
                        '&.Mui-focusVisible .FlotaCheckbox-icon': {
                            boxShadow: `0 0 0 3px ${alpha(primaryColor, 0.22)}`,
                        },
                        '&.Mui-disabled': {
                            opacity: 0.4,
                        },
                        '&:active .FlotaCheckbox-icon': {
                            transform: 'scale(0.92)',
                        },
                    },
                },
            },
            MuiRadio: {
                defaultProps: {
                    icon: radioIcon,
                    checkedIcon: radioCheckedIcon,
                    disableRipple: true,
                },
                styleOverrides: {
                    root: {
                        padding: 6,
                        borderRadius: '50%',
                        transition: 'background-color 150ms ease',
                        '& .FlotaRadio-icon': {
                            position: 'relative',
                            display: 'inline-block',
                            width: 18,
                            height: 18,
                            boxSizing: 'border-box',
                            borderRadius: '50%',
                            border: `1.5px solid ${alpha(isDark ? '#cbd5e1' : '#475569', isDark ? 0.58 : 0.68)}`,
                            backgroundColor: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.42)',
                            transition: 'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
                        },
                        '& .FlotaRadio-iconChecked': {
                            borderColor: primaryColor,
                            boxShadow: isDark
                                ? `0 1px 4px ${alpha(primaryColor, 0.34)}`
                                : `0 1px 4px ${alpha(primaryColor, 0.26)}`,
                        },
                        '& .FlotaRadio-iconChecked::after': {
                            content: '""',
                            position: 'absolute',
                            inset: 4,
                            borderRadius: '50%',
                            backgroundColor: primaryColor,
                        },
                        '&:hover': {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(15,23,42,0.045)',
                        },
                        '&.Mui-focusVisible .FlotaRadio-icon': {
                            boxShadow: `0 0 0 3px ${alpha(primaryColor, 0.22)}`,
                        },
                        '&.Mui-disabled': {
                            opacity: 0.4,
                        },
                        '&:active .FlotaRadio-icon': {
                            transform: 'scale(0.92)',
                        },
                    },
                },
            },
            MuiOutlinedInput: {
                styleOverrides: {
                    root: {
                        borderRadius: 12,
                        backgroundColor: surface.control,
                        transition: 'background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                        '&:hover': {
                            backgroundColor: surface.controlHover,
                        },
                        '&.Mui-focused': {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.8)',
                            boxShadow: `0 0 0 2px ${alpha(primaryColor, 0.2)}`,
                        }
                    },
                    notchedOutline: {
                        border: `1px solid ${surface.subtleBorder}`,
                    },
                }
            },
            MuiDialog: {
                styleOverrides: {
                    paper: {
                        backdropFilter: glassBlur,
                        WebkitBackdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        backgroundImage: glassBackgroundImage,
                        border: glassBorder,
                        borderRadius: 12,
                        boxShadow: glassShadow,
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
                        WebkitBackdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        backgroundImage: glassBackgroundImage,
                        border: glassBorder,
                        borderRadius: 12,
                        boxShadow: glassShadow,
                    }
                }
            },
            MuiPopover: {
                styleOverrides: {
                    paper: {
                        backdropFilter: glassBlur,
                        WebkitBackdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        backgroundImage: glassBackgroundImage,
                        border: glassBorder,
                        borderRadius: 12,
                        boxShadow: glassShadow,
                    }
                }
            },
            MuiAutocomplete: {
                styleOverrides: {
                    paper: {
                        backdropFilter: glassBlur,
                        WebkitBackdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        backgroundImage: glassBackgroundImage,
                        border: glassBorder,
                        borderRadius: 12,
                        boxShadow: glassShadow,
                    }
                }
            },
            MuiSnackbarContent: {
                styleOverrides: {
                    root: {
                        backdropFilter: glassBlur,
                        WebkitBackdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        backgroundImage: glassBackgroundImage,
                        border: glassBorder,
                        borderRadius: 12,
                        boxShadow: glassShadow,
                        color: isDark ? '#f8fafc' : '#1e293b',
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
                        minHeight: 40,
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
                defaultProps: { IconComponent: ArrowDropDown },
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
            MuiAlert: {
                defaultProps: {
                    iconMapping: {
                        success: React.createElement(CheckCircle),
                        error: React.createElement(ErrorIcon),
                        info: React.createElement(Info),
                        warning: React.createElement(Warning),
                    },
                },
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
                backgroundImage: glassBackgroundImage,
                backdropFilter: glassBlur,
                border: glassBorder,
                boxShadow: glassShadow,
            },
            surface,
            gradients: {
                primary: `linear-gradient(135deg, ${primaryColor} 0%, ${alpha(primaryColor, 0.8)} 100%)`,
            }
        }
    });
};
