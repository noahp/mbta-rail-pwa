import type { MbtaSchedule, MbtaStop, MbtaTrip, Prefs } from './types';

const PREFS_KEY = 'mbta-rail-pwa-v1';
const SCHED_KEY_PREFIX = 'mbta-rail-pwa-sched-v1-';

const defaults: Prefs = {
  apiKey: '',
  favoriteRoutes: [],
  favoriteStops: {},
  refreshInterval: 10,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...defaults, favoriteStops: {} };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...defaults, ...parsed, favoriteStops: parsed.favoriteStops ?? {} };
  } catch {
    return { ...defaults, favoriteStops: {} };
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export interface PersistedSchedCache {
  date: string;
  schedules: MbtaSchedule[];
  trips: [string, MbtaTrip][];
  stops: [string, MbtaStop][];
}

export function loadSchedCache(routeId: string): PersistedSchedCache | null {
  try {
    const raw = localStorage.getItem(SCHED_KEY_PREFIX + routeId);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSchedCache;
  } catch {
    return null;
  }
}

export function saveSchedCache(routeId: string, cache: PersistedSchedCache): void {
  try {
    localStorage.setItem(SCHED_KEY_PREFIX + routeId, JSON.stringify(cache));
  } catch {
    // Quota exceeded — not critical, next load will re-fetch
  }
}

export function clearSchedCache(routeId: string): void {
  localStorage.removeItem(SCHED_KEY_PREFIX + routeId);
}
