import {
  D2_PHASE_ORDER,
  phaseDependencies,
  type D2Phase,
  type D2ShardId,
} from './d2ShardManifest';
import type { D2Receipt } from './d2Evidence';

/**
 * Scheduling and payload access for the D2 diagnostic.
 *
 * Two separate concerns, deliberately kept in separate function signatures:
 *
 *  - `scheduleD2` decides *what runs next*. It is a function of the manifest
 *    and the set of completed shard ids and nothing else, so no control-flow
 *    decision can depend on an outcome value. "Look at partial results, then
 *    decide whether to keep going" is not expressible here, rather than merely
 *    being forbidden by convention.
 *  - `readD2Payloads` decides *what a shard may read*. Access is granted per
 *    (phase, split) and only from a fully complete earlier phase, which is how
 *    the D1 freeze boundary — Fit sees only an authenticated train batch, test
 *    labels materialize only after both final models freeze — survives being
 *    split across processes.
 */

export function shardPhase(shardId: D2ShardId): D2Phase {
  const phase = shardId.split('/')[0] as D2Phase;
  if (!D2_PHASE_ORDER.includes(phase)) {
    throw new D2SchedulerError('unknown-shard-phase');
  }
  return phase;
}

export type D2SchedulerErrorReason =
  | 'unknown-shard-phase'
  | 'test-before-freeze'
  | 'capability-denied';

export class D2SchedulerError extends Error {
  readonly name = 'D2SchedulerError';
  constructor(readonly reason: D2SchedulerErrorReason) {
    super(`D2 scheduler:${reason}`);
  }
}

export class D2FreezeBoundaryError extends Error {
  readonly name = 'D2FreezeBoundaryError';
  readonly reason = 'test-before-freeze' as const;
  constructor(readonly detail: string) {
    super(`D2 runtime-fail:test-before-freeze:${detail}`);
  }
}

const FIT_SIDE_PHASES: readonly D2Phase[] = Object.freeze(['fit', 'selection', 'final-freeze']);

const shardsOfPhase = (shardIds: readonly D2ShardId[], phase: D2Phase): readonly D2ShardId[] =>
  shardIds.filter((shardId) => shardPhase(shardId) === phase);

const phaseComplete = (
  shardIds: readonly D2ShardId[],
  completed: ReadonlySet<D2ShardId>,
  phase: D2Phase,
): boolean => shardsOfPhase(shardIds, phase).every((shardId) => completed.has(shardId));

const anyOfPhaseComplete = (
  shardIds: readonly D2ShardId[],
  completed: ReadonlySet<D2ShardId>,
  phase: D2Phase,
): boolean => shardsOfPhase(shardIds, phase).some((shardId) => completed.has(shardId));

/**
 * Rebuild the freeze state machine from receipts rather than from in-process
 * memory, so it holds across episodes.  Two holes are closed here: a test
 * receipt with no final-freeze receipt, and a fit-side receipt appearing after
 * test labels already exist.
 */
export function assertD2FreezeBoundary(
  shardIds: readonly D2ShardId[],
  completed: ReadonlySet<D2ShardId>,
): void {
  if (!anyOfPhaseComplete(shardIds, completed, 'label-test')) return;
  if (!phaseComplete(shardIds, completed, 'final-freeze')) {
    throw new D2FreezeBoundaryError('test-receipt-without-final-freeze');
  }
  // Silently skipping an incomplete fit-side shard here would strand the run:
  // aggregate could never be scheduled, and the episode would degenerate into
  // repeated `aggregate-missing` with no failing shard to promote. The state is
  // impossible under the phase order, so it is a boundary breach.
  for (const phase of FIT_SIDE_PHASES) {
    if (!phaseComplete(shardIds, completed, phase)) {
      throw new D2FreezeBoundaryError(`test-receipt-with-incomplete-${phase}`);
    }
  }
}

/**
 * Payload-blind. The signature is the enforcement: there is no parameter
 * through which an outcome could reach this function.
 */
export function scheduleD2(
  manifest: { readonly shardIds: readonly D2ShardId[] },
  completed: ReadonlySet<D2ShardId>,
): readonly D2ShardId[] {
  const { shardIds } = manifest;
  assertD2FreezeBoundary(shardIds, completed);
  const testStarted = anyOfPhaseComplete(shardIds, completed, 'label-test');

  return shardIds.filter((shardId) => {
    if (completed.has(shardId)) return false;
    const phase = shardPhase(shardId);
    // Once test labels exist the fit side is sealed; re-running it would be a
    // refit after seeing held-out data.
    if (testStarted && FIT_SIDE_PHASES.includes(phase)) return false;
    return phaseDependencies(phase).every((dependency) =>
      phaseComplete(shardIds, completed, dependency));
  });
}

