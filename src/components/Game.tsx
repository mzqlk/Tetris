import { useKeyboardControls } from '../hooks/useGameLoop';
import GameCanvas from './GameCanvas';
import ScoreBoard from './ScoreBoard';
import GameOverlay from './GameOverlay';
import AiControls from './AiControls';
import HoldPiece from './HoldPiece';
import styles from './Game.module.css';

export default function Game() {
  useKeyboardControls();

  return (
    <div className={styles.gameContainer}>
      <aside className={styles.holdPanel}>
        <div className={styles.previewLabel}>Hold</div>
        <div className={styles.previewCanvasWrapper}>
          <HoldPiece />
        </div>
        <div className={styles.holdHint}>C / Shift</div>
      </aside>
      <div className={styles.canvasWrapper}>
        <GameCanvas />
        <GameOverlay />
      </div>
      <div className={styles.sidebar}>
        <ScoreBoard />
        <AiControls />
      </div>
    </div>
  );
}
