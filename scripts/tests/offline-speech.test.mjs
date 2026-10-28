import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { readPcmWav } = require('../../electron/services/stt/offlineWorker')
function wav() {
  const b = Buffer.alloc(50)
  b.write('RIFF'); b.writeUInt32LE(42, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24)
  b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(6, 40); b.writeInt16LE(-32768, 44); b.writeInt16LE(0, 46); b.writeInt16LE(16384, 48)
  return b
}
test('离线语音解码为本机浮点采样，坏格式不会进入模型', () => {
  assert.deepEqual([...readPcmWav(wav())], [-1, 0, .5])
  const stereo = wav(); stereo.writeUInt16LE(2, 22)
  assert.throws(() => readPcmWav(stereo), /单声道/)
  assert.throws(() => readPcmWav(wav().subarray(0, 47)), /不完整/)
  assert.throws(() => readPcmWav(Buffer.from('not audio')), /WAV/)
})
