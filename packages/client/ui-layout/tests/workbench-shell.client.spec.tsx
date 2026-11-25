// @vitest-environment jsdom
/** Static desktop workbench shell: both columns, draft field, and column resize. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { isDesktopWorkbenchDocument } from '../src/client/desktop-workbench.ts'
import { zh } from '../src/client/locales/workbench.ts'
import { WorkbenchShell, type WorkbenchText } from '../src/client/WorkbenchShell.tsx'

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

afterEach(() => {
  cleanup()
  globalThis.__DSH_DESKTOP_WORKBENCH__ = undefined
})

describe('desktop workbench document marker', () => {
  it('is true only when the desktop index set the flag', () => {
    expect(isDesktopWorkbenchDocument()).toBe(false)
    globalThis.__DSH_DESKTOP_WORKBENCH__ = true
    expect(isDesktopWorkbenchDocument()).toBe(true)
    globalThis.__DSH_DESKTOP_WORKBENCH__ = undefined
    expect(isDesktopWorkbenchDocument()).toBe(false)
  })
})

describe('WorkbenchShell', () => {
  afterEach(() => { cleanup() })

  function mount() {
    installPointerCapture()
    const view = render(<WorkbenchShell t={t} />)
    const handle = view.getByRole('separator', { name: zh['resize.label'] })
    return { ...view, handle }
  }

  it('shows the rail, workflow steps, trace, and placeholder file together', () => {
    const { getByRole, getByLabelText } = mount()
    expect(getByRole('navigation', { name: zh['rail.label'] }).querySelector('[aria-current="page"]')?.getAttribute('aria-label'))
      .toBe(zh['rail.workflow'])
    expect(getByRole('heading', { name: zh['section.workflow'] })).toBeTruthy()
    expect(getByRole('heading', { name: zh['section.trajectory'] })).toBeTruthy()
    const active = document.querySelector('[data-workbench-step="implement"]')
    expect(active?.getAttribute('data-status')).toBe('active')
    expect(active?.textContent).toContain('正在写入 src/lib/split.ts')
    expect(document.querySelector('[data-workbench-step="test"]')?.getAttribute('data-status')).toBe('waiting')
    expect(document.querySelector('[data-workbench-step="test"]')?.textContent).not.toContain(':')
    expect(document.querySelector('[data-workbench-trace="edit"]')?.textContent).toContain('行 18-42')
    expect(document.querySelector('[data-workbench-trace="create"]')?.textContent).toContain('write')
    expect(document.querySelector('[data-workbench-trace="todo"]')?.textContent).toContain(zh['trajectory.todo'])
    expect(getByLabelText(zh['editor.label']).textContent).toContain('src/lib/split.ts')
    expect(getByLabelText(zh['editor.label']).textContent).toContain("throw new Error('amount')")
    expect(getByLabelText(zh['editor.label']).textContent).toContain(zh['editor.written'])
    expect(getByLabelText(zh['editor.label']).textContent).toContain('Ln 18, Col 1')
    expect(getByLabelText(zh['editor.label']).textContent).toContain('split.ts')
    const draft = getByRole('textbox', { name: zh['composer.label'] }) as HTMLTextAreaElement
    expect(draft.placeholder).toBe(zh['composer.placeholder'])
    const send = () => getByRole('button', { name: zh['composer.send'] }) as HTMLButtonElement
    expect(send().disabled).toBe(true)
    fireEvent.change(draft, { target: { value: '  ' } })
    expect(send().disabled).toBe(true)
    fireEvent.change(draft, { target: { value: '继续补测试' } })
    expect(send().disabled).toBe(false)
    fireEvent.click(getByRole('button', { name: zh['composer.send'] }))
    fireEvent.click(getByRole('button', { name: zh['composer.attach'] }))
    expect(draft.value).toBe('继续补测试')
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
    expect(handle.getAttribute('aria-valuenow')).toBe('720')
    pointer(handle, 'pointerDown', 1000)
    pointer(handle, 'pointerCancel', -1000)
    expect(handle.getAttribute('aria-valuenow')).toBe('280')
    pointer(handle, 'pointerDown', 0)
    unmount()
    expect(handle.hasPointerCapture(1)).toBe(false)
  })

  it('releases a drag that no longer owns the pointer when the shell unmounts', () => {
    const { handle, unmount } = mount()
    pointer(handle, 'pointerDown', 10)
    handle.releasePointerCapture(1)
    unmount()
    expect(handle.isConnected).toBe(false)
  })
})
