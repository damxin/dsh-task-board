/**
 * Session options for the execution-target pickers: the rows built from the
 * client session catalog (`sessions.list`), the same store the GUI sidebar
 * renders from. The create dialog and the detail page share this one
 * normalization, so they cannot promise different option sets.
 *
 * The catalog is a runtime fact of the deployment, not ledger state, and its
 * row type is deliberately NOT imported here: the picker must survive whatever
 * shape the runtime hands over (a failed read, an older client, a renamed
 * field), so every field read is guarded and an unreadable row is skipped —
 * never a thrown render.
 */
import type { ExecutionSessionOption } from '../../core/controller.ts'

/**
 * Upper bound on picker rows. A plain `<select>` listing every conversation of
 * a long-lived deployment is unusable, so only the most recently active ones
 * are offered. A pin to an older session still works — the run continues in it
 * regardless of the cap; the picker just shows the stale id as a "removed"
 * row, exactly as it would for a deleted conversation.
 */
const SESSION_OPTION_LIMIT = 50

/** A plain JSON object, or undefined for anything else (including arrays). */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** A non-empty string, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The last path segment of a directory path, for the cwd title fallback. */
function pathBasename(value: string): string {
  const segments = value.split(/[\\/]/).filter(segment => segment !== '')
  return segments[segments.length - 1] ?? value
}

/**
 * One picker row, or undefined when the entry carries no usable id. The record
 * key is the id on the wire, but a row may also name its own — the stored pin
 * is compared against what the picker offers, so the row's id wins and the key
 * is only the fallback.
 */
function rowOf(key: string, entry: Record<string, unknown>): ExecutionSessionOption | undefined {
  // A blank session is the GUI's own throwaway starting point — an empty new
  // conversation it keeps around, with no content a card could continue.
  // "Would a user ever pin this?" says no, so it is skipped; real
  // conversations (teammate rows included) stay offerable.
  if (entry.blank === true) return undefined
  const id = text(entry.id) ?? text(key)
  if (id === undefined) return undefined
  const cwd = text(entry.cwd)
  return {
    sessionId: id,
    title: text(entry.title) ?? text(entry.displayTitle) ?? (cwd !== undefined ? text(pathBasename(cwd)) : undefined) ?? id,
    // Anything but an explicit true reads as idle, so a malformed row can
    // never fake a "running" badge.
    running: entry.running === true,
    ...(typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? { updatedAt: entry.updatedAt } : {}),
  }
}

/**
 * Normalize the session catalog's `byId` record into picker rows: most
 * recently active first, so the common case (pin the conversation you were
 * just in) sits at the top of the list.
 * @param byId - the raw catalog record; anything unreadable yields fewer
 * rows, never a throw.
 * @returns the picker options, capped at {@link SESSION_OPTION_LIMIT}.
 */
export function sessionOptionsFromCatalog(byId: unknown): ExecutionSessionOption[] {
  const rows = record(byId)
  if (rows === undefined) return []
  const options: ExecutionSessionOption[] = []
  for (const [key, value] of Object.entries(rows)) {
    const entry = record(value)
    if (entry === undefined) continue
    const row = rowOf(key, entry)
    if (row !== undefined) options.push(row)
  }
  // Rows the catalog carries no timestamp for sort last (0 vs epoch ms), so
  // the cap always keeps the freshest conversations.
  options.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return options.slice(0, SESSION_OPTION_LIMIT)
}
