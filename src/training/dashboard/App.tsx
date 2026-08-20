import { useTrainingLog } from './useTrainingLog';
import { ScoreRateChart, WeightEvolutionChart, SigmaHeatmap, BestWeightsChart } from './charts';
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
        <p className={styles.subtitle}>public/ai/score-rate-v5/training-log.jsonl</p>
        <div className={styles.empty}>No training data yet — run <code>npm run train</code> and the charts will appear automatically</div>
      </div>
    );
  }

  const latest = entries[entries.length - 1];
  const bestEver = Math.max(...entries.map((entry) => entry.bestScoreRate));
  const totalMs = entries.reduce((s, e) => s + e.elapsedMs, 0);

  const metrics: [string, string][] = [
    ['Generation', String(latest.gen)],
    ['Best score rate', bestEver.toFixed(2)],
    ['Median score rate', latest.medianScoreRate.toFixed(2)],
    ['Elite score', Math.round(latest.eliteScore).toLocaleString()],
    ['Best Tetris lines', `${(100 * latest.bestTetrisLineShare).toFixed(1)}%`],
    ['Elite Tetris lines', `${(100 * latest.eliteTetrisLineShare).toFixed(1)}%`],
    ['Median lines', Math.round(latest.medianLines).toLocaleString()],
    ['Median height', latest.medianHeight.toFixed(1)],
    ['Elite height', latest.eliteHeight.toFixed(1)],
    ['Best clean well', latest.bestStrategyDiagnostics.meanCleanWellDepth.toFixed(2)],
    ['Elite setup progress', latest.eliteStrategyDiagnostics.meanTetrisSetupProgress.toFixed(2)],
    ['Elite ready rows', latest.eliteStrategyDiagnostics.meanTetrisReadyRows.toFixed(2)],
    ['Best depth histogram', latest.bestSearchDiagnostics.completedDepthHistogram.join('/')],
    ['Best mean work units', latest.bestSearchDiagnostics.meanWorkUnitsUsed.toFixed(1)],
    ['Best max work units', latest.bestSearchDiagnostics.maxWorkUnitsUsed.toLocaleString()],
    ['Best budget exhaustion', `${(100 * latest.bestSearchDiagnostics.budgetExhaustionRate).toFixed(1)}%`],
    ['Piece cap', latest.maxPieces.toLocaleString()],
    ['Elapsed', formatDuration(totalMs)],
  ];

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Tetris AI — Training</h1>
      <p className={styles.subtitle}>{entries.length} generations · live from public/ai/score-rate-v5/training-log.jsonl</p>

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
          <div className={styles.cardTitle}>Score rate per generation</div>
          <ScoreRateChart entries={entries} />
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
          <BestWeightsChart entry={entries.reduce((a, b) => (a.bestScoreRate >= b.bestScoreRate ? a : b))} />
        </div>
      </div>
    </div>
  );
}
