export class D1RuntimeError extends Error {
  readonly name = 'D1RuntimeError';

  constructor(detail: string) {
    super(`runtime-fail: ${detail}`);
  }
}

export interface D1NewtonSystem {
  readonly objective: number;
  readonly gradient: readonly number[];
  readonly hessian: readonly (readonly number[])[];
}

export interface D1NewtonControllerInput {
  readonly initialWeights: readonly number[];
  readonly evaluateSystem: (weights: readonly number[]) => D1NewtonSystem;
  readonly evaluateObjective: (weights: readonly number[]) => number;
  readonly solveDirection: (
    hessian: readonly (readonly number[])[],
    gradient: readonly number[],
  ) => readonly number[];
}

export interface D1NewtonControllerResult {
  readonly weights: readonly number[];
  readonly gradientNorm: number;
  readonly iterationCount: number;
}

function finite(value: number, detail: string): number {
  if (!Number.isFinite(value)) throw new D1RuntimeError(detail);
  return value;
}

export function solveD1NewtonDirection(
  hessian: readonly (readonly number[])[],
  gradient: readonly number[],
): readonly number[] {
  const dimensions = gradient.length;
  if (dimensions === 0 || hessian.length !== dimensions ||
    hessian.some((row) => row.length !== dimensions)) {
    throw new D1RuntimeError('malformed Newton system');
  }
  const A = hessian.map((row) => row.map((value) => finite(value, 'non-finite Hessian value')));
  const b = gradient.map((value) => finite(-finite(value, 'non-finite gradient'), 'non-finite negated gradient'));
  for (let k = 0; k < dimensions; k += 1) {
    let pivotRow = k;
    for (let row = k + 1; row < dimensions; row += 1) {
      if (Math.abs(A[row]![k]!) > Math.abs(A[pivotRow]![k]!)) pivotRow = row;
    }
    if (pivotRow !== k) {
      [A[k], A[pivotRow]] = [A[pivotRow]!, A[k]!];
      [b[k], b[pivotRow]] = [b[pivotRow]!, b[k]!];
    }
    const pivot = finite(A[k]![k]!, 'non-finite pivot');
    if (Math.abs(pivot) <= 1e-15) throw new D1RuntimeError('singular pivot');
    for (let row = k + 1; row < dimensions; row += 1) {
      const factor = finite(A[row]![k]! / pivot, 'non-finite elimination factor');
      A[row]![k] = +0;
      for (let column = k + 1; column < dimensions; column += 1) {
        A[row]![column] = finite(A[row]![column]! - factor * A[k]![column]!, 'non-finite elimination');
      }
      b[row] = finite(b[row]! - factor * b[k]!, 'non-finite eliminated target');
    }
  }

  const direction = new Array<number>(dimensions).fill(+0);
  for (let row = dimensions - 1; row >= 0; row -= 1) {
    let sum = b[row]!;
    for (let column = row + 1; column < dimensions; column += 1) {
      sum = finite(sum - A[row]![column]! * direction[column]!, 'non-finite back substitution sum');
    }
    direction[row] = finite(sum / A[row]![row]!, 'non-finite direction');
  }
  return direction;
}

