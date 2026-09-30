import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { parse } from 'csv-parse';
import yauzl from 'yauzl';
import type { Readable } from 'node:stream';
import { parseGtfsTime } from '../time.ts';

export type Row = Record<string, string>;
/** Returns rows for a GTFS file name (e.g. "stops.txt"), or null if absent. */
export type GtfsSource = (file: string) => Promise<AsyncIterable<Row> | Iterable<Row> | null>;

const SCHEMA = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE routes(route_id TEXT PRIMARY KEY, short TEXT, long TEXT, type INT, color TEXT, text_color TEXT);
CREATE TABLE trips(trip_id TEXT PRIMARY KEY, route_id TEXT, service_id TEXT, headsign TEXT, direction_id INT, shape_id TEXT);
CREATE TABLE stops(stop_id TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL, parent TEXT, location_type INT, platform TEXT);
CREATE TABLE stop_times(trip_id TEXT, seq INT, stop_id TEXT, arr INT, dep INT);
CREATE TABLE calendar(service_id TEXT, days TEXT, start TEXT, end TEXT);
CREATE TABLE calendar_dates(service_id TEXT, date TEXT, type INT);
CREATE TABLE shapes(shape_id TEXT, seq INT, lat REAL, lon REAL);
`;

const INDEXES = `
CREATE INDEX st_stop_dep ON stop_times(stop_id, dep);
CREATE INDEX st_trip_seq ON stop_times(trip_id, seq);
CREATE INDEX trips_route ON trips(route_id, direction_id);
CREATE INDEX shapes_id ON shapes(shape_id, seq);
CREATE INDEX cd_date ON calendar_dates(date);
CREATE TEMP TABLE tf AS
  SELECT trip_id, MIN(seq) AS s, dep AS start FROM stop_times GROUP BY trip_id;
CREATE TABLE trip_bounds AS
  SELECT tl.trip_id, tf.start, tl.end, tl.last_seq, tl.last_stop
  FROM (SELECT trip_id, MAX(seq) AS last_seq, stop_id AS last_stop, arr AS end
        FROM stop_times GROUP BY trip_id) tl JOIN tf USING(trip_id);
CREATE UNIQUE INDEX tb_id ON trip_bounds(trip_id);
CREATE INDEX tb_time ON trip_bounds(start, end);
CREATE TABLE stop_routes AS
  SELECT DISTINCT st.stop_id, t.route_id, t.direction_id
  FROM stop_times st JOIN trips t ON t.trip_id = st.trip_id;
CREATE INDEX sr_stop ON stop_routes(stop_id);
`;

async function insertAll(
  db: DatabaseSync,
  rows: AsyncIterable<Row> | Iterable<Row> | null,
  sql: string,
  map: (r: Row) => (string | number | null)[] | null,
  log: (msg: string) => void,
  label: string,
) {
  if (!rows) return 0;
  const stmt = db.prepare(sql);
  let n = 0;
  db.exec('BEGIN');
  for await (const r of rows as AsyncIterable<Row>) {
    const v = map(r);
    if (!v) continue;
    stmt.run(...v);
    if (++n % 200_000 === 0) {
      db.exec('COMMIT; BEGIN');
      log(`  ${label}: ${n.toLocaleString('sv-SE')} rows`);
    }
  }
  db.exec('COMMIT');
  log(`  ${label}: ${n.toLocaleString('sv-SE')} rows`);
  return n;
}

const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));

/** Build a fresh SQLite database from a GTFS source. Writes to `dbPath` atomically. */
export async function importGtfs(source: GtfsSource, dbPath: string, version: string, log = console.log) {
  const tmp = `${dbPath}.tmp`;
  fs.rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-200000;');
  db.exec(SCHEMA);

  await insertAll(db, await source('routes.txt'),
    'INSERT OR REPLACE INTO routes VALUES (?,?,?,?,?,?)',
    (r) => [r.route_id, r.route_short_name ?? '', r.route_long_name ?? '', Number(r.route_type), r.route_color ?? null, r.route_text_color ?? null],
    log, 'routes');
  await insertAll(db, await source('trips.txt'),
    'INSERT OR REPLACE INTO trips VALUES (?,?,?,?,?,?)',
    (r) => [r.trip_id, r.route_id, r.service_id, r.trip_headsign ?? '', num(r.direction_id) ?? 0, r.shape_id || null],
    log, 'trips');
  await insertAll(db, await source('stops.txt'),
    'INSERT OR REPLACE INTO stops VALUES (?,?,?,?,?,?,?)',
    (r) => [r.stop_id, r.stop_name, Number(r.stop_lat), Number(r.stop_lon), r.parent_station || null, num(r.location_type) ?? 0, r.platform_code || null],
    log, 'stops');
  await insertAll(db, await source('calendar.txt'),
    'INSERT INTO calendar VALUES (?,?,?,?)',
    (r) => [r.service_id, [r.sunday, r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday].map((d) => (d === '1' ? '1' : '0')).join(''), r.start_date, r.end_date],
    log, 'calendar');
  await insertAll(db, await source('calendar_dates.txt'),
    'INSERT INTO calendar_dates VALUES (?,?,?)',
    (r) => [r.service_id, r.date, Number(r.exception_type)],
    log, 'calendar_dates');
  await insertAll(db, await source('shapes.txt'),
    'INSERT INTO shapes VALUES (?,?,?,?)',
    (r) => [r.shape_id, Number(r.shape_pt_sequence), Number(r.shape_pt_lat), Number(r.shape_pt_lon)],
    log, 'shapes');
  await insertAll(db, await source('stop_times.txt'),
    'INSERT INTO stop_times VALUES (?,?,?,?,?)',
    (r) => {
      const arr = parseGtfsTime(r.arrival_time);
      const dep = parseGtfsTime(r.departure_time);
      if (arr < 0 && dep < 0) return null; // untimed stop; skip
      return [r.trip_id, Number(r.stop_sequence), r.stop_id, arr < 0 ? dep : arr, dep < 0 ? arr : dep];
    },
    log, 'stop_times');

  log('  building indexes…');
  db.exec(INDEXES);
  db.prepare('INSERT INTO meta VALUES (?,?)').run('version', version);
  db.prepare('INSERT INTO meta VALUES (?,?)').run('imported', new Date().toISOString());
  db.close();
  fs.rmSync(dbPath, { force: true });
  fs.renameSync(tmp, dbPath);
}

/** GtfsSource reading CSV files from a GTFS zip. */
export function zipSource(zipPath: string): GtfsSource {
  return (file) =>
    new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
        if (err || !zip) return reject(err);
        let found = false;
        zip.on('entry', (entry: yauzl.Entry) => {
          if (entry.fileName.replace(/^.*\//, '') !== file) return zip.readEntry();
          found = true;
          zip.openReadStream(entry, (e2, stream) => {
            if (e2 || !stream) return reject(e2);
            const parser = (stream as Readable).pipe(
              parse({ columns: true, bom: true, relax_column_count: true, skip_empty_lines: true, trim: true }),
            );
            parser.on('end', () => zip.close());
            resolve(parser as AsyncIterable<Row>);
          });
        });
        zip.on('end', () => {
          if (!found) {
            zip.close();
            resolve(null);
          }
        });
        zip.readEntry();
      });
    });
}
