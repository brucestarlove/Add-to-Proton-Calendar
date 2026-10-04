import { inputForZone } from './time.js';

const pad = (n) => String(n).padStart(2, '0');

// Wall time in the event's zone plus its UTC offset, e.g. 2026-10-05T14:00-04:00.
function stamp(iso, zone) {
  const wall = inputForZone(iso, zone);
  const offset = Date.parse(`${wall}:00Z`) / 60000 - Math.floor(Date.parse(iso) / 60000);
  const abs = Math.abs(offset);
  return `${wall}${offset < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Plain-text event block; calendar-paste.js fills Proton's form when it is pasted into the title
 * field. An all-day event has dates without times, and End is its last day: Start: 2026-10-24.
 */
export function clipboardText(event) {
  const [start, end] = event.allDay ? [event.startDate, event.endDate] : [stamp(event.start, event.zone), stamp(event.end, event.zone)];
  return [
    `Title: ${event.title}`,
    `Start: ${start}`,
    `End: ${end}`,
    event.location && `Location: ${event.location}`,
    event.description && `Notes: ${event.description}`
  ].filter(Boolean).join('\n');
}
