import { addDays, calendarDay, daysBetween, inputForZone, todayIn } from './time.js';

// An event is timed (start and end instants, shown in a time zone) or all-day (a first and last
// date, inclusive, with no time zone, as Proton's form shows them).
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const DAY = 86400000;

/** The longest event the extension creates, timed or all-day. */
export const MAX_DAYS = 31;

/** Page text as one line: whitespace and control characters collapsed, at most `max` characters. */
export const cleanLine = (value, max = 255) => String(value ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

const isDay = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && calendarDay(...value.split('-').map(Number)) === value;

// Sites often publish an all-day event as midnight to midnight, or to 23:59. Read from the wall
// times the source wrote (YYYY-MM-DDTHH:MM), these give the days covered, or null.
function midnightDays(wall, endWall) {
  if (!/T00:00$/.test(wall || '') || !endWall) return null;
  const [first, last] = [wall.slice(0, 10), endWall.slice(0, 10)];
  if (/T23:59$/.test(endWall) && last >= first) return [first, last];
  if (/T00:00$/.test(endWall) && last > first) return [first, addDays(last, -1)];
  return null;
}

/**
 * Shapes a detected event for review. Timed events take start and end Dates, the zone, and `wall`
 * and `endWall` (YYYY-MM-DDTHH:MM as the source wrote them, used to spot conversions, duplicates,
 * and midnight-to-midnight days). All-day events take allDay, startDate and endDate (YYYY-MM-DD,
 * inclusive); `zone` is where "today" is judged for them. Events up to 7 days past come back with
 * reason "past" so the popup can explain them; events over MAX_DAYS as { reason: 'too-long' }.
 */
export function candidate(found, { now = new Date(), zone: localZone = found.zone } = {}) {
  const title = cleanLine(found.title, 200) || 'Untitled event';
  const shared = {
    title, yearAssumed: !!found.yearAssumed, dateOrderAssumed: !!found.dateOrderAssumed, weekdayMismatch: !!found.weekdayMismatch,
    location: cleanLine(found.location),
    description: String(found.description || '').replace(/\u0000/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000),
    source: found.source, score: found.score || 0, index: found.index || 0
  };
  const days = found.allDay ? [found.startDate, found.endDate || found.startDate] : midnightDays(found.wall, found.endWall);
  if (days) {
    const [first, last] = days;
    if (!isDay(first) || !isDay(last) || last < first || !localZone) return null;
    if (daysBetween(first, last) >= MAX_DAYS) return { reason: 'too-long', title, allDay: true, startDate: first };
    const today = todayIn(localZone, now);
    if (daysBetween(today, first) > 366 || daysBetween(last, today) > 7) return null;
    return { ...shared, allDay: true, startDate: first, endDate: last, midnight: !found.allDay, inPast: first < today, ...(first < today && { reason: 'past' }) };
  }
  const { start, zone, wall } = found;
  if (!(start instanceof Date) || !Number.isFinite(start.getTime()) || !zone) return null;
  const durationAssumed = !(found.end instanceof Date) || !(found.end > start);
  const end = durationAssumed ? new Date(start.getTime() + 3600000) : found.end;
  if (end - start > MAX_DAYS * DAY) return { reason: 'too-long', title, start: start.toISOString(), zone };
  if (start - now > 366 * DAY || now - start > 7 * DAY) return null;
  return {
    ...shared, start: start.toISOString(), end: end.toISOString(), zone,
    zoneAssumed: !!found.zoneAssumed, durationAssumed, inPast: start < now,
    converted: !!wall && inputForZone(start.toISOString(), zone) !== wall, wall,
    ...(start < now && { reason: 'past' })
  };
}

/**
 * Checks a reviewed event before it is copied and returns only the fields that get copied:
 * { title, start, end, zone, location, description } for a timed event, or
 * { title, allDay: true, startDate, endDate, location, description } for an all-day one, whose
 * dates must not be before today in this browser.
 */
export function validateEvent(event, now = new Date()) {
  if (!event || typeof event.title !== 'string' || !event.title.trim() || event.title.length > 255 || /[\r\n\u0000]/.test(event.title)) throw new Error('Enter a single-line title of at most 255 characters.');
  const when = event.allDay === true ? allDayDates(event, now) : timedDates(event, now);
  if (typeof event.description !== 'string' || event.description.length > 3000 || /\u0000/.test(event.description)) throw new Error('Notes must be at most 3000 characters with no null characters.');
  if (typeof event.location !== 'string' || event.location.length > 255 || /[\r\n\u0000]/.test(event.location)) throw new Error('Enter a single-line location of at most 255 characters.');
  return { title: event.title.trim(), ...when, location: event.location, description: event.description };
}

function timedDates(event, now) {
  if (typeof event.zone !== 'string') throw new Error('Choose a valid time zone.');
  try { new Intl.DateTimeFormat('en-US', { timeZone: event.zone }); } catch { throw new Error('Choose a valid time zone.'); }
  if (typeof event.start !== 'string' || typeof event.end !== 'string' || !ISO_UTC.test(event.start) || !ISO_UTC.test(event.end)) throw new Error('Enter valid event dates.');
  const start = new Date(event.start), end = new Date(event.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.toISOString() !== event.start || end.toISOString() !== event.end || start.getUTCFullYear() < 1970 || end.getUTCFullYear() < 1970 || start.getUTCFullYear() > 2037 || end.getUTCFullYear() > 2037) throw new Error('Enter valid event dates within the supported range (1970–2037).');
  if (start < now) throw new Error('The event start is in the past.');
  if (end <= start || end - start > MAX_DAYS * DAY) throw new Error(`Event end must follow start within ${MAX_DAYS} days.`);
  return { start: event.start, end: event.end, zone: event.zone };
}

function allDayDates(event, now) {
  const { startDate, endDate } = event;
  if (!isDay(startDate) || !isDay(endDate)) throw new Error('Enter valid event dates within the supported range (1970–2037).');
  const today = calendarDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
  if (startDate < today) throw new Error('The event start is in the past.');
  if (endDate < startDate || daysBetween(startDate, endDate) >= MAX_DAYS) throw new Error(`The last day must be on or after the first day, within ${MAX_DAYS} days.`);
  return { allDay: true, startDate, endDate };
}
