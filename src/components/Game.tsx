import { useKeyboardControls } from '../hooks/useGameLoop';
import GameCanvas from './GameCanvas';
import ScoreBoard from './ScoreBoard';
import GameOverlay from './GameOverlay';
import AiControls from './AiControls';
import styles from './Game.module.css';

export default function Game() {
  useKeyboardControls();

  return (
    <div className={styles.gameContainer}>
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