export function runD1NewtonController(input: D1NewtonControllerInput): D1NewtonControllerResult {
  let weights = input.initialWeights.map((value) => finite(value, 'non-finite initial weight'));
  if (weights.length === 0) throw new D1RuntimeError('empty initial weights');

  // Smallest gradient norm and objective seen, and when. Only read at the
  // iteration cap, to tell a fit stalled at its floating-point floor from one
  // that is still descending.
  let bestGradientNorm = Number.POSITIVE_INFINITY;
  let lastGradientImprovement = 0;
  let bestObjective = Number.POSITIVE_INFINITY;
  let lastObjectiveImprovement = 0;

  for (let iteration = 0; iteration <= 200; iteration += 1) {
    const current = input.evaluateSystem(weights);
    finite(current.objective, 'non-finite objective');
    if (current.gradient.length !== weights.length || current.hessian.length !== weights.length) {
      throw new D1RuntimeError('malformed Newton system');
    }
    for (let row = 0; row < weights.length; row += 1) {
      if (current.hessian[row]!.length !== weights.length) throw new D1RuntimeError('malformed Newton system');
      for (let column = 0; column < weights.length; column += 1) {
        finite(current.hessian[row]![column]!, 'non-finite Hessian value');
      }
    }
    let gradientNorm = +0;
    for (let dimension = 0; dimension < weights.length; dimension += 1) {
      const magnitude = Math.abs(finite(current.gradient[dimension]!, 'non-finite gradient'));
      if (magnitude > gradientNorm) gradientNorm = magnitude;
    }
    if (gradientNorm < bestGradientNorm) {
      bestGradientNorm = gradientNorm;
      lastGradientImprovement = iteration;
    }
    if (current.objective < bestObjective) {
      bestObjective = current.objective;
      lastObjectiveImprovement = iteration;
    }
    if (gradientNorm <= 1e-9) return { weights, gradientNorm, iterationCount: iteration };
    if (iteration === 200) {
      // The absolute tolerance above is not scale invariant: the attainable
      // gradient floor depends on the objective's magnitude and conditioning, so
      // a perfectly converged fit can sit just above 1e-9 and never reach it.
      // `action24` at lambda 0.1 converges quadratically through iteration 4 and
      // then holds a bit-identical gradient norm of 1.832e-9 -- 1.83x the
      // tolerance -- and a bit-identical objective for the remaining 195
      // iterations, while the line search backtracks to a 1.49e-8 step that
      // moves two of twenty-four weights by one ulp apiece. It is converged; the
      // test simply cannot say so. That fit halted a 7-hour D2 run 68 shards
      // short of its verdict.
      //
      // So at the cap, distinguish a stalled fit from a descending one. Both
      // the objective and the gradient norm must have gone 32 consecutive
      // iterations without improving. The objective is the load-bearing half:
      // a stalled fit cannot lower it at all, while a genuinely unconverged one
      // lowers it every iteration -- `objective = -w`, `gradient = -1`
      // descends forever on a constant gradient norm, and on the gradient test
      // alone that divergence would have been reported as convergence.
      //
      // Deciding this only at the cap is what makes it safe, and the two
      // tempting mid-loop forms were both tried and both wrong. "Objective
      // failed to decrease" truncates lambda 0.01 early -- both representations
      // reach the objective's floor while the gradient is still falling
      // (afterstate13 to 9.3e-10 by iteration 6, action24 to 5.7e-10 by
      // iteration 8) -- and "weights unchanged" never fires at all, because the
      // stall drifts by ulps rather than resting. Here neither matters: a fit
      // that converges returns above and can never reach this line.
      if (iteration - lastGradientImprovement >= 32
        && iteration - lastObjectiveImprovement >= 32) {
        return { weights, gradientNorm, iterationCount: iteration };
      }
      throw new D1RuntimeError('optimizer did not converge after 200 updates');
    }

    const direction = input.solveDirection(current.hessian, current.gradient);
    if (direction.length !== weights.length) throw new D1RuntimeError('malformed Newton direction');
    let dot = +0;
    for (let dimension = 0; dimension < weights.length; dimension += 1) {
      dot = finite(dot + current.gradient[dimension]! * finite(direction[dimension]!, 'non-finite direction'),
        'non-finite direction dot gradient');
    }
    if (!(dot < 0)) throw new D1RuntimeError('non-descent direction');

    let step = 1;
    let accepted: number[] | undefined;
    for (let candidateIndex = 0; candidateIndex < 64; candidateIndex += 1) {
      const candidate = new Array<number>(weights.length);
      for (let dimension = 0; dimension < weights.length; dimension += 1) {
        candidate[dimension] = finite(weights[dimension]! + step * direction[dimension]!, 'non-finite candidate weight');
      }
      const candidateObjective = finite(input.evaluateObjective(candidate), 'non-finite candidate objective');
      const armijoBound = finite(current.objective + 1e-4 * step * dot, 'non-finite Armijo bound');
      if (candidateObjective <= armijoBound) {
        accepted = candidate;
        break;
      }
      step = finite(step * 0.5, 'non-finite line-search step');
    }
    if (!accepted) throw new D1RuntimeError('line search did not accept a step');
    weights = accepted;
  }
  throw new D1RuntimeError('unreachable optimizer state');
}
