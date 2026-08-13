import { createPiece } from '../engine/piece';
import { useGameStore } from '../store/gameStore';
import PiecePreview from './PiecePreview';

export default function HoldPiece() {
  const holdPiece = useGameStore((state) => state.holdPiece);
  return (
    <PiecePreview
      piece={holdPiece === null ? null : createPiece(holdPiece)}
      label="Hold piece"
    />
  );
}
