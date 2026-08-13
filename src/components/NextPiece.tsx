import { useGameStore } from '../store/gameStore';
import PiecePreview from './PiecePreview';

export default function NextPiece() {
  const nextPiece = useGameStore((state) => state.nextPiece);
  return <PiecePreview piece={nextPiece} label="Next piece" />;
}
