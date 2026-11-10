import NoteEditor from '../../src/components/editor/NoteEditor'
import TodoReferenceDialogs from '../../src/components/todos/TodoReferenceDialogs'
import { openNoteLink } from '../../src/utils/linkUtils'
import NoteList from '../../src/components/notes/NoteList'
import { DragAnimationProvider } from '../../src/components/common/DragAnimationProvider'
import { flushSync } from 'react-dom'
import React, { createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Box, CssBaseline, ThemeProvider } from '@mui/material'
import { createAppTheme } from '../../src/styles/theme'
import { ErrorProvider } from '../../src/components/common/ErrorProvider'
import WYSIWYGEditor from '../../src/components/editor/WYSIWYGEditor'
import TodoFormFields from '../../src/components/todos/TodoFormFields'
import { useStore } from '../../src/store/useStore'
import { getImageResolver } from '../../src/utils/ImageProtocolResolver'
import { refreshTodoReferences } from '../../src/hooks/useTodoReferences'

let rows = [{ id: 41, sync_id: 'task-stable-1', content: '准备产品演示', description: '[产品方案](app://note/note-stable-1)', is_completed: 0, repeat_type: 'none' }]
let createdCount = 0
const listeners = new Set()
window.electronAPI = {
  invoke: async (channel, ...args) => {
    if (channel === 'todo:getAll') return { success: true, data: structuredClone(rows) }
    if (channel === 'todo:toggleComplete') { rows[0].is_completed = Number(!rows[0].is_completed); listeners.forEach(fn => fn()); return { success: true, data: structuredClone(rows[0]) } }
    if (channel === 'todo:getSubtasks') return { success: true, data: [] }
    if (channel === 'todo:getTagSuggestions') return { success: true, data: [] }
    if (channel === 'todo:create') { const index = createdCount++; const row = { id: 42 + index, sync_id: index ? `task-created-${index}` : 'task-created', ...args[0], is_completed: 0 }; rows.push(row); listeners.forEach(fn => fn()); return { success: true, data: row } }
    if (channel === 'image:save-from-buffer') { await new Promise(resolve => setTimeout(resolve, 250)); return { success: true, data: 'images/demo.png' } }
    return { success: true, data: {} }
  },
  on: (channel, fn) => { if (channel === 'todo:changed') listeners.add(fn) },
  removeListener: (_, fn) => listeners.delete(fn),
  settings: { get: async () => ({ success: true, data: null }) },
  images: {
    saveFromBuffer: async () => { await new Promise(r=>setTimeout(r,250)); return { success: true, data: 'images/demo.png' } },
    getBase64: async () => ({ success: true, data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' }),
  },
}
// The browser has no app:// protocol; serve only the test fixture through the same image NodeView.
const resolveImage = getImageResolver().resolve.bind(getImageResolver())
getImageResolver().resolve = src => src === 'images/demo.png' ? Promise.resolve('/png/christmas-tree.png') : resolveImage(src)
useStore.setState({ notes: [{ id: 17, sync_id: 'note-stable-1', title: '产品方案', content: '项目资料', note_type: 'markdown' }] })
const ref = createRef(), formRef = createRef()
const root = createRoot(document.getElementById('root'))
let editor
const wrap = children => <ThemeProvider theme={createAppTheme(window.demoMode || 'light')}><CssBaseline /><ErrorProvider>{children}</ErrorProvider></ThemeProvider>
function Form() {
  const [value, setValue] = useState({ content: '准备产品演示', description: '整理参考资料', repeat_type: 'none' })
  return <TodoFormFields ref={formRef} identity="demo" value={value} onChange={setValue} getTagSuggestions={async () => []} />
}
window.mountTodoDemo = mode => {
  editor = null
  root.render(wrap(<Box sx={{ width: '100%', maxWidth: 620, mx: 'auto', p: 3 }}>{mode === 'form' ? <Form /> : <WYSIWYGEditor key={mode} noteId={17} ref={ref} content={'# 项目计划\n\n[准备产品演示](app://todo/task-stable-1)\n\n会议后的下一步行动。'} onChange={() => {}} onEditorReady={e => { editor = e }} />}</Box>))
}
window.mountNoteDetailsDemo = (linked = true) => {
  const note = { id: 17, sync_id: 'note-stable-1', title: '产品方案', content: linked ? '项目资料\n\n[准备产品演示](app://todo/task-stable-1)' : '项目资料', note_type: 'markdown' }
  rows[0].description = linked ? '[产品方案](app://note/note-stable-1)' : ''
  useStore.setState({ notes: [note], selectedNoteId: 17, currentView: 'notes', editorMode: 'wysiwyg', aiCommandCenterEnabled: false, initializeSettings: async () => {}, updateNote: async (id, updates) => { useStore.setState(state => ({ notes: state.notes.map(item => item.id === id ? { ...item, ...updates } : item) })); return { ...note, ...updates } } })
  root.render(wrap(<DragAnimationProvider><Box sx={{ height: '100vh', p: 2 }}><NoteEditor key={String(linked)} /></Box></DragAnimationProvider>))
  refreshTodoReferences()
}
const wait = async fn => { for(let i=0;i<150;i++) { if(fn()) return; await new Promise(r=>setTimeout(r,30)) } throw Error('UI timeout') }
window.runTodoTests = async () => {
  const results=[]
  const test=async(name,fn)=>{try{await fn();results.push({name,ok:true})}catch(e){results.push({name,ok:false,error:e.stack})}}
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)}
  await wait(()=>editor && document.querySelector('[data-node-view-wrapper] input[type=checkbox]'))
  await test('stable task reference renders and round-trips', async()=>{
    assert(editor.state.doc.toJSON().content.some(n=>n.type==='todoEmbed'),'embed missing')
    const markdown=ref.current.getMarkdown()
    assert(markdown.includes('app://todo/task-stable-1'),'stable reference lost')
    editor.commands.setContent(markdown)
    assert(editor.state.doc.toJSON().content.some(n=>n.type==='todoEmbed'),'reload lost reference')
  })
  await test('checkbox updates the original task', async()=>{
    document.querySelector('[data-node-view-wrapper] input[type=checkbox]').click()
    await wait(()=>rows[0].is_completed===1)
    await wait(()=>document.querySelector('[data-node-view-wrapper] input[type=checkbox]').checked)
  })
  await test('background refresh does not discard a task detail draft', async()=>{
    const card=document.querySelector('[data-node-view-wrapper]')
    const titleButton=[...card.querySelectorAll('button')].find(b=>b.textContent.includes('准备产品演示'))
    titleButton.click()
    await wait(()=>document.querySelector('[role=dialog] .ProseMirror'))
    const detailEditor=document.querySelector('[role=dialog] .ProseMirror').editor
    detailEditor.commands.insertContent('未保存的修改')
    listeners.forEach(fn=>fn())
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    assert(document.querySelector('[role=dialog] .ProseMirror').textContent.includes('未保存的修改'),'background refresh discarded draft')
    const cancel=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='取消')
    cancel.click();await wait(()=>!document.querySelector('[role=dialog]'))
  })
  await test('deleted task preserves reference and presents missing state', async()=>{
    rows=[];await refreshTodoReferences();await wait(()=>document.body.textContent.includes('待办已删除或尚未同步'))
    assert(ref.current.getMarkdown().includes('app://todo/task-stable-1'),'deleted reference erased')
  })
  await test('selected text creates linked task without replacing existing tasks', async()=>{
    editor.chain().focus().setTextSelection({from:2,to:6}).run()
    editor.commands.requestTodoReference()
    await wait(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='新建并插入'))
    document.querySelectorAll('[role=dialog] button').forEach(b=>{if(b.textContent==='新建并插入')b.click()})
    await wait(()=>rows.some(r=>r.sync_id==='task-created'))
    assert(rows[0].description.includes('app://note/note-stable-1'),'source note not linked')
    await wait(()=>!document.querySelector('[role=dialog]'))
    assert(ref.current.getMarkdown().includes('app://todo/task-created'),'created task not embedded')
  })
  await test('task form flushes final keystrokes before debounce', async()=>{
    window.mountTodoDemo('form');await wait(()=>formRef.current && document.querySelector('.ProseMirror'))
    const dom=document.querySelector('.ProseMirror'), ed=dom.editor
    // TipTap attaches editor on DOM; use actual ProseMirror transaction, then immediately snapshot form.
    assert(ed,'editor not mounted')
    ed.commands.insertContent('最后输入')
    const snapshot=await formRef.current.getValue()
    assert(snapshot.description.includes('最后输入'),'last text dropped')
  })
  await test('saving waits for an in-flight image import', async()=>{
    const input=document.querySelector('input[type=file]')
    const transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'demo.png',{type:'image/png'}));input.files=transfer.files
    input.dispatchEvent(new Event('change',{bubbles:true}))
    const started=performance.now()
    const snapshot=await formRef.current.getValue()
    assert(performance.now()-started>=200,'save did not await image')
    assert(snapshot.description.includes('images/demo.png'),'image reference dropped')
  })
  await test('saving also waits for a pasted screenshot', async()=>{
    const editorElement=document.querySelector('.ProseMirror')
    const clipboard=new DataTransfer();clipboard.items.add(new File(['fixture'],'pasted.png',{type:'image/png'}))
    const before=(await formRef.current.getValue()).description.match(/images\/demo.png/g)?.length || 0
    editorElement.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}))
    const snapshot=await formRef.current.getValue()
    assert((snapshot.description.match(/images\/demo.png/g)?.length || 0)>before,'pasted image was not awaited')
  })
  await test('note association stores the stable note ID', async()=>{
    const linkButton=[...document.querySelectorAll('button')].find(b=>b.textContent==='关联笔记')
    linkButton.click()
    await wait(()=>document.querySelector('[role=dialog]'))
    const noteButton=[...document.querySelectorAll('[role=dialog] [role=button]')].find(b=>b.textContent.includes('产品方案'))
    noteButton.click()
    await new Promise(r=>setTimeout(r,30))
    const confirm=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='关联')
    confirm.click()
    await wait(()=>!document.querySelector('[role=dialog]'))
    const snapshot=await formRef.current.getValue()
    assert(snapshot.description.includes('app://note/note-stable-1'),'association used a local database ID')
  })
  await test('note list embed round-trips and creates a linked task in place', async()=>{
    window.mountTodoDemo('note');await wait(()=>editor && !editor.isDestroyed)
    editor.commands.requestTodoReference()
    await wait(()=>document.querySelector('[role=dialog]'))
    const listButton=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='待办清单')
    listButton.click();await new Promise(r=>setTimeout(r,30))
    const confirm=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='插入清单')
    confirm.click();await wait(()=>!document.querySelector('[role=dialog]'))
    assert(editor.state.doc.toJSON().content.some(n=>n.type==='todoListEmbed'),'list embed missing')
    assert(ref.current.getMarkdown().includes('app://todo-list/note%2Fnote-stable-1'),'list scope not stored')
    const field=document.querySelector('input[placeholder="添加一条待办…"]')
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
    setter.call(field,'在笔记中新增任务');field.dispatchEvent(new Event('input',{bubbles:true}))
    await new Promise(r=>setTimeout(r,30))
    document.querySelector('[aria-label="新增清单待办"]').click()
    await wait(()=>rows.some(t=>t.content==='在笔记中新增任务'))
    assert(rows.find(t=>t.content==='在笔记中新增任务').description.includes('app://note/note-stable-1'),'list add lost source')
    const markdown=ref.current.getMarkdown();editor.commands.setContent(markdown)
    assert(editor.state.doc.toJSON().content.some(n=>n.type==='todoListEmbed'),'list lost on reload')
  })
  await test('list progress and completed visibility follow original task state', async()=>{
    const bar=document.querySelector('[role=progressbar]')
    const list=bar.closest('[data-node-view-wrapper]')
    const checkbox=[...list.querySelectorAll('input[type=checkbox]')].find(input=>!input.checked&&!input.disabled&&!input.closest('label'))
    // MUI wraps every checkbox in a span; only the final visibility control has an outer label.
    const rowCheckbox=list.querySelector('input[aria-label="完成待办"]')
    assert(rowCheckbox,'no actionable list task')
    rowCheckbox.click()
    await wait(()=>Number(bar.getAttribute('aria-valuenow'))>0)
    const visibleToggle=list.querySelector('label input[type=checkbox]')
    visibleToggle.click()
    await wait(()=>list.querySelector('input[aria-label="恢复待办"]'))
  })
  await test('note deletion retains an exiting row, then closes the gap', async()=>{
    const demoNotes=[1,2,3].map(id=>({id,sync_id:`animation-${id}`,title:`动画笔记${id}`,content:'列表动画检查',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}))
    useStore.setState({notes:demoNotes,isLoading:false,selectedNoteId:2,loadNotes:async()=>{}})
    root.render(wrap(<DragAnimationProvider><Box sx={{height:600,width:340}}><NoteList /></Box></DragAnimationProvider>))
    await wait(()=>document.body.textContent.includes('动画笔记2'))
    const target=[...document.querySelectorAll('li')].find(e=>e.textContent.includes('动画笔记2'))
    const next=[...document.querySelectorAll('li')].find(e=>e.textContent.includes('动画笔记3'))
    const oldY=next.getBoundingClientRect().top
    flushSync(()=>useStore.setState({notes:[demoNotes[0],demoNotes[2]],selectedNoteId:3}))
    assert(target.isConnected,'row removed before exit animation')
    await wait(()=>!target.isConnected)
    assert(next.getBoundingClientRect().top<oldY,'neighbor did not move into deleted space')
    useStore.setState({notes:[]})
    await wait(()=>document.querySelectorAll('li.MuiCollapse-root').length===0)
  })
  await test('Markdown list links open the same interactive list in a dialog', async()=>{
    root.render(wrap(<TodoReferenceDialogs />))
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    await openNoteLink('app://todo-list/all')
    await wait(()=>document.querySelector('[role=dialog] input[placeholder="添加一条待办…"]'))
    assert(document.querySelector('[aria-label="关闭待办清单"]'),'list close control missing')
    document.querySelector('[aria-label="关闭待办清单"]').click()
    await wait(()=>!document.querySelector('[role=dialog]'))
  })
  window.todoTestResults=results
  return results
}
window.mountTodoDemo('note')

window.testReady = true
window.runEditorTests = window.runTodoTests

window.checkReducedRemoval = async () => {
  const demo=[{id:901,sync_id:'reduced-note',title:'减少动态效果检查',content:'内容',created_at:new Date().toISOString()}]
  useStore.setState({notes:demo,isLoading:false,selectedNoteId:901,loadNotes:async()=>{}})
  root.render(wrap(<DragAnimationProvider><Box sx={{height:600,width:340}}><NoteList /></Box></DragAnimationProvider>))
  await wait(()=>document.body.textContent.includes('减少动态效果检查'))
  useStore.setState({notes:[],selectedNoteId:null})
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
  return !document.body.textContent.includes('减少动态效果检查')
}
