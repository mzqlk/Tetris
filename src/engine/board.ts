import type { Board, Piece, ClearResult, Position } from '../types';
import { BOARD_WIDTH, TOTAL_ROWS, PIECE_MATRICES } from '../constants';

export function createEmptyBoard(): Board {
  return Array.from({ length: TOTAL_ROWS }, () =>
    Array(BOARD_WIDTH).fill(0)
  );
}

export function getPieceCells(piece: Piece): Position[] {
  const matrix = PIECE_MATRICES[piece.type][piece.rotation];
  const cells: Position[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      if (matrix[row][col] !== 0) {
        cells.push({
          x: piece.position.x + col,
          y: piece.position.y + row,
        });
      }
    }
  }
  return cells;
}

export function isValidPosition(board: Board, piece: Piece): boolean {
  const cells = getPieceCells(piece);
  for (const cell of cells) {
    if (cell.x < 0 || cell.x >= BOARD_WIDTH || cell.y < 0 || cell.y >= TOTAL_ROWS) {
      return false;
    }
    if (board[cell.y][cell.x] !== 0) {
      return false;
    }
  }
  return true;
}

export function lockPiece(board: Board, piece: Piece): Board {
  const newBoard = board.map(row => [...row]);
  const cells = getPieceCells(piece);
  for (const cell of cells) {
    if (cell.y >= 0 && cell.y < TOTAL_ROWS && cell.x >= 0 && cell.x < BOARD_WIDTH) {
      newBoard[cell.y][cell.x] = piece.type;
    }
  }
  return newBoard;
}

export function clearLines(board: Board): ClearResult {
  const clearedRows: number[] = [];
  for (let row = 0; row < TOTAL_ROWS; row++) {
    if (board[row].every(cell => cell !== 0)) {
      clearedRows.push(row);
    }
  }

  if (clearedRows.length === 0) {
    return { clearedRows: [], newBoard: board };
  }

  const newBoard = board
    .filter((_, idx) => !clearedRows.includes(idx));

  // Add empty rows at top to maintain board height
  while (newBoard.length < TOTAL_ROWS) {
    newBoard.unshift(Array(BOARD_WIDTH).fill(0));
  }

  return { clearedRows, newBoard };
}

export function getGhostPosition(board: Board, piece: Piece): Position {
  const ghostPos = { x: piece.position.x, y: piece.position.y };
  const ghostPiece: Piece = { type: piece.type, rotation: piece.rotation, position: ghostPos };

  // Try moving down one row at a time — mutate ghostPos in place to avoid per-iteration allocations
  ghostPos.y += 1;
  while (isValidPosition(board, ghostPiece)) {
    ghostPos.y += 1;
  }
  // Went one row too far — back up to the last valid position
  ghostPos.y -= 1;

  return { x: ghostPos.x, y: ghostPos.y };
}

export function isGameOver(board: Board, piece: Piece): boolean {
  return !isValidPosition(board, piece);
}