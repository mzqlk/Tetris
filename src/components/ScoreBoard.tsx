import { useGameStore } from '../store/gameStore';
import NextPiece from './NextPiece';
import styles from './ScoreBoard.module.css';

export default function ScoreBoard() {
  const score = useGameStore(s => s.score);
  const level = useGameStore(s => s.level);
  const lines = useGameStore(s => s.lines);

  return (
    <div className={styles.board}>
      <div className={styles.section}>
        <div className={styles.nextLabel}>Next</div>
        <div className={styles.nextCanvasWrapper}>
          <NextPiece />
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.label}>Score</div>
        <div className={styles.value}>{score.toLocaleString()}</div>
      </div>
      <div className={styles.section}>
        <div className={styles.label}>Level</div>
        <div className={styles.value}>{level}</div>
      </div>
      <div className={styles.section}>
        <div className={styles.label}>Lines</div>
        <div className={styles.value}>{lines}</div>
      </div>
    </div>
  );
}