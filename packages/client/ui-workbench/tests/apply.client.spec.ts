// @vitest-environment jsdom
/** The workbench plugin occupies the frame slot and leaves with its fiber. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

describe('ui-workbench apply', () => {
  it('declares its service dependencies and has no host behavior', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale'])
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
      retain: () => { throw new Error('workbench test does not open a session') },
      create: () => Promise.reject(new Error('workbench test does not create a session')),
    })
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: { workbench: { kind: 'single', scope: 'root' } },
    }, () => null)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('workbench')).toHaveLength(1)
    const entry = slots.entries('workbench')[0] as { inject?: () => { send?: (text: string) => Promise<boolean> } } | undefined
    expect(await entry?.inject?.().send?.('')).toBe(false)
    await fiber.dispose()
    expect(slots.entries('workbench')).toHaveLength(0)
  })
})
