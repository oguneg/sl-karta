// Dev helper: write the demo feed as GTFS CSV files (to test the zip import path).
import fs from 'node:fs';
import path from 'node:path';
import { buildDemoFeed } from './demoFeed.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: exportDemo <dir>');
fs.mkdirSync(out, { recursive: true });
for (const [file, rows] of Object.entries(buildDemoFeed())) {
  const cols = rows.length ? Object.keys(rows[0]) : ['service_id', 'date', 'exception_type'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  fs.writeFileSync(path.join(out, file), '\ufeff' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\r\n'));
}
console.log('wrote', out);
