/**
 * Follow the desktop Session and publish a workbench view.
 * The followed Session is the one this composer started, or otherwise the Session
 * workspace navigation retains as `mainView`. That is the desktop app's live
 * agent session. The workflow engine is not consulted.
 */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { projectActivity, type ActivityEvent, type ActivityModel, type WorkbenchView } from './activity.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Desktop workbench following the Session it displays. */
    workbench: unknown
  }
}

/** Session events the fold reads. */
interface FollowedEvents {
  readonly entries: readonly { readonly type: string; readonly event: ActivityEvent }[]
}

/** The Session controller slice this shell uses. */
export interface WorkbenchSessions {
  /** Catalog and local retention, including the desktop main view. */
  readonly list: ObservableSnapshot<SessionListState>
  /**
   * Keep one Session's event window.
   * @param id - Session to follow.
   * @param options - this shell's reference source and an open event connection.
   * @returns a reference whose binding carries the event window and prompt verb.
   */
  retain(id: SessionId, options: { readonly source: 'workbench'; readonly connection: true }): {
    readonly binding: {
      readonly session: {
        prompt(
          content: { type: 'text'; text: string }[],
          mode: 'queue',
        ): Promise<{ ok: boolean }>
      }
      readonly eventSource: ObservableSnapshot<FollowedEvents>
    }
    /** Release this reference. */
    release(): void
  }
  /**
   * Create a Session when the desktop has not opened one.
   * @returns the new Session identity.
   */
  create(): Promise<SessionId>
}

const EMPTY_MODEL = projectActivity([])

function retainedCount(retained: object, source: string): number {
  const value = Object.getOwnPropertyDescriptor(retained, source)?.value
  return typeof value === 'number' ? value : 0
}

function mainViewId(list: SessionListState): SessionId | undefined {
  for (const id of list.ids) {
    const row = list.byId[id]
    if (row !== undefined && retainedCount(row.retainedBy, 'mainView') > 0) return id
  }
  return undefined
}

function eventsOf(entries: readonly { readonly type: string; readonly event: { readonly type: string; readonly time: number; readonly data: unknown } }[]): ActivityEvent[] {
  const events: ActivityEvent[] = []
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    events.push({ type: entry.event.type, time: entry.event.time, data: entry.event.data })
  }
  return events
}

/** Live workbench view and the composer send action. */
export interface WorkbenchActivity {
  /** Snapshot the shell reads through its injected hook. */
  readonly view: SnapshotStore<WorkbenchView>
  /**
   * Send one instruction into the followed Session, creating a Session when none is open.
   * @param text - draft text.
   * @returns whether the Host accepted the prompt.
   */
  send(text: string): Promise<boolean>
  /** Stop following and release the Session reference. */
  dispose(): void
}

/**
 * Subscribe to the current desktop Session and expose its workbench view.
 * @param sessions - client Session controller.
 * @returns the view store, send action, and disposer.
 */
export function bindWorkbench(sessions: WorkbenchSessions): WorkbenchActivity {
  const view = createSnapshotStore<WorkbenchView>({ ...EMPTY_MODEL, sending: false, failed: false })
  let model: ActivityModel = EMPTY_MODEL
  let sending = false
  let failed = false
  let ownedId: SessionId | undefined
  let followedId: SessionId | undefined
  let reference: ReturnType<WorkbenchSessions['retain']> | undefined
  let unsubscribeEvents: (() => void) | undefined
  let switching = false
  let disposed = false

  const publish = (next: ActivityModel): void => {
    model = next
    view.set({ ...next, sending, failed })
  }

  const releaseFollow = (): void => {
    unsubscribeEvents?.()
    unsubscribeEvents = undefined
    reference?.release()
    reference = undefined
    followedId = undefined
  }

  const follow = (): void => {
    if (switching || disposed) return
    const id = ownedId ?? mainViewId(sessions.list.getSnapshot())
    if (id === followedId) return
    switching = true
    try {
      releaseFollow()
      followedId = id
      if (id === undefined) {
        publish(EMPTY_MODEL)
        return
      }
      reference = sessions.retain(id, { source: 'workbench', connection: true })
      const source = reference.binding.eventSource
      const apply = (): void => { publish(projectActivity(eventsOf(source.getSnapshot().entries))) }
      unsubscribeEvents = source.subscribe(apply)
      apply()
    } finally {
      switching = false
    }
  }

  const unsubscribeList = sessions.list.subscribe(follow)
  follow()

  return {
    view,
    async send(text: string): Promise<boolean> {
      const trimmed = text.trim()
      if (trimmed === '' || sending || disposed) return false
      sending = true
      failed = false
      publish(model)
      try {
        if (followedId === undefined) {
          ownedId = await sessions.create()
          follow()
        }
        const session = reference?.binding.session
        if (session === undefined) {
          failed = true
          return false
        }
        const result = await session.prompt([{ type: 'text', text: trimmed }], 'queue')
        failed = !result.ok
        return result.ok
      } catch {
        // Create and prompt failures stay on the composer. The Session log remains the activity source.
        failed = true
        return false
      } finally {
        sending = false
        publish(model)
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      unsubscribeList()
      releaseFollow()
    },
  }
}
