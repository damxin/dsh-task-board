/**
 * `session/projections` answers in the wire shape the Host serves.
 *
 * DSH 0.2.1-rc.2 made the answer a discriminated union: a `sequenced` variant
 * carries complete values at an exact Session event cursor, while
 * `migration-required` carries only cached hints from a session log that has not
 * been migrated yet, and a session the Host cannot see answers `null`. Fixtures
 * that answer with a bare `{ values }` would encode the pre-0.2.1 shape, which
 * the runner deliberately refuses to read as evidence.
 * @module tests/projection-wire
 */

/** A complete baseline at an exact event cursor: the only variant the board reads. */
export function projectionBaseline(values: Record<string, unknown>, asOfSeq = 1): {
  kind: 'sequenced'
  asOfSeq: number
  values: Record<string, unknown>
} {
  return { kind: 'sequenced', asOfSeq, values }
}

/**
 * The answer a session whose log still has to be migrated gets. The hints are
 * what the projection cache happens to hold; they may name a preset, a model
 * selection or a goal, and none of it is authoritative.
 */
export function pendingMigrationProjections(values: Record<string, unknown> = {}): {
  kind: 'migration-required'
  values: Record<string, unknown>
} {
  return { kind: 'migration-required', values }
}
