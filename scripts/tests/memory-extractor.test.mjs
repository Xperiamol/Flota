import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { MemoryExtractor } = createRequire(import.meta.url)('../../electron/services/aichat/memoryExtractor.js');

const preference = '我长期习惯用中文交流，回答时请尽量简洁。';
const operation = { op: 'add', layer: 'profile', content: '用户长期偏好简洁的中文回答', durable: true, confidence: .95, evidence: preference };
function fixture(operations = [operation], existing = []) {
  const calls = { search: 0, generate: [], saved: [], deleted: [] };
  const mem0Service = {
    isAvailable: () => true, getSetting: () => true,
    searchMemories: async () => { calls.search++; return existing; },
    addMemory: async (...args) => { calls.saved.push(args); return { success: true, id: 2 }; },
    softDeleteMemory: (id) => { calls.deleted.push(id); return { previousContent: '旧偏好' }; },
  };
  const extractor = new MemoryExtractor({ mem0Service, generate: async (messages) => {
    calls.generate.push(messages); return { content: JSON.stringify({ operations }) };
  } });
  const turn = (text, conversationId = 'one', extra = {}) => extractor.processTurn({ conversationId, messages: [{ role: 'user', content: text }], ...extra });
  return { extractor, calls, turn, mem0Service };
}

test('ordinary tasks and troubleshooting do not even invoke extraction', async () => {
  const { calls, turn } = fixture();
  for (const text of ['把按钮改成蓝色，布局紧凑一点', '同步报错了，请检查并修复', '今天写完这份报告，明天提交', '帮我翻译这篇很长很长的笔记']) assert.deepEqual(await turn(text), []);
  assert.equal(calls.search, 0);
  assert.equal(calls.generate.length, 0);
});

test('eligible automatic extraction is limited across conversations, explicit requests bypass cooldown', async () => {
  const { calls, turn } = fixture();
  const results = await Promise.all([turn(preference), turn(preference, 'two')]);
  assert.equal(results.flat().length, 1);
  assert.equal(calls.generate.length, 1);
  assert.equal((await turn('请记住：我喜欢简洁的中文回答。')).length, 1);
  assert.equal(calls.saved.length, 2);
});

test('automatic extraction resumes after cooldown', async () => {
  const { extractor, turn, calls } = fixture();
  await turn(preference);
  extractor._lastAutoAttempt = Date.now() - 300001;
  await turn(preference);
  assert.equal(calls.generate.length, 2);
});

for (const patch of [{ durable: false }, { confidence: .7 }, { confidence: undefined }, { evidence: undefined }, { evidence: '模型猜测的用户偏好' }, { layer: 'episodic' }]) {
  test(`reject unsupported automatic memory: ${JSON.stringify(patch)}`, async () => {
    const { turn, calls } = fixture([{ ...operation, ...patch }]);
    assert.deepEqual(await turn(preference), []);
    assert.equal(calls.saved.length, 0);
  });
}

test('at most one operation is stored and assistant output is not evidence', async () => {
  const { turn, calls } = fixture([operation, operation]);
  await turn(preference, 'one', { assistantText: '助手建议用户改行当程序员' });
  assert.equal(calls.saved.length, 1);
  assert.ok(!JSON.stringify(calls.generate).includes('助手建议用户改行'));
});

test('deletion requires an explicit forget request and a retrieved memory', async () => {
  const existing = [{ id: 7, content: '旧偏好', memory_layer: 'profile' }];
  const { turn, calls } = fixture([{ op: 'delete', id: 7 }], existing);
  await turn('请记住：我喜欢简洁的中文回答。');
  assert.deepEqual(calls.deleted, []);
  await turn('请忘掉我的旧偏好');
  assert.deepEqual(calls.deleted, [7]);
  const unknown = fixture([{ op: 'delete', id: 99 }], existing);
  await unknown.turn('请忘掉我的旧偏好');
  assert.deepEqual(unknown.calls.deleted, []);
});

test('sensitive input and disabled memory do not invoke extraction', async () => {
  const { turn, calls, mem0Service } = fixture();
  await turn('请记住我的密码是: private-password');
  mem0Service.getSetting = () => false;
  await turn(preference);
  assert.equal(calls.search, 0);
});
