import { useGameStore } from '../store/gameStore';
import styles from './GameOverlay.module.css';

export default function GameOverlay() {
  const status = useGameStore(s => s.status);
  const score = useGameStore(s => s.score);

  if (status === 'playing') return null;

  return (
    <div className={styles.overlay}>
      {status === 'idle' && (
        <>
          <div className={styles.title}>TETRIS</div>
          <div className={styles.prompt}>PRESS ENTER TO START</div>
        </>
      )}
      {status === 'paused' && (
        <>
          <div className={styles.title}>PAUSED</div>
          <div className={styles.prompt}>PRESS P TO RESUME</div>
        </>
      )}
      {status === 'gameover' && (
        <>
          <div className={styles.title}>GAME OVER</div>
          <div className={styles.subtitle}>FINAL SCORE</div>
          <div className={styles.finalScore}>{score.toLocaleString()}</div>
          <div className={styles.prompt}>PRESS ENTER TO RESTART</div>
        </>
      )}
    </div>
  );
}