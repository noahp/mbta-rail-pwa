import { MbtaApi } from './api';
import { loadPrefs, savePrefs } from './store';
import { formatTime, countdown, isPast, todayString, nowHHMM, relativeTime, escHtml } from './utils';
import type {
  Prefs, MbtaRoute, MbtaStop, MbtaTrip, MbtaPrediction, MbtaSchedule,
  MbtaAlert, TripDisplay, StopTimeDisplay,
} from './types';

// ── Singletons / state ────────────────────────────────────────────────────

const api = new MbtaApi();
let prefs: Prefs;
let routes: MbtaRoute[] = [];
let routesError = '';

interface PredCache {
  predictions: MbtaPrediction[];
  trips: Map<string, MbtaTrip>;
  stops: Map<string, MbtaStop>;
  fetchedAt: number;
}

interface SchedCache {
  schedules: MbtaSchedule[];
  trips: Map<string, MbtaTrip>;
  stops: Map<string, MbtaStop>;
  date: string;
}

interface TripSchedCache {
  stops: { stopId: string; stopName: string; sequence: number; scheduled: string | null }[];
}

const predCache = new Map<string, PredCache>();
const schedCache = new Map<string, SchedCache>();
const tripSchedCache = new Map<string, TripSchedCache>();

const expandedRoutes = new Set<string>();
const expandedTrips = new Set<string>();
const loadingRoutes = new Set<string>();
const loadingTrips = new Set<string>();
const routeErrors = new Map<string, string>();

let showSettings = false;
let lastRefreshed: Date | null = null;
let isRefreshing = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeTab: 'trains' | 'alerts' = 'trains';
let alertCache: MbtaAlert[] = [];
let alertsError = '';

// ── Entry point ───────────────────────────────────────────────────────────

export async function init() {
  prefs = loadPrefs();
  api.setApiKey(prefs.apiKey);

  attachDelegation();
  renderSettings();
  renderStatus();

  try {
    routes = await api.getCommuterRailRoutes();
    routes.sort((a, b) => a.attributes.sort_order - b.attributes.sort_order);
  } catch (e) {
    routesError = e instanceof Error ? e.message : String(e);
  }

  // Auto-expand favorites
  for (const id of prefs.favoriteRoutes) expandedRoutes.add(id);

  renderRoutes();

  // Load data for expanded routes + initial alerts in parallel
  await Promise.all([
    ...[...expandedRoutes].map(loadRouteData),
    fetchAlerts(),
  ]);
  renderRoutes();
  renderStatus();
  renderTabBar();

  startPolling();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else { void pollAll(); startPolling(); }
  });
}

// ── Data loading ──────────────────────────────────────────────────────────

async function loadRouteData(routeId: string) {
  loadingRoutes.add(routeId);
  renderRoutes();

  const today = todayString();
  const cached = schedCache.get(routeId);

  const [, predResult] = await Promise.allSettled([
    // Only re-fetch schedules if stale (different day)
    (cached?.date === today ? Promise.resolve() : fetchSchedules(routeId, today)),
    fetchPredictions(routeId),
  ]);

  if (predResult.status === 'rejected') {
    routeErrors.set(routeId, String(predResult.reason).slice(0, 100));
  } else {
    routeErrors.delete(routeId);
  }

  loadingRoutes.delete(routeId);
  lastRefreshed = new Date();
}

async function fetchSchedules(routeId: string, date: string) {
  const { schedules, trips, stops } = await api.getSchedulesForRoute(routeId, date, nowHHMM(-15));
  schedCache.set(routeId, {
    schedules,
    trips: new Map(trips.map(t => [t.id, t])),
    stops: new Map(stops.map(s => [s.id, s])),
    date,
  });
}

async function fetchPredictions(routeId: string) {
  const { predictions, trips, stops } = await api.getPredictions(routeId);
  predCache.set(routeId, {
    predictions,
    trips: new Map(trips.map(t => [t.id, t])),
    stops: new Map(stops.map(s => [s.id, s])),
    fetchedAt: Date.now(),
  });
}

async function fetchAlerts() {
  if (!prefs.favoriteRoutes.length) { alertCache = []; return; }
  try {
    alertCache = await api.getAlerts(prefs.favoriteRoutes);
    alertsError = '';
  } catch (e) {
    alertsError = e instanceof Error ? e.message : String(e);
  }
}

