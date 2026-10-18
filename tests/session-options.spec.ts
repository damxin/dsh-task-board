import { describe, expect, it } from 'vitest'
import { sessionOptionsFromCatalog } from '../src/client/board/session-options.ts'

describe('sessionOptionsFromCatalog', () => {
  it('offers the catalog rows with their title and running state', () => {
    const options = sessionOptionsFromCatalog({
      'session-a': { id: 'session-a', title: 'Refactor the parser', running: false, updatedAt: 10 },
      'session-b': { id: 'session-b', displayTitle: 'dsh-task-board', cwd: 'D:/work/board', running: true, updatedAt: 20 },
    })
    expect(options).toEqual([
      // Most recently active first: pinning the conversation you were just in
      // is the common case, so it sits at the top.
      { sessionId: 'session-b', title: 'dsh-task-board', running: true, updatedAt: 20 },
      { sessionId: 'session-a', title: 'Refactor the parser', running: false, updatedAt: 10 },
    ])
  })

  it('falls back through title, display title, directory name and the raw id', () => {
    const options = sessionOptionsFromCatalog({
      a: { title: 'Named', displayTitle: 'Shown', cwd: '/x/y' },
      b: { displayTitle: 'Shown', cwd: '/x/y' },
      c: { cwd: '/x/y' },
      d: {},
    })
    expect(options.map(option => option.title)).toEqual(['Named', 'Shown', 'y', 'd'])
  })

  it('skips blank throwaway conversations and rows that are not records', () => {
    const options = sessionOptionsFromCatalog({
      real: { id: 'session-real' },
      empty: { id: 'session-empty', blank: true },
      broken: 'not-a-row',
      nullish: null,
    })
    expect(options.map(option => option.sessionId)).toEqual(['session-real'])
  })

  it('falls back to the record key when a row names no id of its own', () => {
    // The catalog keys its rows by session id, so a row without its own id
    // still identifies a conversation — the key is the fallback, not a guess.
    const options = sessionOptionsFromCatalog({ 'session-keyed': { title: 'Keyed row' } })
    expect(options).toEqual([{ sessionId: 'session-keyed', title: 'Keyed row', running: false }])
  })

  it('reads a malformed catalog as no options instead of throwing', () => {
    expect(sessionOptionsFromCatalog(undefined)).toEqual([])
    expect(sessionOptionsFromCatalog(null)).toEqual([])
    expect(sessionOptionsFromCatalog([])).toEqual([])
    expect(sessionOptionsFromCatalog('nonsense')).toEqual([])
    // A row whose fields are all the wrong type still renders off the record
    // key, with no badge and no timestamp: a bad row must never fake a running
    // marker or a bogus recency.
    expect(sessionOptionsFromCatalog({ x: { id: 7, running: 'yes', updatedAt: 'soon' } }))
      .toEqual([{ sessionId: 'x', title: 'x', running: false }])
    expect(sessionOptionsFromCatalog({ y: { id: 'session-y', running: 'yes', updatedAt: 'soon' } }))
      .toEqual([{ sessionId: 'session-y', title: 'session-y', running: false }])
  })

  it('caps the list at the most recently active rows', () => {
    const byId: Record<string, { id: string; updatedAt: number }> = {}
    for (let index = 0; index < 80; index += 1) {
      byId['session-' + index] = { id: 'session-' + index, updatedAt: index }
    }
    const options = sessionOptionsFromCatalog(byId)
    expect(options).toHaveLength(50)
    expect(options[0]?.sessionId).toBe('session-79')
    expect(options[49]?.sessionId).toBe('session-30')
  })

  it('sorts rows without a usable timestamp last, so the cap keeps fresh conversations', () => {
    const options = sessionOptionsFromCatalog({
      stale: { id: 'stale' },
      fresh: { id: 'fresh', updatedAt: 5 },
    })
    expect(options.map(option => option.sessionId)).toEqual(['fresh', 'stale'])
  })
})
