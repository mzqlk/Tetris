import { useTrainingLog } from './useTrainingLog';
import { FitnessChart, WeightEvolutionChart, SigmaHeatmap, BestWeightsChart } from './charts';
import styles from './App.module.css';

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function App() {
  const { entries } = useTrainingLog();

  if (entries.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Tetris AI — Training</h1>
        <p className={styles.subtitle}>public/ai/training-log.jsonl</p>
        <div className={styles.empty}>尚未开始训练 —— 运行 <code>npm run train</code> 后曲线会自动出现</div>
      </div>
    );
  }

  const latest = entries[entries.length - 1];
  const bestEver = Math.max(...entries.map((e) => e.best));
  const totalMs = entries.reduce((s, e) => s + e.elapsedMs, 0);

  const metrics: [string, string][] = [
    ['Generation', String(latest.gen)],
    ['Best lines', Math.round(bestEver).toLocaleString()],
    ['Median lines', Math.round(latest.median).toLocaleString()],
    ['Piece cap', latest.maxPieces.toLocaleString()],
    ['Elapsed', formatDuration(totalMs)],
  ];

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Tetris AI — Training</h1>
      <p className={styles.subtitle}>{entries.length} generations · live from public/ai/training-log.jsonl</p>

      <div className={styles.metrics}>
        {metrics.map(([label, value]) => (
          <div key={label}>
            <div className={styles.metricLabel}>{label}</div>
            <div className={styles.metricValue}>{value}</div>
          </div>
        ))}
      </div>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Fitness per generation</div>
          <FitnessChart entries={entries} />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Weight evolution (mu)</div>
          <WeightEvolutionChart entries={entries} />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Distribution contraction (sigma)</div>
          <SigmaHeatmap entries={entries} />
        </div>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Best weights so far</div>
          <BestWeightsChart entry={entries.reduce((a, b) => (a.best >= b.best ? a : b))} />
        </div>
      </div>
    </div>
  );
}