/**
 * Which phases' payloads each phase may read.  Transcribed from the design's
 * capability table; the `label-*` rows carry no label, fit or model payload
 * because a label shard must never see a model, a freeze record, or another
 * split's labels.
 *
 * `capture` appears in every downstream row because the captured states are
 * the protocol's frozen *input*, not an outcome: they are the only thing from
 * which a later episode can rebuild the placement manifest and the context
 * batch (design §7.3 — the chain is rebuilt within each episode from validated
 * receipts).  Withholding them would not tighten any of the design's stated
 * denials; it would only make the sharded model unimplementable, because every
 * phase after `capture` needs the boards to re-derive its own tasks.  The
 * denials that carry the weight are the ones below: `fit` cannot see
 * `label-validation` or `label-test`, `selection` and `final-freeze` cannot
 * see `label-test`, and no label shard can see a model or a freeze record.
 */
const READABLE: Readonly<Record<D2Phase, readonly D2Phase[]>> = Object.freeze({
  capture: Object.freeze([]),
  'label-train': Object.freeze(['capture' as const]),
  'label-validation': Object.freeze(['capture' as const]),
  'label-test': Object.freeze(['capture' as const]),
  fit: Object.freeze(['capture' as const, 'label-train' as const]),
  // `label-train` is here, wider than the design's table, and the reason is
  // structural rather than convenient. `selectD1Lambda` will only accept
  // *authenticated* `D1FitResult` objects, whose authority is a WeakMap entry
  // bound to the train batch that produced them; a fit receipt is JSON and
  // carries no authority, so a `selection` shard cannot use the fit payloads
  // as the design's table imagines. It must rebuild the fits in process from
  // the receipted train projections, which is the same rebuild §7.3 already
  // requires of every resumed episode. The invariant that carries the weight
  // is untouched: the fitter still only ever sees the train batch, and nothing
  // on the fit side can reach `label-test`.
  selection: Object.freeze([
    'capture' as const, 'label-train' as const, 'label-validation' as const, 'fit' as const,
  ]),
  'final-freeze': Object.freeze([
    'capture' as const, 'label-train' as const, 'label-validation' as const, 'selection' as const,
  ]),
  replay: Object.freeze(['capture' as const, 'label-test' as const]),
  aggregate: Object.freeze([
    'capture' as const,
    'label-train' as const, 'label-validation' as const, 'label-test' as const,
    'fit' as const, 'selection' as const, 'final-freeze' as const,
  ]),
});

export function readablePhases(phase: D2Phase): readonly D2Phase[] {
  return READABLE[phase];
}

export interface D2PayloadCapability {
  readonly phase: D2Phase;
}

interface CapabilityRecord {
  readonly phase: D2Phase;
  readonly receipts: ReadonlyMap<D2ShardId, D2Receipt>;
  readonly completed: ReadonlySet<D2ShardId>;
  readonly shardIds: readonly D2ShardId[];
}

/**
 * Private registry.  A capability is recognised by object identity, so a
 * copied, spread, JSON round-tripped, or hand-built lookalike is not a
 * capability.
 */
const CAPABILITIES = new WeakMap<D2PayloadCapability, CapabilityRecord>();

/**
 * Mint a capability for one phase.
 *
 * This function is an ordinary module export, so an executor could import it
 * and mint itself an `aggregate` capability. What makes that harmless is that
 * minting one requires a receipts map, and nothing reachable from a
 * `D2ShardExecutionContext` carries one: the context holds a capability, and a
 * capability is an opaque frozen `{ phase }` token. A self-granted capability
 * can therefore only ever expose payloads its holder already had. That is the
 * enforced property, and `d2Scheduler.test.ts` pins it.
 *
 * Scoping the stored record to the readable phases adds nothing observable on
 * top of the read-time check — it is defense in depth, bounding what a leaked
 * record could expose, and no test can distinguish it.
 */
export function grantD2PayloadCapability(input: {
  readonly phase: D2Phase;
  readonly shardIds: readonly D2ShardId[];
  readonly receipts: ReadonlyMap<D2ShardId, D2Receipt>;
  readonly completed: ReadonlySet<D2ShardId>;
}): D2PayloadCapability {
  const readable = new Set(readablePhases(input.phase));
  const scoped = new Map<D2ShardId, D2Receipt>();
  for (const [shardId, receipt] of input.receipts) {
    if (readable.has(shardPhase(shardId))) scoped.set(shardId, receipt);
  }
  const capability: D2PayloadCapability = Object.freeze({ phase: input.phase });
  CAPABILITIES.set(capability, {
    phase: input.phase,
    receipts: scoped,
    completed: input.completed,
    shardIds: input.shardIds,
  });
  return capability;
}

export function readD2Payloads(
  capability: D2PayloadCapability,
  from: D2Phase,
): readonly { readonly shardId: D2ShardId; readonly payload: unknown }[] {
  const record = CAPABILITIES.get(capability);
  if (record === undefined) throw new D2SchedulerError('capability-denied');
  if (!readablePhases(record.phase).includes(from)) throw new D2SchedulerError('capability-denied');
  if (!phaseComplete(record.shardIds, record.completed, from)) {
    throw new D2SchedulerError('capability-denied');
  }
  return shardsOfPhase(record.shardIds, from).map((shardId) => {
    const receipt = record.receipts.get(shardId);
    if (receipt === undefined) throw new D2SchedulerError('capability-denied');
    return { shardId, payload: receipt.payload };
  });
}
