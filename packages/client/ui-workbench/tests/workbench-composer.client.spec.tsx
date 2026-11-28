// @vitest-environment jsdom
/** Official Conversation factory props used by the workbench composer. */
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkbenchComposer, type WorkbenchComposerProps } from '../src/client/WorkbenchComposer.tsx'

function sessionSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    blank: true,
    awaitingFirstTurn: true,
    running: false,
    promptAttempted: false,
    openState: 'open',
    ...overrides,
  }
}

function mount(props: Pick<WorkbenchComposerProps, 'sessionId' | 'useSession' | 'useConversation' | 'useSessions' | 'renderFactorySlot' | 'onWorkspaceSelected'>) {
  return render(<WorkbenchComposer {...props as WorkbenchComposerProps} />)
}

describe('WorkbenchComposer', () => {
  it('hosts official conversation content in hero phase when no Session is open', () => {
    const renderFactorySlot = vi.fn(() => <div data-official-content="" />)
    const onWorkspaceSelected = vi.fn()
    mount({
      sessionId: undefined,
      useSession: selector => selector(undefined as never),
      useConversation: selector => selector(undefined as never),
      useSessions: selector => selector({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} } as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'hero', hero: true, onWorkspaceSelected },
      expect.objectContaining({ slots: expect.objectContaining({ views: expect.any(Function) }) }),
    )
  })

  it('keeps official hero phase for a blank Session so the workspace picker stays available', () => {
    const renderFactorySlot = vi.fn(() => <div data-official-content="" />)
    const onWorkspaceSelected = vi.fn()
    const sessionId = 's-blank' as SessionId
    mount({
      sessionId,
      useSession: selector => selector(sessionSnapshot() as never),
      useConversation: selector => selector({
        views: { get: () => undefined, grouped: () => undefined },
        activeTargets: new Set(),
      } as never),
      useSessions: selector => selector({
        ids: [sessionId],
        byId: { [sessionId]: { id: sessionId, displayTitle: 'Blank', running: false, blank: true, updatedAt: 1, retainedBy: {} } },
        phase: 'ready',
        projectionsBySession: {},
      } as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'hero', hero: true, onWorkspaceSelected },
      expect.objectContaining({ slots: expect.objectContaining({ views: expect.any(Function) }) }),
    )
  })

  it('uses the official active phase once the Session has started a turn', () => {
    const renderFactorySlot = vi.fn(() => <div data-official-content="" />)
    const onWorkspaceSelected = vi.fn()
    const sessionId = 's-active' as SessionId
    mount({
      sessionId,
      useSession: selector => selector(sessionSnapshot({ blank: false, awaitingFirstTurn: false, running: true, openState: 'open' }) as never),
      useConversation: selector => selector({ views: { get: () => undefined, grouped: () => undefined }, activeTargets: new Set(['t']) } as never),
      useSessions: selector => selector({
        ids: [sessionId],
        byId: { [sessionId]: { id: sessionId, displayTitle: 'Live', running: true, blank: false, updatedAt: 1, retainedBy: {} } },
        phase: 'ready',
        projectionsBySession: {},
      } as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'active', hero: false, onWorkspaceSelected },
      expect.objectContaining({ slots: expect.objectContaining({ views: expect.any(Function) }) }),
    )
    const views = renderFactorySlot.mock.calls[0]?.[2]?.slots.views
    const renderSlot = vi.fn(() => <span data-chat-view="" />)
    if (views !== undefined) render(views({ renderSlot }))
    expect(renderSlot).toHaveBeenCalledWith('conversation.session', { view: 'chat' })
  })

  it('uses engaging, settling, and running-only phases from the official Session', () => {
    const renderFactorySlot = vi.fn(() => <div data-official-content="" />)
    const onWorkspaceSelected = vi.fn()
    const sessionId = 's-phase' as SessionId
    const sessions = {
      ids: [sessionId],
      byId: { [sessionId]: { id: sessionId, displayTitle: 'Phase', running: false, blank: false, updatedAt: 1, retainedBy: {} } },
      phase: 'ready' as const,
      projectionsBySession: {},
    }
    const conversation = { views: { get: () => undefined, grouped: () => undefined }, activeTargets: new Set() }
    mount({
      sessionId,
      useSession: selector => selector(sessionSnapshot({ promptAttempted: true }) as never),
      useConversation: selector => selector(conversation as never),
      useSessions: selector => selector(sessions as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'active', hero: false, onWorkspaceSelected },
      expect.anything(),
    )
    mount({
      sessionId,
      useSession: selector => selector(sessionSnapshot({ openState: 'loading' }) as never),
      useConversation: selector => selector(conversation as never),
      useSessions: selector => selector(sessions as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'settling', hero: false, onWorkspaceSelected },
      expect.anything(),
    )
    mount({
      sessionId,
      useSession: selector => selector(sessionSnapshot({ blank: false, awaitingFirstTurn: false, running: false }) as never),
      useConversation: selector => selector(conversation as never),
      useSessions: selector => selector(sessions as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'active', hero: false, onWorkspaceSelected },
      expect.anything(),
    )
    mount({
      sessionId,
      useSession: selector => selector(sessionSnapshot({ running: true }) as never),
      useConversation: selector => selector(conversation as never),
      useSessions: selector => selector({ ...sessions, byId: {} } as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'active', hero: false, onWorkspaceSelected },
      expect.anything(),
    )
    mount({
      sessionId,
      useSession: selector => selector(sessionSnapshot({ openState: 'closed' }) as never),
      useConversation: selector => selector(conversation as never),
      useSessions: selector => selector({
        ...sessions,
        byId: { [sessionId]: { ...sessions.byId[sessionId], blank: true } },
      } as never),
      renderFactorySlot,
      onWorkspaceSelected,
    })
    expect(renderFactorySlot).toHaveBeenLastCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'hero', hero: true, onWorkspaceSelected },
      expect.anything(),
    )
  })
})
