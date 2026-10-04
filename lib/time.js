// Wall-clock time in an IANA time zone, to and from UTC. No network access or DOM dependencies.

// Epoch of a basic wall time (YYYYMMDDTHHMMSS) read as if it were UTC.
function components(value, enforceRange = false) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!m) throw new Error('Invalid calendar date.');
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const epoch = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(epoch);
  if ((enforceRange && (year < 1970 || year > 2037)) || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second) {
    throw new Error('Invalid or unsupported calendar date (supported years: 1970–2037).');
  }
  return epoch;
}

function utcBasic(epoch) {
  return new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Building a formatter costs far more than using one, and conversion samples each zone 13 times.
const formatters = new Map();
function wallParts(zone, epoch) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const parts = formatters.get(zone).formatToParts(epoch);
  const o = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${o.year}${o.month}${o.day}T${o.hour}${o.minute}${o.second}`;
}

/** 20261005T140000 in America/New_York becomes 20261005T180000Z. Times a daylight-saving change makes ambiguous or nonexistent are rejected, not guessed. */
export function zonedToUtc(wall, zone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { throw new Error(`Invalid time zone: ${zone}`); }
  const local = components(wall, true);
  const candidates = new Set();
  for (let offset = -36; offset <= 36; offset += 6) {
    const sample = local + offset * 3600000;
    const candidate = local - (components(wallParts(zone, sample)) - sample);
    if (wallParts(zone, candidate) === wall) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error(candidates.size ? 'Ambiguous local time at daylight-saving transition.' : 'Nonexistent local time at daylight-saving transition.');
  return utcBasic([...candidates][0]);
}

/** 20261005T140000 at a fixed offset of -240 minutes (UTC-04:00) becomes 20261005T180000Z. */
export function offsetToUtc(wall, offset) {
  if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 60) throw new Error('Invalid UTC offset.');
  return utcBasic(components(wall, true) - offset * 60000);
}

/** 20261005T180000Z as a Date. */
export const basicToDate = (value) => new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`);

/** UTC ISO time as a datetime-local input value (YYYY-MM-DDTHH:MM) in the zone. */
export function inputForZone(iso, zone) {
  const wall = wallParts(zone, Date.parse(iso));
  return `${wall.slice(0, 4)}-${wall.slice(4, 6)}-${wall.slice(6, 8)}T${wall.slice(9, 11)}:${wall.slice(11, 13)}`;
}

/** A datetime-local input value in the zone as a UTC ISO time. */
export function inputToUtc(value, zone) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) throw new Error('Enter a valid date and time.');
  const utc = zonedToUtc(value.replaceAll('-', '').replace(':', '') + '00', zone);
  return `${utc.slice(0, 4)}-${utc.slice(4, 6)}-${utc.slice(6, 8)}T${utc.slice(9, 11)}:${utc.slice(11, 13)}:${utc.slice(13, 15)}.000Z`;
}

// All-day events are calendar dates (YYYY-MM-DD) with no time or zone. Date math on them runs in UTC,
// where every day is 24 hours long.
const dayEpoch = (day) => Date.parse(`${day}T00:00:00Z`);

/** A real date in the supported years, 1970–2037, as YYYY-MM-DD; '' otherwise. */
export function calendarDay(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year < 1970 || year > 2037 || d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return d.toISOString().slice(0, 10);
}

/** 2026-10-31 plus 1 day is 2026-11-01. */
export const addDays = (day, days) => new Date(dayEpoch(day) + days * 86400000).toISOString().slice(0, 10);

/** Whole days from one date to another: 2026-10-30 to 2026-11-01 is 2. */
export const daysBetween = (from, to) => Math.round((dayEpoch(to) - dayEpoch(from)) / 86400000);

/** Today's date in a zone, as YYYY-MM-DD. */
export const todayIn = (zone, now = new Date()) => inputForZone(now.toISOString(), zone).slice(0, 10);

/** "Oct 24, 2026", or "Oct 30 – Nov 1, 2026" for a span of days. */
export function formatDays(first, last = first) {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const [a, b] = [first, last].map((day) => new Date(dayEpoch(day) + 43200000));
  return first === last ? format.format(a) : format.formatRange(a, b);
}

export function formatForZone(iso, zone) {
  const date = new Date(iso);
  return {
    date: new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).format(date)
  };
}
