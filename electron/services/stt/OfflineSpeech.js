const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const { getUserDataPath } = require('../../utils/userDataPath');

class OfflineSpeech {
  constructor() {
    this.cacheDir = path.join(getUserDataPath(), 'models', 'speech');
    this.worker = null;
  }
  status() {
    return { ready: fs.existsSync(path.join(this.cacheDir, 'ready.json')), busy: Boolean(this.worker) };
  }
  run(mode, audio, language, onProgress = () => {}) {
    if (this.worker) return Promise.reject(new Error('语音模型正在处理，请稍后再试'));
    if (mode === 'transcribe' && !this.status().ready) return Promise.reject(new Error('请先到语音转文字设置下载离线模型'));
    return new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'offlineWorker.js'), { workerData: { mode, cacheDir: this.cacheDir, audio, language } });
      this.worker = worker;
      const finish = (error, data) => {
        this.worker = null;
        worker.removeAllListeners();
        worker.terminate();
        error ? reject(error) : resolve(data);
      };
      worker.on('message', message => {
        if (message.type === 'progress') onProgress(message.data);
        if (message.type === 'result') finish(null, message.data);
        if (message.type === 'error') finish(new Error(message.error));
      });
      worker.on('error', error => finish(error));
      worker.on('exit', code => finish(new Error(`语音处理已中断 (${code})`)));
    });
  }
}
module.exports = OfflineSpeech;
