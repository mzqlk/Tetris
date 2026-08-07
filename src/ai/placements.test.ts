import { afterEach, describe, it, expect, vi } from 'vitest';
import { enumeratePlacements, cellKey, projectHardDrop } from './placements';
import { projectPath, samePiece } from './replay';
import { boardFrom } from './testUtils';
import { createEmptyBoard, isValidPosition } from '../engine/board';
import { createPiece, movePiece, rotatePiece } from '../engine/piece';
import { BOARD_WIDTH } from '../constants';
import type { Board, Piece, PieceType } from '../types';

const EMPTY = createEmptyBoard();
const ALL_TYPES: PieceType[] = [1, 2, 3, 4, 5, 6, 7];

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY_I_ORDER = [
  '185,195,205,215', '184,194,204,214', '186,196,206,216',
  '213,214,215,216', '183,193,203,213', '212,213,214,215',
  '187,197,207,217', '214,215,216,217', '182,192,202,212',
  '211,212,213,214', '188,198,208,218', '215,216,217,218',
  '210,211,212,213', '181,191,201,211', '216,217,218,219',
  '189,199,209,219', '180,190,200,210',
];

const TUCK_I_ORDER = [
  '155,165,175,185', '154,164,174,184', '156,166,176,186',
  '183,184,185,186', '182,183,184,185', '157,167,177,187',
  '184,185,186,187', '181,182,183,184', '158,168,178,188',
  '185,186,187,188', '183,193,203,213', '182,192,202,212',
  '186,187,188,189', '159,169,179,189', '181,191,201,211',
  '210,211,212,213', '180,190,200,210', '211,212,213,214',
];

const JAGGED_T_ORDER = [
  '174,182,183,184', '173,181,182,183', '162,172,182,183',
  '172,173,174,182', '195,203,204,205', '184,194,204,205',
  '172,180,181,182', '161,171,181,182', '183,193,203,204',
  '187,195,196,197', '176,186,196,197', '196,204,205,206',
  '185,195,205,206', '193,194,195,203', '181,182,183,191',
  '161,162,172,182', '188,196,197,198', '177,187,197,198',
  '194,195,196,204', '183,184,194,204', '180,190,200,201',
  '180,181,182,190', '182,183,193,203', '189,197,198,199',
  '195,196,197,205', '184,185,195,205', '188,198,208,209',
  '187,188,189,197', '196,197,198,206', '176,177,187,197',
  '185,186,196,206', '180,181,191,201', '188,189,199,209',
  '197,198,208,218',
];

const BOARDS: [string, Board][] = [
  ['empty', EMPTY],
  ['roofed', boardFrom(['....######', '....######', '.....#####'])],
  ['jagged', boardFrom(['..#.......', '..#....#..', '##.#####.#'])],
];

