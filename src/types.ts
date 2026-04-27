export interface MbtaRoute {
  id: string;
  type: 'route';
  attributes: {
    long_name: string;
    short_name: string;
    color: string;
    text_color: string;
    direction_names: [string, string];
    direction_destinations: [string, string];
    sort_order: number;
  };
}

export interface MbtaStop {
  id: string;
  type: 'stop';
  attributes: {
    name: string;
    municipality: string;
    platform_name?: string | null;
    platform_code?: string | null;
  };
}

export interface MbtaTrip {
  id: string;
  type: 'trip';
  attributes: {
    headsign: string;
    name: string;
    direction_id: number;
  };
}

export interface MbtaPrediction {
  id: string;
  type: 'prediction';
  attributes: {
    arrival_time: string | null;
    departure_time: string | null;
    direction_id: number;
    schedule_relationship: string | null;
    status: string | null;
    stop_sequence: number | null;
  };
  relationships: {
    trip: { data: { id: string } | null };
    stop: { data: { id: string } | null };
    route: { data: { id: string } | null };
  };
}

export interface MbtaSchedule {
  id: string;
  type: 'schedule';
  attributes: {
    arrival_time: string | null;
    departure_time: string | null;
    direction_id: number;
    stop_sequence: number;
    timepoint: boolean;
  };
  relationships: {
    trip: { data: { id: string } | null };
    stop: { data: { id: string } | null };
  };
}

export interface Prefs {
  apiKey: string;
  favoriteRoutes: string[];
  favoriteStops: Record<string, string[]>;
  favoriteTrips: Record<string, string[]>; // routeId -> tripNames[]
  refreshInterval: number; // seconds
}

export interface TripDisplay {
  tripId: string;
  tripName: string;
  headsign: string;
  directionId: number;
  originTime: string | null;
  track: string | null;
  status: string | null;
  hasLiveData: boolean;
  isFavorite: boolean;
}

export interface MbtaAlert {
  id: string;
  type: 'alert';
  attributes: {
    header: string;
    description: string | null;
    effect: string;
    severity: number;
    service_effect: string;
    cause: string;
    updated_at: string;
    lifecycle: string;
    active_period: Array<{ start: string; end: string | null }>;
  };
  relationships?: {
    routes?: { data: Array<{ id: string; type: string }> };
  };
}

export interface StopTimeDisplay {
  stopId: string;
  stopName: string;
  sequence: number;
  scheduled: string | null;
  predicted: string | null;
  track: string | null;
  status: string | null;
  isFavorite: boolean;
  isPast: boolean;
}
