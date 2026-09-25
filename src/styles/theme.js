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
    const backgroundDefault = isDark ? '#161618' : '#f4f4f2';
    const backgroundPaper = isDark ? '#1f1f22' : '#ffffff';

    // 浮层（菜单 / 弹窗 / 对话框）：实心底色 + 细边框 + 柔和投影，不用毛玻璃和渐变
    const glassBackground = isDark ? '#242427' : '#ffffff';
    const glassBorder = isDark
        ? '1px solid rgba(255, 255, 255, 0.09)'
        : '1px solid rgba(0, 0, 0, 0.08)';
    const glassBlur = 'none';
    const glassBackgroundImage = 'none';
    const glassShadow = isDark
        ? '0 12px 32px rgba(0, 0, 0, 0.45)'
        : '0 12px 32px rgba(0, 0, 0, 0.10), 0 2px 6px rgba(0, 0, 0, 0.04)';

    // Surface tokens — 用于替换全应用的 rgba(255,255,255,0.x) / rgba(0,0,0,0.x) 硬编码
    const surface = {
        // 玻璃态：浅/重两档
        glassLight: isDark ? alpha('#1f1f22', 0.58) : alpha('#ffffff', 0.74),
        glassHeavy: isDark ? alpha('#1f1f22', 0.82) : alpha('#ffffff', 0.92),
        // 半透明覆盖：用于 hover/active/selected 等
        hover:    isDark ? 'rgba(255,255,255,0.06)' : 'rgba(22,22,24,0.04)',
        active:   isDark ? 'rgba(255,255,255,0.10)' : 'rgba(22,22,24,0.06)',
        pressed:  isDark ? 'rgba(255,255,255,0.14)' : 'rgba(22,22,24,0.08)',
        // 表单与嵌入面板使用同一层低对比材质，避免透明、灰底、白底混用。
        control: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(22,22,24,0.025)',
        controlHover: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(22,22,24,0.04)',
        // 面板内的分组底色（首页卡片、四象限等）：比面板略深一点，不用边框
        inset: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(22,22,24,0.028)',
        insetHover: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(22,22,24,0.05)',
        // 细分割线
        subtleBorder:  isDark ? 'rgba(255,255,255,0.08)' : 'rgba(22,22,24,0.08)',
        strongBorder:  isDark ? 'rgba(255,255,255,0.14)' : 'rgba(22,22,24,0.12)',
        // 阴影
        shadowSoft:   isDark ? '0 4px 16px rgba(0,0,0,0.32)' : '0 4px 16px rgba(22,22,24,0.06)',
        shadowMedium: isDark ? '0 12px 32px rgba(0,0,0,0.4)' : '0 12px 32px rgba(22,22,24,0.10)',
    };

    return createTheme({
        palette: {
            mode: validMode,
            primary: {
                main: primaryColor,
            },
            secondary: {
                main: isDark ? '#a1a1aa' : '#6e6e76',
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
                primary: isDark ? '#f2f2f3' : '#1f1f22',
                secondary: isDark ? '#9d9da5' : '#6e6e76',
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
                        // 很淡的中性明暗过渡：让浮在上面的玻璃外框有东西可透，不引入颜色
                        backgroundImage: isDark
                            ? 'linear-gradient(165deg, #1c1c1f 0%, #151517 55%, #111113 100%)'
                            : 'linear-gradient(165deg, #f8f8f6 0%, #efeeea 55%, #e8e7e3 100%)',
                        backgroundAttachment: 'fixed',
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
                            : '0 3px 12px rgba(22,22,24, 0.055)',
                    },
                    elevation2: {
                        boxShadow: isDark
                            ? '0 8px 24px rgba(0, 0, 0, 0.3)'
                            : '0 8px 24px rgba(22,22,24, 0.08)',
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
                        borderColor: surface.strongBorder,
                        backgroundColor: 'transparent',
                        '&:hover': {
                            borderColor: isDark ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.2)',
                            backgroundColor: surface.hover,
                        },
                    },
                    contained: {
                        boxShadow: 'none',
                        '&:hover': { boxShadow: 'none' },
                    },
                    containedPrimary: {
                        backgroundColor: primaryColor,
                        backgroundImage: 'none',
                        boxShadow: 'none',
                        '&:hover': {
                            backgroundColor: primaryColor,
                            backgroundImage: 'none',
                            filter: 'brightness(0.94)',
                            boxShadow: 'none',
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
                                boxShadow: 'none',
                            },
                            '& .MuiSwitch-thumb': {
                                backgroundColor: '#ffffff',
                                boxShadow: isDark
                                    ? '0 2px 8px rgba(11,11,12, 0.28)'
                                    : '0 2px 8px rgba(22,22,24, 0.16)',
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
                        backgroundColor: isDark ? '#fafafa' : '#ffffff',
                        boxShadow: isDark
                            ? '0 2px 8px rgba(11,11,12, 0.22)'
                            : '0 2px 6px rgba(22,22,24, 0.12)',
                    },
                    track: {
                        borderRadius: 999,
                        opacity: 1,
                        boxSizing: 'border-box',
                        border: `1px solid ${alpha(isDark ? '#ffffff' : '#161618', isDark ? 0.08 : 0.10)}`,
                        backgroundColor: isDark
                            ? 'rgba(110,110,118,0.22)'
                            : 'rgba(209,209,213,0.72)',
                        backgroundImage: 'none',
                        boxShadow: 'none',
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
                            border: `1.5px solid ${alpha(isDark ? '#d1d1d5' : '#4d4d55', isDark ? 0.58 : 0.68)}`,
                            backgroundColor: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.42)',
                            transition: 'background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
                        },
                        '& .FlotaCheckbox-iconChecked, & .FlotaCheckbox-iconIndeterminate': {
                            borderColor: primaryColor,
                            backgroundColor: primaryColor,
                            boxShadow: 'none',
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
                            backgroundColor: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(22,22,24,0.045)',
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
                            border: `1.5px solid ${alpha(isDark ? '#d1d1d5' : '#4d4d55', isDark ? 0.58 : 0.68)}`,
                            backgroundColor: isDark ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.42)',
                            transition: 'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
                        },
                        '& .FlotaRadio-iconChecked': {
                            borderColor: primaryColor,
                        },
                        '& .FlotaRadio-iconChecked::after': {
                            content: '""',
                            position: 'absolute',
                            inset: 4,
                            borderRadius: '50%',
                            backgroundColor: primaryColor,
                        },
                        '&:hover': {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.055)' : 'rgba(22,22,24,0.045)',
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
                        borderRadius: 10,
                        backgroundColor: surface.control,
                        transition: 'background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
                        '&:hover': {
                            backgroundColor: surface.controlHover,
                        },
                        '&.Mui-focused': {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#ffffff',
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
                        color: isDark ? '#fafafa' : '#1f1f22',
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
            // 标签：实心蓝色药丸换成浅底色小标签，圆角收小
            MuiChip: {
                styleOverrides: {
                    root: {
                        borderRadius: 8,
                        fontWeight: 500,
                    },
                    filled: {
                        '&.MuiChip-colorPrimary': {
                            backgroundColor: alpha(primaryColor, isDark ? 0.2 : 0.1),
                            color: isDark ? '#ffffff' : primaryColor,
                        },
                        '&.MuiChip-colorPrimary.MuiChip-clickable:hover': {
                            backgroundColor: alpha(primaryColor, isDark ? 0.28 : 0.16),
                        },
                        '&.MuiChip-colorDefault': {
                            backgroundColor: surface.active,
                        },
                    },
                    outlined: {
                        borderColor: surface.strongBorder,
                    },
                    iconColorPrimary: {
                        color: 'inherit',
                    },
                },
            },
            MuiDrawer: {
                styleOverrides: {
                    paper: {
                        backgroundColor: isDark ? '#161618' : '#f4f4f2',
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
                            backgroundColor: alpha(primaryColor, isDark ? 0.16 : 0.1),
                            '&:hover': {
                                backgroundColor: alpha(primaryColor, isDark ? 0.22 : 0.14),
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
