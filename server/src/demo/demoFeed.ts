/**
 * A small synthetic GTFS feed modelled on a slice of the SL network, so the app is fully
 * usable without a Trafiklab key. Station positions are approximate; timetables are generated.
 */
import type { GtfsSource, Row } from '../gtfs/importer.ts';
import { haversine } from '../gtfs/store.ts';

type P = [name: string, lat: number, lon: number];

// ---- Stations -------------------------------------------------------------------------------
const M: Record<string, P> = Object.fromEntries(([
  ['Hässelby strand', 59.3614, 17.8324], ['Hässelby gård', 59.3669, 17.8440], ['Johannelund', 59.3679, 17.8575],
  ['Vällingby', 59.3632, 17.8720], ['Råcksta', 59.3548, 17.8818], ['Blackeberg', 59.3483, 17.8828],
  ['Islandstorget', 59.3459, 17.8940], ['Ängbyplan', 59.3419, 17.9071], ['Åkeshov', 59.3421, 17.9249],
  ['Brommaplan', 59.3383, 17.9392], ['Abrahamsberg', 59.3367, 17.9529], ['Stora mossen', 59.3345, 17.9661],
  ['Alvik', 59.3336, 17.9803], ['Kristineberg', 59.3326, 18.0032], ['Thorildsplan', 59.3318, 18.0154],
  ['Fridhemsplan', 59.3322, 18.0296], ['S:t Eriksplan', 59.3396, 18.0371], ['Odenplan', 59.3429, 18.0497],
  ['Rådmansgatan', 59.3405, 18.0587], ['Hötorget', 59.3355, 18.0634], ['T-Centralen', 59.3313, 18.0596],
  ['Gamla stan', 59.3231, 18.0676], ['Slussen', 59.3195, 18.0718], ['Medborgarplatsen', 59.3142, 18.0736],
  ['Skanstull', 59.3078, 18.0762], ['Gullmarsplan', 59.2991, 18.0808], ['Skärmarbrink', 59.2952, 18.0904],
  ['Hammarbyhöjden', 59.2948, 18.1045], ['Björkhagen', 59.2912, 18.1156], ['Kärrtorp', 59.2845, 18.1144],
  ['Bagarmossen', 59.2763, 18.1316], ['Skarpnäck', 59.2667, 18.1333], ['Blåsut', 59.2902, 18.0906],
  ['Sandsborg', 59.2847, 18.0923], ['Skogskyrkogården', 59.2791, 18.0955], ['Tallkrogen', 59.2711, 18.0853],
  ['Gubbängen', 59.2626, 18.0821], ['Hökarängen', 59.2579, 18.0824], ['Farsta', 59.2435, 18.0932],
  ['Farsta strand', 59.2350, 18.1016], ['Globen', 59.2943, 18.0775], ['Enskede gård', 59.2893, 18.0703],
  ['Sockenplan', 59.2833, 18.0707], ['Svedmyra', 59.2775, 18.0674], ['Stureby', 59.2746, 18.0556],
  ['Bandhagen', 59.2703, 18.0495], ['Högdalen', 59.2637, 18.0429], ['Rågsved', 59.2565, 18.0282],
  ['Hagsätra', 59.2627, 18.0126],
  ['Mörby centrum', 59.3984, 18.0363], ['Danderyds sjukhus', 59.3920, 18.0414], ['Bergshamra', 59.3813, 18.0365],
  ['Universitetet', 59.3655, 18.0549], ['Tekniska högskolan', 59.3456, 18.0716], ['Stadion', 59.3428, 18.0817],
  ['Östermalmstorg', 59.3350, 18.0741], ['Mariatorget', 59.3170, 18.0632], ['Zinkensdamm', 59.3177, 18.0501],
  ['Hornstull', 59.3157, 18.0340], ['Liljeholmen', 59.3106, 18.0231], ['Midsommarkransen', 59.3019, 18.0118],
  ['Telefonplan', 59.2982, 17.9971], ['Hägerstensåsen', 59.2956, 17.9790], ['Västertorp', 59.2914, 17.9667],
  ['Fruängen', 59.2865, 17.9650], ['Ropsten', 59.3573, 18.1022], ['Gärdet', 59.3470, 18.0990],
  ['Karlaplan', 59.3386, 18.0907], ['Aspudden', 59.3064, 18.0014], ['Örnsberg', 59.3055, 17.9892],
  ['Axelsberg', 59.3044, 17.9754], ['Mälarhöjden', 59.3009, 17.9573], ['Bredäng', 59.2948, 17.9338],
  ['Sätra', 59.2849, 17.9213], ['Skärholmen', 59.2771, 17.9069], ['Vårberg', 59.2759, 17.8901],
  ['Vårby gård', 59.2645, 17.8840], ['Masmo', 59.2497, 17.8801], ['Fittja', 59.2475, 17.8609],
  ['Alby', 59.2395, 17.8454], ['Hallunda', 59.2433, 17.8255], ['Norsborg', 59.2437, 17.8143],
  ['Kungsträdgården', 59.3307, 18.0735], ['Rådhuset', 59.3303, 18.0421], ['Stadshagen', 59.3371, 18.0170],
  ['Västra skogen', 59.3474, 18.0040], ['Solna centrum', 59.3588, 17.9989], ['Näckrosen', 59.3664, 17.9829],
  ['Hallonbergen', 59.3754, 17.9692], ['Kista', 59.4029, 17.9425], ['Husby', 59.4103, 17.9254],
  ['Akalla', 59.4146, 17.9128], ['Huvudsta', 59.3496, 17.9856], ['Solna strand', 59.3536, 17.9737],
  ['Sundbybergs centrum', 59.3608, 17.9720], ['Duvbo', 59.3677, 17.9646], ['Rissne', 59.3759, 17.9400],
  ['Rinkeby', 59.3880, 17.9285], ['Tensta', 59.3945, 17.9010], ['Hjulsta', 59.3963, 17.8876],
] as P[]).map((p) => [p[0], p]));

