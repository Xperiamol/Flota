import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

let source = await readFile(new URL('../../src/utils/aiExcalidrawGenerator.js', import.meta.url), 'utf8')
source = source.replace(/^import .*$/gm, '').replace("await import('./diagrams/visualReview')", "{ reviewCanvas: (...args) => globalThis.__reviewCanvas(...args) }")
const parserSource = await readFile(new URL('../../src/utils/diagrams/structuredOutput.js', import.meta.url), 'utf8')
source = parserSource.replace('export const', 'const') + `
const logger = { log() {}, warn() {} }
const computeOffset = () => ({ offsetX: 100, offsetY: 100 })
const DIAGRAM_THEME = { canvas: '#ffffff' }
const renderMermaidNative = async code => globalThis.__renderMermaid(code)
const renderComposer = tree => globalThis.__renderComposer(tree)
const createSvgAsset = text => globalThis.__createSvgAsset(text)
` + source
const { aiGenerateExcalidrawElements: generate } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
const setup = replies => {
  const calls = []
  globalThis.window = { electronAPI: { ai: { chat: async messages => { calls.push(messages); return replies.shift() } } } }
  globalThis.__renderMermaid = () => ({ elements: [{ id: 'mermaid' }] })
  globalThis.__renderComposer = () => ({ elements: [{ id: 'composer' }] })
  globalThis.__createSvgAsset = text => {
    if (!text.endsWith('</svg>')) throw new Error('SVG 标签未闭合')
    return { elements: [{ id: 'svg' }], files: { svg: {} } }
  }
  return calls
}
const ok = content => ({ success: true, data: { content } })
test('状态流转及带流程字样的时序图不会误走 flowchart', async () => {
  for (const [prompt, type] of [['画订单状态流转图', 'stateDiagram'], ['以时序图呈现登录流程', 'sequenceDiagram'], ['以类图呈现审批步骤', 'classDiagram']]) {
    const calls = setup([ok('valid')])
    await generate(prompt)
    assert.match(calls[0][0].content, new RegExp(type))
  }
})
test('SVG 校验失败仅修复一次，修复失败包含两次错误', async () => {
  const calls = setup([ok('<svg>'), ok('<svg>still broken')])
  await assert.rejects(generate('用 SVG 画 NTU 海报'), /首次校验失败.*自动修复后仍失败/)
  assert.equal(calls.length, 2)
  assert.match(calls[1].at(-1).content, /标签未闭合/)
})
test('SVG 修复成功返回完整图片资产', async () => {
  const calls = setup([ok('<svg>'), ok('<svg></svg>')])
  const result = await generate('用 SVG 画 NTU 海报')
  assert.equal(result.elements[0].id, 'svg')
  assert.ok(result.files.svg)
  assert.equal(calls.length, 2)
})
test('网关和网络失败不触发反思请求；Mermaid 保留上游错误', async () => {
  for (const prompt of ['SVG 海报', '流程图']) {
    const calls = setup([{ success: false, error: '请求失败 (503)' }])
    await assert.rejects(generate(prompt), /服务暂时不可用/)
    assert.equal(calls.length, 1)
  }
})
test('局部 SVG 降级保留节点 ID 和连线引用，且向上报告警告', async () => {
  const tree = { children: [{ type: 'svg', props: { id: 'visual', prompt: 'NTU 插画' } }, { type: 'card', props: { id: 'date', title: '23 Oct 2026' } }], connectors: [{ from: 'visual', to: 'date' }] }
  setup([ok(JSON.stringify(tree)), { success: false, error: '模型返回空正文' }])
  let rendered
  globalThis.__renderComposer = value => { rendered = value; return { elements: [{ id: 'card' }] } }
  const result = await generate('画 NTU 挑战赛全景图')
  assert.equal(rendered.children[0].type, 'card')
  assert.equal(rendered.children[0].props.id, 'visual')
  assert.equal(rendered.connectors[0].from, 'visual')
  assert.match(result.warnings[0], /模型返回空正文/)
})

test('取消贯穿 SVG、Mermaid、Composer 请求，不触发自动修复或降级', async () => {
  for (const prompt of ['SVG 海报', '流程图', '全景图']) {
    let calls = 0
    setup([])
    const task = { chat: async () => { calls++; throw Object.assign(new Error('已停止生成'), { name: 'AbortError' }) } }
    await assert.rejects(generate(prompt, [], task), { name: 'AbortError' })
    assert.equal(calls, 1)
  }
})


test('explicit flowchart type wins over composition and artwork words in the task', async () => {
  const calls = setup([ok('flowchart TD\nA-->B')])
  const result = await generate('以流程图呈现：项目审批，包含流程图与时间轴说明，不要变成插画')
  assert.equal(result.elements[0].id, 'mermaid')
  assert.equal(result.elements[0].customData.flotaGeneration.engine, 'mermaid')
  assert.match(calls[0][0].content, /flowchart/)
})

