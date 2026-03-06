import React, { useState } from 'react'
import {
  Box,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  Alert
} from '@mui/material'
import {
  Image as ImageIcon,
  CloudUpload as UploadIcon,
  ContentPaste as PasteIcon
} from '@mui/icons-material'
import { imageAPI } from '../api/imageAPI'

const ImageUploadDialog = ({ open, onClose, onImageInsert }) => {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleFileSelect = async () => {
    try {
      setUploading(true)
      setError('')
      
      const result = await imageAPI.selectFile()
      const { imagePath, fileName } = result
      
      // 插入markdown图片语法
      onImageInsert(`![${fileName}](${imagePath})`, '', '')
      onClose()
    } catch (error) {
      setError(error.message || '选择图片失败')
    } finally {
      setUploading(false)
    }
  }

  const handlePasteFromClipboard = async () => {
    try {
      setUploading(true)
      setError('')
      
      const result = await imageAPI.saveFromClipboard()
      const { imagePath, fileName } = result
      
      // 插入markdown图片语法
      onImageInsert(`![${fileName}](${imagePath})`, '', '')
      onClose()
    } catch (error) {
      setError(error.message || '从剪贴板粘贴图片失败')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>插入图片</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, py: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          
          <Button
            variant="outlined"
            startIcon={uploading ? <CircularProgress size={20} /> : <UploadIcon />}
            onClick={handleFileSelect}
            disabled={uploading}
            sx={{ p: 2 }}
          >
            <Box sx={{ textAlign: 'left' }}>
              <Typography variant="subtitle1">从文件选择</Typography>
              <Typography variant="body2" color="text.secondary">
                选择本地图片文件
              </Typography>
            </Box>
          </Button>

          <Button
            variant="outlined"
            startIcon={uploading ? <CircularProgress size={20} /> : <PasteIcon />}
            onClick={handlePasteFromClipboard}
            disabled={uploading}
            sx={{ p: 2 }}
          >
            <Box sx={{ textAlign: 'left' }}>
              <Typography variant="subtitle1">从剪贴板粘贴</Typography>
              <Typography variant="body2" color="text.secondary">
                粘贴剪贴板中的图片
              </Typography>
            </Box>
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={uploading}>
          取消
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const ImageUploadButton = ({ onImageInsert, disabled = false }) => {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Tooltip title="插入图片">
        <span>
          <IconButton
            size="small"
            onClick={() => setDialogOpen(true)}
            disabled={disabled}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              '&:hover': {
                backgroundColor: 'action.hover'
              }
            }}
          >
            <ImageIcon />
          </IconButton>
        </span>
      </Tooltip>
      
      <ImageUploadDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onImageInsert={onImageInsert}
      />
    </>
  )
}

export default ImageUploadButton