const ORDERED_PLACEMENT_SUMMARIES: Record<string, string> = {
  'empty:1': '1:1:3:18@185,195,205,215 1:1:2:18@184,194,204,214 1:1:4:18@186,196,206,216 1:0:3:20@213,214,215,216 1:1:1:18@183,193,203,213 1:0:2:20@212,213,214,215 1:1:5:18@187,197,207,217 1:0:4:20@214,215,216,217 1:1:0:18@182,192,202,212 1:0:1:20@211,212,213,214 1:1:6:18@188,198,208,218 1:0:5:20@215,216,217,218 1:0:0:20@210,211,212,213 1:1:-1:18@181,191,201,211 1:0:6:20@216,217,218,219 1:1:7:18@189,199,209,219 1:1:-2:18@180,190,200,210',
  'empty:2': '2:0:3:20@204,205,214,215 2:0:2:20@203,204,213,214 2:0:4:20@205,206,215,216 2:0:1:20@202,203,212,213 2:0:5:20@206,207,216,217 2:0:0:20@201,202,211,212 2:0:6:20@207,208,217,218 2:0:-1:20@200,201,210,211 2:0:7:20@208,209,218,219',
  'empty:3': '3:0:3:20@204,213,214,215 3:1:3:19@194,204,205,214 3:0:2:20@203,212,213,214 3:1:2:19@193,203,204,213 3:0:4:20@205,214,215,216 3:1:4:19@195,205,206,215 3:2:3:19@203,204,205,214 3:0:1:20@202,211,212,213 3:1:1:19@192,202,203,212 3:2:2:19@202,203,204,213 3:0:5:20@206,215,216,217 3:1:5:19@196,206,207,216 3:2:4:19@204,205,206,215 3:3:3:19@194,203,204,214 3:0:0:20@201,210,211,212 3:1:0:19@191,201,202,211 3:2:1:19@201,202,203,212 3:3:2:19@193,202,203,213 3:0:6:20@207,216,217,218 3:1:6:19@197,207,208,217 3:2:5:19@205,206,207,216 3:3:4:19@195,204,205,215 3:1:-1:19@190,200,201,210 3:2:0:19@200,201,202,211 3:3:1:19@192,201,202,212 3:0:7:20@208,217,218,219 3:1:7:19@198,208,209,218 3:2:6:19@206,207,208,217 3:3:5:19@196,205,206,216 3:3:0:19@191,200,201,211 3:2:7:19@207,208,209,218 3:3:6:19@197,206,207,217 3:3:7:19@198,207,208,218 3:3:8:19@199,208,209,219',
  'empty:4': '4:0:3:20@204,205,213,214 4:1:3:19@194,204,205,215 4:0:2:20@203,204,212,213 4:1:2:19@193,203,204,214 4:0:4:20@205,206,214,215 4:1:4:19@195,205,206,216 4:0:1:20@202,203,211,212 4:1:1:19@192,202,203,213 4:0:5:20@206,207,215,216 4:1:5:19@196,206,207,217 4:0:0:20@201,202,210,211 4:1:0:19@191,201,202,212 4:0:6:20@207,208,216,217 4:1:6:19@197,207,208,218 4:1:-1:19@190,200,201,211 4:0:7:20@208,209,217,218 4:1:7:19@198,208,209,219',
  'empty:5': '5:0:3:20@203,204,214,215 5:1:3:19@195,204,205,214 5:0:2:20@202,203,213,214 5:1:2:19@194,203,204,213 5:0:4:20@204,205,215,216 5:1:4:19@196,205,206,215 5:0:1:20@201,202,212,213 5:1:1:19@193,202,203,212 5:0:5:20@205,206,216,217 5:1:5:19@197,206,207,216 5:0:0:20@200,201,211,212 5:1:0:19@192,201,202,211 5:0:6:20@206,207,217,218 5:1:6:19@198,207,208,217 5:1:-1:19@191,200,201,210 5:0:7:20@207,208,218,219 5:1:7:19@199,208,209,218',
  'empty:6': '6:0:3:20@203,213,214,215 6:1:3:19@194,195,204,214 6:0:2:20@202,212,213,214 6:1:2:19@193,194,203,213 6:0:4:20@204,214,215,216 6:1:4:19@195,196,205,215 6:2:3:19@203,204,205,215 6:0:1:20@201,211,212,213 6:1:1:19@192,193,202,212 6:2:2:19@202,203,204,214 6:0:5:20@205,215,216,217 6:1:5:19@196,197,206,216 6:2:4:19@204,205,206,216 6:3:3:19@194,204,213,214 6:0:0:20@200,210,211,212 6:1:0:19@191,192,201,211 6:2:1:19@201,202,203,213 6:3:2:19@193,203,212,213 6:0:6:20@206,216,217,218 6:1:6:19@197,198,207,217 6:2:5:19@205,206,207,217 6:3:4:19@195,205,214,215 6:1:-1:19@190,191,200,210 6:2:0:19@200,201,202,212 6:3:1:19@192,202,211,212 6:0:7:20@207,217,218,219 6:1:7:19@198,199,208,218 6:2:6:19@206,207,208,218 6:3:5:19@196,206,215,216 6:3:0:19@191,201,210,211 6:2:7:19@207,208,209,219 6:3:6:19@197,207,216,217 6:3:7:19@198,208,217,218 6:3:8:19@199,209,218,219',
  'empty:7': '7:0:3:20@205,213,214,215 7:1:3:19@194,204,214,215 7:0:2:20@204,212,213,214 7:1:2:19@193,203,213,214 7:0:4:20@206,214,215,216 7:1:4:19@195,205,215,216 7:2:3:19@203,204,205,213 7:0:1:20@203,211,212,213 7:1:1:19@192,202,212,213 7:2:2:19@202,203,204,212 7:0:5:20@207,215,216,217 7:1:5:19@196,206,216,217 7:2:4:19@204,205,206,214 7:3:3:19@193,194,204,214 7:0:0:20@202,210,211,212 7:1:0:19@191,201,211,212 7:2:1:19@201,202,203,211 7:3:2:19@192,193,203,213 7:0:6:20@208,216,217,218 7:1:6:19@197,207,217,218 7:2:5:19@205,206,207,215 7:3:4:19@194,195,205,215 7:1:-1:19@190,200,210,211 7:2:0:19@200,201,202,210 7:3:1:19@191,192,202,212 7:0:7:20@209,217,218,219 7:1:7:19@198,208,218,219 7:2:6:19@206,207,208,216 7:3:5:19@195,196,206,216 7:3:0:19@190,191,201,211 7:2:7:19@207,208,209,217 7:3:6:19@196,197,207,217 7:3:7:19@197,198,208,218 7:3:8:19@198,199,209,219',
  'roofed:1': '1:1:3:15@155,165,175,185 1:1:2:15@154,164,174,184 1:1:4:15@156,166,176,186 1:0:3:17@183,184,185,186 1:0:2:17@182,183,184,185 1:1:5:15@157,167,177,187 1:0:4:17@184,185,186,187 1:2:1:16@181,182,183,184 1:1:6:15@158,168,178,188 1:0:5:17@185,186,187,188 1:1:1:18@183,193,203,213 1:1:0:18@182,192,202,212 1:0:6:17@186,187,188,189 1:1:7:15@159,169,179,189 1:1:-1:18@181,191,201,211 1:2:0:19@210,211,212,213 1:1:-2:18@180,190,200,210 1:2:1:19@211,212,213,214',
  'roofed:2': '2:0:3:17@174,175,184,185 2:0:2:17@173,174,183,184 2:0:4:17@175,176,185,186 2:0:5:17@176,177,186,187 2:0:6:17@177,178,187,188 2:0:7:17@178,179,188,189 2:0:1:20@202,203,212,213 2:0:0:20@201,202,211,212 2:0:-1:20@200,201,210,211',
  'roofed:3': '3:0:3:17@174,183,184,185 3:1:3:16@164,174,175,184 3:0:2:17@173,182,183,184 3:0:4:17@175,184,185,186 3:1:4:16@165,175,176,185 3:1:2:17@173,183,184,193 3:2:3:16@173,174,175,184 3:0:5:17@176,185,186,187 3:1:5:16@166,176,177,186 3:2:4:16@174,175,176,185 3:2:2:17@182,183,184,193 3:3:3:16@164,173,174,184 3:0:6:17@177,186,187,188 3:1:6:16@167,177,178,187 3:2:5:16@175,176,177,186 3:3:4:16@165,174,175,185 3:0:7:17@178,187,188,189 3:1:7:16@168,178,179,188 3:2:6:16@176,177,178,187 3:3:5:16@166,175,176,186 3:1:1:19@192,202,203,212 3:0:1:20@202,211,212,213 3:2:7:16@177,178,179,188 3:3:6:16@167,176,177,187 3:1:0:19@191,201,202,211 3:2:1:19@201,202,203,212 3:3:2:19@193,202,203,213 3:0:0:20@201,210,211,212 3:0:2:20@203,212,213,214 3:3:7:16@168,177,178,188 3:1:-1:19@190,200,201,210 3:2:0:19@200,201,202,211 3:3:1:19@192,201,202,212 3:3:8:16@169,178,179,189 3:3:0:19@191,200,201,211',
  'roofed:4': '4:0:3:17@174,175,183,184 4:1:3:16@164,174,175,185 4:1:2:16@163,173,174,184 4:0:4:17@175,176,184,185 4:1:4:16@165,175,176,186 4:0:2:18@183,184,192,193 4:0:5:17@176,177,185,186 4:1:5:16@166,176,177,187 4:0:6:17@177,178,186,187 4:1:6:16@167,177,178,188 4:1:1:19@192,202,203,213 4:0:7:17@178,179,187,188 4:1:7:16@168,178,179,189 4:0:1:20@202,203,211,212 4:1:0:19@191,201,202,212 4:0:0:20@201,202,210,211 4:1:-1:19@190,200,201,211',
  'roofed:5': '5:0:3:17@173,174,184,185 5:1:3:16@165,174,175,184 5:0:2:17@172,173,183,184 5:0:4:17@174,175,185,186 5:1:4:16@166,175,176,185 5:1:2:17@174,183,184,193 5:0:5:17@175,176,186,187 5:1:5:16@167,176,177,186 5:0:6:17@176,177,187,188 5:1:6:16@168,177,178,187 5:0:7:17@177,178,188,189 5:1:7:16@169,178,179,188 5:1:1:19@193,202,203,212 5:0:1:20@201,202,212,213 5:1:0:19@192,201,202,211 5:0:0:20@200,201,211,212 5:0:2:20@202,203,213,214 5:1:-1:19@191,200,201,210',
  'roofed:6': '6:0:3:17@173,183,184,185 6:1:3:16@164,165,174,184 6:0:2:17@172,182,183,184 6:0:4:17@174,184,185,186 6:1:4:16@165,166,175,185 6:2:3:16@173,174,175,185 6:2:2:16@172,173,174,184 6:0:5:17@175,185,186,187 6:1:5:16@166,167,176,186 6:2:4:16@174,175,176,186 6:1:2:18@183,184,193,203 6:3:3:16@164,174,183,184 6:0:6:17@176,186,187,188 6:1:6:16@167,168,177,187 6:2:5:16@175,176,177,187 6:3:4:16@165,175,184,185 6:0:7:17@177,187,188,189 6:1:7:16@168,169,178,188 6:2:6:16@176,177,178,188 6:3:5:16@166,176,185,186 6:1:1:19@192,193,202,212 6:0:1:20@201,211,212,213 6:2:7:16@177,178,179,189 6:3:6:16@167,177,186,187 6:1:0:19@191,192,201,211 6:2:1:19@201,202,203,213 6:0:0:20@200,210,211,212 6:0:2:20@202,212,213,214 6:3:2:19@193,203,212,213 6:3:7:16@168,178,187,188 6:1:-1:19@190,191,200,210 6:2:0:19@200,201,202,212 6:3:1:19@192,202,211,212 6:3:8:16@169,179,188,189 6:3:0:19@191,201,210,211',
  'roofed:7': '7:0:3:17@175,183,184,185 7:1:3:16@164,174,184,185 7:0:2:17@174,182,183,184 7:1:2:16@163,173,183,184 7:0:4:17@176,184,185,186 7:1:4:16@165,175,185,186 7:0:5:17@177,185,186,187 7:1:5:16@166,176,186,187 7:2:4:16@174,175,176,184 7:2:3:17@183,184,185,193 7:3:3:16@163,164,174,184 7:2:2:17@182,183,184,192 7:0:6:17@178,186,187,188 7:1:6:16@167,177,187,188 7:2:5:16@175,176,177,185 7:3:4:16@164,165,175,185 7:1:1:19@192,202,212,213 7:0:7:17@179,187,188,189 7:1:7:16@168,178,188,189 7:2:6:16@176,177,178,186 7:3:5:16@165,166,176,186 7:0:1:20@203,211,212,213 7:1:0:19@191,201,211,212 7:1:2:19@193,203,213,214 7:2:1:19@201,202,203,211 7:2:7:16@177,178,179,187 7:3:6:16@166,167,177,187 7:0:0:20@202,210,211,212 7:1:-1:19@190,200,210,211 7:2:0:19@200,201,202,210 7:3:1:19@191,192,202,212 7:3:2:19@192,193,203,213 7:3:7:16@167,168,178,188 7:3:0:19@190,191,201,211 7:3:8:16@168,169,179,189',
  'jagged:1': '1:0:2:17@182,183,184,185 1:1:3:17@175,185,195,205 1:1:0:15@152,162,172,182 1:0:1:17@181,182,183,184 1:1:2:17@174,184,194,204 1:1:5:16@167,177,187,197 1:0:4:18@194,195,196,197 1:1:4:17@176,186,196,206 1:0:3:19@203,204,205,206 1:0:0:17@180,181,182,183 1:1:1:17@173,183,193,203 1:0:5:18@195,196,197,198 1:1:-2:17@170,180,190,200 1:0:6:18@196,197,198,199 1:1:6:18@188,198,208,218 1:1:-1:17@171,181,191,201 1:1:7:17@179,189,199,209',
  'jagged:2': '2:0:1:17@172,173,182,183 2:0:3:19@194,195,204,205 2:0:0:17@171,172,181,182 2:0:2:19@193,194,203,204 2:0:5:18@186,187,196,197 2:0:4:19@195,196,205,206 2:0:6:18@187,188,197,198 2:0:-1:19@190,191,200,201 2:0:7:19@198,199,208,209',
  'jagged:3': '3:0:2:17@173,182,183,184 3:0:1:17@172,181,182,183 3:1:1:16@162,172,173,182 3:0:3:19@194,203,204,205 3:1:3:18@184,194,195,204 3:0:0:17@171,180,181,182 3:1:0:17@171,181,182,191 3:2:1:16@171,172,173,182 3:1:2:18@183,193,194,203 3:2:2:17@182,183,184,193 3:0:5:18@186,195,196,197 3:0:4:19@195,204,205,206 3:1:4:18@185,195,196,205 3:2:3:18@193,194,195,204 3:2:0:17@180,181,182,191 3:3:1:16@162,171,172,182 3:3:2:17@173,182,183,193 3:0:6:18@187,196,197,198 3:1:6:17@177,187,188,197 3:1:5:18@186,196,197,206 3:2:4:18@194,195,196,205 3:3:3:18@184,193,194,204 3:1:-1:18@180,190,191,200 3:0:7:18@188,197,198,199 3:2:6:17@186,187,188,197 3:2:5:18@195,196,197,206 3:3:4:18@185,194,195,205 3:3:0:18@181,190,191,201 3:3:6:17@177,186,187,197 3:3:5:18@186,195,196,206 3:1:7:19@198,208,209,218 3:2:7:18@197,198,199,208 3:3:7:18@188,197,198,208 3:3:8:18@189,198,199,209',
  'jagged:4': '4:0:2:17@173,174,182,183 4:0:1:17@172,173,181,182 4:0:3:19@194,195,203,204 4:1:3:18@184,194,195,205 4:1:0:16@161,171,172,182 4:1:1:17@172,182,183,193 4:1:2:18@183,193,194,204 4:1:5:17@176,186,187,197 4:0:4:19@195,196,204,205 4:1:4:18@185,195,196,206 4:0:0:18@181,182,190,191 4:0:6:18@187,188,196,197 4:0:5:19@196,197,205,206 4:1:-1:18@180,190,191,201 4:0:7:18@188,189,197,198 4:1:6:18@187,197,198,208 4:1:7:18@188,198,199,209',
  'jagged:5': '5:0:1:17@171,172,182,183 5:1:1:16@163,172,173,182 5:0:2:18@182,183,193,194 5:0:3:19@193,194,204,205 5:1:3:18@185,194,195,204 5:0:0:17@170,171,181,182 5:1:0:17@172,181,182,191 5:1:2:18@184,193,194,203 5:0:5:18@185,186,196,197 5:0:4:19@194,195,205,206 5:1:4:18@186,195,196,205 5:0:6:18@186,187,197,198 5:1:6:17@178,187,188,197 5:1:5:18@187,196,197,206 5:1:-1:18@181,190,191,200 5:0:7:19@197,198,208,209 5:1:7:19@199,208,209,218',
  'jagged:6': '6:0:2:17@172,182,183,184 6:0:1:17@171,181,182,183 6:1:1:16@162,163,172,182 6:0:3:19@193,203,204,205 6:1:3:18@184,185,194,204 6:0:0:17@170,180,181,182 6:1:2:18@183,184,193,203 6:2:2:17@182,183,184,194 6:3:2:16@163,173,182,183 6:0:5:18@185,195,196,197 6:0:4:19@194,204,205,206 6:1:4:18@185,186,195,205 6:2:3:18@193,194,195,205 6:2:0:16@170,171,172,182 6:1:0:18@181,182,191,201 6:2:1:17@181,182,183,193 6:3:1:16@162,172,181,182 6:0:6:18@186,196,197,198 6:1:6:17@177,178,187,197 6:1:5:18@186,187,196,206 6:2:5:17@185,186,187,197 6:2:4:18@194,195,196,206 6:3:3:18@184,194,203,204 6:1:-1:18@180,181,190,200 6:0:7:18@187,197,198,199 6:2:6:18@196,197,198,208 6:3:4:18@185,195,204,205 6:3:6:17@177,187,196,197 6:2:7:18@197,198,199,209 6:3:7:17@178,188,197,198 6:3:5:18@186,196,205,206 6:3:0:18@181,191,200,201 6:1:7:19@198,199,208,218 6:3:8:18@189,199,208,209',
  'jagged:7': '7:0:2:17@174,182,183,184 7:0:1:17@173,181,182,183 7:1:1:16@162,172,182,183 7:2:2:16@172,173,174,182 7:0:3:19@195,203,204,205 7:1:3:18@184,194,204,205 7:0:0:17@172,180,181,182 7:1:0:16@161,171,181,182 7:1:2:18@183,193,203,204 7:0:5:18@187,195,196,197 7:1:5:17@176,186,196,197 7:0:4:19@196,204,205,206 7:1:4:18@185,195,205,206 7:2:3:18@193,194,195,203 7:2:1:17@181,182,183,191 7:3:1:16@161,162,172,182 7:0:6:18@188,196,197,198 7:1:6:17@177,187,197,198 7:2:4:18@194,195,196,204 7:3:3:18@183,184,194,204 7:1:-1:18@180,190,200,201 7:2:0:17@180,181,182,190 7:3:2:18@182,183,193,203 7:0:7:18@189,197,198,199 7:2:5:18@195,196,197,205 7:3:4:18@184,185,195,205 7:1:7:18@188,198,208,209 7:2:7:17@187,188,189,197 7:2:6:18@196,197,198,206 7:3:6:17@176,177,187,197 7:3:5:18@185,186,196,206 7:3:0:18@180,181,191,201 7:3:8:18@188,189,199,209 7:3:7:19@197,198,208,218',
};

