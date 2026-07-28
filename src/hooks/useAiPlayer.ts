import { useEffect, useRef } from 'react';
import type { Board, Piece } from '../types';
import { useGameStore } from '../store/gameStore';
import { bestPlacement } from '../ai/search';
import { projectPath, samePiece } from '../ai/replay';
import type { AiMove } from '../ai/placements';
import { toVector, type Weights } from '../ai/weights';

export type AiSpeed = 'instant' | 'normal' | 'slow';

export interface AiPlayerOptions {
  enabled: boolean;
  depth: 1 | 2;
  speed: AiSpeed;
  weights: Weights;
}

export interface AiPlan {
  moves: AiMove[];
  /** path[i] is the pose after moves[i]. */
  path: Piece[];
  cursor: number;
  origin: Piece;
}

const STEP_DELAY_MS: Record<AiSpeed, number> = {
  instant: 0,
  normal: 40,
  slow: 150,
};

/** Delay used while idling — game over, paused, or nowhere to place the piece. */
const IDLE_DELAY_MS = 120;

export function planPlacement(
  board: Board,
  current: Piece,
  next: Piece | null,
  weights: number[],
  depth: 1 | 2,
): AiPlan | null {
  const decision = bestPlacement(board, current, next, weights, depth);
  if (decision === null) return null;

  const moves = decision.placement.moves;
  const path = projectPath(board, current, moves);
  // projectPath replays through the same engine BFS used, so this should never
  // happen. Bail to a fresh plan rather than executing a half-valid sequence.
  if (path.length !== moves.length) return null;

  return { moves, path, cursor: 0, origin: current };
}

/** The pose the board must be in for the plan's next move to make sense. */
export function expectedPose(plan: AiPlan): Piece {
  return plan.cursor === 0 ? plan.origin : plan.path[plan.cursor - 1];
}

export function isPlanValid(plan: AiPlan, currentPiece: Piece | null): boolean {
  if (plan.cursor > plan.moves.length) return false;
  return samePiece(expectedPose(plan), currentPiece);
}

/**
 * Drives the game through the same store actions the keyboard uses — no back
 * door, no teleporting pieces.
 *
 * Gravity keeps pulling the piece down while a key sequence is being replayed,
 * so a plan can go stale mid-flight (tuck placements, which depend on an exact
 * y, are the most fragile). Every step therefore checks the live piece against
 * the pose the plan expects and re-plans from scratch on any mismatch.
 */
export function useAiPlayer(opts: AiPlayerOptions): void {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;

    let cancelled = false;
    let timer: number | undefined;
    let plan: AiPlan | null = null;

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = window.setTimeout(step, delay);
    };

    const dispatch = (move: AiMove) => {
      const store = useGameStore.getState();
      if (move === 'left') store.moveLeft();
      else if (move === 'right') store.moveRight();
      else if (move === 'rotate') store.rotate();
      else store.softDrop();
    };

    const step = () => {
      if (cancelled) return;

      const { depth, weights, speed } = optsRef.current;
      const store = useGameStore.getState();

      if (store.status !== 'playing' || store.currentPiece === null) {
        plan = null;
        schedule(IDLE_DELAY_MS);
        return;
      }

      let active = plan;
      if (active === null || !isPlanValid(active, store.currentPiece)) {
        active = planPlacement(
          store.board, store.currentPiece, store.nextPiece, toVector(weights), depth,
        );
        plan = active;
        if (active === null) {
          // Nowhere to put this piece; let gravity end the game.
          schedule(IDLE_DELAY_MS);
          return;
        }
      }

      if (speed === 'instant') {
        // Run the whole placement in one turn of the event loop, so gravity
        // cannot interleave and invalidate the plan.
        while (active.cursor < active.moves.length) {
          dispatch(active.moves[active.cursor]);
          active.cursor++;
        }
        useGameStore.getState().hardDrop();
        plan = null;
        schedule(0);
        return;
      }

      if (active.cursor >= active.moves.length) {
        store.hardDrop();
        plan = null;
        schedule(STEP_DELAY_MS[speed]);
        return;
      }

      dispatch(active.moves[active.cursor]);
      active.cursor++;
      schedule(STEP_DELAY_MS[speed]);
    };

    schedule(0);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [opts.enabled]);
}
