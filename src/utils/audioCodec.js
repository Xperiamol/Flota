/**
 * 音频编解码工具 — 将任意音频解码为 16kHz mono 16-bit WAV
 * 用于火山引擎 STT 等仅支持 PCM/WAV 的场景
 */

function encodeWav(pcm) {
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const v = new DataView(buf)
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); ws(8, 'WAVE')
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  ws(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  for (let i = 0, off = 44; i < pcm.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, pcm[i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  return new Uint8Array(buf)
}

/**
 * 将 Blob 解码为 WAV buffer (Array<number>)
 */
export async function blobToWav(blob) {
  const ab = await blob.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  const decoded = await ctx.decodeAudioData(ab)
  ctx.close()
  return Array.from(encodeWav(decoded.getChannelData(0)))
}

/**
 * 将 URL 指向的音频解码为 WAV buffer (Array<number>)
 */
export async function urlToWav(url) {
  const resp = await fetch(url)
  const ab = await resp.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  const decoded = await ctx.decodeAudioData(ab)
  ctx.close()
  return Array.from(encodeWav(decoded.getChannelData(0)))
}
