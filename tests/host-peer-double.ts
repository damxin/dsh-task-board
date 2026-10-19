/**
 * The target cohort's `Peer`, as the unit tests need it.
 *
 * The board constructs its owner Peer from `@deepseek-ai/dsh-client-connection`
 * because DSH 0.2.1-rc.2 requires every in-process Remote invocation to name
 * its Peer. The real `Peer` is built on the Host's own scope registry, so a
 * test that mounts the board against a capture-only fake context cannot
 * construct one — and the published cohort the suite resolves from `node_modules`
 * predates the `Peer` export entirely (it published `OperatorPeer`).
 *
 * This double keeps the target contract instead of the target class: it records
 * how it was created and exposes the `PeerScope` surface the gateway reads, so
 * the suite still proves the board creates ONE owner Peer and sends it with
 * every call. `vitest.config.ts` aliases the package onto this module.
 * @module tests/host-peer-double
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'

/** How each Peer this double built was created, newest last. */
export const createdPeers: { principal: unknown; interactions: unknown }[] = []

/** Construction options, mirroring the Host's `PeerOptions`. */
export interface PeerOptions {
  readonly principal: unknown
  readonly interactions?: 'answer' | 'none'
}

/**
 * Create the Host `Peer` under test, recording its options.
 * @param owner - the Context the real Peer would hang its scope under.
 * @param options - the principal (and interaction rights) the Peer speaks for.
 */
export function Peer(owner: Context, options: PeerOptions) {
  createdPeers.push({ principal: options.principal, interactions: options.interactions })
  const lifetime = new AbortController()
  return {
    id: randomUUID(),
    ctx: owner,
    principal: options.principal,
    interactions: options.interactions ?? 'answer',
    signal: lifetime.signal,
    dispose: async () => { lifetime.abort() },
  }
}