const J: Record<string, P> = Object.fromEntries(([
  ['Märsta', 59.6282, 17.8606], ['Rosersberg', 59.5832, 17.8795], ['Upplands Väsby', 59.5217, 17.9003],
  ['Rotebro', 59.4763, 17.9135], ['Norrviken', 59.4579, 17.9243], ['Häggvik', 59.4440, 17.9326],
  ['Sollentuna', 59.4283, 17.9481], ['Helenelund', 59.4089, 17.9612], ['Ulriksdal', 59.3810, 18.0000],
  ['Solna', 59.3651, 18.0106], ['Stockholm Odenplan', 59.3431, 18.0461], ['Stockholm City', 59.3310, 18.0590],
  ['Stockholm Södra', 59.3137, 18.0632], ['Årstaberg', 59.2997, 18.0294], ['Älvsjö', 59.2785, 18.0106],
  ['Stuvsta', 59.2530, 17.9965], ['Huddinge', 59.2370, 17.9814], ['Flemingsberg', 59.2185, 17.9464],
  ['Tullinge', 59.2053, 17.9031], ['Tumba', 59.1995, 17.8335], ['Rönninge', 59.1935, 17.7501],
  ['Östertälje', 59.1843, 17.6640], ['Södertälje hamn', 59.1789, 17.6461], ['Södertälje centrum', 59.1924, 17.6266],
  ['Västerhaninge', 59.1225, 18.1027], ['Jordbro', 59.1414, 18.1263], ['Handen', 59.1680, 18.1371],
  ['Skogås', 59.2180, 18.1532], ['Trångsund', 59.2275, 18.1297], ['Farsta strand', 59.2358, 18.1030],
  ['Karlberg', 59.3398, 18.0293], ['Sundbyberg', 59.3609, 17.9713], ['Spånga', 59.3833, 17.8984],
  ['Barkarby', 59.4040, 17.8699], ['Jakobsberg', 59.4232, 17.8341], ['Kallhäll', 59.4531, 17.8054],
  ['Kungsängen', 59.4782, 17.7505], ['Bro', 59.5114, 17.6368], ['Bålsta', 59.5680, 17.5305],
] as P[]).map((p) => [p[0], p]));

