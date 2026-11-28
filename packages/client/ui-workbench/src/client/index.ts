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
import { bindWorkbench } from './activity-source.ts'
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

/** Required services: slot registry, the Session controller, copy, and official workspace navigation. */
export const inject = ['slots', 'sessions', 'locale', 'uiWorkspace']

/**
 * Register the workbench dictionaries and the shell that occupies the frame slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const activity = bindWorkbench(ctx.sessions)
  const workspace = ctx.get('uiWorkspace') as WorkspaceNavigation
  const openWorkspace: WorkspaceSelectedHandler = (workspaceId, adopt) => (
    workspace.openWorkspace(workspaceId, (sessionId) => {
      adopt(sessionId)
      activity.followSession(sessionId)
    })
  )
  ctx.effect(() => activity.dispose, 'workbench: session')
  ctx.effect(() => ctx.locale.register('workbench', { zh, en, ja, es, fr, de, ru, pt }), 'workbench: copy')
  ctx.effect(() => ctx.slots.inject('workbench', () => ctx.slots.register({
    name: 'workbench',
    locale: 'workbench',
    children: {
      'workbench.composer': { kind: 'single', scope: 'session-maybe' },
    },
    inject: () => ({
      hooks: { activity: activity.view },
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
        if (files === undefined) return
        queueMicrotask(() => {
          try { files.openTab('files') }
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
