// 重新生成 Microsoft Store（AppX）图标：node build/appx-art/render.js
// 需要本机有 Google Chrome，并临时安装 puppeteer-core（npm i --no-save puppeteer-core）
// 输出到 build/appx/，electron-builder 打 appx 时会自动读取这个目录。
const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const root = path.join(__dirname, '..', '..')
const outDir = path.join(root, 'build', 'appx')
const logo = fs.readFileSync(path.join(root, 'logo.png')).toString('base64')

// fill：logo 内容（裁掉透明边后）占画布较短边的比例
const jobs = []
const add = (name, width, height, fill, scales = [100, 200]) => {
  for (const scale of scales) {
    const suffix = scale === 100 ? '' : `.scale-${scale}`
    jobs.push({ file: `${name}${suffix}.png`, width: width * scale / 100, height: height * scale / 100, fill })
  }
}
add('StoreLogo', 50, 50, 0.92)
add('Square44x44Logo', 44, 44, 0.92)
add('Square150x150Logo', 150, 150, 0.7)
add('Wide310x150Logo', 310, 150, 0.7)
// 任务栏、开始菜单列表用的无底板图标
for (const size of [16, 24, 32, 48, 256]) {
  jobs.push({ file: `Square44x44Logo.targetsize-${size}_altform-unplated.png`, width: size, height: size, fill: 0.94 })
}

;(async () => {
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const tab = await browser.newPage()
  await tab.setContent('<canvas></canvas>')
  for (const job of jobs) {
    const dataUrl = await tab.evaluate(async ({ logo, width, height, fill }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${logo}`
      await img.decode()
      // 找到 logo 的不透明区域
      const probe = document.createElement('canvas')
      probe.width = img.width
      probe.height = img.height
      const pctx = probe.getContext('2d')
      pctx.drawImage(img, 0, 0)
      const { data } = pctx.getImageData(0, 0, img.width, img.height)
      let minX = img.width, minY = img.height, maxX = 0, maxY = 0
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          if (data[(y * img.width + x) * 4 + 3] > 8) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      const cw = maxX - minX + 1
      const ch = maxY - minY + 1
      const box = Math.min(width, height) * fill
      const scale = Math.min(box / cw, box / ch)
      const w = cw * scale
      const h = ch * scale
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, minX, minY, cw, ch, (width - w) / 2, (height - h) / 2, w, h)
      return canvas.toDataURL('image/png')
    }, { logo, ...job })
    fs.writeFileSync(path.join(outDir, job.file), Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('✓', job.file, `${job.width}×${job.height}`)
  }
  await browser.close()
})()