const B: Record<string, P> = Object.fromEntries(([
  ['Gullmarsplan', 59.2995, 18.0800], ['Skanstull', 59.3083, 18.0755], ['Ringvägen', 59.3085, 18.0640],
  ['Zinkensdamm', 59.3181, 18.0505], ['Hornstull', 59.3160, 18.0345], ['Västerbroplan', 59.3230, 18.0270],
  ['Fridhemsplan', 59.3326, 18.0290], ['S:t Eriksplan', 59.3400, 18.0365], ['Odenplan', 59.3433, 18.0490],
  ['Stadsbiblioteket', 59.3438, 18.0543], ['Tekniska högskolan', 59.3460, 18.0710], ['Stadion', 59.3432, 18.0810],
  ['Radiohuset', 59.3361, 18.1024], ['Stora Essingen', 59.3240, 17.9950], ['Scheelegatan', 59.3309, 18.0386],
  ['Kungsbron', 59.3330, 18.0510], ['Centralen', 59.3318, 18.0570], ['Stureplan', 59.3355, 18.0735],
  ['Karlaplan', 59.3390, 18.0900], ['Frihamnen', 59.3425, 18.1180], ['Sergels torg', 59.3326, 18.0632],
  ['Kungsträdgården', 59.3317, 18.0717], ['Nybroplan', 59.3326, 18.0770], ['Djurgårdsbron', 59.3316, 18.0931],
  ['Nordiska museet', 59.3292, 18.0936], ['Skansen', 59.3263, 18.1030], ['Waldemarsudde', 59.3220, 18.1100],
  ['Slussen', 59.3200, 18.0725], ['Medborgarplatsen', 59.3146, 18.0730], ['Götgatan', 59.3110, 18.0735],
  ['Sofo', 59.3120, 18.0820], ['Danvikstull', 59.3140, 18.1030],
] as P[]).map((p) => [p[0], p]));

const trunkWest = ['Hässelby strand', 'Hässelby gård', 'Johannelund', 'Vällingby', 'Råcksta', 'Blackeberg', 'Islandstorget', 'Ängbyplan', 'Åkeshov', 'Brommaplan', 'Abrahamsberg', 'Stora mossen', 'Alvik', 'Kristineberg', 'Thorildsplan', 'Fridhemsplan', 'S:t Eriksplan', 'Odenplan', 'Rådmansgatan', 'Hötorget', 'T-Centralen', 'Gamla stan', 'Slussen', 'Medborgarplatsen', 'Skanstull', 'Gullmarsplan'];
const redCore = ['Östermalmstorg', 'T-Centralen', 'Gamla stan', 'Slussen', 'Mariatorget', 'Zinkensdamm', 'Hornstull', 'Liljeholmen'];

interface LineDef {
  id: string; line: string; name: string; type: number; color: string;
  group: 'M' | 'J' | 'B'; stops: string[]; headway: number; kmh: number; dwell: number;
}

