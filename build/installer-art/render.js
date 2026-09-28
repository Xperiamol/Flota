// 重新生成安装器美术：node build/installer-art/render.js
// 需要本机有 Google Chrome 和 ffmpeg，并临时安装 puppeteer-core（npm i --no-save puppeteer-core）
const path = require('path')
const { execFileSync } = require('child_process')
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const here = __dirname
const out = path.join(here, '..')
const page = `file://${path.join(here, 'art.html')}`

const jobs = [
  // DMG 背景：@1x + @2x（electron-builder 默认读取 build/background.png，并自动合成 @2x）
  { art: 'dmg', width: 660, height: 420, scale: 1, file: 'background.png' },
  { art: 'dmg', width: 660, height: 420, scale: 2, file: 'background@2x.png' },
  // NSIS 只接受 24 位 BMP
  { art: 'sidebar', width: 164, height: 314, scale: 1, file: 'installerSidebar.bmp', bmp: true },
  { art: 'header', width: 150, height: 57, scale: 1, file: 'installerHeader.bmp', bmp: true },
]

;(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--allow-file-access-from-files', '--force-color-profile=srgb'] })
  const tab = await browser.newPage()
  for (const job of jobs) {
    await tab.setViewport({ width: job.width, height: job.height, deviceScaleFactor: job.scale })
    await tab.goto(`${page}?art=${job.art}`, { waitUntil: 'networkidle0' })
    await tab.evaluate(() => document.fonts.ready)
    const png = path.join(out, job.bmp ? `${job.file}.png` : job.file)
    await tab.screenshot({ path: png })
    if (job.bmp) {
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-pix_fmt', 'bgr24', path.join(out, job.file)])
      require('fs').unlinkSync(png)
    }
    console.log('✓', job.file)
  }
  await browser.close()
})()