test('visual review cannot reclassify a flowchart into composer or SVG', async () => {
  const calls = setup([ok('flowchart TD\nA-->B'), ok('flowchart TD\nA-->B')])
  window.electronAPI.ai.getConfig = async () => ({ success: true, data: { visionEnabled: true } })
  globalThis.__reviewCanvas = async () => ['一张图中包含多个图的说明要简化，不要把它画成海报主视觉']
  const result = await generate('项目审批流程图')
  assert.equal(calls.length, 2)
  assert.equal(result.elements[0].id, 'mermaid')
  assert.equal(result.elements[0].customData.flotaGeneration.diagramType, 'flowchart')
  assert.match(calls[1][0].content, /flowchart/)
})

test('review failure preserves the generated scene and never exposes raw parser errors in the result', async () => {
  setup([ok('flowchart TD\nA-->B')])
  window.electronAPI.ai.getConfig = async () => ({ data: { visionEnabled: true } })
  globalThis.__reviewCanvas = async () => { throw new SyntaxError('Expected comma at position 165') }
  const result = await generate('流程图')
  assert.equal(result.elements[0].id, 'mermaid')
  assert.deepEqual(result.warnings, ['视觉复核未完成，已保留生成结果'])
})

test('Mermaid 11.14+ renderId 前缀剥离与 subgraph 规范化防止 SubGraph element not found', async () => {
  let mermaidNativeSource = await readFile(new URL('../../src/utils/diagrams/mermaidNative.js', import.meta.url), 'utf8')
  mermaidNativeSource = mermaidNativeSource
    .replace(/^import .*$/gm, '')
  mermaidNativeSource = `
const parseMermaidToExcalidraw = async () => ({ elements: [] })
const convertToExcalidrawElements = x => x
const logger = { log() {}, warn() {} }
` + mermaidNativeSource
  const {
    stripMermaidRenderIdPrefix,
    sanitizeMermaidCode,
  } = await import(`data:text/javascript;base64,${Buffer.from(mermaidNativeSource).toString('base64')}`)

  // 1) stripMermaidRenderIdPrefix 剥离 cluster/node/edge 上的 renderId 前缀，同时保留 filter/gradient
  const rawSvg = [
    '<svg id="mermaid-to-excalidraw-0">',
    '<defs>',
    '<filter id="mermaid-to-excalidraw-0-drop-shadow"></filter>',
    '<linearGradient id="mermaid-to-excalidraw-0-gradient"></linearGradient>',
    '<marker id="mermaid-to-excalidraw-0_flowchart-v2-pointEnd"></marker>',
    '</defs>',
    '<g class="cluster" id="mermaid-to-excalidraw-0-SG1"><rect/></g>',
    '<g class="node default" id="mermaid-to-excalidraw-0-flowchart-A-0"></g>',
    '<path id="mermaid-to-excalidraw-0-L_A_B_0" data-edge="true"/>',
    '</svg>',
  ].join('')
  const strippedSvg = stripMermaidRenderIdPrefix(rawSvg, 'mermaid-to-excalidraw-0')
  assert.match(strippedSvg, /<g class="cluster" id="SG1">/)
  assert.match(strippedSvg, /<g class="node default" id="flowchart-A-0">/)
  assert.match(strippedSvg, /<path id="L_A_B_0" data-edge="true"\/>/)
  assert.match(strippedSvg, /<filter id="mermaid-to-excalidraw-0-drop-shadow">/)
  assert.match(strippedSvg, /<linearGradient id="mermaid-to-excalidraw-0-gradient">/)

  // 2) sanitizeMermaidCode 规范化各种不规范 subgraph 写法并剔除空 subgraph
  const dirtyDsl = `flowchart TD
  subgraph["感知层 (Sensor)"]
    A[摄像头: 输入] --> B[雷达]
  end
  subgraph 核心处理层
    B --> C{决策引擎}
  end
  subgraph EmptyGroup ["空分组"]
  end
  style 核心处理层 fill:#f9f,stroke:#333`
  const sanitized = sanitizeMermaidCode(dirtyDsl)
  assert.doesNotMatch(sanitized, /_subgraph/)
  assert.match(sanitized, /subgraph sg_1 \["感知层 \(Sensor\)"\]/)
  assert.match(sanitized, /subgraph sg_2 \["核心处理层"\]/)
  assert.doesNotMatch(sanitized, /EmptyGroup/)
  assert.match(sanitized, /style sg_2 fill:#f9f,stroke:#333/)
})