function placementSummary(piece: Piece): string {
  return `${piece.type}:${piece.rotation}:${piece.position.x}:${piece.position.y}@${cellKey(piece)}`;
}

it('keeps representative resting placements in their established order', () => {
  const tuck = boardFrom(['....######', '....######', '.....#####']);
  const jagged = boardFrom(['..#.......', '..#....#..', '##.#####.#']);

  expect(enumeratePlacements(EMPTY, createPiece(1)).map((p) => cellKey(p.piece)))
    .toEqual(EMPTY_I_ORDER);
  expect(enumeratePlacements(tuck, createPiece(1)).map((p) => cellKey(p.piece)))
    .toEqual(TUCK_I_ORDER);
  expect(enumeratePlacements(jagged, createPiece(7)).map((p) => cellKey(p.piece)))
    .toEqual(JAGGED_T_ORDER);
});

/** Rotate-then-hard-drop enumeration: the naive alternative BFS has to beat. */
function naiveKeys(board: Board, spawn: Piece): Set<string> {
  const out = new Set<string>();
  for (let rotation = 0; rotation < 4; rotation++) {
    for (let x = -3; x <= BOARD_WIDTH; x++) {
      const start: Piece = { type: spawn.type, rotation, position: { x, y: spawn.position.y } };
      if (!isValidPosition(board, start)) continue;
      let cur = start;
      for (;;) {
        const down = movePiece(board, cur, 0, 1);
        if (!down) break;
        cur = down;
      }
      out.add(cellKey(cur));
    }
  }
  return out;
}

