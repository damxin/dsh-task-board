import { describe, expect, it } from 'vitest'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { sessionTarget, type SessionRoster } from '../src/core/session-target.ts'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Scheduled', description: '', prompt: 'run' }, 1, 'task-a'),
    ...overrides,
  }
}

function roster(
  sessions: readonly { sessionId: string; running: boolean }[],
  known = true,
): SessionRoster {
  return { known, sessions }
}

describe('sessionTarget — a card that pins a session', () => {
  it('mints a fresh session when the card pins none', () => {
    expect(sessionTarget(task(), roster([{ sessionId: 'session-a', running: false }]))).toEqual({ kind: 'fresh' })
    // An unknown roster costs an unpinned card nothing: there is no pin to prove.
    expect(sessionTarget(task(), undefined)).toEqual({ kind: 'fresh' })
  })

  it('continues in the pinned session when it exists and is idle', () => {
    expect(sessionTarget(task({ sessionId: 'session-a' }), roster([
      { sessionId: 'session-a', running: false },
      { sessionId: 'session-b', running: true },
    ]))).toEqual({ kind: 'pinned', sessionId: 'session-a' })
  })

  it('refuses a pinned session the roster no longer holds', () => {
    expect(sessionTarget(task({ sessionId: 'session-gone' }), roster([{ sessionId: 'session-a', running: false }])))
      .toEqual({ kind: 'unusable', sessionId: 'session-gone', reason: 'missing' })
  })

  it('refuses a pinned session another turn is using right now', () => {
    expect(sessionTarget(task({ sessionId: 'session-a' }), roster([{ sessionId: 'session-a', running: true }])))
      .toEqual({ kind: 'unusable', sessionId: 'session-a', reason: 'busy' })
  })

  it('refuses while the roster is unknown or unreadable', () => {
    // An unreadable roster cannot prove the pin exists, and this board fails
    // closed on every unusable pin rather than silently running somewhere else.
    expect(sessionTarget(task({ sessionId: 'session-a' }), undefined))
      .toEqual({ kind: 'unusable', sessionId: 'session-a', reason: 'roster-unknown' })
    expect(sessionTarget(task({ sessionId: 'session-a' }), roster([], false)))
      .toEqual({ kind: 'unusable', sessionId: 'session-a', reason: 'roster-unknown' })
  })

  it('refuses a team run: a Lead session is always minted fresh', () => {
    expect(sessionTarget(task({ sessionId: 'session-a', teamRun: true }), roster([{ sessionId: 'session-a', running: false }])))
      .toEqual({ kind: 'unusable', sessionId: 'session-a', reason: 'team' })
    // The team conflict is a property of the card alone: it is decided before
    // any roster read, so a card with no reachable roster says the same thing.
    expect(sessionTarget(task({ sessionId: 'session-a', teamRun: true }), undefined))
      .toEqual({ kind: 'unusable', sessionId: 'session-a', reason: 'team' })
  })

  it('supersedes the previous-session reuse option rather than racing it', () => {
    const both = task({ sessionId: 'session-pinned', reuseSession: true })
    expect(sessionTarget(both, roster([
      { sessionId: 'session-old', running: false },
      { sessionId: 'session-pinned', running: false },
    ]))).toEqual({ kind: 'pinned', sessionId: 'session-pinned' })
  })
})
