// @vitest-environment jsdom
/** Static desktop workbench shell: both columns, official composer host, and column resize. */
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchShellProps, WorkbenchText } from '../src/client/WorkbenchShell.tsx'
import type { ActivityFile, WorkbenchView } from '../src/client/activity.ts'
import type { MonitorSnapshot } from '../src/client/monitor/model.ts'
import { zh } from '../src/client/locales/workbench.ts'
import { abbreviateConversation } from '../src/client/monitor/parse.ts'
import { WorkbenchShell } from '../src/client/WorkbenchShell.tsx'

const idle: WorkbenchView = {
  steps: [{ id: 'waiting', title: '', status: 'waiting' }],
  trace: [],
  files: [],
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

  const renderSlot = ((name: string) => (
    name === 'workbench.composer' ? <div data-official-composer="" /> : null
  )) as WorkbenchShellProps['renderSlot']

  const SessionProvider: WorkbenchShellProps['SessionProvider'] = ({ children, empty, session }) => (
    <>{session === undefined ? empty?.() ?? null : children}</>
  )

  const startSession = vi.fn()
  const openSessions = vi.fn()
  const openFiles = vi.fn()
  const openSettings = vi.fn()

  function mount(view: WorkbenchView = idle) {
    startSession.mockReset()
    openSessions.mockReset()
    openFiles.mockReset()
    openSettings.mockReset()
    installPointerCapture()
    installMeasurement()
    const rendered = render(
      <WorkbenchShell
        t={t}
        useActivity={selector => selector(view)}
        sessionOf={() => undefined}
        startSession={startSession}
        openSessions={openSessions}
        openFiles={openFiles}
        openSettings={openSettings}
        SessionProvider={SessionProvider}
        renderSlot={renderSlot}
      />,
    )
    const handle = rendered.getByRole('separator', { name: zh['resize.label'] })
    return { ...rendered, handle }
  }

  it('shows the rail, an empty workflow, and hosts the official composer', () => {
    const { getByRole, getByLabelText } = mount(idle)
    expect(getByRole('navigation', { name: zh['rail.label'] }).querySelector('[aria-current="page"]')?.getAttribute('aria-label'))
      .toBe(zh['rail.workflow'])
    expect(getByRole('heading', { name: zh['section.workflow'] })).toBeTruthy()
    expect(getByRole('heading', { name: zh['section.trajectory'] })).toBeTruthy()
    expect(document.querySelector('[data-workbench-step="waiting"]')?.textContent).toContain(zh['step.waiting.title'])
    expect(getByLabelText(zh['editor.label']).textContent).toContain(zh['editor.empty'])
    expect(document.querySelectorAll('[data-window-drag]')).toHaveLength(2)
    expect(document.querySelector('[data-dsh-workbench]')).not.toBeNull()
    expect(document.querySelector('[data-workbench-composer] [data-official-composer]')).not.toBeNull()
  })

  it('opens the official settings dialog from the rail', () => {
    const { getByRole } = mount()
    getByRole('button', { name: zh['rail.settings'] }).click()
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('starts an official new session and shows the official session list', () => {
    const { getByRole, queryByRole } = mount()
    expect(queryByRole('button', { name: zh['rail.graph'] })).toBeNull()
    expect(queryByRole('button', { name: zh['rail.branch'] })).toBeNull()
    expect(queryByRole('button', { name: zh['rail.metrics'] })).toBeNull()
    getByRole('button', { name: zh['rail.chat'] }).click()
    expect(startSession).toHaveBeenCalledOnce()
    expect(openSessions).toHaveBeenCalledWith(true)
  })

  it('filters local Codex and Antigravity sessions inside the existing panes', () => {
    const monitor: MonitorSnapshot = {
      running: 1,
      sessions: [
        {
          id: 'ag:1', agent: 'antigravity', surface: 'app', title: '给 aurora-sync 加上本机文件监听',
          cwd: '/Projects/aurora-sync', startedAt: Date.now() - 2 * 60 * 60 * 1000, status: 'running',
          prompt: `给 aurora-sync 加上本机文件监听 ${'x'.repeat(120)}`,
          steps: [
            { id: 'read', at: 1, action: 'read', label: 'README.md', status: 'done' },
            { id: 'cmd', at: Date.now() - 5_000, action: 'command', label: 'npm test', status: 'done' },
            { id: 'later', at: Date.now() + 60_000, action: 'read', label: 'later', status: 'done' },
            { id: 'edit', at: 3, action: 'edit', label: 'src/sync/manifest.ts', status: 'done' },
            { id: 'write', at: 4, action: 'write', label: 'src/sync/watcher.ts', status: 'running' },
            { id: 'abs', at: 2, action: 'edit', label: '/Users/wei/Documents/CodexProjects/demo/public/app.js', status: 'done' },
          ],
          files: [
            { path: 'src/sync/watcher.ts', name: 'watcher.ts', content: 'export const watcher = true\n', fresh: true, action: 'write', at: 4 },
            { path: '/', name: 'README', content: 'plain\n', fresh: false, action: 'write', at: 1 },
            { path: 'empty.ts', name: 'empty.ts', content: '', fresh: false, action: 'edit', at: 1 },
            {
              path: '/Users/wei/Documents/CodexProjects/demo/public/app.js', name: 'app.js',
              content: 'export const app = 1\n', fresh: false, action: 'edit', at: 2,
            },
          ],
          reads: [{
            path: '/Users/wei/Documents/CodexProjects/demo/public/app.js', name: 'app.js', content: 'export const before = 0\n',
          }],
        },
        {
          id: 'ag:cli', agent: 'antigravity', surface: 'cli', title: 'transcript_full.jsonl',
          cwd: '/var/notes.jsonl', startedAt: Date.now() - 60_000, status: 'error', prompt: '', steps: [], files: [],
        },
        {
          id: 'codex:exec', agent: 'codex', surface: 'exec', title: '命令行检查',
          cwd: '', startedAt: Date.now() - 2 * 60 * 60 * 1000, status: 'done', prompt: '',
          steps: [{ id: 'win', at: 1, action: 'read', label: 'C:\\src\\app.js', status: 'done' }],
          files: [{ path: 'C:\\src\\app.js', name: '', content: 'export const win = 1\n', fresh: false, action: 'edit', at: 1 }],
          reads: [{ path: 'C:\\src\\app.js', name: '', content: 'export const readwin = 1\n', at: 1 }],
        },
        {
          id: 'codex:1', agent: 'codex', surface: 'desktop', title: '为 aurora-sync 补充单元测试',
          cwd: '/Projects/aurora-sync', startedAt: Date.now() - 5 * 60 * 1000, status: 'done', prompt: '为 aurora-sync 补充单元测试',
          steps: [{ id: 'ed', at: Date.now(), action: 'edit', label: 'a.ts', status: 'running' }], files: [],
        },
        {
          id: 'codex:soon', agent: 'codex', surface: 'desktop', title: 'rollout-2026.jsonl',
          cwd: '/Projects/taskmarket-tsk-brk611an', startedAt: Date.now() + 10_000, status: 'done', prompt: '',
          steps: [], files: [], reads: [{ path: 'plain.ts', name: 'plain.ts', content: '' }],
        },
        {
          id: 'codex:child', agent: 'codex', surface: 'subagent', title: 'transcript_full.jsonl',
          cwd: '', startedAt: 3, status: 'running', prompt: '补齐类型\n更多', parentId: 'codex:1', steps: [], files: [],
        },
        {
          id: 'codex:bare', agent: 'codex', surface: 'desktop', title: '',
          cwd: '', startedAt: 1, status: 'done', prompt: '',
          steps: [{ id: 'slash', at: 1, action: 'read', label: '/', status: 'done' }], files: [],
        },
        {
          id: 'codex:named', agent: 'codex', surface: 'exec', title: 'taskmarket-tsk-brk611an',
          cwd: '/Users/wei/Documents/CodexProjects/自动化副业/outputs/taskmarket-tsk-brk611an',
          startedAt: Date.now() - 1000, status: 'done',
          prompt: '/tmp/only.ts\n\nnotes.jsonl\ntaskmarket-tsk-brk611an\n给副业页面补上移动端预览',
          steps: [], files: [],
        },
        {
          id: 'codex:long', agent: 'codex', surface: 'exec', title: '<USER_REQUEST>',
          cwd: '/outputs/taskmarket-tsk-brk611an', startedAt: Date.now() - 4_000, status: 'done',
          prompt: '<USER_REQUEST>\nTSK-BRK611AN 已完成「发布者增长从哪来 (posterCohorts)」双链对比主图、数据驱动结论句、专属分享卡 (share-growth.png)\n</USER_REQUEST>',
          steps: [{ id: 'long-step', at: 9, action: 'edit', label: 'share-growth.png', status: 'done' }],
          files: [],
        },
        {
          id: 'codex:childslug', agent: 'codex', surface: 'subagent', title: 'taskmarket-tsk-brk611an',
          cwd: '/outputs/taskmarket-tsk-brk611an', startedAt: Date.now() - 3_000, status: 'done',
          prompt: '', parentId: 'codex:long',
          steps: [{ id: 'child-step', at: 8, action: 'command', label: 'exec', status: 'done' }],
          files: [],
        },
        {
          id: 'codex:orphan', agent: 'codex', surface: 'subagent', title: 'taskmarket-tsk-brk611an',
          cwd: '/x/taskmarket-tsk-brk611an', startedAt: 2, status: 'done', prompt: '',
          parentId: 'codex:bare', steps: [], files: [],
        },
      ],
    }
    installPointerCapture()
    installMeasurement()
    const view = render(
      <WorkbenchShell
        t={t}
        useActivity={selector => selector(idle)}
        useMonitor={selector => selector(monitor)}
        sessionOf={() => undefined}
        SessionProvider={SessionProvider}
        renderSlot={renderSlot}
      />,
    )
    expect(view.getByRole('heading', { name: zh['monitor.title'] })).toBeTruthy()
    expect(view.getByText(zh['monitor.mark'])).toBeTruthy()
    expect(view.getByText(/正在监控 11 个会话/u)).toBeTruthy()
    expect(view.getByText(zh['monitor.readonly'])).toBeTruthy()
    expect(view.getByRole('heading', { level: 3, name: '给 aurora-sync 加上本机文件监听' })).toBeTruthy()
    expect(view.getByText(zh['monitor.streaming'])).toBeTruthy()
    const editor = view.getByLabelText(zh['editor.label'])
    expect(editor.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(zh['monitor.outputPane'])
    expect(view.getAllByRole('table')).toHaveLength(1)
    expect(editor.textContent).toContain('export const watcher = true')
    expect(editor.textContent).not.toContain('export const before = 0')
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.input'] }))
    expect(editor.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(zh['monitor.input'])
    expect(editor.textContent).toContain('给 aurora-sync 加上本机文件监听')
    expect(editor.textContent).toContain('export const before = 0')
    expect(editor.textContent).not.toContain('export const watcher = true')
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.outputPane'] }))
    expect(editor.textContent).toContain('export const watcher = true')
    expect(view.getAllByRole('table')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('/Users/wei/Documents')
    expect(view.getAllByText('app.js').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-monitor-region="highlight"]')).not.toBeNull()
    expect(document.querySelector('[data-monitor-region="events"]')).not.toBeNull()
    expect(document.querySelector('[data-workbench-session="ag:1"]')?.textContent).toContain('aurora-sync')
    expect(document.querySelector('[data-workbench-session="ag:1"]')?.textContent).toContain(zh['monitor.origin.ide'])
    expect(document.querySelector('[data-workbench-session="codex:child"]')?.textContent).toContain(zh['monitor.origin.subagent'])
    expect(document.querySelector('[data-workbench-session="codex:exec"]')?.textContent).toContain(zh['monitor.origin.exec'])
    expect(document.querySelector('[data-workbench-session="codex:soon"]')?.textContent).toContain('taskmarket-tsk-brk611an')
    const short = abbreviateConversation('TSK-BRK611AN 已完成「发布者增长从哪来 (posterCohorts)」双链对比主图、数据驱动结论句、专属分享卡')
    expect(short.length).toBeLessThanOrEqual(24)
    expect(document.querySelector('[data-workbench-session="codex:long"]')?.textContent).toContain(short)
    expect(document.querySelector('[data-workbench-session="codex:long"]')?.textContent).not.toContain('<USER_REQUEST>')
    expect(document.querySelector('[data-workbench-session="codex:long"]')?.textContent).not.toContain('专属分享卡')
    expect(document.querySelector('[data-workbench-session="codex:childslug"]')?.textContent).toContain(short)
    expect(document.querySelector('[data-workbench-session="codex:childslug"]')?.textContent).not.toContain('taskmarket-tsk-brk611an')
    expect(document.querySelector('[data-workbench-trace="long-step"]')?.textContent).toContain(short)
    expect(document.querySelector('[data-workbench-trace="child-step"]')?.textContent).toContain(short)
    expect(document.querySelector('[data-workbench-trace="child-step"]')?.textContent).not.toContain('<USER_REQUEST>')
    expect(document.querySelector('[data-workbench-session="codex:named"]')?.textContent).toContain('给副业页面补上移动端预览')
    fireEvent.click(document.querySelector('[data-workbench-session="codex:long"]') as Element)
    const headline = view.getByRole('heading', { level: 3, name: short })
    expect(headline.textContent).toBe(short)
    expect(headline.getAttribute('title')).toContain('专属分享卡')
    expect(headline.getAttribute('title')).not.toBe(short)
    expect(document.querySelector('[data-workbench-session="codex:named"]')?.textContent).not.toContain('taskmarket-tsk-brk611an')
    expect(document.querySelector('[data-workbench-session="ag:cli"]')?.textContent).toContain('Antigravity')
    expect(document.querySelector('[data-workbench-session="ag:cli"]')?.textContent).not.toContain('transcript_full.jsonl')
    expect(document.querySelector('[data-workbench-session="ag:cli"]')?.textContent).toContain(zh['monitor.lane.waiting'])
    expect(document.querySelector('[data-workbench-session="codex:child"]')?.textContent).toContain('补齐类型')
    expect(document.querySelector('[data-workbench-trace="cmd"]')?.textContent).toContain(zh['monitor.command'])
    expect(document.querySelector('[data-workbench-trace="edit"]')?.textContent).toContain(zh['monitor.edit'])
    expect(document.querySelector('[data-workbench-trace="write"]')?.getAttribute('data-status')).toBe('running')
    expect(document.querySelector('[data-monitor-count="running"]')?.textContent).toContain(zh['monitor.lane.running'])
    expect(document.querySelector('[data-monitor-count="idle"]')?.textContent).toContain(zh['monitor.lane.idle'])
    expect(document.querySelector('[data-monitor-count="waiting"]')?.textContent).toContain(zh['monitor.lane.waiting'])
    expect(document.body.textContent).toContain('h ')
    expect(document.querySelector('[data-workbench-session="ag:1"]')?.textContent).not.toContain('transcript_full.jsonl')
    const rail = view.getByRole('navigation', { name: zh['rail.label'] })
    fireEvent.click(rail.querySelector(`[aria-label="${zh['monitor.sources']}"]`) as Element)
    expect(view.getByText(zh['monitor.sourcesNote'])).toBeTruthy()
    fireEvent.click(rail.querySelector(`[aria-label="${zh['monitor.overview']}"]`) as Element)
    fireEvent.click(rail.querySelector(`[aria-label="${zh['rail.settings']}"]`) as Element)
    fireEvent.click(view.getByRole('button', { name: zh['monitor.night'] }))
    expect(document.querySelector('[data-theme="night"]')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['monitor.day'] }))
    fireEvent.change(view.getByRole('searchbox', { name: zh['monitor.search'] }), { target: { value: '命令行' } })
    expect(document.querySelector('[data-workbench-session="ag:1"]')).toBeNull()
    fireEvent.change(view.getByRole('searchbox', { name: zh['monitor.search'] }), { target: { value: '' } })
    fireEvent.click(document.querySelector('[data-workbench-session="ag:cli"]') as Element)
    expect(view.getAllByRole('table')).toHaveLength(1)
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain(zh['monitor.outputEmpty'])
    expect(view.getByLabelText(zh['editor.label']).textContent).not.toContain(zh['monitor.inputEmpty'])
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.input'] }))
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain(zh['monitor.inputEmpty'])
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.outputPane'] }))
    fireEvent.click(document.querySelector('[data-workbench-session="codex:exec"]') as Element)
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain('app.js')
    expect(view.getByLabelText(zh['editor.label']).textContent).not.toContain('export const readwin = 1')
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.input'] }))
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain('export const readwin = 1')
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.outputPane'] }))
    fireEvent.click(document.querySelector('[data-workbench-session="codex:1"]') as Element)
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain(zh['monitor.outputEmpty'])
    expect(view.getByLabelText(zh['editor.label']).textContent).not.toContain('为 aurora-sync 补充单元测试')
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.input'] }))
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain('为 aurora-sync 补充单元测试')
    fireEvent.click(view.getByRole('tab', { name: zh['monitor.outputPane'] }))
    fireEvent.click(document.querySelector('[data-workbench-session="codex:soon"]') as Element)
    fireEvent.click(document.querySelector('[data-workbench-session="codex:child"]') as Element)
    window.dispatchEvent(new CustomEvent('dsh:workbench-sessions', { detail: { open: true } }))
    window.dispatchEvent(new CustomEvent('dsh:workbench-files', { detail: { open: false } }))
    window.dispatchEvent(new CustomEvent('dsh:workbench-files', { detail: {} }))
    window.dispatchEvent(new CustomEvent('dsh:workbench-sessions', { detail: {} }))
    fireEvent.click(document.querySelector('[data-workbench-session="ag:1"]') as Element)
    fireEvent.click(view.getByRole('button', { name: zh['monitor.codex'] }))
    expect(document.querySelector('[data-workbench-session="ag:1"]')).toBeNull()
    expect(document.querySelector('[data-workbench-session="codex:1"]')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: zh['monitor.view.repo'] }))
    fireEvent.click(view.getByRole('button', { name: zh['monitor.view.board'] }))
    fireEvent.click(document.querySelector('[data-workbench-session="codex:exec"]') as Element)
    fireEvent.click(view.getByRole('button', { name: zh['monitor.view.list'] }))
    fireEvent.click(view.getByRole('button', { name: zh['monitor.all'] }))
    fireEvent.click(document.querySelector('[data-workbench-session="ag:1"]') as Element)
    fireEvent.click(document.querySelector('[data-workbench-open-file="/"]') as Element)
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain('plain')
    expect(view.queryByText(zh['monitor.streaming'])).toBeNull()
    fireEvent.click(document.querySelector('[data-monitor-region="output"] [data-workbench-open-file="src/sync/watcher.ts"]') as Element)
    fireEvent.click(document.querySelector('[data-workbench-trace="write"] button') as Element)
    expect(view.getByLabelText(zh['editor.label']).textContent).toContain('export const watcher = true')
    expect(view.getByText(zh['monitor.streaming'])).toBeTruthy()
    expect(document.querySelector('[data-workbench-composer] [data-official-composer]')).not.toBeNull()
    expect(document.querySelectorAll('[data-window-drag]')).toHaveLength(1)
  })

  it('reserves a macOS titlebar band above the monitor mark', () => {
    const sheet = readFileSync('packages/client/ui-workbench/src/client/WorkbenchShell.module.css', 'utf8')
    const main = readFileSync('apps/desktop/src/main.ts', 'utf8')
    expect(sheet).toContain('grid-template-columns: 108px minmax(0, 1fr)')
    expect(sheet).toContain('padding-top: calc(var(--dsh-frame-top-clearance, 52px) + 36px)')
    expect(main).toContain('trafficLightPosition: { x: 22, y: 22 }')
  })

  it('names a single product in the watching line', () => {
    installPointerCapture()
    installMeasurement()
    const only = (agent: 'codex' | 'antigravity'): MonitorSnapshot => ({
      running: 0,
      sessions: [{
        id: agent, agent, surface: 'desktop', title: 'solo', cwd: '', startedAt: 1,
        status: 'done', prompt: '', steps: [], files: [],
      }],
    })
    const codex = render(
      <WorkbenchShell
        t={t}
        useActivity={selector => selector(idle)}
        useMonitor={selector => selector(only('codex'))}
        sessionOf={() => undefined}
        SessionProvider={SessionProvider}
        renderSlot={renderSlot}
      />,
    )
    expect(codex.getByText(/来自 Codex/u)).toBeTruthy()
    codex.unmount()
    const antigravity = render(
      <WorkbenchShell
        t={t}
        useActivity={selector => selector(idle)}
        useMonitor={selector => selector(only('antigravity'))}
        sessionOf={() => undefined}
        SessionProvider={SessionProvider}
        renderSlot={renderSlot}
      />,
    )
    expect(antigravity.getByText(/来自 反重力/u)).toBeTruthy()
  })

  it('shows the empty copy when no local logs are listed', () => {
    installPointerCapture()
    installMeasurement()
    const view = render(
      <WorkbenchShell
        t={t}
        useActivity={selector => selector(idle)}
        useMonitor={selector => selector({ running: 0, sessions: [] })}
        sessionOf={() => undefined}
        SessionProvider={SessionProvider}
        renderSlot={renderSlot}
      />,
    )
    expect(view.getAllByText(zh['monitor.empty']).length).toBeGreaterThan(0)
    expect(view.getByText(/正在监控 0 个会话/u)).toBeTruthy()
    expect(document.querySelector('[data-monitor-count="running"]')?.textContent).toContain('0')
    expect(document.querySelector('[data-monitor]')).not.toBeNull()
  })

  it('opens official workspace files from the rail', () => {
    const { getByRole } = mount()
    getByRole('button', { name: zh['rail.files'] }).click()
    expect(openFiles).toHaveBeenCalledWith(true)
    getByRole('button', { name: zh['rail.workflow'] }).click()
    expect(openSessions).toHaveBeenCalledWith(false)
    expect(openFiles).toHaveBeenCalledWith(false)
  })

  it('renders a running step, its trace, and the file being written', () => {
    const running: WorkbenchView = {
      steps: [
        { id: 'todo-0', title: '编写核心模块', status: 'active', detail: 'writing', path: 'src/lib/split.ts' },
        { id: 'todo-1', title: '补充测试', status: 'waiting' },
      ],
      trace: [{ id: 'edit', kind: 'edit', action: 'edit', path: 'src/lib/split.ts', lines: '18-42', time: '14:32:05', status: 'running' }],
      files: [{
        path: 'src/lib/split.ts',
        crumbs: ['src', 'lib', 'split.ts'],
        badge: 'TS',
        lines: ["throw new Error('amount')"],
        annotated: [1],
        cursorLine: 1,
        cursorColumn: 1,
      }],
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

  it('renders the other step and trace labels', () => {
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
      files: [{
        path: 'notes', crumbs: ['notes'], badge: '', lines: ['// note', 'const n = 2'], annotated: [2],
        cursorLine: 2, cursorColumn: 1,
      }],
      file: {
        path: 'notes', crumbs: ['notes'], badge: '', lines: ['// note', 'const n = 2'], annotated: [2],
        cursorLine: 2, cursorColumn: 1,
      },
      sending: true,
      failed: true,
    }
    const { getByLabelText } = mount(view)
    expect(document.querySelector('[data-workbench-step="turn-2"]')?.textContent).toContain('第 2 轮')
    expect(document.querySelector('[data-workbench-step="turn-2"]')?.textContent).toContain('正在修改 notes')
    expect(document.querySelector('[data-workbench-step="turn-2"]')?.textContent).toContain(zh['status.error'])
    expect(document.querySelector('[data-workbench-trace="todo"]')?.textContent).toContain(zh['trajectory.todo'])
    expect(document.querySelector('[data-workbench-trace="bash"]')?.textContent).toContain('bash')
    expect(getByLabelText(zh['editor.label']).textContent).not.toContain(zh['editor.written'].repeat(2))
    expect(document.querySelector('[data-workbench-composer] [data-official-composer]')).not.toBeNull()
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
    const view = render(
      <WorkbenchShell
        t={t}
        useActivity={selector => selector(idle)}
        sessionOf={() => undefined}
        SessionProvider={SessionProvider}
        renderSlot={renderSlot}
      />,
    )
    const handle = view.getByRole('separator', { name: zh['resize.label'] })
    expect(handle.getAttribute('aria-valuenow')).toBe('440')
    expect(handle.getAttribute('aria-valuemin')).toBe('0')
    const rail = view.getByRole('navigation', { name: zh['rail.label'] })
    fireEvent.click(rail.querySelector(`[aria-label="${zh['rail.chat']}"]`) as Element)
    fireEvent.click(rail.querySelector(`[aria-label="${zh['rail.files']}"]`) as Element)
    fireEvent.click(rail.querySelector(`[aria-label="${zh['rail.workflow']}"]`) as Element)
    fireEvent.click(rail.querySelector(`[aria-label="${zh['rail.settings']}"]`) as Element)
  })

  it('collapses the steps and trace panes independently', () => {
    const { getByRole } = mount(idle)
    const stepsToggle = getByRole('button', { name: zh['section.steps'] })
    const traceToggle = getByRole('button', { name: zh['section.trajectory'] })
    expect(stepsToggle.getAttribute('aria-expanded')).toBe('true')
    expect(traceToggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[data-workbench-step="waiting"]')).not.toBeNull()
    fireEvent.click(stepsToggle)
    expect(getByRole('button', { name: zh['section.steps'] }).getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-workbench-step="waiting"]')).toBeNull()
    expect(document.querySelector('[data-workbench-steps-pane]')?.hasAttribute('data-collapsed')).toBe(true)
    expect(document.querySelector('[data-all-collapsed]')).toBeNull()
    fireEvent.click(traceToggle)
    expect(getByRole('button', { name: zh['section.trajectory'] }).getAttribute('aria-expanded')).toBe('false')
    expect(document.querySelector('[data-workbench-trace-pane] ol')).toBeNull()
    expect(document.querySelector('[data-all-collapsed]')).not.toBeNull()
    fireEvent.click(getByRole('button', { name: zh['section.steps'] }))
    expect(document.querySelector('[data-workbench-step="waiting"]')).not.toBeNull()
    expect(document.querySelector('[data-all-collapsed]')).toBeNull()
  })

  it('does not show tabs for a single written file', () => {
    const written: ActivityFile = {
      path: 'src/lib/split.ts', crumbs: ['src', 'lib', 'split.ts'], badge: 'TS',
      lines: ["throw new Error('amount')"], annotated: [1], cursorLine: 1, cursorColumn: 1,
    }
    const { getByLabelText, queryByRole } = mount({
      steps: [{ id: 'todo-0', title: '编写核心模块', status: 'done' }],
      trace: [{ id: 'edit', kind: 'edit', action: 'edit', path: written.path, lines: '18-42', time: '14:32:05', status: 'done' }],
      files: [written],
      file: written,
      sending: false,
      failed: false,
    })
    expect(queryByRole('tablist')).toBeNull()
    expect(getByLabelText(zh['editor.label']).getAttribute('data-workbench-editor-file')).toBe(written.path)
    expect(getByLabelText(zh['editor.label']).textContent).toContain('src/lib/split.ts')
  })

  it('opens a written file from its trace row and switches tabs', () => {
    const alpha: ActivityFile = {
      path: 'src/lib/split.ts', crumbs: ['src', 'lib', 'split.ts'], badge: 'TS',
      lines: ['export const amount = 1'], annotated: [1], cursorLine: 1, cursorColumn: 1,
    }
    const beta: ActivityFile = {
      path: 'src/lib/notes.md', crumbs: ['src', 'lib', 'notes.md'], badge: 'MD',
      lines: ['# Notes'], annotated: [1], cursorLine: 1, cursorColumn: 1,
    }
    const bare: ActivityFile = {
      path: 'README', crumbs: [], badge: '',
      lines: ['hello'], annotated: [], cursorLine: 1, cursorColumn: 1,
    }
    const { getByLabelText, getByRole } = mount({
      steps: [{ id: 'turn-1', title: '补上文件', status: 'done', time: '14:32' }],
      trace: [
        { id: 'w1', kind: 'write', action: 'write', path: alpha.path, time: '14:32:05', status: 'done' },
        { id: 'w2', kind: 'write', action: 'write', path: beta.path, time: '14:32:09', status: 'done' },
        { id: 'todo', kind: 'todo_write', action: 'todo', time: '14:32:10', status: 'done' },
      ],
      files: [alpha, beta, bare],
      file: beta,
      sending: false,
      failed: false,
    })
    const editor = getByLabelText(zh['editor.label'])
    expect(editor.getAttribute('data-workbench-editor-file')).toBe(beta.path)
    expect(editor.textContent).toContain('# Notes')
    expect(editor.textContent).not.toContain('export const amount = 1')
    expect(getByRole('tablist', { name: zh['editor.tabs'] }).querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(getByRole('tab', { name: 'README' })).toBeTruthy()
    expect(getByRole('tab', { name: 'split.ts' }).getAttribute('aria-selected')).toBe('false')
    expect(getByRole('tab', { name: 'notes.md' }).getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[data-workbench-trace="todo"] button')).toBeNull()
    fireEvent.click(getByRole('button', { name: zh['trajectory.open'].replace('{path}', alpha.path) }))
    expect(getByLabelText(zh['editor.label']).getAttribute('data-workbench-editor-file')).toBe(alpha.path)
    expect(getByLabelText(zh['editor.label']).textContent).toContain('export const amount = 1')
    expect(getByLabelText(zh['editor.label']).textContent).not.toContain('# Notes')
    expect(getByRole('tab', { name: 'split.ts' }).getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector('[data-workbench-trace="w1"] button')?.getAttribute('aria-current')).toBe('true')
    fireEvent.click(getByRole('tab', { name: 'notes.md' }))
    expect(getByLabelText(zh['editor.label']).getAttribute('data-workbench-editor-file')).toBe(beta.path)
    expect(getByLabelText(zh['editor.label']).textContent).toContain('# Notes')
    expect(getByLabelText(zh['editor.label']).textContent).not.toContain('export const amount = 1')
    expect(getByRole('tab', { name: 'notes.md' }).getAttribute('aria-selected')).toBe('true')
  })

  it('releases a drag that no longer owns the pointer when the shell unmounts', () => {
    const { handle, unmount } = mount()
    pointer(handle, 'pointerDown', 10)
    handle.releasePointerCapture(1)
    unmount()
    expect(handle.isConnected).toBe(false)
  })
})
