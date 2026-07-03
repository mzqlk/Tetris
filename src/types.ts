export type PieceType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type GameStatus = 'idle' | 'playing' | 'paused' | 'gameover';

export interface Position {
  x: number;
  y: number;
}

export interface Piece {
  type: PieceType;
  rotation: number; // 0-3
  position: Position;
}

export type Board = number[][];

export interface ClearResult {
  clearedRows: number[];
  newBoard: Board;
}

export interface ScoreResult {
  points: number;
  linesCleared: number;
}

export interface GameState {
  board: Board;
  currentPiece: Piece | null;
  nextPiece: Piece | null;
  bag: PieceType[];
  score: number;
  level: number;
  lines: number;
  status: GameStatus;
  dropTimer: number;
  flashRows: number[];
  flashTimer: number;
  hardDropTrail: Position[];
  trailTimer: number;
}