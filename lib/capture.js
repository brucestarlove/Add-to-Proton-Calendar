import { candidate } from './event.js';
import { basicToDate, calendarDay, offsetToUtc, todayIn, zonedToUtc } from './time.js';
import { zoneIn } from './zones.js';

// Dates and times are found separately and then paired by what sits between them, so
// "Saturday, October 24 · 7 - 9pm EDT", "When: 10/24/2026 7:00 PM" and a date on one line with
// its time on the next all read the same way. A date with no time is an all-day event only when
// the page says so: a span of days ("Oct 30 – Nov 1") or the words "all day". A date alone is far
// more often a byline or a timestamp. English only; every result goes through review.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\.?`;
const WEEKDAY = String.raw`(?:(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?![a-z])\.?(?:\s*[,•·⋅|]\s*|\s+))?`;
const YEAR = String.raw`(?:,?\s+(\d{4})(?![\d:]))?`;
const THROUGH = String.raw`\s*(?:-|~|to|through|thru)\s*`;
const JOIN = new RegExp(String.raw`^${THROUGH}$`, 'i');
// The second day of "Nov 5-7" must not be the hour of "Nov 5 - 7pm" or "Nov 5 - 6:30".
const NOT_HOUR = String.raw`(?![a-z\d]|[:h.]\d|\s*(?:[ap]\.?\s?m\.?(?![a-z])|o'?clock))`;
const DATES = [
  // Spans of days within one month: Nov 5-7, 2026 and 5-7 November. Spans across months are two dates.
  [new RegExp(String.raw`\b${WEEKDAY}${MONTH}\s*(\d{1,2})(?:st|nd|rd|th)?${THROUGH}(\d{1,2})(?:st|nd|rd|th)?${NOT_HOUR}${YEAR}`, 'gi'), (m) => ({ weekday: m[1], month: m[2], day: m[3], last: { day: m[4] }, year: m[5] })],
  [new RegExp(String.raw`\b${WEEKDAY}(?<![:.])(\d{1,2})(?:st|nd|rd|th)?${THROUGH}(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH}${YEAR}`, 'gi'), (m) => ({ weekday: m[1], day: m[2], last: { day: m[3] }, month: m[4], year: m[5] })],
  // Oct 5, Monday, October 5th 2026, SAT, OCT 24, Sept. 30 (a day directly followed by ":30" is an hour)
  [new RegExp(String.raw`\b${WEEKDAY}${MONTH}\s*(\d{1,2})(?:st|nd|rd|th)?(?![a-z\d]|[:h.]\d)${YEAR}`, 'gi'), (m) => ({ weekday: m[1], month: m[2], day: m[3], year: m[4] })],
  // 5 October, Thursday 29 October 2026, 29th of Oct
  [new RegExp(String.raw`\b${WEEKDAY}(?<![:.])(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+${MONTH}${YEAR}`, 'gi'), (m) => ({ weekday: m[1], day: m[2], month: m[3], year: m[4] })],
  [/\b(\d{4})-(\d\d)-(\d\d)(?!\d)/g, (m) => ({ year: m[1], month: Number(m[2]), day: m[3], iso: true })],
  [/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g, (m) => ({ slashed: [Number(m[1]), Number(m[2])], year: m[3].length === 2 ? `20${m[3]}` : m[3] })],
  [/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/]|\.\d)/g, (m) => ({ slashed: [Number(m[1]), Number(m[2])], loose: true })],
  [/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.])/g, (m) => ({ day: m[1], month: Number(m[2]), year: m[3] })],
  [/\b(today|tonight|tomorrow)\b/gi, (m) => ({ relative: m[1].toLowerCase() })]
];
const CLOCK = String.raw`(?:12\s*noon|noon|midday|midnight|\d{1,2}(?:[:h.]\d\d){0,2}(?:\s*[ap]\.?\s?m\.?(?![a-z]))?)`;
const TIMES = new RegExp(String.raw`(?<![\d:/.$€£¥#+-])(${CLOCK})(?:\s*(?:-|~|to|until|till|thru|through)\s*(${CLOCK}))?(?![\d:/%]|\.\d)`, 'gi');
// What may sit between a date and the time that follows it, or a time and the date after it.
const AFTER = /^(?:[\s,.·⋅•|@()/:-]|\b(?:at|from|starting|starts?|begins?|beginning|time|times)\b)*$/i;
const BEFORE = /^(?:[\s,·⋅•|@()-]|\bon\b)*$/i;
const HAS_DATE = new RegExp(String.raw`\b${MONTH}\s*\d{1,2}(?!\d)|\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}|\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b\d{4}-\d\d-\d\d\b`, 'i');
const HAS_TIME = /\b\d{1,2}(?:[:.]\d\d)?\s*[ap]\.?m\b|\b\d{1,2}:\d\d\b/i;
const LABEL = /^(?:all[\s-]?day(?:\s+event)?|date|time|when|where|date\s*(?:&|and|\/)\s*time|starts?|ends?|start\s*time|event\s*(?:details|date|time|info)|details|schedule|location|venue|add\s+to\s+(?:google\s+)?calendar|upcoming(?:\s+events?)?|today|tonight|tomorrow|calendar|agenda|rsvp|share|going|interested|register|tickets?|free|online(?:\s+event)?|in\s+person|hosted\s+by|about(?:\s+this\s+event)?)\s*:?$/i;
const MONTH_YEAR = new RegExp(String.raw`^${MONTH}\s+\d{4}$|^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$`, 'i');
const LEAD = /^(?:(?:updated\s+|new\s+)?invitation|reminder|event(?:\s+name)?|meeting|webinar|topic|subject|title|date\s*(?:&|and|\/)?\s*time|date|time|when|starts?)\s*:\s*/i;
const QUOTED = /(?:reminder that|register(?:ed|ing)? for|registration for|invited (?:you )?to|invitation to|rsvp(?:'d|ed)? to|join(?:ing)? us for|event(?:\s+is)?|webinar|meeting|session)\s*:?\s+["“]([^"”\n]{3,180})["”]/gi;
const PLACE = /^(?:where|location|venue|place|address)\s*(?::\s*(.+)|$)/i;
const ONLINE = /\b(?:zoom|teams|meet|webex|online|virtual|video|link)\b/i;
// "All day" right after a date ("Sat, Oct 24 · All day") or right before it ("All-day event: Oct 24").
const ALL_DAY_AFTER = /^[\s,.·⋅•|@(-]{0,6}all[\s-]?day\b/i;
const ALL_DAY_BEFORE = /\ball[\s-]?day(?:\s+event)?[\s,.·⋅•|:@)-]{0,6}$/i;
// Between a date-time and the one it runs until: "Fri, Oct 30, 7 PM to Sun, Nov 1, 5 PM". A zone may
// close the first: "7 PM EDT – ...". Or the end sits on its own "Ends:" line.
const SPAN = /^([^\n]{0,40}?)\s*(?:-|~|to|until|till|through|thru)\s*$/i;
const ENDS = /^\s*(?:ends?|end\s*(?:date|time)|until|finish(?:es)?)\b\s*:?\s*$/i;
const pad = (n) => String(n).padStart(2, '0');
const EVENTS = 150; // Far more than anyone picks from; keeps huge pages fast.
const newlines = (text) => (text.match(/\n/g) || []).length;

/** A meeting link worth putting in the location field, or ''. Product pages such as zoom.us/download are not meetings. */
export function meetingLink(href) {
  let url;
  try { url = new URL(href); } catch { return ''; }
  const host = url.hostname.toLowerCase(), path = url.pathname;
  if (url.protocol !== 'https:' || path.length < 2) return '';
  const ok = /(?:^|\.)(?:zoom\.us|zoomgov\.com)$/.test(host) ? /^\/(?:j|w|s|my|wc|webinar|meeting)\b/.test(path)
    : /^teams\.(?:microsoft|live)\.com$/.test(host) ? /\/(?:l\/meetup-join|meet)\b/.test(path)
    : host === 'discord.com' ? /^\/(?:events|invite)\//.test(path)
    : /(?:^|\.)webex\.com$/.test(host) ? host !== 'www.webex.com'
    : /^(?:meet\.google\.com|meet\.proton\.me|whereby\.com|meet\.jit\.si|meet\.goto\.com|global\.gotomeeting\.com|app\.gather\.town|discord\.gg|chime\.aws|bluejeans\.com|streamyard\.com|riverside\.fm)$/.test(host);
  return ok ? href : '';
}

function normalize(text) {
  return text.slice(0, 40000)
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[\u00a0\u2007\u2009\u200a\u202f]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\r\n?/g, '\n');
}

function dateMentions(text, monthFirst) {
  const found = [];
  for (const [pattern, read] of DATES) {
    for (const m of text.matchAll(pattern)) {
      const d = read(m);
      if (d.slashed) {
        // 10/24/2026 and 24/10/2026 are clear; 10/05/2026 follows the page or browser language.
        const [a, b] = d.slashed;
        const dayFirst = a > 12 || (b <= 12 && !monthFirst);
        Object.assign(d, dayFirst ? { day: a, month: b } : { day: b, month: a }, { dateOrderAssumed: a !== b && a <= 12 && b <= 12 });
      }
      if (typeof d.month === 'string') d.month = MONTHS.indexOf(d.month.slice(0, 3).toLowerCase()) + 1;
      const year = d.year && Number(d.year);
      found.push({
        ...d, day: Number(d.day), year, weekday: d.weekday ? WEEKDAYS.indexOf(d.weekday.slice(0, 3).toLowerCase()) : null,
        last: d.last && { year, month: d.month, day: Number(d.last.day), weekday: null }, index: m.index, end: m.index + m[0].length
      });
    }
  }
  // Overlapping readings keep the one that reaches furthest: in "Room 3 Oct 24", Oct 24.
  found.sort((a, b) => a.index - b.index || b.end - a.end);
  const out = [];
  for (const d of found) {
    const last = out.at(-1);
    if (last && d.index < last.end) { if (d.end > last.end) out[out.length - 1] = d; continue; }
    // "Oct 30 – Nov 1, 2026" and "Fri 30 Oct to Sun 1 Nov": two dates joined by a dash or "to" are
    // one span of days. Bare numbers such as 3/4 are too often not dates to join.
    const spans = (x) => !x.relative && !x.loose && !x.last;
    if (last && spans(last) && spans(d) && d.index - last.end <= 12 && JOIN.test(text.slice(last.end, d.index))) {
      Object.assign(last, { last: { year: d.year, month: d.month, day: d.day, weekday: d.weekday }, end: d.end, dateOrderAssumed: last.dateOrderAssumed || d.dateOrderAssumed });
      continue;
    }
    out.push(d);
  }
  return out;
}

function clock(raw) {
  const s = raw.toLowerCase().replace(/\s+/g, '');
  if (/noon|midday/.test(s)) return { fixed: 720 };
  if (s === 'midnight') return { fixed: 0 };
  const [, h, sep, mm = '00', period] = /^(\d{1,2})(?:([:h.])(\d\d))?(?:[:h.]\d\d)?([ap])?/.exec(s);
  const hour = Number(h), minute = Number(mm);
  if (minute > 59 || (period && (hour < 1 || hour > 12)) || hour > 23 || (sep === '.' && !period && hour > 12)) return null;
  // "6.30" without am/pm is not a time on its own (it could be a price) but can borrow one in "6.30-8pm".
  return { hour, minute, period, clock24: !period && (sep === ':' || sep === 'h') };
}

const minutesAt = (c, period) => c.fixed ?? (period ? (c.hour % 12 + (period === 'p' ? 12 : 0)) * 60 + c.minute : c.clock24 ? c.hour * 60 + c.minute : null);
const other = (period) => (period === 'p' ? 'a' : 'p');

// Minutes after midnight for a time or range, borrowing am/pm across a range ("7 - 9pm",
// "11am - 1"). A bare hour needs that help, or "tonight". Null if the text is not a time.
function resolveTimes(startRaw, endRaw, tonight) {
  const a = clock(startRaw), b = endRaw ? clock(endRaw) : null;
  if (!a || (endRaw && !b)) return null;
  const evening = (c) => (tonight && c.fixed === undefined && !c.period && c.hour < 12 ? 'p' : c.period);
  if (!b) {
    const start = minutesAt(a, evening(a));
    return start === null ? null : { start, end: null };
  }
  const pa = evening(a), pb = evening(b);
  let start = minutesAt(a, pa), end = minutesAt(b, pb);
  if (!pa && pb && a.fixed === undefined && !(a.clock24 && a.hour > 12)) {
    start = minutesAt(a, pb);
    if (start >= end) start = minutesAt(a, other(pb));
  } else if (pa && !pb && b.fixed === undefined && !(b.clock24 && b.hour > 12)) {
    end = minutesAt(b, pa);
    if (end <= start) end = minutesAt(b, other(pa));
  }
  if (start === null || end === null) return null;
  return { start, end: end === start ? null : end };
}

function timeMentions(text, dates) {
  const out = [];
  const pattern = new RegExp(TIMES.source, TIMES.flags);
  let next = 0; // Dates are in order and do not overlap, and so are the matches: walk them together.
  for (let m; (m = pattern.exec(text));) {
    const index = m.index, end = m.index + m[0].length;
    while (next < dates.length && dates[next].end <= index) next++;
    // The day of "Nov 5 - 6:30 PM" reads as a range "5 - 6:30 PM"; look again after the date.
    const date = dates[next]?.index < end ? dates[next] : null;
    if (date) { pattern.lastIndex = Math.max(date.end, index + 1); continue; }
    out.push({ index, end, start: m[1], finish: m[2] });
  }
  return out;
}

// Year, month and day today in a zone or at a fixed offset.
function today(now, where) {
  if (where?.offset !== undefined) {
    const d = new Date(now.getTime() + where.offset * 60000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  const [year, month, day] = todayIn(where.zone, now).split('-').map(Number);
  return { year, month, day };
}

const realDate = (year, month, day) => {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
};
const weekdayOf = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

// "October 2026" headings, as calendar grids show above their dates.
const headings = (text) => [...text.matchAll(new RegExp(String.raw`\b${MONTH}\s+(\d{4})\b`, 'gi'))]
  .map((m) => ({ index: m.index, month: MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, year: Number(m[2]) }));

// Without a written year: a "Month YYYY" heading above it (a calendar grid), else the year whose
// weekday matches what the page says, else the year that puts the date nearest to today.
function inferYear(heads, d, local) {
  const heading = heads.filter((h) => h.month === d.month && h.index < d.index && d.index - h.index <= 3000).at(-1);
  if (heading) return { year: heading.year, assumed: false };
  const years = [local.year - 1, local.year, local.year + 1].filter((year) => realDate(year, d.month, d.day));
  if (d.weekday !== null) {
    const matching = years.filter((year) => weekdayOf(year, d.month, d.day) === d.weekday);
    if (matching.length === 1) return { year: matching[0], assumed: false };
  }
  const todayDays = Date.UTC(local.year, local.month - 1, local.day);
  const nearest = years.sort((a, b) => Math.abs(Date.UTC(a, d.month - 1, d.day) - todayDays) - Math.abs(Date.UTC(b, d.month - 1, d.day) - todayDays))[0];
  return { year: nearest ?? local.year, assumed: true };
}

function wallTime(year, month, day, minutes, dayOffset = 0) {
  if (!realDate(year, month, day)) throw new Error('Invalid event date.');
  const d = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`;
}

function titleFor(text, index, hint) {
  const prefix = text.slice(Math.max(0, index - 600), index);
  const quoted = [...prefix.matchAll(QUOTED)].at(-1);
  if (quoted) return quoted[1].trim();
  const lines = prefix.split('\n');
  // Text on the event's own line counts when a separator sets it apart: "Design review @ Mon Oct 26".
  const same = lines.pop().replace(LEAD, '');
  const cleaned = same.replace(/[\s@:,|·⋅•(-]+$/, '').trim();
  if (/[@:|·⋅•,-]\s*$/.test(same) && cleaned.length >= 3 && cleaned.length <= 150 && !LABEL.test(cleaned)) return cleaned;
  let checked = 0;
  for (const raw of lines.reverse()) {
    const line = raw.trim().replace(LEAD, '');
    if (!line) continue;
    if (++checked > 5) break;
    if (line.length < 3 || line.length > 150 || LABEL.test(line) || MONTH_YEAR.test(line) || HAS_DATE.test(line) || HAS_TIME.test(line)) continue;
    if (/[:,]$/.test(line) || /^(?:hi|hello|hey|dear)\b/i.test(line) || (line.length > 90 && /[.!?]$/.test(line))) continue;
    return line;
  }
  return hint || '';
}

function locationFor(text, index, from, to, links) {
  let place = '';
  const after = text.slice(from, to).split('\n'), before = text.slice(Math.max(0, index - 300), index).split('\n').slice(-4);
  for (const lines of [after, before]) {
    for (let i = 0; i < lines.length && !place; i++) {
      const m = PLACE.exec(lines[i].trim());
      if (!m) continue;
      const value = (m[1] || lines.slice(i + 1).find((line) => line.trim()) || '').trim();
      if (value && !LABEL.test(value) && !HAS_TIME.test(value)) place = value;
    }
    if (place) break;
  }
  const inText = [...text.slice(from, to).matchAll(/https:\/\/[^\s<>"')\]]+/g)].map((m) => meetingLink(m[0])).find(Boolean);
  // A link only elsewhere in the page area counts when it is the only meeting link there.
  const nearby = [...new Set((links || []).map(meetingLink).filter(Boolean))];
  const link = inText || (nearby.length === 1 ? nearby[0] : '');
  if (place && !(link && ONLINE.test(place))) return place;
  return link || place;
}

const attempt = (read) => { try { return read(); } catch { return null; } };
const dashed = (basic) => `${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}T${basic.slice(9, 11)}:${basic.slice(11, 13)}`;

// Each date with the time beside it, as { d, resolved, index, from, where }: `from` is where the
// pair's text ends and `where` the zone written after it. Spans of days take no time.
function pairTimes(source, dates, times) {
  const stops = [...dates.map((d) => d.index), ...times.filter((t) => resolveTimes(t.start, t.finish, false)).map((t) => t.index)].sort((a, b) => a - b);
  const used = new Set(), moments = [];
  // A gap that crosses lines costs more than one on the same line, so in a list of
  // "10:00am, Thursday, October 29" rows each date keeps the time on its own row.
  const cost = (gap) => newlines(gap) * 10 + gap.replace(/\s/g, '').length;
  for (const d of dates) {
    if (moments.length >= EVENTS) break;
    if (d.last) continue;
    const tonight = d.relative === 'tonight';
    // Only the times on either side of a date can pair with it: anything further has the
    // nearer time's digits in between, which no connector allows.
    let lo = 0, hi = times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid].index < d.end) lo = mid + 1; else hi = mid; }
    const [prior, following] = [times[lo - 1], times[lo]];
    let before = null, after = null;
    if (prior && !used.has(prior) && prior.end <= d.index && d.index - prior.end <= 20) {
      const gap = source.slice(prior.end, d.index);
      const resolved = newlines(gap) <= 1 && BEFORE.test(gap) && resolveTimes(prior.start, prior.finish, tonight);
      if (resolved) before = { time: prior, resolved, cost: cost(gap) };
    }
    if (following && !used.has(following) && following.index - d.end <= 40) {
      const gap = source.slice(d.end, following.index);
      const iso = d.iso && gap === 'T';
      const resolved = newlines(gap) <= 2 && (iso || AFTER.test(gap)) && resolveTimes(following.start, following.finish, tonight);
      if (resolved) after = { time: following, resolved, cost: iso ? 0 : cost(gap) };
    }
    const best = before && (!after || before.cost < after.cost) ? before : after;
    if (!best) continue;
    used.add(best.time);
    const from = Math.max(d.end, best.time.end);
    const next = stops.find((index) => index >= from) ?? source.length;
    moments.push({ d, resolved: best.resolved, from, index: Math.min(d.index, best.time.index), where: zoneIn(source.slice(from, Math.min(from + 80, next))) });
  }
  return moments;
}

// Whether moment b is where moment a ends: "Fri, Oct 30, 7 PM to Sun, Nov 1, 5 PM", or a later
// "Ends:" line. Neither may be a range of its own.
function endsAt(source, a, b) {
  if (!b || a.resolved.end !== null || b.resolved.end !== null) return false;
  const line = source.slice(source.lastIndexOf('\n', b.index - 1) + 1, b.index);
  if (ENDS.test(line)) return b.index - a.index < 300;
  const m = b.index - a.from <= 60 && SPAN.exec(source.slice(a.from, b.index));
  return !!m && (!m[1].trim() || !!zoneIn(m[1]));
}

// The calendar date a mention names, with today judged where the event is.
function dayOf({ now, defaultZone, heads }, d, where) {
  const local = today(now, where || { zone: defaultZone });
  let { year, month, day } = d, yearAssumed = false;
  if (d.relative) {
    const base = new Date(Date.UTC(local.year, local.month - 1, local.day + (d.relative === 'tomorrow' ? 1 : 0)));
    [year, month, day] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
  } else if (!year && d.last?.year) {
    // A span writes its year once, at the end: Dec 30 – Jan 2, 2027 starts in 2026.
    year = d.last.year - (month * 100 + day > d.last.month * 100 + d.last.day ? 1 : 0);
  } else if (!year) ({ year, assumed: yearAssumed } = inferYear(heads, d, local));
  return { year, month, day, yearAssumed, weekdayMismatch: d.weekday !== null && weekdayOf(year, month, day) !== d.weekday };
}

// A timed event at moment a, or from moment a until moment b.
function timedEvent(context, a, b = null) {
  const { source, dates, now, defaultZone, hint, links } = context;
  const [startZone, endZone] = [a.where || b?.where, b?.where || a.where];
  const first = dayOf(context, a.d, startZone), last = b && dayOf(context, b.d, endZone);
  const startWall = wallTime(first.year, first.month, first.day, a.resolved.start);
  const endWall = last ? wallTime(last.year, last.month, last.day, b.resolved.start)
    : a.resolved.end !== null && wallTime(first.year, first.month, first.day, a.resolved.end, a.resolved.end <= a.resolved.start ? 1 : 0);
  if (last && endWall <= startWall) return null; // Not a span; read before converting anything.
  const instant = (wall, where) => basicToDate(where?.offset !== undefined ? offsetToUtc(wall, where.offset) : zonedToUtc(wall, where?.zone || defaultZone));
  const weekdayMismatch = first.weekdayMismatch || !!last?.weekdayMismatch;
  const from = (b || a).from;
  return candidate({
    title: titleFor(source, a.index, hint), start: instant(startWall, startZone), end: endWall ? instant(endWall, endZone) : null,
    zone: startZone?.zone || defaultZone, zoneAssumed: !startZone, yearAssumed: first.yearAssumed || !!last?.yearAssumed,
    dateOrderAssumed: a.d.dateOrderAssumed || !!b?.d.dateOrderAssumed, weekdayMismatch,
    wall: dashed(startWall), endWall: endWall ? dashed(endWall) : undefined,
    location: locationFor(source, a.index, from, Math.min(from + 700, dates.find((other) => other.index >= from)?.index ?? source.length), links),
    description: '', source: 'text', index: a.index,
    score: (startZone ? 2 : 0) + (endWall ? 2 : 0) + (a.d.weekday !== null ? 1 : 0) + (a.d.year || a.d.relative ? 1 : 0) - (weekdayMismatch ? 4 : 0)
  }, { now, zone: defaultZone });
}

// An all-day event from a date without a time: a span of days, or a date the page marks "all day".
function allDayEvent(context, d) {
  const { source, dates, now, defaultZone, hint, links } = context;
  if (!d.last && !ALL_DAY_AFTER.test(source.slice(d.end, d.end + 20)) && !ALL_DAY_BEFORE.test(source.slice(Math.max(0, d.index - 24), d.index))) return null;
  const first = dayOf(context, d);
  const startDate = calendarDay(first.year, first.month, first.day);
  let endDate = startDate, weekdayMismatch = first.weekdayMismatch;
  if (d.last) {
    const { month, day, weekday } = d.last;
    const year = d.last.year || first.year + (month * 100 + day < first.month * 100 + first.day ? 1 : 0);
    endDate = calendarDay(year, month, day);
    weekdayMismatch ||= weekday !== null && weekdayOf(year, month, day) !== weekday;
  }
  if (!startDate || !endDate) return null;
  return candidate({
    title: titleFor(source, d.index, hint), allDay: true, startDate, endDate,
    yearAssumed: first.yearAssumed, dateOrderAssumed: d.dateOrderAssumed, weekdayMismatch,
    location: locationFor(source, d.index, d.end, Math.min(d.end + 700, dates.find((other) => other.index >= d.end)?.index ?? source.length), links),
    description: '', source: 'text', index: d.index,
    score: 2 + (d.weekday !== null ? 1 : 0) + (d.year || d.last?.year || d.relative ? 1 : 0) - (weekdayMismatch ? 4 : 0)
  }, { now, zone: defaultZone });
}

/**
 * Every event in page text, best first: future events, plus events up to 7 days past with reason
 * "past". Options: now, defaultZone (used and flagged when no zone is written), locale (decides
 * 10/05 order), hint (a title to fall back on), links (meeting link candidates).
 */
export function findTextEvents(text, { now = new Date(), defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone, locale = Intl.DateTimeFormat().resolvedOptions().locale, hint = '', links = [] } = {}) {
  if (typeof text !== 'string' || !defaultZone) return [];
  const source = normalize(text);
  const dates = dateMentions(source, /^(?:en(?:-US)?|es-US|en-PH|fil(?:-PH)?)$/i.test(locale || ''));
  const moments = pairTimes(source, dates, timeMentions(source, dates));
  const context = { source, dates, heads: headings(source), now, defaultZone, hint, links };
  // Malformed dates and daylight-saving gaps or overlaps are skipped, not guessed.
  const items = [];
  for (let i = 0; i < moments.length; i++) {
    const [a, b] = [moments[i], moments[i + 1]];
    const span = endsAt(source, a, b) ? attempt(() => timedEvent(context, a, b)) : null;
    const joined = !!span && !span.durationAssumed;
    if (joined) i++;
    const item = joined ? span : attempt(() => timedEvent(context, a));
    if (item) items.push(item);
  }
  const paired = new Set(moments.map((m) => m.d));
  for (const d of dates) {
    if (items.length >= EVENTS) break;
    const item = !paired.has(d) && attempt(() => allDayEvent(context, d));
    if (item) items.push(item);
  }
  return items.filter((item) => item.reason !== 'too-long').sort((a, b) => b.score - a.score || a.index - b.index);
}

/** The best upcoming event in text, or with includePast the best event up to 7 days old. Null if none. */
export function extractEventFromText(text, { includePast = false, ...options } = {}) {
  return findTextEvents(text, options).find((item) => !item.reason || (includePast && item.reason === 'past')) || null;
}
