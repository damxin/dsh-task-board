/**
 * Pinned-session rule: decides, for one card, whether an execution may run
 * inside the DSH session the card pins, or whether the pin must be refused.
 * Pure, so the fail-closed conditions stay unit-testable without a gateway —
 * the same discipline as `session-reuse.ts`, whose question this one inverts:
 * reuse decides whether to continue the card's OWN previous conversation, a
 * pin decides whether to run inside a conversation the user chose.
 */
import type { TaskRecord } from './tasks.ts'

/**
 * One session the board can currently see, and whether some turn is using it
 * right now. Structural on purpose (a subset of the roster row the Host reads
 * from `session/list`), so this module and its tests need no SDK session type.
 */
export interface SessionRosterEntry {
  /** The DSH session id. */
  sessionId: string
  /** True while a turn in that session is still running. */
  running: boolean
}

/**
 * The roster one launch reads before it trusts a pin. `known: false` means
 * the read failed or was not offered, so the list proves nothing either way —
 * exactly the posture an unknown roster already takes against
 * `reuseSessionFor`.
 */
export interface SessionRoster {
  /** False when the roster could not be read and must not be trusted. */
  known: boolean
  /** The sessions the read saw, in roster order. */
  sessions: readonly SessionRosterEntry[]
}

/** Why a pinned session cannot host this execution; also the Host error key. */
export type SessionPinRefusal = 'missing' | 'busy' | 'roster-unknown' | 'team'

/**
 * What a launch does with the card's pinned session:
 * - `fresh`: no pin — the launch path keeps minting a conversation (or
 *   honouring `reuseSession` upstream); this module deliberately does not
 *   decide reuse, so the two options compose instead of competing;
 * - `pinned`: run inside that conversation;
 * - `unusable`: the pin cannot be honored this run, with the reason the Host
 *   reports — the board fails closed rather than silently retargeting.
 */
export type SessionTargetVerdict =
  | { kind: 'fresh' }
  | { kind: 'pinned'; sessionId: string }
  | { kind: 'unusable'; sessionId: string; reason: SessionPinRefusal }

/**
 * Resolve what an execution of this card does about its pinned session.
 *
 * The order of the checks is the order of their authority: the card's own
 * options first (a team run must mint a fresh Lead session and derive its
 * immutable teammates from it, so no pin can ever apply), then whether the
 * roster can prove anything at all, and only then the roster's own verdict
 * about that one session. An unreadable roster refuses the pin rather than
 * trusting it, because the board settles the run by reading that session's
 * turn history — prompting into a conversation we cannot see is the one
 * failure `fresh` cannot have, and the pin must never introduce it.
 * @param task - the card about to run.
 * @param roster - the roster this launch read itself, or undefined when the
 *   Host has none to offer.
 * @returns `pinned` only when the session is visible, idle, and reachable
 *   outside a team run; every other shape returns `fresh` or a refusal.
 */
export function sessionTarget(
  task: TaskRecord,
  roster: SessionRoster | undefined,
): SessionTargetVerdict {
  // Normalized like every stored target string: trim, and a blank pin reads
  // as "no pin" so a hand-edited blank collapses to the historical behavior
  // instead of a pin that can never resolve.
  const sessionId = typeof task.sessionId === 'string' ? task.sessionId.trim() : ''
  if (sessionId === '') return { kind: 'fresh' }
  // A team run's Lead session is the root of its Team; teammates are spawned
  // from it and the settlement rule reads the Team through it. Running the
  // Lead inside a pinned conversation would entangle two Teams' worth of
  // history in one transcript, so the pin is refused outright.
  if (task.teamRun === true) return { kind: 'unusable', sessionId, reason: 'team' }
  // An unknown roster cannot prove the pinned session exists, and this board
  // fails closed on unusable pins — the same discipline as an unknown roster
  // refusing `reuseSession`. Launching would either fail at session lookup or
  // (worse) succeed into a conversation the settlement path cannot read.
  if (roster === undefined || roster.known !== true) {
    return { kind: 'unusable', sessionId, reason: 'roster-unknown' }
  }
  const entry = roster.sessions.find(candidate => candidate.sessionId === sessionId)
  // Absent from the roster means the session is gone (deleted, another
  // deployment's, or an id typo) — the pin names something that is not there.
  if (entry === undefined) return { kind: 'unusable', sessionId, reason: 'missing' }
  // Busy means another turn owns the conversation right now. The board
  // settles this execution by reading that session's turn history, so two
  // writers would make the verdict unattributable; the pin waits for a run
  // where the conversation is idle.
  if (entry.running) return { kind: 'unusable', sessionId, reason: 'busy' }
  return { kind: 'pinned', sessionId }
}
