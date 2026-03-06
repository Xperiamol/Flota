import React, { useState, useRef, useCallback } from 'react'
import { IconButton, Tooltip, Box, Typography, Dialog, DialogContent } from '@mui/material'
import { Mic as MicIcon, Stop as StopIcon, FiberManualRecord as RecordingIcon } from '@mui/icons-material'

/**
 * 录音按钮组件 — 录制音频并保存为 m4a 文件
 *
 * 使用 Web MediaRecorder API 录制，录制完成后通过 Electron IPC 保存到 audio/ 目录。
 * @param {Function} onAudioInsert - 录音完成后回调，传入相对路径（如 "audio/rec_xxx.m4a"）
 */
const AudioRecordButton = ({ onAudioInsert, disabled = false }) => {
  const [isRecording, setIsRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const streamRef = useRef(null)

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 }
      })
      streamRef.current = stream

      // 检查支持的格式：优先 webm/opus，其次 ogg/opus
      let mimeType = 'audio/webm;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/ogg;codecs=opus'
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = '' // 使用浏览器默认
      }

      const opts = mimeType ? { mimeType, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 }
      const recorder = new MediaRecorder(stream, opts)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        clearInterval(timerRef.current)
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0) return

        // 根据 MIME 类型确定扩展名
        const ext = (recorder.mimeType || '').includes('ogg') ? 'ogg' : 'webm'
        const fileName = `rec_${Date.now()}.${ext}`

        try {
          const buffer = await blob.arrayBuffer()
          const result = await window.electronAPI.audio.saveFromBuffer(
            Array.from(new Uint8Array(buffer)),
            fileName
          )
          if (result.success && onAudioInsert) {
            onAudioInsert(result.data)
          }
        } catch (error) {
          console.error('保存录音失败:', error)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(250) // 每 250ms 一个 chunk
      setIsRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000)
    } catch (error) {
      console.error('启动录音失败:', error)
    }
  }, [onAudioInsert])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    setElapsed(0)
  }, [])

  return (
    <>
      <Tooltip title={isRecording ? '停止录音' : '录音'}>
        <span>
          <IconButton
            size="small"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={disabled}
            color={isRecording ? 'error' : 'default'}
            sx={{
              border: '1px solid',
              borderColor: isRecording ? 'error.main' : 'divider',
              borderRadius: 1,
              '&:hover': { backgroundColor: 'action.hover' }
            }}
          >
            {isRecording ? <StopIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>

      {/* 录音中指示器 */}
      <Dialog open={isRecording} onClose={stopRecording} maxWidth="xs">
        <DialogContent sx={{ textAlign: 'center', py: 4, px: 6 }}>
          <RecordingIcon sx={{ fontSize: 48, color: 'error.main', animation: 'pulse 1.5s infinite' }} />
          <Typography variant="h6" sx={{ mt: 2 }}>
            录音中
          </Typography>
          <Typography variant="h4" sx={{ mt: 1, fontFamily: 'monospace' }}>
            {formatTime(elapsed)}
          </Typography>
          <Box sx={{ mt: 3 }}>
            <IconButton
              onClick={stopRecording}
              size="large"
              sx={{
                bgcolor: 'error.main',
                color: 'white',
                '&:hover': { bgcolor: 'error.dark' },
                width: 56,
                height: 56
              }}
            >
              <StopIcon />
            </IconButton>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            点击停止录音
          </Typography>
        </DialogContent>
      </Dialog>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  )
}

export default AudioRecordButton
