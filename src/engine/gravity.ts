import { getSpeedInterval } from '../constants';

export function shouldDrop(dropTimer: number, level: number, deltaTime: number): { shouldDrop: boolean; newTimer: number } {
  const newTimer = dropTimer + deltaTime;
  const interval = getSpeedInterval(level);

  if (newTimer >= interval) {
    return { shouldDrop: true, newTimer: newTimer - interval };
  }

  return { shouldDrop: false, newTimer };
}