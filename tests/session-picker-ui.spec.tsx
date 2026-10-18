// @vitest-environment jsdom
/**
 * The pinned-session execution target (the session counterpart of the project
 * picker): a card can be pinned to an existing conversation, the picker offers
 * the deployment's sessions, a pinned card stands the workspace picker down,
 * a pin the runtime no longer lists stays visible instead of silently resetting,
 * and a NEW card never inherits a parent's session.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot, ExecutionSessionOption } from '../src/core/controller.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { openFormSection } from './form-sections.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
})

const SESSIONS: ExecutionSessionOption[] = [
  // The feed hands the picker its rows most-recent-first, so the list reads in
  // that order; the picker renders what it is given.
  { sessionId: 'session-b', title: 'Write the release notes', running: true, updatedAt: 20 },
  { sessionId: 'session-a', title: 'Refactor the parser', running: false, updatedAt: 10 },
]

function card(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Card', description: 'desc', prompt: 'work' }, 0, 'card-1'),
    ...overrides,
  }
}

function fakeController(
  options: { sessions?: readonly ExecutionSessionOption[] } = {},
  created: TaskRecord[] = [],
): BoardController {
  const snapshot: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: {
      workspaces: [{ workspaceId: 'ws-1', title: 'Alpha' }],
      presets: [],
      models: [],
      ...(options.sessions === undefined ? {} : { sessions: options.sessions }),
    },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      goalRunEnabled: true,
    },
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    updateTask: vi.fn(async () => true),
    createTaskConfirmed: vi.fn(async () => {
      created.push(card())
      return card()
    }),
    runTask: vi.fn(async () => true),
    openTask: vi.fn(),
    archiveTask: vi.fn(async () => true),
    // The detail overlay asks whether the board is Host-backed before it offers
    // its Host-only affordances (adding a subtask, for one).
    isHostBacked: () => true,
  } as unknown as BoardController
}

function render(node: React.ReactNode): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(node) })
  return container
}

/** The session picker: the select whose empty row means "a new session per run". */
function sessionSelect(container: HTMLElement): HTMLSelectElement {
  const select = [...container.querySelectorAll<HTMLSelectElement>('select')]
    .find(candidate => [...candidate.options].some(option => option.textContent === t('exec.session.everyRun')))
  if (select === undefined) throw new Error('no session picker')
  return select
}

/** The project picker: the select whose empty row means "the most recent one". */
function workspaceSelect(container: HTMLElement): HTMLSelectElement {
  const select = [...container.querySelectorAll<HTMLSelectElement>('select')]
    .find(candidate => [...candidate.options].some(option => option.textContent === t('exec.workspace.recent')))
  if (select === undefined) throw new Error('no workspace picker')
  return select
}

