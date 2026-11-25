// @vitest-environment jsdom
/** Static desktop workbench shell: both columns, draft field, and column resize. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchView } from '../src/client/activity.ts'
import { zh } from '../src/client/locales/workbench.ts'
import { WorkbenchShell, type WorkbenchText } from '../src/client/WorkbenchShell.tsx'

const idle: WorkbenchView = {
  steps: [{ id: 'waiting', title: '', status: 'waiting' }],
  trace: [],
  file: null,
  sending: false,
  failed: false,
}

const t: WorkbenchText = (key, params) => {
  const template = zh[key]
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function pointer(element: Element, type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture', clientX: number, pointerId = 1, button = 0): void {
  fireEvent[type](element, { clientX, pointerId, button, buttons: button === 0 ? 1 : 0 })
}

function installPointerCapture(): void {
  const captured = new WeakMap<Element, number>()
  Element.prototype.setPointerCapture = function (this: Element, id: number) { captured.set(this, id) }
  Element.prototype.releasePointerCapture = function (this: Element) { captured.delete(this) }
  Element.prototype.hasPointerCapture = function (this: Element, id: number) { return captured.get(this) === id }
}

let shellWidth = 1440

afterEach(() => {
  shellWidth = 1440
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function installMeasurement(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: shellWidth, height: 800, top: 0, left: 0, right: shellWidth, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
  }))
  class ResizeObserverStub {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(): void { this.callback([], this as unknown as ResizeObserver) }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
}

describe('WorkbenchShell', () => {
  afterEach(() => { cleanup() })

  function mount(view: WorkbenchView = idle, send: (text: string) => Promise<boolean> = () => Promise.resolve(true)) {
    installPointerCapture()
    installMeasurement()
    const rendered = render(<WorkbenchShell t={t} useActivity={selector => selector(view)} send={send} />)
    const handle = rendered.getByRole('separator', { name: zh['resize.label'] })
    return { ...rendered, handle }
  }

  it('shows the rail, an empty workflow, and sends a draft', async () => {
    const send = vi.fn(() => Promise.resolve(true))
    const { getByRole, getByLabelText } = mount(idle, send)
    expect(getByRole('navigation', { name: zh['rail.label'] }).querySelector('[aria-current="page"]')?.getAttribute('aria-label'))
      .toBe(zh['rail.workflow'])
    expect(getByRole('heading', { name: zh['section.workflow'] })).toBeTruthy()
    expect(getByRole('heading', { name: zh['section.trajectory'] })).toBeTruthy()
    expect(document.querySelector('[data-workbench-step="waiting"]')?.textContent).toContain(zh['step.waiting.title'])
    expect(getByLabelText(zh['editor.label']).textContent).toContain(zh['editor.empty'])
    expect(document.querySelectorAll('[data-window-drag]')).toHaveLength(2)
    expect(document.querySelector('[data-dsh-workbench]')).not.toBeNull()
    const draft = getByRole('textbox', { name: zh['composer.label'] }) as HTMLTextAreaElement
    const button = () => getByRole('button', { name: zh['composer.send'] }) as HTMLButtonElement
    expect(button().disabled).toBe(true)
    fireEvent.change(draft, { target: { value: '  ' } })
    expect(button().disabled).toBe(true)
    fireEvent.change(draft, { target: { value: '继续补测试' } })
    expect(button().disabled).toBe(false)
    fireEvent.click(button())
    expect(send).toHaveBeenCalledExactlyOnceWith('继续补测试')
    await vi.waitFor(() => { expect(draft.value).toBe('') })
  })

  it('renders a running step, its trace, and the file being written', () => {
    const running: WorkbenchView = {
      steps: [
        { id: 'todo-0', title: '编写核心模块', status: 'active', detail: 'writing', path: 'src/lib/split.ts' },
        { id: 'todo-1', title: '补充测试', status: 'waiting' },
      ],
      trace: [{ id: 'edit', kind: 'edit', action: 'edit', path: 'src/lib/split.ts', lines: '18-42', time: '14:32:05', status: 'running' }],
      file: {
        path: 'src/lib/split.ts',
        crumbs: ['src', 'lib', 'split.ts'],
        badge: 'TS',
        lines: ["throw new Error('amount')"],
        annotated: [1],
        cursorLine: 1,
        cursorColumn: 1,
      },
      sending: false,
      failed: false,
    }
    const { getByLabelText } = mount(running)
    const active = document.querySelector('[data-workbench-step="todo-0"]')
    expect(active?.getAttribute('data-status')).toBe('active')
    expect(active?.textContent).toContain('正在写入 src/lib/split.ts')
    expect(document.querySelector('[data-workbench-step="todo-1"]')?.textContent).not.toContain(':')
    expect(document.querySelector('[data-workbench-trace="edit"]')?.textContent).toContain('行 18-42')
    expect(getByLabelText(zh['editor.label']).textContent).toContain("throw new Error('amount')")
    expect(getByLabelText(zh['editor.label']).textContent).toContain(zh['editor.written'])
    expect(getByLabelText(zh['editor.label']).textContent).toContain('Ln 1, Col 1')
  })

  it('keeps a refused draft and renders the other step and trace labels', async () => {
    const send = vi.fn(() => Promise.resolve(false))
    const view: WorkbenchView = {
      steps: [
        { id: 'done', title: '解析需求', status: 'done', time: '14:28' },
        { id: 'turn-2', title: '', turn: 2, status: 'error', detail: 'editing', path: 'notes' },
      ],
      trace: [
        { id: 'write', kind: 'write', action: 'write', path: 'notes', time: '14:32:09', status: 'done' },
        { id: 'todo', kind: 'todo_write', action: 'todo', time: '14:32:10', status: 'done' },
        { id: 'bash', kind: 'bash', action: 'call', time: '14:32:11', status: 'done' },
        { id: 'bare-edit', kind: 'edit', action: 'edit', path: 'notes', time: '14:32:12', status: 'done' },
      ],
      file: {
        path: 'notes', crumbs: ['notes'], badge: '', lines: ['// note', 'const n = 2'], annotated: [2],
        cursorLine: 2, cursorColumn: 1,
      },
      sending: true,
      failed: true,
    }
    const { getByRole, getByLabelText } = mount(view, send)
    expect(document.querySelector('[data-workbench-step="turn-2"]')?.textContent).toContain('第 2 轮')
    expect(document.querySelector('[data-workbench-step="turn-2"]')?.textContent).toContain('正在修改 notes')
    expect(document.querySelector('[data-workbench-step="turn-2"]')?.textContent).toContain(zh['status.error'])
    expect(document.querySelector('[data-workbench-trace="todo"]')?.textContent).toContain(zh['trajectory.todo'])
    expect(document.querySelector('[data-workbench-trace="bash"]')?.textContent).toContain('bash')
    expect(getByRole('alert').textContent).toBe(zh['composer.failed'])
    expect(getByLabelText(zh['editor.label']).textContent).not.toContain(zh['editor.written'].repeat(2))
    const draft = getByRole('textbox', { name: zh['composer.label'] }) as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: '留下' } })
    expect((getByRole('button', { name: zh['composer.send'] }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(draft, { key: 'Enter', shiftKey: true })
    expect(send).not.toHaveBeenCalled()
    const idleSend = vi.fn(() => Promise.resolve(false))
    cleanup()
    const next = mount(idle, idleSend)
    const nextDraft = next.getByRole('textbox', { name: zh['composer.label'] }) as HTMLTextAreaElement
    fireEvent.keyDown(nextDraft, { key: 'Enter' })
    fireEvent.change(nextDraft, { target: { value: '留下' } })
    fireEvent.keyDown(nextDraft, { key: 'Enter' })
    await vi.waitFor(() => { expect(idleSend).toHaveBeenCalledExactlyOnceWith('留下') })
    expect(nextDraft.value).toBe('留下')
    cleanup()
    let accept: (value: boolean) => void = () => {}
    const racing = mount(idle, () => new Promise(resolve => { accept = resolve }))
    const racingDraft = racing.getByRole('textbox', { name: zh['composer.label'] }) as HTMLTextAreaElement
    fireEvent.change(racingDraft, { target: { value: '先写' } })
    fireEvent.keyDown(racingDraft, { key: 'Enter' })
    fireEvent.change(racingDraft, { target: { value: '先写更多' } })
    accept(true)
    await vi.waitFor(() => { expect(racingDraft.value).toBe('先写更多') })
  })

  it('resizes the workflow column from the pointer and the keyboard', () => {
    const { handle, unmount } = mount()
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    fireEvent.keyDown(handle, { key: 'a' })
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle.getAttribute('aria-valuenow')).toBe('456')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    pointer(handle, 'pointerDown', 0, 1, 2)
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    pointer(handle, 'pointerMove', 80)
    pointer(handle, 'pointerUp', 80)
    pointer(handle, 'lostPointerCapture', 1)
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    pointer(handle, 'pointerDown', 100)
    pointer(handle, 'pointerDown', 100, 2)
    pointer(handle, 'pointerMove', 140, 2)
    pointer(handle, 'pointerUp', 140, 2)
    pointer(handle, 'pointerCancel', 140, 2)
    pointer(handle, 'lostPointerCapture', 0, 2)
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    pointer(handle, 'pointerMove', 130)
    expect(handle.getAttribute('aria-valuenow')).toBe('470')
    pointer(handle, 'lostPointerCapture', 1)
    pointer(handle, 'pointerUp', 200)
    expect(handle.getAttribute('aria-valuenow')).toBe('470')
    pointer(handle, 'pointerDown', 0)
    handle.releasePointerCapture(1)
    pointer(handle, 'pointerUp', 400)
    expect(handle.getAttribute('aria-valuenow')).toBe('870')
    expect(handle.getAttribute('aria-valuemax')).toBe('1184')
    pointer(handle, 'pointerDown', 1000)
    pointer(handle, 'pointerCancel', -1000)
    expect(handle.getAttribute('aria-valuenow')).toBe('200')
    pointer(handle, 'pointerDown', 0)
    unmount()
    expect(handle.hasPointerCapture(1)).toBe(false)
  })

  it('fits both columns inside the desktop minimum window', () => {
    shellWidth = 520
    const wide = mount()
    expect(wide.handle.getAttribute('aria-valuemin')).toBe('200')
    expect(wide.handle.getAttribute('aria-valuemax')).toBe('264')
    expect(wide.handle.getAttribute('aria-valuenow')).toBe('264')
    fireEvent.keyDown(wide.handle, { key: 'ArrowRight' })
    expect(wide.handle.getAttribute('aria-valuenow')).toBe('264')
    wide.unmount()
    shellWidth = 300
    const narrow = mount()
    expect(narrow.handle.getAttribute('aria-valuenow')).toBe('122')
    narrow.unmount()
    shellWidth = 40
    const cramped = mount()
    expect(cramped.handle.getAttribute('aria-valuenow')).toBe('0')
  })

  it('ignores a zero shell measurement', () => {
    shellWidth = 0
    const { handle } = mount()
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
  })

  it('keeps the preferred width until the shell is measured', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    installPointerCapture()
    const view = render(<WorkbenchShell t={t} useActivity={selector => selector(idle)} send={() => Promise.resolve(true)} />)
    const handle = view.getByRole('separator', { name: zh['resize.label'] })
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    expect(handle.getAttribute('aria-valuemin')).toBe('0')
  })

  it('releases a drag that no longer owns the pointer when the shell unmounts', () => {
    const { handle, unmount } = mount()
    pointer(handle, 'pointerDown', 10)
    handle.releasePointerCapture(1)
    unmount()
    expect(handle.isConnected).toBe(false)
  })
})
