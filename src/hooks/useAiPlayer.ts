import { useEffect, useRef } from 'react';
import type { Board, Piece } from '../types';
import { useGameStore } from '../store/gameStore';
import { bestPlacement } from '../ai/search';
import { projectPath, samePiece } from '../ai/replay';
import { cellKey, projectHardDrop, type AiMove } from '../ai/placements';
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
  /** path[i] is the pose after moves[i], before the final hard drop. */
  path: Piece[];
  cursor: number;
  origin: Piece;
  target: Piece;
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

  const preDrop = path.at(-1) ?? current;
  if (cellKey(projectHardDrop(board, preDrop)) !== cellKey(decision.placement.piece)) {
    return null;
  }

  return {
    moves,
    path,
    cursor: 0,
    origin: current,
    target: decision.placement.piece,
  };
}

/** Executes one positioning action and hard-drops when the plan is complete. */
export function advanceAiPlan(
  plan: AiPlan,
  dispatch: (move: AiMove) => void,
  hardDrop: () => void,
): boolean {
  if (plan.cursor >= plan.moves.length) {
    hardDrop();
    return true;
  }

  dispatch(plan.moves[plan.cursor]);
  plan.cursor++;
  if (plan.cursor === plan.moves.length) {
    hardDrop();
    return true;
  }
  return false;
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
        while (!advanceAiPlan(
          active,
          dispatch,
          () => useGameStore.getState().hardDrop(),
        )) {
          // All positioning actions intentionally run in this event-loop callback.
        }
        // UI hard-drop bonuses may change the displayed score; simulation fitness excludes them.
        plan = null;
        schedule(0);
        return;
      }

      const placed = advanceAiPlan(
        active,
        dispatch,
        () => useGameStore.getState().hardDrop(),
      );
      if (placed) plan = null;
      schedule(STEP_DELAY_MS[speed]);
    };

    schedule(0);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [opts.enabled]);
}