function choose(select: HTMLSelectElement, value: string): void {
  const prototype = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set
  prototype?.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function submit(container: HTMLElement): void {
  const form = container.querySelector('form')
  if (form === null) throw new Error('no modal form')
  act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}

describe('pinned-session picker in the card detail', () => {
  it('operator sees every session offered with its running state and picks one', () => {
    // Given a card with no session pin on a deployment with two conversations
    const controller = fakeController({ sessions: SESSIONS })
    const container = render(<TaskDetail controller={controller} task={card()} />)

    // When the user reads the picker
    const select = sessionSelect(container)

    // Then the default row means "a new session every run" and both sessions are
    // offered, a running one marked as such
    expect(select.options[0]!.textContent).toBe(t('exec.session.everyRun'))
    expect([...select.options].map(option => option.value)).toEqual(['', 'session-b', 'session-a'])
    expect([...select.options].map(option => option.textContent)).toContain(
      'Write the release notes' + t('exec.session.runningSuffix'),
    )
    expect(workspaceSelect(container).disabled).toBe(false)

    // And choosing one writes the pin through the controller
    choose(select, 'session-a')
    expect(controller.updateTask).toHaveBeenCalledWith('card-1', { sessionId: 'session-a' })
  })

  it('operator clearing the pin writes the empty value, which the ledger normalizes to no pin', () => {
    // Given a card already pinned to a session
    const controller = fakeController({ sessions: SESSIONS })
    const container = render(<TaskDetail controller={controller} task={card({ sessionId: 'session-a' })} />)

    // When the user returns to the default row
    const select = sessionSelect(container)
    expect(select.value).toBe('session-a')
    choose(select, '')

    // Then the same empty-string convention the workspace picker uses is written
    expect(controller.updateTask).toHaveBeenCalledWith('card-1', { sessionId: '' })
  })

  it('operator with a pinned card sees the project picker stood down with the reason', () => {
    // Given a card pinned to a session
    const controller = fakeController({ sessions: SESSIONS })
    const container = render(<TaskDetail controller={controller} task={card({ sessionId: 'session-a', workspaceId: 'ws-1' })} />)

    // When the user reads the execution settings
    // Then the session's own workspace governs, so the project picker is inactive
    // and says why instead of silently losing to the pin
    expect(workspaceSelect(container).disabled).toBe(true)
    expect(container.textContent).toContain(t('exec.session.workspaceHint'))
    expect(sessionSelect(container).disabled).toBe(false)
  })

  it('operator whose pinned session left the roster still sees which session the run asks for', () => {
    // Given a card pinned to a conversation the deployment no longer lists
    const controller = fakeController({ sessions: [{ sessionId: 'session-b', title: 'Other', running: false }] })
    const container = render(<TaskDetail controller={controller} task={card({ sessionId: 'session-gone' })} />)

    // When the user opens the picker
    const select = sessionSelect(container)

    // Then the stale pin stays selected as a removed row rather than resetting
    // the card to "a new session every run" behind the user's back
    expect(select.value).toBe('session-gone')
    expect([...select.options].map(option => option.textContent))
      .toContain('session-gone' + t('exec.session.removed'))
  })
})

describe('pinned-session picker in the new-task dialog', () => {
  it('user creating a card sends the session they picked', () => {
    // Given the new-task dialog on a deployment with two conversations
    const controller = fakeController({ sessions: SESSIONS })
    const container = render(<NewTaskModal controller={controller} onClose={() => {}} />)
    openFormSection(container, t('new.section.execution'))

    // When the user picks a session and submits
    const select = sessionSelect(container)
    choose(select, 'session-a')
    submit(container)

    // Then the create payload carries the pin
    expect(controller.createTaskConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-a' }),
    )
  })

  it('user leaving the picker at its default sends no pin at all', () => {
    // Given the new-task dialog with no session chosen
    const controller = fakeController({ sessions: SESSIONS })
    const container = render(<NewTaskModal controller={controller} onClose={() => {}} />)

    // When the user submits
    submit(container)

    // Then the key is omitted rather than sent empty, exactly like the other
    // execution targets
    const payload = (controller.createTaskConfirmed as unknown as { mock: { calls: [{ sessionId?: string }][] } }).mock.calls[0]![0]
    expect('sessionId' in payload).toBe(false)
  })

  it('user creating a subtask of a session-pinned parent does not inherit its conversation', () => {
    // Given a parent pinned to a session, whose members run concurrently
    const parent = card({ id: 'parent', sessionId: 'session-a' })
    const controller = fakeController({ sessions: SESSIONS })
    const container = render(<NewTaskModal controller={controller} parentTask={parent} onClose={() => {}} />)

    // When the user reads the execution region and submits
    openFormSection(container, t('new.section.execution'))
    expect(sessionSelect(container).value).toBe('')
    submit(container)

    // Then no pin travels down: several members prompting into one conversation
    // would interleave their turns
    const payload = (controller.createTaskConfirmed as unknown as { mock: { calls: [{ sessionId?: string }][] } }).mock.calls[0]![0]
    expect('sessionId' in payload).toBe(false)
  })

  it('user duplicating a card keeps its session pin and the project picker stands down', () => {
    // Given a source card pinned to a session
    const source = card({ id: 'source', sessionId: 'session-a' })
    const controller = fakeController({ sessions: SESSIONS })
    const container = render(<NewTaskModal controller={controller} initialTask={source} onClose={() => {}} />)

    // When the user opens the execution region
    openFormSection(container, t('new.section.execution'))

    // Then the duplicate starts on the same conversation, with the reason shown
    expect(sessionSelect(container).value).toBe('session-a')
    expect(workspaceSelect(container).disabled).toBe(true)
    expect(container.textContent).toContain(t('exec.session.workspaceHint'))
  })
})
