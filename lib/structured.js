import { candidate, cleanLine } from './event.js';
import { addDays, basicToDate, offsetToUtc, zonedToUtc } from './time.js';

// Machine-readable events: schema.org Event data (JSON-LD or microdata, published by most ticketing
// and event sites for search engines) and "Add to Google/Outlook/Yahoo Calendar" links. Both carry
// exact times, so they are preferred over reading the page's prose.

const ENTITIES = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' ']]);
const validZone = (zone) => { try { return !!zone && !!new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { return false; } };

/** Text from HTML-ish strings that sites put in event data: tags dropped, entities decoded. */
function plain(value, multiline = false) {
  const text = String(value ?? '')
    .replace(/<(?:br|\/p|\/div|\/li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, name) => {
      if (name[0] !== '#') return ENTITIES.get(name.toLowerCase()) ?? all;
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    });
  return multiline ? text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim() : cleanLine(text, 1000);
}

/**
 * A date or date-time as event data writes it: 2026-10-24T19:00:00-04:00, 2026-10-24T23:00Z,
 * 20261024T230000Z, a floating 2026-10-24T19:00 (read in `zone`), or a date alone, 2026-10-24.
 * `day` is the date as written; `date`, the instant, is missing for a date alone.
 */
function when(value, zone) {
  const m = /^(\d{4})-?(\d\d)-?(\d\d)(?:[T ](\d\d):?(\d\d)(?::?(\d\d))?(?:\.\d+)?\s*(Z|[+-]\d\d(?::?\d\d)?)?)?$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', off] = m;
  const day = `${y}-${mo}-${d}`;
  if (h === undefined) return { day };
  const wall = `${y}${mo}${d}T${h}${mi}${s}`;
  try {
    if (!off) return { day, date: basicToDate(zonedToUtc(wall, zone)), wall: `${day}T${h}:${mi}`, floating: true };
    const [, sign, hours, minutes = '00'] = /^([+-])(\d\d):?(\d\d)?$/.exec(off) || [, '+', '00'];
    const offset = (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
    // A UTC time says nothing about what the page shows; any other offset is the venue's wall time.
    return { day, date: basicToDate(offsetToUtc(wall, offset)), wall: offset ? `${day}T${h}:${mi}` : undefined };
  } catch { return null; }
}

// The candidate for a start and end read by when(). A start without a time is an all-day event;
// `lastDay` turns its end into the last day (calendar links end the day after, as iCalendar does).
function shape(start, end, details, { now, zone, zoneKnown = false, lastDay = (day) => day }) {
  if (!start) return null;
  if (!start.date) return candidate({ ...details, allDay: true, startDate: start.day, endDate: end?.day > start.day ? lastDay(end.day) : start.day }, { now, zone });
  return candidate({ ...details, start: start.date, end: end?.date, zone, zoneAssumed: !!start.floating && !zoneKnown, wall: start.wall, endWall: end?.wall }, { now, zone });
}

function place(location) {
  for (const item of [].concat(location || [])) {
    if (typeof item === 'string') return plain(item);
    if (!item || typeof item !== 'object') continue;
    if (/VirtualLocation/i.test(String(item['@type'])) && /^https:\/\//i.test(String(item.url))) return String(item.url);
    const a = item.address;
    const address = typeof a === 'string' ? plain(a) : [a?.streetAddress, a?.addressLocality, a?.addressRegion, a?.postalCode].map((part) => plain(part)).filter(Boolean).join(', ');
    const name = plain(item.name);
    const text = name && address && !address.startsWith(name) ? `${name}, ${address}` : name || address;
    if (text) return text;
  }
  return '';
}

const first = (value) => (Array.isArray(value) ? value[0] : value);
const isEvent = (node) => [].concat(node['@type'] || []).some((type) => /(?:^|[/:#])(?:\w*Event|Festival|CourseInstance)$/.test(String(type)));

function collect(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8 || out.length >= 200) return;
  if (Array.isArray(node)) { for (const item of node.slice(0, 500)) collect(item, out, depth + 1); return; }
  if (isEvent(node) && node.startDate) out.push(node);
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item', 'subEvent', 'event', 'events']) collect(node[key], out, depth + 1);
}

function parse(json) {
  if (typeof json !== 'string') return json;
  for (const text of [json, json.replace(/<!--|-->|<!\[CDATA\[|\]\]>/g, '').replace(/,\s*([}\]])/g, '$1')]) {
    try { return JSON.parse(text); } catch { /* Try the cleaned-up copy, then give up on this block. */ }
  }
  return null;
}

// schema.org dates are inclusive: an endDate of 2026-10-26 includes that day.
function fromSchema(node, { now, defaultZone }) {
  const start = when(first(node.startDate), defaultZone);
  const end = node.endDate ? when(first(node.endDate), defaultZone) : null;
  const url = [node.url, node['@id']].map(first).find((value) => /^https?:\/\//i.test(String(value || '')));
  const item = shape(start, end, { title: plain(node.name), location: place(node.location), description: url ? String(url) : '', source: 'structured' }, { now, zone: defaultZone });
  if (item && /cancel/i.test(String(node.eventStatus || ''))) {
    return { reason: 'cancelled', title: item.title, ...(item.allDay ? { allDay: true, startDate: item.startDate } : { start: item.start, zone: item.zone }) };
  }
  return item;
}

/** Events from JSON-LD blocks (strings) and microdata (objects), in page order, with rejections (reason). */
export function structuredEvents(blocks = [], { now = new Date(), defaultZone } = {}) {
  const nodes = [];
  for (const block of blocks.slice(0, 60)) collect(parse(block), nodes);
  const seen = new Set();
  return nodes.map((node) => fromSchema(node, { now, defaultZone })).filter((item) => {
    const key = item && `${item.title}|${item.start || item.startDate}`;
    return item && !seen.has(key) && seen.add(key);
  });
}

// Email and chat services wrap links in redirects (google.com/url?q=, Outlook safelinks); look inside.
function calendarUrl(href, depth = 0) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (kind(url)) return url;
  if (depth < 2) for (const value of url.searchParams.values()) if (/^https?:\/\//i.test(value)) { const inner = calendarUrl(value, depth + 1); if (inner) return inner; }
  return null;
}

function kind(url) {
  const host = url.hostname.toLowerCase(), p = url.searchParams;
  if (/^(?:calendar|www)\.google\.com$/.test(host) && /^\/calendar\/(?:u\/\d+\/)?(?:render|event|r\/eventedit)/.test(url.pathname) && p.get('dates') && (p.get('action') === 'TEMPLATE' || /eventedit/.test(url.pathname))) return 'google';
  if (/^outlook\.(?:live|office|office365)\.com$/.test(host) && /\/calendar\//.test(url.pathname) && p.get('startdt')) return 'outlook';
  if (host === 'calendar.yahoo.com' && p.get('st')) return 'yahoo';
  return null;
}

function fromCalendarUrl(url, { now, defaultZone }) {
  const p = url.searchParams, type = kind(url);
  const ctz = validZone(p.get('ctz')) ? p.get('ctz') : null;
  const zone = ctz || defaultZone;
  let start, end, title, location, details;
  if (type === 'google') {
    const [a, b] = (p.get('dates') || '').split('/');
    [start, end, title, location, details] = [when(a, zone), when(b, zone), p.get('text'), p.get('location'), p.get('details')];
  } else if (type === 'outlook') {
    [start, end, title, location, details] = [when(p.get('startdt'), zone), when(p.get('enddt'), zone), p.get('subject'), p.get('location'), p.get('body')];
  } else {
    start = when(p.get('st'), zone);
    end = when(p.get('et'), zone);
    const duration = /^(\d\d)(\d\d)$/.exec(p.get('dur') || '');
    if (!end && start?.date && duration) end = { date: new Date(start.date.getTime() + (Number(duration[1]) * 60 + Number(duration[2])) * 60000) };
    [title, location, details] = [p.get('title'), p.get('in_loc'), p.get('desc')];
  }
  // Outlook and Yahoo can mark a dated time as all day; only the dates count then.
  const allDay = (type === 'outlook' && p.get('allday') === 'true') || (type === 'yahoo' && p.get('dur') === 'allday');
  if (allDay && start) [start, end] = [{ day: start.day }, end && { day: end.day }];
  return shape(start, end, { title: plain(title), location: plain(location), description: plain(details, true), source: 'link' }, { now, zone, zoneKnown: !!ctz, lastDay: (day) => addDays(day, -1) });
}

/** Events from "add to calendar" links among page links (hrefs), deduplicated, with rejections (reason). */
export function linkEvents(links = [], { now = new Date(), defaultZone } = {}) {
  const seen = new Set(), out = [];
  for (const href of links) {
    const url = calendarUrl(href);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    const item = fromCalendarUrl(url, { now, defaultZone });
    if (item) out.push(item);
  }
  return out;
}

