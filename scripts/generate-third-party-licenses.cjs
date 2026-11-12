// 生成第三方开源许可清单：随应用发布的生产依赖（含间接依赖）的许可证类型与全文。
// 输出：
//   src/generated/third-party-licenses.json  设置 → 关于 页面按需加载
//   build/THIRD_PARTY_NOTICES.txt            随安装包附带的许可证全文
// 用法：npm run licenses（dev / build 前自动运行，依赖变化后清单随之更新）
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const JSON_OUT = path.join(root, 'src/generated/third-party-licenses.json')
const TEXT_OUT = path.join(root, 'build/THIRD_PARTY_NOTICES.txt')
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?(\.(md|txt|markdown))?$/i

// 许可证全文的识别特征：package.json 没写或写成 “SEE LICENSE IN” 时据此判断
const TEXT_SIGNATURES = [
  [/Apache License[\s\S]{0,40}Version 2\.0/i, 'Apache-2.0'],
  [/Permission is hereby granted, free of charge/i, 'MIT'],
  [/Permission to use, copy, modify, and\/or distribute this software for any/i, 'ISC'],
  [/Redistribution and use in source and binary forms[\s\S]*Neither the name/i, 'BSD-3-Clause'],
  [/Redistribution and use in source and binary forms/i, 'BSD-2-Clause'],
  [/Mozilla Public License,? (v\. |Version )2\.0/i, 'MPL-2.0'],
]

const normalizeLicense = (pkg, text) => {
  let value = pkg.license ?? pkg.licenses
  if (Array.isArray(value)) value = value.map((item) => item?.type || item).join(' OR ')
  else if (value && typeof value === 'object') value = value.type
  value = String(value || '').trim().replace(/^\((.*)\)$/, '$1')
  if (!value || /^SEE LICEN[CS]E/i.test(value)) value = TEXT_SIGNATURES.find(([pattern]) => pattern.test(text))?.[1] || 'UNKNOWN'
  return value
}

const repositoryUrl = (pkg) => {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
  if (!repo) return pkg.homepage || ''
  return repo.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/').replace(/^(?!https?:)([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
}

// 只在构建期使用、不随应用发布的依赖（误放在 dependencies 里），连同只被它们引用的包一起排除
const BUILD_ONLY = new Set(['vite', '@vitejs/plugin-react'])
const STUBS_DIR = path.join(root, 'stubs') + path.sep

// 按 Node 的查找规则从 fromDir 向上找依赖包目录
const resolvePackageDir = (name, fromDir) => {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
    if (dir === path.dirname(dir)) return null
  }
}

// 运行时依赖闭包：包括已安装的可选原生依赖。
const runtimePackageDirs = () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const queue = Object.keys({ ...rootPkg.dependencies, ...rootPkg.optionalDependencies }).filter((name) => !BUILD_ONLY.has(name)).map((name) => [name, root])
  const dirs = new Set()
  while (queue.length) {
    const [name, from] = queue.shift()
    const dir = resolvePackageDir(name, from)
    // stubs/ 下是 Flota 自己的空包（替换掉用不到的 SDK），不是第三方代码
    if (!dir || dirs.has(dir) || dir.startsWith(STUBS_DIR)) continue
    dirs.add(dir)
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push([dep, dir])
  }
  return [...dirs]
}

// 包内附带原生库时（如 sharp 的 vendor/libvips），第三方声明放在子目录里，也要一并收录
const nestedNotices = (dir, depth = 0) => {
  if (depth > 3) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return nestedNotices(full, depth + 1)
    return depth > 0 && /^third[-_]party[-_]notices/i.test(entry.name) ? [full] : []
  })
}

const listPackages = () => {
  const seen = new Map()
  for (const dir of runtimePackageDirs()) {
    let pkg
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { continue }
    if (!pkg.name || pkg.private) continue
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) continue
    const files = fs.readdirSync(dir).filter((name) => LICENSE_FILE.test(name) && fs.statSync(path.join(dir, name)).isFile()).sort()
    const paths = [...files.map((name) => path.join(dir, name)), ...nestedNotices(dir).sort()]
    const text = paths.map((file) => fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').trim()).join('\n\n---\n\n')
    seen.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: normalizeLicense(pkg, text),
      repository: repositoryUrl(pkg),
      text,
    })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
}

const build = () => {
  const packages = listPackages()
  const json = `${JSON.stringify({ packages }, null, 1)}\n`
  const text = [
    'Flota 使用了以下第三方开源软件。各软件的版权归其各自作者所有，按各自的许可证授权。',
    'Flota uses the following third-party open source software, licensed under their respective licenses.',
    '',
    ...packages.map((item) => [
      '='.repeat(72),
      `${item.name} ${item.version}`,
      `License: ${item.license}`,
      item.repository ? `Source: ${item.repository}` : '',
      '',
      item.text || `(该包未附带许可证全文，许可证为 ${item.license})`,
      '',
    ].filter((line, index) => line !== '' || index > 3).join('\n')),
  ].join('\n')
  return { packages, json, text }
}

const { packages, json, text } = build()
fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true })
fs.writeFileSync(JSON_OUT, json)
fs.writeFileSync(TEXT_OUT, text)
const counts = {}
for (const item of packages) counts[item.license] = (counts[item.license] || 0) + 1
console.log(`已生成第三方许可清单：${packages.length} 个包（${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([license, count]) => `${license} ${count}`).join('，')}）`)