describe('enumeratePlacements on an empty board', () => {
  // Verified against the real engine. Without cell-set dedup O would be 36
  // (four identical rotations) and I would be 34 (two identical bar states).
  const EXPECTED: Record<PieceType, number> = { 1: 17, 2: 9, 3: 34, 4: 17, 5: 17, 6: 34, 7: 34 };

  for (const type of ALL_TYPES) {
    it(`finds ${EXPECTED[type]} deduplicated placements for piece ${type}`, () => {
      expect(enumeratePlacements(EMPTY, createPiece(type))).toHaveLength(EXPECTED[type]);
    });
  }

  it('returns no duplicate cell sets', () => {
    for (const type of ALL_TYPES) {
      const placements = enumeratePlacements(EMPTY, createPiece(type));
      expect(new Set(placements.map((p) => cellKey(p.piece))).size).toBe(placements.length);
    }
  });
});

describe('placement invariants', () => {
  it.each(BOARDS)('keeps every ordered full placement on the %s board', (name, board) => {
    const rowReferences = [...board];
    const boardSnapshot = board.map((row) => [...row]);

    for (const type of ALL_TYPES) {
      const spawn = createPiece(type);
      const placements = enumeratePlacements(board, spawn);
      const expectedSummaries = ORDERED_PLACEMENT_SUMMARIES[`${name}:${type}`].split(' ');
      expect(placements.length, `${name} piece ${type} placement count`)
        .toBe(expectedSummaries.length);
      expect(
        placements.map(({ piece }) => placementSummary(piece)),
        `${name} piece ${type} ordered pose@cellKey summaries`,
      ).toEqual(expectedSummaries);
      expect(
        placements.map(({ piece }) => cellKey(piece)),
        `${name} piece ${type} ordered cellKey list`,
      ).toEqual(expectedSummaries.map((summary) => summary.split('@')[1]));

      const seenCells = new Set<string>();
      placements.forEach((placement, index) => {
        const summary = placementSummary(placement.piece);
        const label = `${name} piece ${type} placement ${index}: ${summary}`;
        expect(summary, label).toBe(expectedSummaries[index]);

        const cells = cellKey(placement.piece);
        expect(seenCells.has(cells), `${label} duplicates cellKey ${cells}`).toBe(false);
        seenCells.add(cells);

        const path = projectPath(board, spawn, placement.moves);
        expect(path.length, `${label} has an illegal replay move`).toBe(placement.moves.length);
        const preDrop = path.at(-1) ?? spawn;
        expect(
          samePiece(projectHardDrop(board, preDrop), placement.piece),
          `${label} hard-drops to a different full pose`,
        ).toBe(true);
        expect(isValidPosition(board, placement.piece), `${label} is invalid`).toBe(true);
        expect(movePiece(board, placement.piece, 0, 1), `${label} is not resting`).toBeNull();
      });
    }

    expect(board).toEqual(boardSnapshot);
    board.forEach((row, index) => {
      expect(row, `${name} board row ${index} reference was replaced`)
        .toBe(rowReferences[index]);
    });
  });

  for (const [name, board] of BOARDS) {
    it(`every placement on the ${name} board is a resting position`, () => {
      for (const type of ALL_TYPES) {
        for (const p of enumeratePlacements(board, createPiece(type))) {
          expect(isValidPosition(board, p.piece)).toBe(true);
          expect(movePiece(board, p.piece, 0, 1)).toBeNull();
        }
      }
    });

  }

  it.each(BOARDS)('replay plus hard drop reproduces every %s placement', (_name, board) => {
    for (const type of ALL_TYPES) {
      const spawn = createPiece(type);
      for (const placement of enumeratePlacements(board, spawn)) {
        const path = projectPath(board, spawn, placement.moves);
        expect(path).toHaveLength(placement.moves.length);
        const preDrop = path.at(-1) ?? spawn;
        expect(samePiece(projectHardDrop(board, preDrop), placement.piece)).toBe(true);
      }
    }
  });

  it.each([
    ['181,182,183,184', 1, 16],
    ['210,211,212,213', 0, 19],
  ] as const)(
    'keeps the declared rotation-2 I pose for cellKey %s',
    (cells, x, y) => {
      const board = boardFrom(['....######', '....######', '.....#####']);
      const spawn = createPiece(1);
      const placement = enumeratePlacements(board, spawn)
        .find((candidate) => cellKey(candidate.piece) === cells);

      expect(placement?.piece).toMatchObject({
        type: 1,
        rotation: 2,
        position: { x, y },
      });
      const path = projectPath(board, spawn, placement!.moves);
      expect(path).toHaveLength(placement!.moves.length);
      const projected = projectHardDrop(board, path.at(-1) ?? spawn);
      expect(projected).toMatchObject({
        type: 1,
        rotation: 2,
        position: { x, y },
      });
      expect(samePiece(projected, placement!.piece)).toBe(true);
    },
  );

  it('rotates the centre I at spawn and hard-drops without unnecessary down moves', () => {
    const vertical = enumeratePlacements(EMPTY, createPiece(1))
      .find((placement) => cellKey(placement.piece) === '185,195,205,215');

    expect(vertical).toBeDefined();
    expect(vertical!.moves).toEqual(['rotate']);
  });

  it('retains only the downward moves needed for the roofed tuck', () => {
    const board = boardFrom(['....######', '....######', '.....#####']);
    const tuck = enumeratePlacements(board, createPiece(1))
      .find((placement) => cellKey(placement.piece) === '211,212,213,214');

    expect(tuck).toBeDefined();
    expect(tuck!.moves).toContain('down');
    const path = projectPath(board, createPiece(1), tuck!.moves);
    expect(cellKey(projectHardDrop(board, path.at(-1)!))).toBe('211,212,213,214');
  });

  it('does not mutate a representative board while enumerating or hard-dropping', () => {
    const board = boardFrom(['..#.......', '..#....#..', '##.#####.#']);
    const snapshot = board.map((row) => [...row]);

    enumeratePlacements(board, createPiece(7));
    expect(board).toEqual(snapshot);

    projectHardDrop(board, createPiece(7));
    expect(board).toEqual(snapshot);
  });

  it('reaches the left-shaft I landing through a real SRS kick', () => {
    const board = boardFrom(Array(20).fill('.#########'));
    const landingKey = '180,190,200,210';
    const placement = enumeratePlacements(board, createPiece(1))
      .find((candidate) => cellKey(candidate.piece) === landingKey);

    expect(placement).toBeDefined();
    expect(placement!.moves).toEqual(['left', 'left', 'left', 'rotate']);
    const path = projectPath(board, createPiece(1), placement!.moves);
    const beforeKick = path.at(-2)!;
    const kicked = path.at(-1)!;
    expect(isValidPosition(board, { ...beforeKick, rotation: 1 })).toBe(false);
    expect(rotatePiece(board, beforeKick)).toEqual(kicked);
    expect(kicked).toMatchObject({ rotation: 1, position: { x: -2, y: 0 } });
    expect(cellKey(projectHardDrop(board, kicked))).toBe(landingKey);
  });

  it('throws a placement-specific error if the pre-drop projection is missing', () => {
    const board = boardFrom(Array(20).fill('.#########'));
    vi.spyOn(Map.prototype, 'get').mockReturnValueOnce(undefined);

    expect(() => enumeratePlacements(board, createPiece(1)))
      .toThrow('missing pre-drop path for reachable placement 13,14,15,16');
  });
});

