import { useEffect, useState } from 'react';
import { useAiPlayer, type AiSpeed } from '../hooks/useAiPlayer';
import { DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_META, type Weights, type WeightsFile } from '../ai/weights';
import { fetchRuntimeWeights } from '../ai/loadWeights';
import styles from './AiControls.module.css';

const SPEEDS: AiSpeed[] = ['instant', 'normal', 'slow'];

export default function AiControls() {
  const [enabled, setEnabled] = useState(false);
  const [speed, setSpeed] = useState<AiSpeed>('normal');
  const [runtime, setRuntime] = useState<WeightsFile | null>(null);
  const [useRuntime, setUseRuntime] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchRuntimeWeights().then((file) => {
      if (alive) setRuntime(file);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Highlight whichever source is ACTUALLY driving the AI, not merely what the
  // user would prefer. Before training has run `runtime` is null, so a bare
  // `useRuntime` would light up "trained" while bundled weights are in use and
  // the caption below says so.
  const usingRuntime = useRuntime && runtime !== null;
  const active: Weights = usingRuntime ? runtime.weights : DEFAULT_WEIGHTS;

  useAiPlayer({ enabled, speed, weights: active });

  const source = usingRuntime
    // Height is shown alongside lines because lines alone saturate: any model
    // that survives its evaluation reports 0.4 x the piece cap, so two models
    // of quite different quality print the same line count.
    ? `trained · gen ${runtime.gen} · ${Math.round(runtime.meanLines)} lines` +
      (runtime.meanHeight > 0 ? ` · height ${runtime.meanHeight.toFixed(1)}` : '')
    : DEFAULT_WEIGHTS_META && DEFAULT_WEIGHTS_META.gen > 0
      ? `bundled · gen ${DEFAULT_WEIGHTS_META.gen}`
      : 'bundled · handcrafted';

  return (
    <div className={styles.panel}>
      <div className={styles.label}>AI</div>

      <button
        type="button"
        className={`${styles.toggle} ${enabled ? styles.toggleOn : ''}`}
        onClick={() => setEnabled((v) => !v)}
      >
        {enabled ? 'Autoplay on' : 'Autoplay off'}
      </button>

      <div className={styles.label}>Speed</div>
      <div className={styles.row}>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={`${styles.segment} ${speed === s ? styles.segmentActive : ''}`}
            onClick={() => setSpeed(s)}
          >
            {s}
          </button>
        ))}
      </div>

      <div className={styles.label}>Search</div>
      <div className={styles.searchMode}>4-lock expectimax</div>

      <div className={styles.label}>Weights</div>
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.segment} ${!usingRuntime ? styles.segmentActive : ''}`}
          onClick={() => setUseRuntime(false)}
        >
          bundled
        </button>
        <button
          type="button"
          className={`${styles.segment} ${usingRuntime ? styles.segmentActive : ''}`}
          onClick={() => setUseRuntime(true)}
          disabled={runtime === null}
        >
          trained
        </button>
      </div>
      <div className={styles.source}>{source}</div>
    </div>
  );
}
