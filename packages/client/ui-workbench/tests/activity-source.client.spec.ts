/** The workbench follows the open desktop Session and sends the draft into it. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { bindWorkbench, type WorkbenchSessions } from '../src/client/activity-source.ts'

function retention(source: string, count: number): SessionListState['byId'][SessionId]['retainedBy'] {
  const value: SessionListState['byId'][SessionId]['retainedBy'] = {}
  Object.defineProperty(value, source, { value: count, enumerable: true })
  return value
}

const SESSION = 's-main' as SessionId

function harness(main = true) {
  const list = createSnapshotStore<SessionListState>({
    ids: main ? [SESSION] : [],
    byId: main ? {
      [SESSION]: {
        id: SESSION, displayTitle: 'Main', running: false, blank: false, updatedAt: 1,
        retainedBy: retention('mainView', 1),
      },
    } : {},
    phase: 'ready',
    projectionsBySession: {},
  })
  const events = createSnapshotStore({
    entries: [] as { type: string; event: { type: string; time: number; data: unknown } }[],
    hasMore: false,
    revision: 0,
    change: { kind: 'replace' as const, entries: [] as { type: 'event'; event: { type: string; time: number; data: unknown } }[] },
  })
  const prompt = vi.fn((): Promise<{ ok: true; value: { accepted: true } } | { ok: false; error: { code: string; message: string } }> => (
    Promise.resolve({ ok: true, value: { accepted: true } })
  ))
  const release = vi.fn()
  const retain = vi.fn(() => ({
    sessionId: SESSION,
    binding: { session: { prompt }, eventSource: events },
    ready: Promise.resolve(),
    release,
  }))
  const create = vi.fn(() => Promise.resolve('s-new' as SessionId))
  const sessions: WorkbenchSessions = { list, retain, create }
  const activity = bindWorkbench(sessions)
  return { activity, list, events, prompt, release, retain, create }
}

describe('bindWorkbench', () => {
  it('follows the main-view Session and updates when a file is written', () => {
    const { activity, events, retain } = harness()
    expect(retain).toHaveBeenCalledWith(SESSION, { source: 'workbench', connection: true })
    expect(activity.view.getSnapshot().file).toBeNull()
    events.set({
      entries: [{
        type: 'event',
        event: {
          type: 'tool/call',
          time: Date.UTC(2026, 10, 25, 6, 32, 5),
          data: { callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: 'src/lib/split.ts', content: 'export const n = 1\n' }) },
        },
      }],
      hasMore: false,
      revision: 1,
      change: { kind: 'replace', entries: [] },
    })
    expect(activity.view.getSnapshot().file?.path).toBe('src/lib/split.ts')
    expect(activity.view.getSnapshot().trace[0]?.kind).toBe('write')
    activity.dispose()
  })

  it('sends the draft into the followed Session', async () => {
    const { activity, prompt } = harness()
    await expect(activity.send('  补上分账  ')).resolves.toBe(true)
    expect(prompt).toHaveBeenCalledExactlyOnceWith([{ type: 'text', text: '补上分账' }], 'queue')
    expect(activity.view.getSnapshot().sending).toBe(false)
    expect(activity.view.getSnapshot().failed).toBe(false)
    activity.dispose()
  })

  it('creates a Session when none is open, and records a refused prompt', async () => {
    const { activity, create, prompt, retain } = harness(false)
    prompt.mockResolvedValueOnce({ ok: false, error: { code: 'nope', message: 'no' } })
    await expect(activity.send('开始')).resolves.toBe(false)
    expect(create).toHaveBeenCalledOnce()
    expect(retain).toHaveBeenCalledWith('s-new', { source: 'workbench', connection: true })
    expect(activity.view.getSnapshot().failed).toBe(true)
    activity.dispose()
  })

  it('ignores a blank draft, a second send, and a prompt that throws', async () => {
    const { activity, prompt } = harness()
    await expect(activity.send('   ')).resolves.toBe(false)
    let releasePrompt: (value: { ok: true; value: { accepted: true } }) => void = () => {}
    prompt.mockReturnValueOnce(new Promise((resolve) => { releasePrompt = resolve }))
    const first = activity.send('第一句')
    await expect(activity.send('第二句')).resolves.toBe(false)
    releasePrompt({ ok: true, value: { accepted: true } })
    await expect(first).resolves.toBe(true)
    prompt.mockRejectedValueOnce(new Error('down'))
    await expect(activity.send('再来')).resolves.toBe(false)
    expect(activity.view.getSnapshot().failed).toBe(true)
    activity.dispose()
    await expect(activity.send('之后')).resolves.toBe(false)
  })

  it('skips transient rows on the Session it created', async () => {
    const { activity, events, create, retain } = harness(false)
    await activity.send('开始')
    events.set({
      entries: [
        { type: 'transient', event: { type: 'assistant/live-chunk', time: 1, data: {} } },
        { type: 'event', event: { type: 'turn/start', time: 2, data: { turn: 1 } } },
      ],
      hasMore: false,
      revision: 1,
      change: { kind: 'replace', entries: [] },
    })
    expect(activity.view.getSnapshot().steps[0]?.turn).toBe(1)
    expect(create).toHaveBeenCalledOnce()
    expect(retain).toHaveBeenCalledWith('s-new', { source: 'workbench', connection: true })
    activity.dispose()
  })

  it('follows official main-view navigation after it created a Session', async () => {
    const { activity, list, retain, release } = harness(false)
    await activity.send('开始')
    const other = 's-other' as SessionId
    const otherEvents = createSnapshotStore({
      entries: [] as { type: string; event: { type: string; time: number; data: unknown } }[],
      hasMore: false,
      revision: 0,
      change: { kind: 'replace' as const, entries: [] as { type: 'event'; event: { type: string; time: number; data: unknown } }[] },
    })
    retain.mockImplementationOnce(() => ({
      sessionId: other,
      binding: { session: { prompt: vi.fn() }, eventSource: otherEvents },
      ready: Promise.resolve(),
      release,
    }))
    list.set({
      ids: [other],
      byId: {
        [other]: {
          id: other, displayTitle: 'Other', running: false, blank: false, updatedAt: 2,
          retainedBy: retention('mainView', 1),
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    })
    expect(retain).toHaveBeenCalledWith(other, { source: 'workbench', connection: true })
    expect(activity.currentReference()?.sessionId).toBe(other)
    activity.dispose()
  })

  it('follows a Session pinned after an official workspace pick', () => {
    const { activity, list, retain, release } = harness(false)
    const picked = 's-picked' as SessionId
    const events = createSnapshotStore({
      entries: [] as { type: string; event: { type: string; time: number; data: unknown } }[],
      hasMore: false,
      revision: 0,
      change: { kind: 'replace' as const, entries: [] as { type: 'event'; event: { type: string; time: number; data: unknown } }[] },
    })
    retain.mockImplementationOnce(() => ({
      sessionId: picked,
      binding: { session: { prompt: vi.fn() }, eventSource: events },
      ready: Promise.resolve(),
      release,
    }))
    activity.followSession(picked)
    expect(retain).toHaveBeenCalledWith(picked, { source: 'workbench', connection: true })
    expect(activity.currentReference()?.sessionId).toBe(picked)
    const other = 's-other' as SessionId
    retain.mockImplementationOnce(() => ({
      sessionId: other,
      binding: { session: { prompt: vi.fn() }, eventSource: events },
      ready: Promise.resolve(),
      release,
    }))
    list.set({
      ids: [other],
      byId: {
        [other]: {
          id: other, displayTitle: 'Other', running: false, blank: false, updatedAt: 2,
          retainedBy: retention('mainView', 1),
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    })
    expect(retain).toHaveBeenCalledWith(other, { source: 'workbench', connection: true })
    expect(activity.currentReference()?.sessionId).toBe(other)
    activity.dispose()
    activity.followSession(picked)
    expect(activity.currentReference()).toBeUndefined()
  })

  it('reports a create failure and follows a replacement main view', async () => {
    const created = harness(false)
    created.create.mockRejectedValueOnce(new Error('no session'))
    await expect(created.activity.send('开始')).resolves.toBe(false)
    expect(created.activity.view.getSnapshot().failed).toBe(true)
    created.activity.dispose()

    const current = harness()
    const other = 's-other' as SessionId
    current.list.set({
      ids: [other],
      byId: {
        [other]: {
          id: other, displayTitle: 'Other', running: false, blank: false, updatedAt: 2,
          retainedBy: retention('mainView', 1),
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    })
    current.list.set({
      ids: ['missing' as SessionId],
      byId: {},
      phase: 'ready',
      projectionsBySession: {},
    })
    const odd: ReturnType<typeof retention> = {}
    Object.defineProperty(odd, 'mainView', { value: 'none', enumerable: true })
    current.list.set({
      ids: [SESSION],
      byId: {
        [SESSION]: {
          id: SESSION, displayTitle: 'Main', running: false, blank: false, updatedAt: 4,
          retainedBy: odd,
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    })
    expect(current.activity.view.getSnapshot().steps[0]?.id).toBe('waiting')
    expect(current.retain).toHaveBeenCalledWith(other, { source: 'workbench', connection: true })
    expect(current.release).toHaveBeenCalled()
    current.activity.dispose()
  })

  it('ignores a list update that arrives while switching, and a create that finishes after dispose', async () => {
    const current = harness()
    current.retain.mockImplementation(() => {
      const snapshot = current.list.getSnapshot()
      current.list.set({ ...snapshot, ids: [...snapshot.ids] })
      return {
        sessionId: SESSION,
        binding: { session: { prompt: current.prompt }, eventSource: current.events },
        ready: Promise.resolve(),
        release: current.release,
      }
    })
    const other = 's-other' as SessionId
    current.list.set({
      ids: [other],
      byId: {
        [other]: {
          id: other, displayTitle: 'Other', running: true, blank: true, updatedAt: 3,
          retainedBy: retention('mainView', 1),
        },
      },
      phase: 'ready',
      projectionsBySession: {},
    })
    current.activity.dispose()

    const late = harness(false)
    let finish: (id: SessionId) => void = () => {}
    late.create.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = late.activity.send('晚到')
    late.activity.dispose()
    finish('s-late' as SessionId)
    await expect(pending).resolves.toBe(false)
  })

  it('releases the Session when disposed', () => {
    const { activity, release } = harness()
    activity.dispose()
    expect(release).toHaveBeenCalledOnce()
    activity.dispose()
    expect(release).toHaveBeenCalledOnce()
  })
})
