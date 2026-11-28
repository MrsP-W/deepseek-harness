// @vitest-environment jsdom
/** The workbench plugin occupies the frame slot and leaves with its fiber. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

describe('ui-workbench apply', () => {
  it('declares its service dependencies and has no host behavior', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale', 'uiWorkspace'])
    expect(nodeApply()).toBeUndefined()
  })

  it('fills the workbench slot and removes that entry when disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('sessions', {
      list: {
        getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
        subscribe: () => () => {},
      },
      retain: () => ({
        binding: {
          eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} },
          session: { prompt: () => Promise.resolve({ ok: true, value: { accepted: true } }) },
        },
        release: () => {},
      }),
      create: () => Promise.reject(new Error('workbench test does not create a session')),
    })
    ctx.provide('uiWorkspace', {
      openWorkspace: async (_id: unknown, adopt: (sessionId: string) => void) => { adopt('s1') },
      startSession: () => {},
    })
    ctx.provide('sidebarRight', { openTab: () => { throw new Error('no session') } })
    vi.stubGlobal('dshDesktop', {
      generationMonitor: {
        files: () => Promise.resolve([]),
        read: () => Promise.resolve(null),
        readText: () => Promise.resolve(null),
        subscribe: () => () => {},
      },
    })
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { workbench: { kind: 'single', scope: 'root' } },
    } as never, () => null)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('workbench')).toHaveLength(1)
    const entry = slots.entries('workbench')[0] as { inject?: () => {
      send?: (text: string) => Promise<boolean>
      sessionOf?: () => unknown
      startSession?: () => void
      openSessions?: (open: boolean) => void
      openFiles?: (open: boolean) => void
      openSettings?: () => void
    } } | undefined
    const injected = entry?.inject?.()
    expect(await injected?.send?.('')).toBe(false)
    expect(injected?.sessionOf?.()).toBeUndefined()
    injected?.startSession?.()
    injected?.openSessions?.(true)
    injected?.openFiles?.(false)
    injected?.openFiles?.(true)
    injected?.openSettings?.()
    const composer = slots.entries('workbench.composer')[0] as { inject?: () => { onWorkspaceSelected?: (id: string, adopt: (sessionId: string) => void) => Promise<void> } } | undefined
    await composer?.inject?.().onWorkspaceSelected?.('workspace', () => {})
    await fiber.dispose()
    expect(slots.entries('workbench')).toHaveLength(0)
  })
})
