import { useEffect, useState } from 'react';
import { useAiPlayer, type AiSpeed } from '../hooks/useAiPlayer';
import { DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_META, type Weights, type WeightsFile } from '../ai/weights';
import { fetchRuntimeWeights } from '../ai/loadWeights';
import styles from './AiControls.module.css';

const SPEEDS: AiSpeed[] = ['instant', 'normal', 'slow'];

export default function AiControls() {
  const [enabled, setEnabled] = useState(false);
  const [speed, setSpeed] = useState<AiSpeed>('normal');
  const [depth, setDepth] = useState<1 | 2>(2);
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

  const active: Weights = useRuntime && runtime ? runtime.weights : DEFAULT_WEIGHTS;

  useAiPlayer({ enabled, depth, speed, weights: active });

  const source = useRuntime && runtime
    ? `trained · gen ${runtime.gen} · ${Math.round(runtime.meanLines)} lines`
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

      <div className={styles.label}>Lookahead</div>
      <div className={styles.row}>
        {([1, 2] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={`${styles.segment} ${depth === d ? styles.segmentActive : ''}`}
            onClick={() => setDepth(d)}
          >
            {d} ply
          </button>
        ))}
      </div>

      <div className={styles.label}>Weights</div>
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.segment} ${!useRuntime ? styles.segmentActive : ''}`}
          onClick={() => setUseRuntime(false)}
        >
          bundled
        </button>
        <button
          type="button"
          className={`${styles.segment} ${useRuntime ? styles.segmentActive : ''}`}
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
