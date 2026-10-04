import { findTextEvents } from './capture.js';
import { linkEvents, structuredEvents } from './structured.js';

// Turns what lib/page-text.js read from a page into events to offer, best first.
// Page areas are tried most specific first (a selection, an open dialog, an email body, ...),
// and the first area with an upcoming event wins, so a cookie banner or a chat widget with only
// old timestamps falls through to the page behind it. Event data the page publishes (schema.org,
// calendar links) adds exact times and details. When the reader picked an area by selecting text
// or opening a dialog, only events seen there are offered.
const FOCUSED = new Set(['selection', 'dialog']);
const RELIABILITY = { link: 3, structured: 2, text: 1 };
const MAIL_TITLE = /^(?:inbox|mail|gmail|outlook|proton mail)\b/i;

// An all-day event and a timed one are never the same sighting.
const sameEvent = (a, b) => (a.allDay || b.allDay
  ? !!a.allDay && !!b.allDay && a.startDate === b.startDate
  : Math.abs(Date.parse(a.start) - Date.parse(b.start)) < 60000 || (!!a.wall && a.wall === b.wall && (a.zoneAssumed || b.zoneAssumed)));

// Several sightings of one event become one: timing from the copy that knows its zone (for
// all-day events, the most reliable copy), the title and details from the most reliable source
// that has them.
function merge(items) {
  const out = [];
  for (const item of items) {
    const twin = out.find((other) => sameEvent(other, item));
    if (!twin) { out.push({ ...item }); continue; }
    const copies = [twin, item];
    const ranked = [...copies].sort((a, b) => RELIABILITY[b.source] - RELIABILITY[a.source]);
    const timing = (!twin.allDay && copies.find((copy) => !copy.zoneAssumed)) || ranked[0];
    const pick = (field, empty = '') => ranked.map((copy) => copy[field]).find((value) => value && value !== empty) || ranked[0][field];
    const endSource = timing.durationAssumed ? copies.find((copy) => !copy.durationAssumed && copy.start === timing.start) : null;
    Object.assign(twin, {
      ...timing, ...(endSource && { end: endSource.end, durationAssumed: false }),
      title: pick('title', 'Untitled event'), location: pick('location'), description: pick('description'),
      source: ranked[0].source, index: twin.index
    });
  }
  return out;
}

function pageTitle(title) {
  const text = String(title || '').split(/\s+[|·•–—-]\s+/)[0].trim();
  return text.length >= 3 && !MAIL_TITLE.test(text) ? text : '';
}

/**
 * { events, rejected, selectionMissed } for a page read by readEventPage. `rejected` lists
 * events that cannot be offered, each with a reason: past, too-long, or cancelled.
 */
export function findEvents(page, { now = new Date() } = {}) {
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  const options = { now, defaultZone: page?.zone || resolved.timeZone, locale: page?.lang || resolved.locale };
  const hint = pageTitle(page?.title);
  const structured = structuredEvents([...(page?.structured || []), ...(page?.microdata || [])], options);
  const rejected = [];
  let chosen = null, selectionMissed = false;
  for (const scope of page?.scopes || []) {
    const items = [...linkEvents(scope.links, options), ...findTextEvents(scope.text, { ...options, hint: scope.heading || hint, links: scope.links })];
    rejected.push(...items.filter((item) => item.reason));
    const events = items.filter((item) => !item.reason);
    if (events.length) { chosen = { focused: FOCUSED.has(scope.kind), events }; break; }
    if (scope.kind === 'selection') selectionMissed = true;
  }
  const upcoming = structured.filter((item) => !item.reason);
  const found = chosen?.focused
    ? [...chosen.events, ...upcoming.filter((item) => chosen.events.some((event) => sameEvent(event, item)))]
    : [...(chosen?.events || []), ...upcoming];
  const events = merge(found).sort((a, b) => RELIABILITY[b.source] - RELIABILITY[a.source]);
  return { events: events.slice(0, 12), rejected: [...rejected, ...structured.filter((item) => item.reason)], selectionMissed: selectionMissed && events.length > 0 };
}
