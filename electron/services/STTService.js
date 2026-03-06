/**
 * STT (Speech-to-Text) 服务 - 语音转文字功能
 * 支持多个语音识别服务提供商
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

let uuidv4;
try { uuidv4 = require('uuid').v4; } catch (_) { uuidv4 = null; }

let WSClass;
try { WSClass = require('ws'); } catch (_) { WSClass = null; }

class STTService extends EventEmitter {
  constructor(settingDAO) {
    super();
    this.settingDAO = settingDAO;
    this.initialized = false;
  }

  /**
   * 初始化STT服务
   */
  async initialize() {
    try {
      // 确保必要的设置键存在
      this.ensureDefaultSettings();
      this.initialized = true;
      console.log('STT Service initialized');
      return { success: true };
    } catch (error) {
      console.error('Failed to initialize STT Service:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 确保默认设置存在
   */
  ensureDefaultSettings() {
    const defaults = [
      { key: 'stt_enabled', value: 'false', type: 'boolean', description: 'STT功能开关' },
      { key: 'stt_volc_appid', value: '', type: 'string', description: '火山引擎 App ID' },
      { key: 'stt_volc_token', value: '', type: 'string', description: '火山引擎 Access Token' },
      { key: 'stt_volc_resource_id', value: 'volcengine_short_sentence', type: 'string', description: '火山引擎 Cluster ID (一句话识别)' }
    ];

    defaults.forEach(({ key, value, type, description }) => {
      const existing = this.settingDAO.get(key);
      if (!existing) {
        this.settingDAO.set(key, value, type, description);
      }
    });
  }

  /**
   * 获取STT配置
   */
  async getConfig() {
    try {
      const g = (key, def = '') => { const s = this.settingDAO.get(key); return s ? s.value : def; };
      const config = {
        enabled: g('stt_enabled') === true || g('stt_enabled') === 'true',
        volcAppId: g('stt_volc_appid'),
        volcToken: g('stt_volc_token'),
        volcResourceId: g('stt_volc_resource_id', 'volcengine_short_sentence')
      };
      return { success: true, data: config };
    } catch (error) {
      console.error('Failed to get STT config:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 保存STT配置
   */
  async saveConfig(config) {
    try {
      const { enabled, volcAppId, volcToken, volcResourceId } = config;

      this.settingDAO.set('stt_enabled', enabled, 'boolean', 'STT功能开关');
      this.settingDAO.set('stt_volc_appid', volcAppId || '', 'string', '火山引擎 App ID');
      this.settingDAO.set('stt_volc_token', volcToken || '', 'string', '火山引擎 Access Token');
      this.settingDAO.set('stt_volc_resource_id', volcResourceId || 'volcengine_short_sentence', 'string', '火山引擎 Cluster ID');

      // 触发配置更改事件
      this.emit('config-changed', config);

      return {
        success: true,
        message: '配置已保存'
      };
    } catch (error) {
      console.error('Failed to save STT config:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 测试STT连接
   */
  async testConnection(config) {
    try {
      const { volcAppId, volcToken, volcResourceId } = config;
      if (!volcAppId || !volcToken) return { success: false, error: '请先配置火山引擎 App ID 和 Access Token' };
      return await this.testVolcengine(volcAppId, volcToken, volcResourceId);
    } catch (error) {
      console.error('Failed to test STT connection:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 测试火山引擎连接（通过 AUC HTTP 接口验证 token/appid 有效性）
   */
  async testVolcengine(appId, token, resourceId = 'volcengine_short_sentence') {
    try {
      // 使用固定的 AUC cluster 来测试 token/appid 有效性
      // 实际转文字使用 WebSocket 接口（一句话识别），cluster 在那里才使用 resourceId
      const testCluster = 'volc_auc_common_flash';
      // 提交一个无效 URL 任务，通过返回的应用错误码判断认证是否正确
      // 认证通过: code=1001(参数无效/音频无效) 或 1015(下载失败)
      // 认证失败: code=1002
      const response = await fetch('https://openspeech.bytedance.com/api/v1/auc/submit', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer;${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app: { appid: appId, token: token, cluster: testCluster },
          user: { uid: appId },
          audio: { format: 'wav', url: 'http://test.invalid/test.wav' }
        })
      });

      let data;
      try { data = await response.json(); } catch (_) { data = {}; }
      console.log('[STT] testVolcengine status:', response.status, 'body:', JSON.stringify(data));

      // 火山引擎返回结构: 顶层 { code, message } 或嵌套 { resp: { code, message } }
      const code = data?.resp?.code ?? data?.code;
      const msg  = data?.resp?.message || data?.message || '';

      // 认证通过: 发送无效 URL 后得到 1014/1015(下载/参数无效) 说明 token 已被接受
      if (code === 1000 || code === 1014 || code === 1015) {
        return { success: true, message: `连接成功（appid=${appId}）` };
      }
      // 明确认证失败
      if (code === 1002 || code === 1001) {
        return { success: false, error: `认证失败(${code}): token 或 appid 无效 — ${msg}` };
      }
      // HTTP 层面失败且无可识别的业务码
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${msg || response.statusText}` };
      }
      return { success: false, error: `未知响应 code=${code}: ${msg}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 语音转文字主方法
   * @param {string|Buffer} audioFile - 音频文件路径或Buffer
   * @param {object} options - 转换选项
   */
  async transcribe(audioFile, options = {}) {
    try {
      const configResult = await this.getConfig();
      if (!configResult.success) {
        return configResult;
      }

      const config = configResult.data;
      
      if (!config.enabled) {
        return { success: false, error: 'STT功能未启用' };
      }

      if (!config.volcAppId || !config.volcToken) {
        return { success: false, error: '请先配置火山引擎 App ID 和 Access Token' };
      }

      return await this.transcribeVolcengine(config, audioFile, options);
    } catch (error) {
      console.error('STT transcribe failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 火山引擎一句话识别（WebSocket 二进制协议）
   */
  async transcribeVolcengine(config, audioFile, options = {}) {
    try {
      if (!config.volcAppId || !config.volcToken) throw new Error('请先配置火山引擎 App ID 和 Access Token');
      if (!WSClass) throw new Error('WebSocket 模块 (ws) 不可用，请运行 npm install ws');

      const cluster = config.volcResourceId || 'volcengine_short_sentence';

      // 准备音频: 不支持的格式用 ffmpeg 转 wav
      let audioBuffer, fmt, sampleRate = 16000;
      if (typeof audioFile === 'string') {
        const ext = audioFile.split('.').pop()?.toLowerCase() || '';
        const supported = { wav: 'wav', mp3: 'mp3', ogg: 'ogg', opus: 'ogg', webm: 'ogg' };
        if (supported[ext]) {
          audioBuffer = fs.readFileSync(audioFile);
          fmt = supported[ext];
        } else {
          const wavBuf = this._convertToWav(audioFile);
          if (!wavBuf) throw new Error(`不支持 ${ext} 格式，且 ffmpeg 不可用。请安装 ffmpeg 或使用 wav/mp3/ogg 格式。`);
          audioBuffer = wavBuf;
          fmt = 'wav';
        }
      } else if (Buffer.isBuffer(audioFile)) {
        audioBuffer = audioFile;
        fmt = 'wav';
      } else {
        throw new Error('不支持的音频文件类型');
      }

      function buildFrame(msgType, flags, serial, compress, payload) {
        const comp = compress === 1 ? zlib.gzipSync(payload) : payload;
        const hdr  = Buffer.from([0x11, (msgType << 4) | flags, (serial << 4) | compress, 0x00]);
        const size = Buffer.alloc(4); size.writeUInt32BE(comp.length, 0);
        return Buffer.concat([hdr, size, comp]);
      }

      function parseFrame(data) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 4) throw new Error('帧太短');
        const hdrSize  = (buf[0] & 0x0F) * 4;
        const msgType  = (buf[1] >> 4) & 0x0F;
        const compress = buf[2] & 0x0F;

        const gunzip = (d) => {
          if (!d.length) return '{}';
          try { return (compress === 1 ? zlib.gunzipSync(d) : d).toString('utf8'); }
          catch (_) { return d.toString('utf8'); }
        };

        // 错误帧: header + errorCode(4) + payloadSize(4) + payload
        if (msgType === 0xf) {
          if (buf.length < hdrSize + 8) throw new Error('错误帧太短');
          const errCode = buf.readUInt32BE(hdrSize);
          const pSize   = buf.readUInt32BE(hdrSize + 4);
          const start   = hdrSize + 8;
          const payload = buf.slice(start, start + Math.min(pSize, buf.length - start));
          const text    = gunzip(payload);
          console.error(`[STT] 服务端错误 ${errCode}: ${text}`);
          try { const j = JSON.parse(text); if (j.code === undefined) j.code = errCode; return j; }
          catch (_) { return { code: errCode, message: text, sequence: -1 }; }
        }

        // 普通帧: header + payloadSize(4) + payload
        if (buf.length <= hdrSize + 4) return { code: 1000, sequence: 0 };
        const pSize   = buf.readUInt32BE(hdrSize);
        const start   = hdrSize + 4;
        const payload = buf.slice(start, start + Math.min(pSize, buf.length - start));
        return JSON.parse(gunzip(payload));
      }

      const meta = {
        app:     { appid: config.volcAppId, token: config.volcToken, cluster },
        user:    { uid: config.volcAppId },
        audio:   { format: fmt, rate: sampleRate, bits: 16, channel: 1 },
        request: { reqid: this._uuid(), sequence: 1, nbest: 1,
                   workflow: 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate' }
      };

      const metaFrame  = buildFrame(0x1, 0x0, 0x1, 0x1, Buffer.from(JSON.stringify(meta)));
      const audioFrame = buildFrame(0x2, 0x2, 0x0, 0x1, audioBuffer);

      return await new Promise((resolve, reject) => {
        const ws = new WSClass('wss://openspeech.bytedance.com/api/v2/asr', {
          headers: { Authorization: `Bearer;${config.volcToken}` }
        });
        let result = null;
        let settled = false;
        const timer = setTimeout(() => { ws.terminate(); if (!settled) { settled = true; reject(new Error('识别超时（120s）')); } }, 120_000);

        const done = (err) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          if (err) { ws.close(); reject(err); }
          else { ws.close(); resolve({ success: true, data: { text: result || '' } }); }
        };

        ws.on('open', () => { ws.send(metaFrame); ws.send(audioFrame); });

        ws.on('message', (data) => {
          try {
            const json = Buffer.isBuffer(data) ? parseFrame(data) : JSON.parse(data.toString());
            const code = json.code ?? -1;
            const seq  = json.sequence ?? 0;
            console.log(`[STT] resp code=${code} seq=${seq}`);
            if (code !== 1000) { done(new Error(`识别失败(${code}): ${json.message || ''}`)); return; }
            const arr = json.result;
            if (arr?.length > 0 && arr[0].text) result = arr[0].text;
            if (seq < 0) done(null);
          } catch (e) { done(e); }
        });

        ws.on('error', (err) => done(new Error(`WebSocket 错误: ${err.message}`)));
        ws.on('close', () => { if (!settled) done(result ? null : new Error('连接关闭但未收到识别结果')); });
      });
    } catch (error) {
      console.error('Volcengine transcribe failed:', error);
      return { success: false, error: error.message };
    }
  }

  /** 生成 UUID */
  _uuid() {
    if (uuidv4) return uuidv4();
    if (crypto.randomUUID) return crypto.randomUUID();
    // fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  /**
   * 将音频文件通过 ffmpeg 转换为 16kHz mono WAV (PCM16-LE)
   * @returns {Buffer|null} WAV Buffer 或 null（ffmpeg 不可用）
   */
  _convertToWav(inputPath) {
    const { execFileSync } = require('child_process');
    const path = require('path');
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `flashnote_stt_${Date.now()}.wav`);
    try {
      execFileSync('ffmpeg', [
        '-y', '-i', inputPath,
        '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
        '-f', 'wav', tmpFile
      ], { timeout: 30000, stdio: 'pipe' });
      const buf = fs.readFileSync(tmpFile);
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      console.log(`[STT] ffmpeg 转换成功: ${inputPath} -> WAV ${buf.length} bytes`);
      return buf;
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      console.warn(`[STT] ffmpeg 转换失败: ${e.message}`);
      return null;
    }
  }
}

module.exports = STTService;