async function loadTripSchedule(tripId: string) {
  if (tripSchedCache.has(tripId)) return;
  loadingTrips.add(tripId);
  renderRoutes();

  try {
    const { schedules, stops } = await api.getSchedulesForTrip(tripId);
    const stopMap = new Map(stops.map(s => [s.id, s]));
    tripSchedCache.set(tripId, {
      stops: schedules
        .sort((a, b) => a.attributes.stop_sequence - b.attributes.stop_sequence)
        .map(s => ({
          stopId: s.relationships.stop.data?.id ?? '',
          stopName: stopMap.get(s.relationships.stop.data?.id ?? '')?.attributes.name ?? '—',
          sequence: s.attributes.stop_sequence,
          scheduled: s.attributes.departure_time,
        })),
    });
  } catch {
    // Leave cache empty; stop-list will show a retry hint
  }

  loadingTrips.delete(tripId);
  renderRoutes();
}

// ── Polling ────────────────────────────────────────────────────────────────

function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(() => void pollAll(), 10_000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollAll() {
  isRefreshing = true;
  renderStatus();

  await Promise.allSettled([
    ...[...expandedRoutes].map(async id => {
      try {
        await fetchPredictions(id);
        routeErrors.delete(id);
      } catch (e) {
        routeErrors.set(id, String(e).slice(0, 100));
      }
    }),
    fetchAlerts(),
  ]);

  isRefreshing = false;
  lastRefreshed = new Date();
  renderStatus();
  renderTabBar();
  renderRoutes();
  if (activeTab === 'alerts') renderAlertsContainer();
}

// ── View-model builders ───────────────────────────────────────────────────

function buildTripList(routeId: string): TripDisplay[] {
  const sched = schedCache.get(routeId);
  const pred = predCache.get(routeId);

  // Build a map of tripId → predictions for this route
  const predByTrip = new Map<string, MbtaPrediction[]>();
  if (pred) {
    for (const p of pred.predictions) {
      const tid = p.relationships.trip.data?.id;
      if (!tid) continue;
      if (!predByTrip.has(tid)) predByTrip.set(tid, []);
      predByTrip.get(tid)!.push(p);
    }
  }

  // Collect trips from both sched and pred
  const tripMap = new Map<string, MbtaTrip>();
  if (sched) for (const [id, t] of sched.trips) tripMap.set(id, t);
  if (pred) for (const [id, t] of pred.trips) tripMap.set(id, t);

  const stopMap = new Map<string, MbtaStop>();
  if (sched) for (const [id, s] of sched.stops) stopMap.set(id, s);
  if (pred) for (const [id, s] of pred.stops) stopMap.set(id, s);

  // Group schedules by trip (to compute origin departure times for trips without predictions)
  const schedByTrip = new Map<string, MbtaSchedule[]>();
  if (sched) {
    for (const s of sched.schedules) {
      const tid = s.relationships.trip.data?.id;
      if (!tid) continue;
      if (!schedByTrip.has(tid)) schedByTrip.set(tid, []);
      schedByTrip.get(tid)!.push(s);
    }
  }

  // Merge trips from both sources
  const allTripIds = new Set([...schedByTrip.keys(), ...predByTrip.keys()]);
  const result: TripDisplay[] = [];

  for (const tripId of allTripIds) {
    const trip = tripMap.get(tripId);
    if (!trip) continue;

    const preds = predByTrip.get(tripId) ?? [];
    const scheds = (schedByTrip.get(tripId) ?? []).sort(
      (a, b) => a.attributes.stop_sequence - b.attributes.stop_sequence,
    );

    // Find origin: prefer prediction departure from SS or first stop, else schedule
    const ssPred = preds.find(p => {
      const sid = p.relationships.stop.data?.id;
      return sid && isSouthOrNorthStation(stopMap.get(sid)?.attributes.name ?? sid);
    });

    preds.sort((a, b) => (a.attributes.stop_sequence ?? 0) - (b.attributes.stop_sequence ?? 0));
    const firstPred = preds[0];
    const originPred = ssPred ?? firstPred;

    // For origin time, use prediction if available, else schedule first stop
    const originTime =
      originPred?.attributes.departure_time ??
      scheds[0]?.attributes.departure_time ??
      null;

    if (isPast(originTime) && !ssPred?.attributes.track) continue;

    result.push({
      tripId,
      tripName: trip.attributes.name,
      headsign: trip.attributes.headsign,
      directionId: trip.attributes.direction_id,
      originTime,
      track: ssPred?.attributes.track ?? originPred?.attributes.track ?? null,
      status: originPred?.attributes.status ?? null,
      hasLiveData: preds.some(p => p.attributes.status !== null),
    });
  }

  return result
    .sort((a, b) => {
      if (!a.originTime) return 1;
      if (!b.originTime) return -1;
      return new Date(a.originTime).getTime() - new Date(b.originTime).getTime();
    })
    .slice(0, 25);
}

function buildStopList(tripId: string, routeId: string): StopTimeDisplay[] | null {
  const tripSched = tripSchedCache.get(tripId);
  if (!tripSched) return null;

  const pred = predCache.get(routeId);
  const predByStop = new Map<string, MbtaPrediction>();
  if (pred) {
    for (const p of pred.predictions) {
      const tid = p.relationships.trip.data?.id;
      const sid = p.relationships.stop.data?.id;
      if (tid === tripId && sid) predByStop.set(sid, p);
    }
  }

  const favStops = new Set(prefs.favoriteStops[routeId] ?? []);

  return tripSched.stops.map(s => {
    const p = predByStop.get(s.stopId);
    const effectiveTime = p?.attributes.departure_time ?? s.scheduled;
    return {
      stopId: s.stopId,
      stopName: s.stopName,
      sequence: s.sequence,
      scheduled: s.scheduled,
      predicted: p?.attributes.departure_time ?? null,
      track: p?.attributes.track ?? null,
      status: p?.attributes.status ?? null,
      isFavorite: favStops.has(s.stopId),
      isPast: isPast(effectiveTime),
    };
  });
}

function isSouthOrNorthStation(name: string): boolean {
  return name === 'South Station' || name === 'North Station';
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderRoutes() {
  const container = document.getElementById('routes-container');
  if (!container) return;

  if (routesError) {
    container.innerHTML = `<div class="route-error">Failed to load routes: ${escHtml(routesError)}</div>`;
    return;
  }

  if (!routes.length) {
    container.innerHTML = '<div class="loading-routes"><div class="spinner"></div><p>Loading routes…</p></div>';
    return;
  }

  // Sort: favorites first, then by sort_order
  const sorted = [...routes].sort((a, b) => {
    const aFav = prefs.favoriteRoutes.includes(a.id) ? 0 : 1;
    const bFav = prefs.favoriteRoutes.includes(b.id) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.attributes.sort_order - b.attributes.sort_order;
  });

  container.innerHTML = sorted.map(renderRouteCard).join('');
}

function renderRouteCard(route: MbtaRoute): string {
  const isFav = prefs.favoriteRoutes.includes(route.id);
  const isExpanded = expandedRoutes.has(route.id);
  const color = `#${route.attributes.color || '7B388C'}`;
  const isLoading = loadingRoutes.has(route.id);
  const errMsg = routeErrors.get(route.id);

  const destinations = route.attributes.direction_destinations;
  const destText = destinations ? destinations.join(' / ') : '';

  return `
<div class="route-card${isFav ? ' is-favorite' : ''}${isExpanded ? ' is-expanded' : ''}" data-route-id="${escHtml(route.id)}">
  <div class="route-header" data-action="toggle-route" data-route="${escHtml(route.id)}">
    <div class="route-swatch" style="background:${color}"></div>
    <div class="route-name">
      ${escHtml(route.attributes.long_name)}
      ${destText ? `<div class="route-dest">${escHtml(destText)}</div>` : ''}
    </div>
    <button class="fav-btn${isFav ? ' active' : ''}" data-action="toggle-fav-route" data-route="${escHtml(route.id)}" aria-label="${isFav ? 'Unfavorite' : 'Favorite'}">
      ${isFav ? '★' : '☆'}
    </button>
    <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </div>
  ${isExpanded ? renderTripList(route.id, isLoading, errMsg) : ''}
</div>`;
}

function renderTripList(routeId: string, isLoading: boolean, errMsg: string | undefined): string {
  if (isLoading) {
    return '<div class="route-loading"><div class="spinner" style="width:20px;height:20px;margin:0 auto"></div></div>';
  }
  if (errMsg) {
    return `<div class="route-error">${escHtml(errMsg)}</div>`;
  }

  const trips = buildTripList(routeId);
  if (!trips.length) {
    return '<div class="route-empty">No upcoming trains found</div>';
  }

  return `<div class="trip-list">${trips.map(t => renderTripCard(t, routeId)).join('')}</div>`;
}

function renderTripCard(trip: TripDisplay, routeId: string): string {
  const isExpanded = expandedTrips.has(trip.tripId);
  const cd = countdown(trip.originTime);
  const cdSoon = cd === 'Now' || (cd.endsWith('min') && parseInt(cd) <= 5);

  const statusClass = !trip.status ? '' :
    /on.?time/i.test(trip.status) ? 'on-time' :
    /delay/i.test(trip.status) ? 'delayed' :
    /board|all.?aboard/i.test(trip.status) ? 'boarding' : 'other';

  return `
<div class="trip-card${isExpanded ? ' is-expanded' : ''}" data-trip-id="${escHtml(trip.tripId)}">
  <div class="trip-header" data-action="toggle-trip" data-trip="${escHtml(trip.tripId)}" data-route="${escHtml(routeId)}">
    <div class="trip-time-col">
      <div class="trip-time">${formatTime(trip.originTime)}</div>
      ${cd ? `<div class="trip-countdown${cdSoon ? ' soon' : ''}">${escHtml(cd)}</div>` : ''}
    </div>
    <div class="trip-info">
      <div class="trip-headsign">→ ${escHtml(trip.headsign)}</div>
      <div class="trip-name">Train ${escHtml(trip.tripName)}</div>
    </div>
    <div class="trip-badges">
      ${trip.hasLiveData ? '<span class="live-dot" title="Live data"></span>' : ''}
      ${trip.track ? `<span class="track-badge">Track ${escHtml(trip.track)}</span>` : ''}
      ${trip.status && statusClass ? `<span class="status-badge ${statusClass}">${escHtml(trip.status)}</span>` : ''}
    </div>
    <svg class="trip-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  </div>
  ${isExpanded ? renderStopList(trip.tripId, routeId) : ''}
</div>`;
}

function renderStopList(tripId: string, routeId: string): string {
  if (loadingTrips.has(tripId)) {
    return '<div class="stop-list-loading"><div class="spinner" style="width:18px;height:18px;margin:0 auto"></div></div>';
  }

  const stops = buildStopList(tripId, routeId);
  if (!stops) {
    return '<div class="stop-list-loading">Loading stops…</div>';
  }

  const rows = stops.map(s => renderStopRow(s, routeId)).join('');
  return `
<div class="stop-list">
  ${rows}
  <div class="stop-hint">Tap a stop to toggle favorite ★</div>
</div>`;
}

function renderStopRow(s: StopTimeDisplay, routeId: string): string {
  const effectiveTime = s.predicted ?? s.scheduled;
  const cd = s.isPast ? '' : countdown(effectiveTime);
  const cdSoon = cd === 'Now' || (cd.endsWith('min') && parseInt(cd) <= 5);

  return `
<div class="stop-row${s.isFavorite ? ' is-favorite' : ''}${s.isPast ? ' is-past' : ''}"
     data-action="toggle-fav-stop" data-route="${escHtml(routeId)}" data-stop="${escHtml(s.stopId)}">
  <div class="stop-fav-icon">${s.isFavorite ? '★' : ''}</div>
  <div class="stop-name">${escHtml(s.stopName)}</div>
  ${s.track ? `<span class="stop-track">Trk ${escHtml(s.track)}</span>` : ''}
  <div class="stop-time-col">
    ${s.predicted
      ? `<span class="stop-time-pred">${formatTime(s.predicted)}</span>
         ${s.scheduled && s.scheduled !== s.predicted
           ? `<span class="stop-time-sched">${formatTime(s.scheduled)}</span>`
           : ''}`
      : `<span class="stop-time-sched">${formatTime(s.scheduled)}</span>`
    }
    ${cd ? `<span class="stop-countdown${cdSoon ? ' soon' : ''}">${escHtml(cd)}</span>` : ''}
  </div>
</div>`;
}

function renderTabBar() {
  const el = document.getElementById('tab-bar');
  if (!el) return;
  const count = alertCache.length;
  el.innerHTML = `
<button class="tab-btn${activeTab === 'trains' ? ' active' : ''}" data-action="switch-tab" data-tab="trains">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <rect x="3" y="4" width="18" height="13" rx="3"/>
    <path d="M3 12h18"/>
    <circle cx="7.5" cy="19.5" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="16.5" cy="19.5" r="1.5" fill="currentColor" stroke="none"/>
    <path d="M7.5 18V17M16.5 18V17"/>
  </svg>
  Trains
</button>
<button class="tab-btn${activeTab === 'alerts' ? ' active' : ''}" data-action="switch-tab" data-tab="alerts">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
  Alerts
  ${count > 0 ? `<span class="tab-badge">${count}</span>` : ''}
</button>`;
}

function renderAlertsContainer() {
  const el = document.getElementById('alerts-container');
  if (!el) return;

  if (alertsError) {
    el.innerHTML = `<div class="alerts-empty"><p>Failed to load alerts: ${escHtml(alertsError)}</p></div>`;
    return;
  }

  if (!prefs.favoriteRoutes.length) {
    el.innerHTML = `
<div class="alerts-empty">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
  <p>Favorite some lines on the<br><strong>Trains tab</strong> to see alerts here.</p>
</div>`;
    return;
  }

  if (!alertCache.length) {
    el.innerHTML = `
<div class="alerts-empty">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
  <p>All clear! No active alerts for<br>your favorited routes.</p>
</div>`;
    return;
  }

  // Sort: highest severity first, then by updated_at desc
  const sorted = [...alertCache].sort((a, b) => {
    if (b.attributes.severity !== a.attributes.severity)
      return b.attributes.severity - a.attributes.severity;
    return new Date(b.attributes.updated_at).getTime() - new Date(a.attributes.updated_at).getTime();
  });

  el.innerHTML = sorted.map(renderAlertCard).join('');
}

function severityClass(severity: number): string {
  if (severity >= 7) return 'sev-severe';
  if (severity >= 4) return 'sev-warning';
  return 'sev-info';
}

function renderAlertCard(alert: MbtaAlert): string {
  const sevClass = severityClass(alert.attributes.severity);
  const effectLabel = alert.attributes.service_effect || alert.attributes.effect.replace(/_/g, ' ');
  const updated = relativeTime(new Date(alert.attributes.updated_at));

  // Look up affected route names from our in-memory routes list
  const affectedRouteIds = alert.relationships?.routes?.data?.map(r => r.id) ?? [];
  const affectedRoutes = routes.filter(r => affectedRouteIds.includes(r.id));
  const routeChips = affectedRoutes.map(r => `
<span class="alert-route-chip">
  <span class="alert-route-swatch" style="background:#${r.attributes.color || '7B388C'}"></span>
  <span class="alert-route-name">${escHtml(r.attributes.short_name || r.attributes.long_name)}</span>
</span>`).join('');

  return `
<div class="alert-card ${sevClass}">
  <div class="alert-top-row">
    ${routeChips}
    <span class="alert-effect-badge ${sevClass}">${escHtml(effectLabel)}</span>
  </div>
  <p class="alert-header">${escHtml(alert.attributes.header)}</p>
  ${alert.attributes.description ? `
  <details class="alert-details">
    <summary>More info</summary>
    <p class="alert-desc">${escHtml(alert.attributes.description)}</p>
  </details>` : ''}
  <div class="alert-footer">Updated ${escHtml(updated)}</div>
</div>`;
}

function renderStatus() {
  const bar = document.getElementById('status-bar');
  if (!bar) return;

  const noKey = !prefs.apiKey;
  const updatedText = lastRefreshed
    ? `Updated ${relativeTime(lastRefreshed)}`
    : noKey ? 'No API key — limited to 20 req/min' : 'Awaiting data…';

  bar.innerHTML = `
<span class="status-text">${escHtml(updatedText)}</span>
<button class="refresh-btn${isRefreshing ? ' spinning' : ''}" data-action="refresh" aria-label="Refresh">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
  Refresh
</button>`;
}

function renderSettings() {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  if (!showSettings) { panel.innerHTML = ''; return; }

  panel.innerHTML = `
<div class="settings-overlay" data-action="close-settings">
  <div class="settings-sheet" onclick="event.stopPropagation()">
    <div class="settings-handle"></div>
    <h2>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      Settings
    </h2>
    <label class="field-label" for="api-key-input">MBTA API Key</label>
    <input
      class="text-input"
      id="api-key-input"
      type="text"
      placeholder="Paste your API key here"
      value="${escHtml(prefs.apiKey)}"
      autocomplete="off"
      spellcheck="false"
    />
    <p class="field-hint">
      Get a free key at <a href="https://api-v3.mbta.com/" target="_blank" rel="noopener">api-v3.mbta.com</a>
      (takes ~1 day). Without a key, you're limited to 20 requests/min.
      Polling pauses automatically when the tab is hidden.
    </p>
    <div class="settings-actions">
      <button class="btn-primary" data-action="save-settings">Done</button>
    </div>
  </div>
</div>`;
}

// ── Event delegation ───────────────────────────────────────────────────────

function attachDelegation() {
  document.body.addEventListener('input', (e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target.id === 'api-key-input') {
      prefs.apiKey = target.value.trim();
      api.setApiKey(prefs.apiKey);
      savePrefs(prefs);
    }
  });

  document.body.addEventListener('click', (e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = el.dataset.action!;

    switch (action) {
      case 'open-settings':
        showSettings = true;
        renderSettings();
        break;

      case 'close-settings':
        showSettings = false;
        renderSettings();
        break;

      case 'save-settings':
        showSettings = false;
        renderSettings();
        renderStatus();
        renderTabBar();
        break;

      case 'toggle-route': {
        e.stopPropagation();
        const routeId = el.dataset.route!;
        if (expandedRoutes.has(routeId)) {
          expandedRoutes.delete(routeId);
          renderRoutes();
        } else {
          expandedRoutes.add(routeId);
          renderRoutes();
          void loadRouteData(routeId);
        }
        break;
      }

      case 'toggle-fav-route': {
        e.stopPropagation();
        const routeId = el.dataset.route!;
        const idx = prefs.favoriteRoutes.indexOf(routeId);
        if (idx >= 0) {
          prefs.favoriteRoutes.splice(idx, 1);
        } else {
          prefs.favoriteRoutes.unshift(routeId);
          if (!expandedRoutes.has(routeId)) {
            expandedRoutes.add(routeId);
            void loadRouteData(routeId);
          }
        }
        savePrefs(prefs);
        renderRoutes();
        // Refresh alerts since favorites changed
        void fetchAlerts().then(() => { renderTabBar(); if (activeTab === 'alerts') renderAlertsContainer(); });
        break;
      }

      case 'switch-tab': {
        const tab = el.dataset.tab as 'trains' | 'alerts';
        if (tab === activeTab) break;
        activeTab = tab;
        const routesEl = document.getElementById('routes-container');
        const alertsEl = document.getElementById('alerts-container');
        if (routesEl) routesEl.hidden = activeTab !== 'trains';
        if (alertsEl) alertsEl.hidden = activeTab !== 'alerts';
        renderTabBar();
        if (activeTab === 'alerts') renderAlertsContainer();
        break;
      }

      case 'toggle-trip': {
        const tripId = el.dataset.trip!;
        if (expandedTrips.has(tripId)) {
          expandedTrips.delete(tripId);
          renderRoutes();
        } else {
          expandedTrips.add(tripId);
          renderRoutes();
          void loadTripSchedule(tripId);
        }
        break;
      }

      case 'toggle-fav-stop': {
        e.stopPropagation();
        const routeId = el.dataset.route!;
        const stopId = el.dataset.stop!;
        if (!prefs.favoriteStops[routeId]) prefs.favoriteStops[routeId] = [];
        const list = prefs.favoriteStops[routeId];
        const idx = list.indexOf(stopId);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(stopId);
        savePrefs(prefs);
        renderRoutes();
        break;
      }

      case 'refresh':
        void pollAll();
        break;
    }
  });
}
