// Local progress persistence: highest level reached, best times, last password.

const KEY = 'cc-web-save-v1';

export interface SaveData {
  highest: number; // highest level number unlocked
  bestTimes: Record<number, number>; // level number -> best time-left
  lastPassword: string;
}

const DEFAULT: SaveData = { highest: 1, bestTimes: {}, lastPassword: '' };

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<SaveData>) };
  } catch {
    return { ...DEFAULT };
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function recordWin(data: SaveData, levelNumber: number, timeLeft: number): SaveData {
  const next: SaveData = {
    ...data,
    highest: Math.max(data.highest, levelNumber + 1),
    bestTimes: { ...data.bestTimes },
  };
  const prev = next.bestTimes[levelNumber];
  if (prev === undefined || timeLeft > prev) next.bestTimes[levelNumber] = timeLeft;
  return next;
}
