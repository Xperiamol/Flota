import React, { useState } from 'react'
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Tooltip
} from '@mui/material'

/**
 * 统一的下拉菜单组件
 * 遵循SOLID和DRY原则，提供一致的选项样式
 * 所有强调色均使用主题色
 * 
 * @param {Object} props - 组件属性
 * @param {React.ReactNode} props.icon - 触发按钮的图标
 * @param {string} props.tooltip - 按钮提示文本
 * @param {Array} props.options - 菜单选项数组
 * @param {string} props.selectedValue - 当前选中的值
 * @param {Function} props.onSelect - 选择回调函数
 * @param {Object} props.anchorOrigin - 菜单锚点位置
 * @param {Object} props.transformOrigin - 菜单变换原点
 * @param {Object} props.sx - 自定义样式
 */
const DropdownMenu = ({
  icon,
  tooltip,
  options = [],
  selectedValue,
  onSelect,
  anchorOrigin = { horizontal: 'right', vertical: 'bottom' },
  transformOrigin = { horizontal: 'right', vertical: 'top' },
  sx = {}
}) => {
  const [anchorEl, setAnchorEl] = useState(null)
  const open = Boolean(anchorEl)

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleSelect = (value) => {
    onSelect?.(value)
    handleClose()
  }

  return (
    <>
      <Tooltip title={tooltip}>
        <IconButton 
          onClick={handleClick}
          sx={{
            color: 'text.primary',
            '&:hover': {
              backgroundColor: 'action.hover'
            },
            ...sx
          }}
        >
          {icon}
        </IconButton>
      </Tooltip>
      
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={anchorOrigin}
        transformOrigin={transformOrigin}
        slotProps={{
          paper: {
            sx: (theme) => ({
              minWidth: 160,
              boxShadow: theme.custom?.glass?.boxShadow,
              '& .MuiMenuItem-root': {
                fontSize: '0.875rem',
                minHeight: 40,
                '&:hover': {
                  backgroundColor: 'action.hover'
                },
                '&.Mui-selected': {
                  backgroundColor: 'primary.light',
                  color: 'primary.contrastText',
                  fontWeight: 600,
                  '&:hover': {
                    backgroundColor: 'primary.main'
                  }
                }
              }
            })
          }
        }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={selectedValue === option.value}
            onClick={() => handleSelect(option.value)}
          >
            {option.icon && (
              <ListItemIcon sx={{ 
                color: selectedValue === option.value ? 'inherit' : 'text.secondary',
                minWidth: 36
              }}>
                <option.icon fontSize="small" />
              </ListItemIcon>
            )}
            <ListItemText 
              primary={option.label}
              sx={{
                '& .MuiListItemText-primary': {
                  fontWeight: selectedValue === option.value ? 600 : 400
                }
              }}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

export default DropdownMenu
