/**
 * 构建 Chrome 剪藏扩展（extensions/chrome-clipper）：
 * - 把 Readability / Turndown 的浏览器构建复制到 vendor/
 * - 生成 PNG 图标（Chrome 扩展只接受位图）
 * 之后在 chrome://extensions 打开“开发者模式”，“加载已解压的扩展程序”选择该目录即可。
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.join(__dirname, '..')
const extDir = path.join(root, 'extensions', 'chrome-clipper')

const VENDOR = {
  'Readability.js': 'node_modules/@mozilla/readability/Readability.js',
  'turndown.js': 'node_modules/turndown/dist/turndown.js',
  'turndown-plugin-gfm.js': 'node_modules/turndown-plugin-gfm/dist/turndown-plugin-gfm.js',
}

fs.mkdirSync(path.join(extDir, 'vendor'), { recursive: true })
for (const [name, source] of Object.entries(VENDOR)) {
  fs.copyFileSync(path.join(root, source), path.join(extDir, 'vendor', name))
}

// ---- 极简 PNG 编码 ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
const encodePng = (size, pixel) => {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y)
      const offset = y * (size * 4 + 1) + 1 + x * 4
      raw[offset] = r; raw[offset + 1] = g; raw[offset + 2] = b; raw[offset + 3] = a
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// 图标：蓝色圆角方块 + 白色书签（4x 超采样抗锯齿）
const inside = (u, v) => {
  const radius = 0.22
  const cx = Math.min(Math.max(u, radius), 1 - radius)
  const cy = Math.min(Math.max(v, radius), 1 - radius)
  const inTile = (u - cx) ** 2 + (v - cy) ** 2 <= radius ** 2
  if (!inTile) return null
  // 书签：x∈[0.32,0.68]，y∈[0.24,0.78]，底部 V 形缺口
  const inBookmark = u >= 0.32 && u <= 0.68 && v >= 0.24 && v <= 0.78 && v <= 0.78 - 0.2 * (1 - Math.abs(u - 0.5) / 0.18) + 0.2 - 0.2
  const notch = v > 0.64 && v - 0.64 > 0.14 * (1 - Math.abs(u - 0.5) / 0.18)
  return inBookmark && !notch ? 'mark' : 'tile'
}
for (const size of [16, 48, 128]) {
  const png = encodePng(size, (x, y) => {
    let tile = 0, mark = 0
    const samples = 4
    for (let sy = 0; sy < samples; sy++) {
      for (let sx = 0; sx < samples; sx++) {
        const hit = inside((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size)
        if (hit === 'tile') tile++
        if (hit === 'mark') mark++
      }
    }
    const total = samples * samples
    const alpha = (tile + mark) / total
    if (!alpha) return [0, 0, 0, 0]
    const white = mark / (tile + mark)
    const mix = (from, to) => Math.round(from + (to - from) * white)
    return [mix(0x39, 255), mix(0x78, 255), mix(0xf6, 255), Math.round(alpha * 255)]
  })
  fs.mkdirSync(path.join(extDir, 'icons'), { recursive: true })
  fs.writeFileSync(path.join(extDir, 'icons', `icon${size}.png`), png)
}

console.log(`[clipper] 扩展已构建：${extDir}`)