const LINES: LineDef[] = [
  { id: 'demo-17', line: '17', name: 'Gröna linjen', type: 401, color: '#179a3e', group: 'M', headway: 10, kmh: 34, dwell: 30,
    stops: [...trunkWest.slice(8), 'Skärmarbrink', 'Hammarbyhöjden', 'Björkhagen', 'Kärrtorp', 'Bagarmossen', 'Skarpnäck'] },
  { id: 'demo-18', line: '18', name: 'Gröna linjen', type: 401, color: '#179a3e', group: 'M', headway: 10, kmh: 34, dwell: 30,
    stops: [...trunkWest.slice(12), 'Skärmarbrink', 'Blåsut', 'Sandsborg', 'Skogskyrkogården', 'Tallkrogen', 'Gubbängen', 'Hökarängen', 'Farsta', 'Farsta strand'] },
  { id: 'demo-19', line: '19', name: 'Gröna linjen', type: 401, color: '#179a3e', group: 'M', headway: 10, kmh: 34, dwell: 30,
    stops: [...trunkWest, 'Globen', 'Enskede gård', 'Sockenplan', 'Svedmyra', 'Stureby', 'Bandhagen', 'Högdalen', 'Rågsved', 'Hagsätra'] },
  { id: 'demo-13', line: '13', name: 'Röda linjen', type: 401, color: '#d71d24', group: 'M', headway: 8, kmh: 36, dwell: 30,
    stops: ['Ropsten', 'Gärdet', 'Karlaplan', ...redCore, 'Aspudden', 'Örnsberg', 'Axelsberg', 'Mälarhöjden', 'Bredäng', 'Sätra', 'Skärholmen', 'Vårberg', 'Vårby gård', 'Masmo', 'Fittja', 'Alby', 'Hallunda', 'Norsborg'] },
  { id: 'demo-14', line: '14', name: 'Röda linjen', type: 401, color: '#d71d24', group: 'M', headway: 8, kmh: 36, dwell: 30,
    stops: ['Mörby centrum', 'Danderyds sjukhus', 'Bergshamra', 'Universitetet', 'Tekniska högskolan', 'Stadion', ...redCore, 'Midsommarkransen', 'Telefonplan', 'Hägerstensåsen', 'Västertorp', 'Fruängen'] },
  { id: 'demo-10', line: '10', name: 'Blå linjen', type: 401, color: '#0089ca', group: 'M', headway: 8, kmh: 38, dwell: 30,
    stops: ['Kungsträdgården', 'T-Centralen', 'Rådhuset', 'Fridhemsplan', 'Stadshagen', 'Västra skogen', 'Huvudsta', 'Solna strand', 'Sundbybergs centrum', 'Duvbo', 'Rissne', 'Rinkeby', 'Tensta', 'Hjulsta'] },
  { id: 'demo-11', line: '11', name: 'Blå linjen', type: 401, color: '#0089ca', group: 'M', headway: 8, kmh: 38, dwell: 30,
    stops: ['Kungsträdgården', 'T-Centralen', 'Rådhuset', 'Fridhemsplan', 'Stadshagen', 'Västra skogen', 'Solna centrum', 'Näckrosen', 'Hallonbergen', 'Kista', 'Husby', 'Akalla'] },
  { id: 'demo-41', line: '41', name: 'Pendeltåg', type: 109, color: '#ec619f', group: 'J', headway: 15, kmh: 60, dwell: 45,
    stops: ['Märsta', 'Rosersberg', 'Upplands Väsby', 'Rotebro', 'Norrviken', 'Häggvik', 'Sollentuna', 'Helenelund', 'Ulriksdal', 'Solna', 'Stockholm Odenplan', 'Stockholm City', 'Stockholm Södra', 'Årstaberg', 'Älvsjö', 'Stuvsta', 'Huddinge', 'Flemingsberg', 'Tullinge', 'Tumba', 'Rönninge', 'Östertälje', 'Södertälje hamn', 'Södertälje centrum'] },
  { id: 'demo-43', line: '43', name: 'Pendeltåg', type: 109, color: '#ec619f', group: 'J', headway: 15, kmh: 60, dwell: 45,
    stops: ['Västerhaninge', 'Jordbro', 'Handen', 'Skogås', 'Trångsund', 'Farsta strand', 'Älvsjö', 'Årstaberg', 'Stockholm Södra', 'Stockholm City', 'Stockholm Odenplan', 'Karlberg', 'Sundbyberg', 'Spånga', 'Barkarby', 'Jakobsberg', 'Kallhäll', 'Kungsängen', 'Bro', 'Bålsta'] },
  { id: 'demo-b1', line: '1', name: 'Stora Essingen–Frihamnen', type: 700, color: '#0089ca', group: 'B', headway: 8, kmh: 16, dwell: 20,
    stops: ['Stora Essingen', 'Västerbroplan', 'Fridhemsplan', 'Scheelegatan', 'Kungsbron', 'Centralen', 'Sergels torg', 'Stureplan', 'Karlaplan', 'Frihamnen'] },
  { id: 'demo-b4', line: '4', name: 'Gullmarsplan–Radiohuset', type: 700, color: '#0089ca', group: 'B', headway: 7, kmh: 16, dwell: 20,
    stops: ['Gullmarsplan', 'Skanstull', 'Ringvägen', 'Zinkensdamm', 'Hornstull', 'Västerbroplan', 'Fridhemsplan', 'S:t Eriksplan', 'Odenplan', 'Stadsbiblioteket', 'Tekniska högskolan', 'Stadion', 'Radiohuset'] },
  { id: 'demo-b53', line: '53', name: 'Karolinska–Henriksdalsberget', type: 700, color: '#d71d24', group: 'B', headway: 12, kmh: 15, dwell: 20,
    stops: ['Odenplan', 'Kungsbron', 'Centralen', 'Slussen', 'Medborgarplatsen', 'Götgatan', 'Sofo', 'Danvikstull'] },
  { id: 'demo-7', line: '7', name: 'Spårväg City', type: 900, color: '#878a83', group: 'B', headway: 12, kmh: 14, dwell: 25,
    stops: ['Sergels torg', 'Kungsträdgården', 'Nybroplan', 'Djurgårdsbron', 'Nordiska museet', 'Skansen', 'Waldemarsudde'] },
];

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();

