import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AIChatService = require('../../electron/services/aichat/index.js')

const html = (name, body = '<div>hi</div>') => `<!doctype html><html><head><script type="application/flota-widget">{"name":"${name}","description":"d","icon":"widget","sizes":["compact","full"],"libs":[],"data":{}}</script></head><body>${body}</body></html>`

const setup = ({ problems = [] } = {}) => {
  const svc = Object.create(AIChatService.prototype)
  svc.logger = { warn() {} }
  const drafts = new Map()
  const discarded = []
  svc._widgetService = {
    createDraft(code, opts) {
      if (!/application\/flota-widget/.test(code)) throw new Error('缺少组件清单')
      const id = `__draft__${drafts.size + 1}`
      drafts.set(id, { code, ...opts })
      return id
    },
    discardDraft(id) { discarded.push(id); drafts.delete(id) },
    getWidget(id) { if (id !== 'w1') throw new Error('组件不存在'); return { id, code: html('计数器', '<div id="n">0</div>') } },
    dao: { listInstances: (id) => (id === 'w1' ? [{ id: 'i1' }, { id: 'i2' }] : []) },
  }
  const checks = []
  svc._widgetChecker = async (payload) => { checks.push(payload); return problems }
  const cards = []
  svc._pendingActions = { create: async (name, args) => { cards.push({ name, args }); return { requiresConfirmation: true, actionId: 'a1', name, args, confirmationHint: 'x' } } }
  return { svc, drafts, discarded, checks, cards }
}

test('create_widget: agent-written HTML is drafted, pre-run per declared size, and only then becomes a card', async () => {
  const { svc, checks, cards } = setup()
  const res = await svc._proposeWidget('create_widget', { code: html('喝水记录'), instance_name: '我' }, null)
  assert.equal(res.requiresConfirmation, true)
  assert.deepEqual(checks[0].sizes, ['compact', 'full'])
  assert.equal(cards[0].args.draft_id, '__draft__1')
  assert.equal(cards[0].args.widget_name, '喝水记录')
  assert.match(cards[0].args.code, /喝水记录/, 'card keeps the code so an expired draft can be rebuilt')
  assert.equal(res.confirmationHint, undefined)
  assert.match(res.checked, /compact \/ full/)
})

test('create_widget: invalid code or failed pre-run returns the problems and leaves no card or draft behind', async () => {
  let ctx = setup()
  let res = await ctx.svc._proposeWidget('create_widget', { code: '<html></html>' }, null)
  assert.equal(res.success, false)
  assert.match(res.error, /没有通过检查：缺少组件清单/)
  assert.equal(ctx.cards.length, 0)

  ctx = setup({ problems: [{ message: '[首页卡片（compact） 浅色 320px] TypeError: x is undefined', stack: 'at render (widget.html:12)' }] })
  res = await ctx.svc._proposeWidget('create_widget', { code: html('坏的') }, null)
  assert.equal(res.success, false)
  assert.match(res.error, /预跑没有通过.*compact.*TypeError: x is undefined/s)
  assert.match(res.error, /widget\.html:12/)
  assert.deepEqual(ctx.discarded, ['__draft__1'])
  assert.equal(ctx.cards.length, 0)
})

test('update_widget: edits apply to the current code, preview uses an instance copy, bad edits are explained', async () => {
  const ctx = setup()
  const res = await ctx.svc._proposeWidget('update_widget', { id: 'w1', summary: '加一键 +1', instance_id: 'i2', edits: [{ search: '<div id="n">0</div>', replace: '<div id="n">0</div><button>+1</button>' }] }, null)
  assert.equal(res.requiresConfirmation, true)
  assert.match(ctx.drafts.get('__draft__1').code, /<button>\+1<\/button>/)
  assert.equal(ctx.drafts.get('__draft__1').widgetId, 'w1')
  assert.equal(ctx.drafts.get('__draft__1').cloneDataFrom, 'i2')
  assert.equal(ctx.cards[0].args.edits, undefined, 'card stores the resolved full code, not the edits')
  const bad = await ctx.svc._proposeWidget('update_widget', { id: 'w1', summary: 'x', edits: [{ search: '不存在的代码', replace: 'y' }] }, null)
  assert.equal(bad.success, false)
  assert.match(bad.error, /SEARCH 在原代码中找不到/)
  assert.match((await ctx.svc._proposeWidget('update_widget', { id: 'nope', summary: 'x', code: html('a') }, null)).error, /组件不存在/)
})

test('widgets skill hands the model the SDK doc', () => {
  const { createSkillSession } = require('../../electron/services/aichat/skills.js')
  const res = createSkillSession().read('widgets')
  assert.match(res.instructions, /Flota 组件开发规范/)
  assert.match(res.instructions, /组件代码由你直接写出/)
})
