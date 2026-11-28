/**
 * Official Conversation composer hosted in the workbench workflow column.
 * Renders the shared `conversation.content` factory so the InputBar, model
 * picker, permission control, attachments, and workspace picker stay on the
 * real DSH composer path.
 */
import type { ConversationViewsProps, WorkspaceSelectedHandler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Navigation injected into the workbench-hosted Conversation occurrence. */
export interface WorkbenchComposerInjected {
  /** Open the Workspace's Session as the official main Session, then adopt the draft. */
  readonly onWorkspaceSelected: WorkspaceSelectedHandler
}

/**
 * Props for the workbench composer: official Conversation factory, Session
 * sources, and the official workspace-open handler.
 */
export type WorkbenchComposerProps =
  & PropsRuntime<'workbench.composer'>
  & PropsRenderFactories
  & WorkbenchComposerInjected

/**
 * Fixed Chat selection used by the embedded workbench Conversation occurrence.
 * @param props - official Conversation view seat.
 * @returns the chat view of the current Session.
 */
export function WorkbenchConversationView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/**
 * Mount the official Conversation content and keep the composer on the official path.
 * Hero and phase follow the official embedded Conversation pattern so a missing
 * Session still offers the official workspace picker.
 * @param props - session-maybe slot runtime, factory renderer, and workspace handler.
 * @returns the official Conversation occurrence.
 */
export function WorkbenchComposer({
  sessionId, useSession, useConversation, useSessions, renderFactorySlot, onWorkspaceSelected,
}: WorkbenchComposerProps) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const summaryBlank = useSessions(state => sessionId === undefined ? undefined : state.byId[sessionId]?.blank)
  if (sessionId === undefined || session === undefined || conversation === undefined) {
    return renderFactorySlot('conversation.content', {
      variant: 'embedded',
      phase: 'hero',
      hero: true,
      onWorkspaceSelected,
    }, {
      slots: { views: WorkbenchConversationView },
    })
  }
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', {
    variant: 'embedded',
    phase,
    hero,
    onWorkspaceSelected,
  }, {
    slots: { views: WorkbenchConversationView },
  })
}