const fmt = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export function buildDemoFeed(): Record<string, Row[]> {
  const table = { M: M, J: J, B: B } as const;
  const stations = new Map<string, Row>();
  const platforms = new Map<string, Row>();
  const routes: Row[] = [], trips: Row[] = [], stopTimes: Row[] = [], shapes: Row[] = [];

  const platformFor = (l: LineDef, name: string) => {
    const p = table[l.group][name];
    if (!p) throw new Error(`Demo feed: unknown ${l.group} stop ${name}`);
    const stationId = `${l.group}-${slug(name)}`;
    if (!stations.has(stationId)) {
      stations.set(stationId, { stop_id: stationId, stop_name: name, stop_lat: String(p[1]), stop_lon: String(p[2]), location_type: '1', parent_station: '', platform_code: '' });
    }
    // One platform per station and line group; buses/trams at the same place share a stop.
    const platformKey = l.group === 'B' ? `${stationId}-p` : `${stationId}-${l.id}`;
    if (!platforms.has(platformKey)) {
      const n = [...platforms.keys()].filter((k) => k.startsWith(stationId + '-')).length + 1;
      platforms.set(platformKey, { stop_id: platformKey, stop_name: name, stop_lat: String(p[1]), stop_lon: String(p[2]), location_type: '0', parent_station: stationId, platform_code: l.group === 'B' ? '' : String(n) });
    }
    return { id: platformKey, lat: p[1], lon: p[2] };
  };

  for (const l of LINES) {
    routes.push({ route_id: l.id, route_short_name: l.line, route_long_name: l.name, route_type: String(l.type), route_color: l.color.slice(1), route_text_color: 'ffffff' });
    for (const dir of [0, 1]) {
      const names = dir === 0 ? l.stops : [...l.stops].reverse();
      const pts = names.map((n) => platformFor(l, n));
      const shapeId = `${l.id}-${dir}`;
      pts.forEach((p, i) => shapes.push({ shape_id: shapeId, shape_pt_sequence: String(i), shape_pt_lat: String(p.lat), shape_pt_lon: String(p.lon) }));
      // Offsets from trip start for each stop.
      const offsets: [number, number][] = [];
      let t = 0;
      pts.forEach((p, i) => {
        if (i > 0) {
          const km = haversine(pts[i - 1].lat, pts[i - 1].lon, p.lat, p.lon) / 1000;
          t += Math.max(60, Math.round((km / l.kmh) * 3600 / 10) * 10);
        }
        const arr = t;
        if (i > 0 && i < pts.length - 1) t += l.dwell;
        offsets.push([arr, t]);
      });
      const phase = (dir * 3 + parseInt(l.line, 10)) % l.headway;
      for (let start = 5 * 3600 + phase * 60; start <= 25 * 3600; start += l.headway * 60) {
        const tripId = `${l.id}-${dir}-${start}`;
        trips.push({ trip_id: tripId, route_id: l.id, service_id: 'ALL', trip_headsign: names[names.length - 1], direction_id: String(dir), shape_id: shapeId });
        pts.forEach((p, i) => stopTimes.push({
          trip_id: tripId, stop_sequence: String(i + 1), stop_id: p.id,
          arrival_time: fmt(start + offsets[i][0]), departure_time: fmt(start + offsets[i][1]),
        }));
      }
    }
  }

  return {
    'routes.txt': routes,
    'trips.txt': trips,
    'stops.txt': [...stations.values(), ...platforms.values()],
    'stop_times.txt': stopTimes,
    'shapes.txt': shapes,
    'calendar.txt': [{ service_id: 'ALL', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '1', sunday: '1', start_date: '20200101', end_date: '20991231' }],
    'calendar_dates.txt': [],
  };
}

export const demoSource = (): GtfsSource => {
  const feed = buildDemoFeed();
  return async (file) => feed[file] ?? null;
};
