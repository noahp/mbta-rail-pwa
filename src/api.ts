import type { MbtaRoute, MbtaStop, MbtaTrip, MbtaPrediction, MbtaSchedule, MbtaAlert } from './types';

const BASE = 'https://api-v3.mbta.com';

type Included = MbtaTrip | MbtaStop;

interface JsonApiList<T> {
  data: T[];
  included?: Included[];
}

export class MbtaApi {
  private apiKey = '';

  setApiKey(key: string) {
    this.apiKey = key;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<JsonApiList<T>> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (this.apiKey) url.searchParams.set('api_key', this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`MBTA ${res.status}: ${text.slice(0, 120)}`);
    }
    return res.json() as Promise<JsonApiList<T>>;
  }

  async getCommuterRailRoutes(): Promise<MbtaRoute[]> {
    const r = await this.get<MbtaRoute>('/routes', {
      'filter[type]': '2',
      'fields[route]': 'long_name,short_name,color,text_color,direction_names,direction_destinations,sort_order',
    });
    return r.data;
  }

  async getPredictions(routeId: string): Promise<{
    predictions: MbtaPrediction[];
    trips: MbtaTrip[];
    stops: MbtaStop[];
  }> {
    const r = await this.get<MbtaPrediction>('/predictions', {
      'filter[route]': routeId,
      'include': 'trip,stop',
      'fields[prediction]': 'arrival_time,departure_time,direction_id,schedule_relationship,status,stop_sequence',
      'fields[trip]': 'headsign,name,direction_id',
      'fields[stop]': 'name,municipality',
    });
    const inc = r.included ?? [];
    return {
      predictions: r.data,
      trips: inc.filter((i): i is MbtaTrip => i.type === 'trip'),
      stops: inc.filter((i): i is MbtaStop => i.type === 'stop'),
    };
  }

  async getSchedulesForRoute(routeId: string, date: string, minTime: string): Promise<{
    schedules: MbtaSchedule[];
    trips: MbtaTrip[];
    stops: MbtaStop[];
  }> {
    const r = await this.get<MbtaSchedule>('/schedules', {
      'filter[route]': routeId,
      'filter[date]': date,
      'filter[min_time]': minTime,
      'include': 'trip,stop',
      'fields[schedule]': 'departure_time,stop_sequence,direction_id',
      'fields[trip]': 'headsign,name,direction_id',
      'fields[stop]': 'name,municipality',
      'page[limit]': '1500',
    });
    const inc = r.included ?? [];
    return {
      schedules: r.data,
      trips: inc.filter((i): i is MbtaTrip => i.type === 'trip'),
      stops: inc.filter((i): i is MbtaStop => i.type === 'stop'),
    };
  }

  async getSchedulesForTrip(tripId: string): Promise<{
    schedules: MbtaSchedule[];
    stops: MbtaStop[];
  }> {
    const r = await this.get<MbtaSchedule>('/schedules', {
      'filter[trip]': tripId,
      'include': 'stop',
      'fields[schedule]': 'departure_time,arrival_time,stop_sequence',
      'fields[stop]': 'name,municipality',
    });
    const inc = r.included ?? [];
    return {
      schedules: r.data,
      stops: inc.filter((i): i is MbtaStop => i.type === 'stop'),
    };
  }

  async getAlerts(routeIds: string[]): Promise<MbtaAlert[]> {
    if (!routeIds.length) return [];
    const r = await this.get<MbtaAlert>('/alerts', {
      'filter[route]': routeIds.join(','),
      'filter[lifecycle]': 'NEW,ONGOING,ONGOING_UPCOMING',
      'fields[alert]': 'header,description,effect,severity,service_effect,cause,updated_at,lifecycle,active_period',
    });
    return r.data;
  }
}
