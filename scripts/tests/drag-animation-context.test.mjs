import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const source = await readFile(new URL('../../src/hooks/useDragAnimation.js', import.meta.url), 'utf8')
const { DragAnimationContext, useDragAnimation } = await import(
  `data:text/javascript;base64,${Buffer.from(source.replace("'react'", JSON.stringify(import.meta.resolve('react')))).toString('base64')}`
)
const Consumer = ({ expected }) => {
  assert.equal(useDragAnimation(), expected)
  return null
}

test('drag consumers read the actual provider value', () => {
  const value = { createAnimatedDragHandler: () => {} }
  renderToStaticMarkup(createElement(DragAnimationContext.Provider, { value }, createElement(Consumer, { expected: value })))
})

test('nested windows keep their own drag state', () => {
  const outer = { dragState: { isDragging: true } }
  const inner = { dragState: { isDragging: false } }
  renderToStaticMarkup(createElement(DragAnimationContext.Provider, { value: outer },
    createElement(Consumer, { expected: outer }),
    createElement(DragAnimationContext.Provider, { value: inner }, createElement(Consumer, { expected: inner }))))
})

test('a genuinely missing provider still fails explicitly', () => {
  assert.throws(() => renderToStaticMarkup(createElement(Consumer)), /must be used within a DragAnimationProvider/)
})

test('provider and list consumers share the non-visual context module', async () => {
  const provider = await readFile(new URL('../../src/components/common/DragAnimationProvider.jsx', import.meta.url), 'utf8')
  assert.match(provider, /import \{ DragAnimationContext \} from '\.\.\/\.\.\/hooks\/useDragAnimation'/)
  assert.doesNotMatch(provider, /createContext|export const useDragAnimation/)
  for (const file of ['notes/NoteList.jsx', 'todos/TodoList.jsx']) {
    const consumer = await readFile(new URL(`../../src/components/${file}`, import.meta.url), 'utf8')
    assert.match(consumer, /import \{ useDragAnimation \} from '\.\.\/\.\.\/hooks\/useDragAnimation'/)
  }
})
