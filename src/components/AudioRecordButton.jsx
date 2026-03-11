import React, { useState, useRef, useCallback } from 'react'
import { IconButton, Tooltip } from '@mui/material'
import { Mic as MicIcon, Stop as StopIcon } from '@mui/icons-material'
import { blobToWav } from '../utils/audioCodec'

const AudioRecordButton = ({ onAudioInsert, onTranscription, disabled = false, sx }) => {
  const [isRecording, setIsRecording] = useState(false)
  const [sttBusy, setSttBusy] = useState(false)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000 }
      })
      streamRef.current = stream

      let mimeType = 'audio/ogg;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = ''

      const opts = mimeType ? { mimeType, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 }
      const recorder = new MediaRecorder(stream, opts)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        streamRef.current = null

        const mime = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mime })
        if (blob.size === 0) return

        const ext = mime.includes('ogg') ? 'ogg' : 'webm'
        const fileName = `rec_${Date.now()}.${ext}`

        try {
          const buffer = await blob.arrayBuffer()
          const result = await window.electronAPI.audio.saveFromBuffer(
            Array.from(new Uint8Array(buffer)), fileName
          )
          if (!result.success) return
          const audioPath = result.data

          // 先插入音频节点
          onAudioInsert?.(audioPath)

          // 自动转文字
          if (window.electronAPI?.stt?.transcribe && onTranscription) {
            setSttBusy(true)
            try {
              const isWebm = ext === 'webm'
              const sttArg = isWebm ? await blobToWav(blob) : audioPath
              const sttResult = await window.electronAPI.stt.transcribe(sttArg)
              if (sttResult?.success && sttResult?.data?.text) {
                onTranscription(sttResult.data.text, audioPath)
              }
            } catch (e) {
              console.error('自动转文字失败:', e)
            } finally {
              setSttBusy(false)
            }
          }
        } catch (error) {
          console.error('保存录音失败:', error)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(250)
      setIsRecording(true)
    } catch (error) {
      console.error('启动录音失败:', error)
    }
  }, [onAudioInsert, onTranscription])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
  }, [])

  return (
    <>
      <Tooltip title={sttBusy ? '转文字中…' : isRecording ? '点击停止' : '录音'}>
        <span>
          <IconButton
            size="small"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={disabled || sttBusy}
            sx={{
              ...sx,
              overflow: 'hidden',
              ...(isRecording && {
                color: '#fff',
                background: 'linear-gradient(90deg, #e91e63, #9c27b0, #2196f3, #e91e63)',
                backgroundSize: '200% 100%',
                animation: 'fluid-flow 3s linear infinite',
                '&:hover': { opacity: 0.85 },
              }),
              ...(sttBusy && {
                color: '#fff',
                background: 'linear-gradient(90deg, #00bcd4, #7c4dff, #00bcd4)',
                backgroundSize: '200% 100%',
                animation: 'fluid-flow 2s linear infinite',
                '&:hover': { opacity: 0.85 },
              }),
            }}
          >
            {sttBusy ? <MicIcon fontSize="small" /> : isRecording ? <StopIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
      <style>{`
        @keyframes fluid-flow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>
    </>
  )
}

export default AudioRecordButton
