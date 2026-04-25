import type { Prefs } from './types';

const KEY = 'mbta-rail-pwa-v1';

const defaults: Prefs = {
  apiKey: '',
  favoriteRoutes: [],
  favoriteStops: {},
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults, favoriteStops: {} };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...defaults, ...parsed, favoriteStops: parsed.favoriteStops ?? {} };
  } catch {
    return { ...defaults, favoriteStops: {} };
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}
