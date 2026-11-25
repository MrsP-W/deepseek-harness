/**
 * Desktop workbench plugin, browser half.
 * Registers the shell into the layout frame's `workbench` slot.
 * The frame decides when that slot replaces the three columns.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
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

/** Required services: slot registry and copy. */
export const inject = ['slots', 'locale']

/**
 * Register the workbench dictionaries and the shell that occupies the frame slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('workbench', { zh, en, ja, es, fr, de, ru, pt }), 'workbench: copy')
  ctx.effect(() => ctx.slots.inject('workbench', () => ctx.slots.register({
    name: 'workbench',
    locale: 'workbench',
  }, WorkbenchShell)), 'workbench: shell')
}