describe('reachability', () => {
  it('returns an empty array when the spawn position is blocked', () => {
    const full = boardFrom(Array(22).fill('##########'));
    expect(enumeratePlacements(full, createPiece(1))).toEqual([]);
  });

  it('finds tuck placements that rotate-then-hard-drop cannot reach', () => {
    //  row 19:  ....######
    //  row 20:  ....######
    //  row 21:  .....#####     <- (21,4) is roofed over by (19,4)/(20,4)
    const board = boardFrom(['....######', '....######', '.....#####']);
    const spawn = createPiece(1); // I piece

    const bfs = new Set(enumeratePlacements(board, spawn).map((p) => cellKey(p.piece)));
    const naive = naiveKeys(board, spawn);

    // Slide down columns 0-3, then step right to tuck into the roofed cell.
    const tuck = [21 * BOARD_WIDTH + 1, 21 * BOARD_WIDTH + 2,
                  21 * BOARD_WIDTH + 3, 21 * BOARD_WIDTH + 4].join(',');

    expect(bfs.has(tuck)).toBe(true);
    expect(naive.has(tuck)).toBe(false);
    expect(bfs.size).toBeGreaterThan(naive.size);
  });

  it('gives the shortest key sequence for each placement', () => {
    // The far-left O placement needs exactly four lefts from spawn x=3.
    const placements = enumeratePlacements(EMPTY, createPiece(2));
    const leftmost = placements.reduce((a, b) =>
      a.piece.position.x <= b.piece.position.x ? a : b);
    expect(leftmost.moves.filter((m) => m === 'left')).toHaveLength(4);
    expect(leftmost.moves.filter((m) => m === 'right')).toHaveLength(0);
  });
});

describe('samePiece', () => {
  it('compares type, rotation and position', () => {
    const a = createPiece(3);
    expect(samePiece(a, { ...a, position: { ...a.position } })).toBe(true);
    expect(samePiece(a, { ...a, rotation: 1 })).toBe(false);
    expect(samePiece(a, { ...a, position: { x: 9, y: 0 } })).toBe(false);
    expect(samePiece(a, null)).toBe(false);
    expect(samePiece(null, null)).toBe(false);
  });
});
