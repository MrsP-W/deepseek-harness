/**
 * Desktop workbench plugin, browser half.
 * Registers the shell into the layout frame's `workbench` slot and follows
 * the current desktop Session so the shell can show its steps, trace, and files.
 * The frame decides when that slot replaces the three columns.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceSelectedHandler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindWorkbench } from './activity-source.ts'
import { EMPTY_MONITOR, type MonitorBridge, type MonitorSnapshot } from './monitor/model.ts'
import { pollMonitor, type LogCursor } from './monitor/poll.ts'
import { WorkbenchComposer } from './WorkbenchComposer.tsx'
import { WorkbenchShell } from './WorkbenchShell.tsx'
import {
  de, en, es, fr, ja, pt, ru, zh, type WorkbenchKey,
} from './locales/workbench.ts'

export type { WorkbenchKey } from './locales/workbench.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop workbench shell copy. */
    workbench: WorkbenchKey
  }
}

/** Official workspace navigation used by the composer and the session rail. */
interface WorkspaceNavigation {
  openWorkspace(
    workspaceId: Parameters<WorkspaceSelectedHandler>[0],
    beforeOpen: (sessionId: SessionId) => void,
  ): Promise<void>
  startSession(): void
}

/** Official right-sidebar controller used to open the workspace files page. */
interface FilesSidebar {
  openTab(kind: string): void
}

function desktopBridge(): MonitorBridge | undefined {
  const desktop = (globalThis as typeof globalThis & { dshDesktop?: { generationMonitor?: MonitorBridge } }).dshDesktop
  return desktop?.generationMonitor
}

/**
 * Poll local Codex and Antigravity logs while the bridge exists.
 * @param publish - receive each snapshot.
 * @returns stop the poll.
 */
export function startMonitor(publish: (snapshot: MonitorSnapshot) => void): () => void {
  const bridge = desktopBridge()
  if (bridge === undefined) return () => {}
  const cursors = new Map<string, LogCursor>()
  let stopped = false
  const tick = (): void => {
    void pollMonitor(bridge, cursors, Date.now()).then((snapshot) => {
      if (!stopped) publish(snapshot)
    }).catch((_error: unknown) => {
      // A failed read keeps the previous snapshot. The next poll tries again.
      return undefined
    })
  }
  const unsubscribe = bridge.subscribe(tick)
  const timer = setInterval(tick, 1500)
  tick()
  return () => {
    stopped = true
    clearInterval(timer)
    unsubscribe()
  }
}

/** Required services: slot registry, the Session controller, copy, and official workspace navigation. */
export const inject = ['slots', 'sessions', 'locale', 'uiWorkspace']

/**
 * Register the workbench dictionaries and the shell that occupies the frame slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const activity = bindWorkbench(ctx.sessions)
  const monitor = createSnapshotStore<MonitorSnapshot>(EMPTY_MONITOR)
  const workspace = ctx.get('uiWorkspace') as WorkspaceNavigation
  const openWorkspace: WorkspaceSelectedHandler = (workspaceId, adopt) => (
    workspace.openWorkspace(workspaceId, (sessionId) => {
      adopt(sessionId)
      activity.followSession(sessionId)
    })
  )
  ctx.effect(() => activity.dispose, 'workbench: session')
  ctx.effect(() => startMonitor(snapshot => monitor.set(snapshot)), 'workbench: monitor')
  ctx.effect(() => ctx.locale.register('workbench', { zh, en, ja, es, fr, de, ru, pt }), 'workbench: copy')
  ctx.effect(() => ctx.slots.inject('workbench', () => ctx.slots.register({
    name: 'workbench',
    locale: 'workbench',
    children: {
      'workbench.composer': { kind: 'single', scope: 'session-maybe' },
    },
    inject: () => ({
      hooks: { activity: activity.view, monitor: monitor },
      send: (text: string) => activity.send(text),
      sessionOf: () => activity.currentReference(),
      startSession: () => { workspace.startSession() },
      openSessions: (open: boolean) => {
        window.dispatchEvent(new CustomEvent('dsh:workbench-sessions', { detail: { open } }))
      },
      openFiles: (open: boolean) => {
        window.dispatchEvent(new CustomEvent('dsh:workbench-files', { detail: { open } }))
        if (!open) return
        const files = ctx.get('sidebarRight') as FilesSidebar | undefined
        queueMicrotask(() => {
          try { files?.openTab('files') }
          catch { /* No official Session is on screen yet; the files host still mounts. */ }
        })
      },
      openSettings: () => {
        window.dispatchEvent(new CustomEvent('dsh:open-settings'))
      },
    }),
  }, WorkbenchShell)), 'workbench: shell')
  ctx.effect(() => ctx.slots.inject('workbench.composer', () => ctx.slots.register({
    name: 'workbench.composer',
    inject: () => ({ onWorkspaceSelected: openWorkspace }),
  }, WorkbenchComposer)), 'workbench: composer')
}
