import { createTheme, alpha } from '@mui/material/styles';

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

    return createTheme({
        palette: {
            mode: validMode,
            primary: {
                main: primaryColor,
            },
            background: {
                default: backgroundDefault,
                paper: backgroundPaper,
            },
            text: {
                primary: isDark ? '#f1f5f9' : '#1e293b',
                secondary: isDark ? '#94a3b8' : '#64748b',
            }
        },
        shape: {
            borderRadius: 16, // Unified rounded corners
        },
        typography: {
            fontFamily: [
                '"OPPOSans"',
                '-apple-system',
                'BlinkMacSystemFont',
                '"Segoe UI"',
                'Roboto',
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
                        borderRadius: 12,
                        boxShadow: isDark
                            ? 'inset 0 1px 0 rgba(255,255,255,0.05)'
                            : 'inset 0 1px 0 rgba(255,255,255,0.4), 0 1px 2px rgba(0,0,0,0.05)',
                        transition: 'background-color 0.2s cubic-bezier(0.4,0,0.2,1), box-shadow 0.2s cubic-bezier(0.4,0,0.2,1), transform 0.2s cubic-bezier(0.4,0,0.2,1), color 0.2s cubic-bezier(0.4,0,0.2,1)',
                        '&:hover': {
                            boxShadow: isDark
                                ? 'inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 12px rgba(0,0,0,0.3)'
                                : 'inset 0 1px 0 rgba(255,255,255,0.6), 0 4px 12px rgba(0,0,0,0.1)',
                            transform: 'translateY(-1px)',
                        },
                        '&:active': {
                            transform: 'translateY(0)',
                            boxShadow: 'none',
                        },
                    },
                    containedPrimary: {
                        background: `linear-gradient(135deg, ${primaryColor} 0%, ${alpha(primaryColor, 0.9)} 100%)`,
                        boxShadow: `0 4px 12px ${alpha(primaryColor, 0.4)}`,
                        '&:hover': {
                            boxShadow: `0 6px 16px ${alpha(primaryColor, 0.5)}`,
                        }
                    }
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
                        borderRadius: 24,
                        backdropFilter: glassBlur,
                        backgroundColor: glassBackground,
                        border: glassBorder,
                        boxShadow: '0 40px 80px -12px rgba(0, 0, 0, 0.3)', // Deep shadow for dialogs
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
                        borderRadius: 8,
                        boxShadow: '0 8px 30px rgba(0,0,0,0.12)'
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
                        '&.Mui-selected': {
                            backgroundColor: alpha(primaryColor, 0.15),
                            '&:hover': {
                                backgroundColor: alpha(primaryColor, 0.25),
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
            gradients: {
                primary: `linear-gradient(135deg, ${primaryColor} 0%, ${alpha(primaryColor, 0.8)} 100%)`,
            }
        }
    });
};
