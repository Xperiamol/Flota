// 模型下载和推理均在 Worker 中运行；转写阶段只读取本地模型。
const { parentPort, workerData } = require('worker_threads');
const Module = require('module');
const fs = require('fs');
const path = require('path');

function readPcmWav(bytes) {
  const data = Buffer.from(bytes);
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error('离线转写需要 WAV 音频');
  let channels, rate, bits, format, pcm;
  for (let offset = 12; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4), start = offset + 8;
    if (start + size > data.length) throw new Error('WAV 音频不完整');
    const tag = data.toString('ascii', offset, offset + 4);
    if (tag === 'fmt ' && size >= 16) {
      format = data.readUInt16LE(start); channels = data.readUInt16LE(start + 2);
      rate = data.readUInt32LE(start + 4); bits = data.readUInt16LE(start + 14);
    }
    if (tag === 'data') pcm = data.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  if (!pcm || format !== 1 || bits !== 16 || channels !== 1 || rate !== 16000) throw new Error('请选择 16kHz 单声道 WAV 音频，或在编辑器中录音');
  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return samples;
}

async function run() {
  // transformers 同时导入图片库；语音不依赖 sharp 的原生图片解码。
  const sharpPath = Module.createRequire(require.resolve('@xenova/transformers')).resolve('sharp');
  try { require(sharpPath); } catch {
    const stub = new Module(sharpPath); stub.loaded = true;
    stub.exports = () => { throw new Error('语音模型不使用图片处理'); };
    require.cache[sharpPath] = stub;
  }
  const { pipeline, env } = await import('@xenova/transformers');
  env.cacheDir = workerData.cacheDir;
  env.allowLocalModels = true;
  env.localModelPath = workerData.cacheDir + path.sep;
  env.allowRemoteModels = workerData.mode === 'prepare';
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.logLevel = 'error';
  const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    quantized: true, local_files_only: workerData.mode !== 'prepare',
    progress_callback: progress => parentPort.postMessage({ type: 'progress', data: { status: progress.status, progress: progress.progress } }),
  });
  try {
    if (workerData.mode === 'prepare') {
      fs.mkdirSync(workerData.cacheDir, { recursive: true });
      fs.writeFileSync(path.join(workerData.cacheDir, 'ready.json'), JSON.stringify({ model: 'Xenova/whisper-tiny' }));
      return { ready: true };
    }
    const audio = readPcmWav(workerData.audio);
    const result = await pipe(audio, { chunk_length_s: 30, stride_length_s: 5, task: 'transcribe',
      ...(workerData.language && workerData.language !== 'auto' ? { language: workerData.language } : {}) });
    return { text: result.text.trim() };
  } finally { await pipe.dispose(); }
}

if (parentPort) run().then(data => parentPort.postMessage({ type: 'result', data })).catch(error => parentPort.postMessage({ type: 'error', error: error.message }));
module.exports = { readPcmWav };
