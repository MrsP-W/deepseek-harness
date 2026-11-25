/** Session events become workbench steps, a trace, and the file being written. */
import { describe, expect, it } from 'vitest'
import { formatClock, projectActivity, type ActivityEvent } from '../src/client/activity.ts'

const at = Date.UTC(2026, 10, 25, 6, 32, 5)

function event(type: string, data: unknown, time = at): ActivityEvent {
  return { type, time, data }
}

describe('projectActivity', () => {
  it('starts with one waiting step and no file', () => {
    expect(projectActivity([])).toEqual({
      steps: [{ id: 'waiting', title: '', status: 'waiting' }],
      trace: [],
      file: null,
    })
  })

  it('shows the turn, then the written file, then an edit on that file', () => {
    const content = 'export const amount = 1\n'
    const first = projectActivity([
      event('turn/start', { turn: 1 }),
      event('user/message', { content: [{ type: 'text', text: '补上分账' }] }),
      event('tool/call', {
        callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: 'src/lib/split.ts', content }),
      }),
    ])
    expect(first.steps).toMatchObject([{ id: 'turn-1', title: '补上分账', status: 'active', detail: 'writing', path: 'src/lib/split.ts' }])
    expect(first.trace).toMatchObject([{ id: 'w1', kind: 'write', action: 'write', status: 'running', path: 'src/lib/split.ts' }])
    expect(first.file?.path).toBe('src/lib/split.ts')
    expect(first.file?.lines).toEqual(['export const amount = 1', ''])
    expect(first.file?.badge).toBe('TS')
    expect(first.trace[0]?.time).toBe(formatClock(at, true))

    const edited = projectActivity([
      event('turn/start', { turn: 1 }),
      event('user/message', { content: [{ type: 'text', text: '补上分账' }] }),
      event('tool/call', {
        callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: 'src/lib/split.ts', content }),
      }),
      event('tool/result', { message: { toolCallId: 'w1', isError: false } }),
      event('tool/call', {
        callId: 'e1', name: 'edit',
        arguments: JSON.stringify({ file_path: 'src/lib/split.ts', old_string: 'amount = 1', new_string: 'amount = 2', replace_all: false }),
      }),
      event('todo/write', { todos: [{ content: '编写核心模块', status: 'in_progress' }, { content: '补充测试', status: 'pending' }] }),
    ])
    expect(edited.steps).toEqual([
      { id: 'todo-0', title: '编写核心模块', status: 'active', detail: 'editing', path: 'src/lib/split.ts' },
      { id: 'todo-1', title: '补充测试', status: 'waiting' },
    ])
    expect(edited.file?.lines[0]).toBe('export const amount = 2')
    expect(edited.trace.map(row => row.status)).toEqual(['done', 'running'])
    expect(edited.trace[1]?.lines).toBe('1')
  })

  it('marks a refused tool call and reads an added patch file', () => {
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/lib/split.ts',
      '+export const amount = 1',
      '*** End Patch',
    ].join('\n')
    const view = projectActivity([
      event('tool/call', { callId: 'p1', name: 'apply_patch', arguments: JSON.stringify({ input: patch }) }),
      event('tool/result', { message: { toolCallId: 'p1', isError: true } }),
      event('turn/start', { turn: 2 }),
      event('turn/end', { turn: 2, reason: { kind: 'error' } }),
    ])
    expect(view.file?.lines).toEqual(['export const amount = 1'])
    expect(view.trace[0]?.status).toBe('error')
    expect(view.steps).toMatchObject([{ id: 'turn-2', status: 'error' }])
  })

  it('keeps the other tool, edit, and patch branches', () => {
    const long = '字'.repeat(90)
    const replaced = projectActivity([
      event('turn/end', { turn: 0, reason: { kind: 'aborted' } }),
      event('user/message', { content: 'plain text' }),
      event('user/message', { content: null }),
      event('todo/write', { todos: 'nope' }),
      event('todo/write', { todos: [null] }),
      event('todo/write', { todos: [{ content: 'x', status: 'later' }] }),
      event('tool/call', { callId: 'empty', name: 'write', arguments: '' }),
      event('tool/call', { callId: 'w-miss', name: 'write', arguments: JSON.stringify({ file_path: 'only-path.ts' }) }),
      event('tool/call', { callId: 'e-miss', name: 'edit', arguments: JSON.stringify({ file_path: 'only-path.ts', old_string: 'a' }) }),
      event('tool/call', { callId: 'p-miss', name: 'apply_patch', arguments: '{}' }),
      event('assistant/message', {}),
      event('user/message', { content: long }),
      event('turn/start', { turn: 'nope' }),
      event('turn/start', { turn: 3 }),
      event('user/message', { content: '第一行\n第二行' }),
      event('user/message', { content: [{ type: 'image' }, { type: 'text', text: '忽略' }] }),
      event('tool/call', { name: 'write', arguments: '{}' }),
      event('tool/call', { callId: 'w0', name: 'write', arguments: JSON.stringify({ file_path: 'a.txt', content: '' }) }),
      event('tool/call', { callId: 'e0', name: 'edit', arguments: JSON.stringify({ file_path: 'a.txt', old_string: '', new_string: 'x' }) }),
      event('tool/call', { callId: 'e1', name: 'edit', arguments: JSON.stringify({ file_path: 'missing.ts', old_string: 'a', new_string: 'b' }) }),
      event('tool/call', { callId: 'e2', name: 'edit', arguments: JSON.stringify({ file_path: 'a.txt', old_string: 'nope', new_string: 'b' }) }),
      event('tool/call', {
        callId: 'e3', name: 'edit',
        arguments: JSON.stringify({ file_path: 'a.txt', old_string: 'x', new_string: 'y', replace_all: true }),
      }),
      event('tool/call', { callId: 't1', name: 'todo_write', arguments: '{}' }),
      event('tool/call', { callId: 'p0', name: 'apply_patch', arguments: JSON.stringify({ input: '*** Update File: a.txt' }) }),
      event('tool/call', { callId: 'p1', name: 'apply_patch', arguments: JSON.stringify({
        input: [
          '*** Add File: ',
          '*** Add File: src/lib/empty.ts',
          '+',
          '*** Add File: /src//notes',
          '+alpha',
          '+beta',
        ].join('\n'),
      }) }),
      event('tool/result', { message: {} }),
      event('tool/result', {}),
      event('todo/write', { todos: [{ content: long, status: 'completed' }, { content: '下一步', status: 'pending' }] }),
      event('tool/call', { callId: 'w1', name: 'write', arguments: JSON.stringify({ file_path: '/src//kept.ts', content: 'hello hello' }) }),
      event('tool/call', { callId: 'e6', name: 'edit', arguments: JSON.stringify({ file_path: '/src//kept.ts', old_string: 'hello', new_string: 'h\nh', replace_all: true }) }),
      event('tool/call', { callId: 'e5', name: 'edit', arguments: JSON.stringify({ file_path: '/src//kept.ts', old_string: 'h\nh', new_string: '' }) }),
      event('tool/call', { callId: 'e4', name: 'edit', arguments: JSON.stringify({ file_path: '/src//kept.ts', old_string: 'absent', new_string: 'b' }) }),
      event('turn/end', { turn: 3, reason: { kind: 'completed' } }),
    ])
    expect(replaced.steps[0]?.title).toHaveLength(80)
    expect(replaced.steps[0]?.status).toBe('done')
    expect(replaced.trace.some(row => row.action === 'todo')).toBe(true)
    expect(replaced.trace.some(row => row.path?.includes('notes'))).toBe(true)
    expect(replaced.file?.path).toBe('/src//kept.ts')
    const blank = projectActivity([
      event('tool/call', { callId: 'blank', name: 'write', arguments: JSON.stringify({ file_path: '', content: 'z' }) }),
    ])
    expect(blank.file?.badge).toBe('')
    expect(blank.file?.crumbs).toEqual([])
  })

  it('ignores a tool call whose arguments are not JSON', () => {
    const view = projectActivity([
      event('tool/call', { callId: 'b1', name: 'bash', arguments: '{not json' }),
    ])
    expect(view.trace).toMatchObject([{ id: 'b1', action: 'call', kind: 'bash', status: 'running' }])
    expect(view.file).toBeNull()
  })
})
