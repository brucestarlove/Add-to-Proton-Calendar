import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEventFromText, findTextEvents } from '../lib/capture.js';

const now = new Date('2026-10-02T13:58:00Z');

test('email reminder becomes a reviewable event with an explicitly assumed one-hour duration', () => {
  const text = 'Hi Bruce Robinson,\nThis is a reminder that "Humanity Rising" will begin in 1 hour on:\nDate Time: Oct 2, 2026 08:00 AM Pacific Time (US and Canada)\nJoin from a PC\nAdd to Calendar Add to Google Calendar';
  const candidate = extractEventFromText(text, { now, defaultZone: 'America/New_York' });
  assert.equal(candidate.title, 'Humanity Rising');
  assert.equal(candidate.start, '2026-10-02T15:00:00.000Z');
  assert.equal(candidate.end, '2026-10-02T16:00:00.000Z');
  assert.equal(candidate.zone, 'America/Los_Angeles');
  assert.equal(candidate.durationAssumed, true);
  assert.equal(candidate.description, '');
});

test('Skool event modal takes event title and time rather than calendar-grid noise', () => {
  const text = 'Calendar\nOctober 2026\nToday\nOctober 5\n2pm - New Moon D...\nNew Moon Direction Setting\nMonday, October 5th @ 2pm - 3pm\nNew York time\nhttps://us02web.zoom.us/j/123456789\nIntention and direction setting together.\nADD TO CALENDAR';
  const candidate = extractEventFromText(text, { now, defaultZone: 'America/Los_Angeles' });
  assert.equal(candidate.title, 'New Moon Direction Setting');
  assert.equal(candidate.start, '2026-10-05T18:00:00.000Z');
  assert.equal(candidate.end, '2026-10-05T19:00:00.000Z');
  assert.equal(candidate.zone, 'America/New_York');
  assert.equal(candidate.location, 'https://us02web.zoom.us/j/123456789');
  assert.equal(candidate.durationAssumed, false);
});

test('Skool relative Today date uses the page time zone, not UTC calendar day', () => {
  const lateUtc = new Date('2026-10-03T02:00:00Z'); // Oct 2 in Los Angeles
  const text = 'Weekend Jam\nToday @ 8:30pm - 9:30pm\nLos Angeles time\nADD TO CALENDAR';
  const candidate = extractEventFromText(text, { now: lateUtc, defaultZone: 'America/New_York' });
  assert.equal(candidate.title, 'Weekend Jam');
  assert.equal(candidate.start, '2026-10-03T03:30:00.000Z');
  assert.equal(candidate.end, '2026-10-03T04:30:00.000Z');
  assert.equal(candidate.zone, 'America/Los_Angeles');
});

test('an event that already started can be identified for an explanation without treating it as future', () => {
  const text = 'Reminder that "Humanity Rising" starts Date Time: Oct 2, 2026 08:00 AM Pacific Time (US and Canada)';
  const after = new Date('2026-10-02T17:00:00Z');
  assert.equal(extractEventFromText(text, { now: after, defaultZone: 'America/New_York' }), null);
  const past = extractEventFromText(text, { now: after, defaultZone: 'America/New_York', includePast: true });
  assert.equal(past.title, 'Humanity Rising');
  assert.equal(past.inPast, true);
});

test('a bare date or a past event is not offered as a capture', () => {
  assert.equal(extractEventFromText('Published October 5, 2026.', { now, defaultZone: 'America/New_York' }), null);
  assert.equal(extractEventFromText('Date Time: Oct 1, 2026 08:00 AM Pacific Time\n"Old meeting"', { now, defaultZone: 'America/New_York' }), null);
});

test('missing year in a month/day candidate is exposed as an assumption', () => {
  const candidate = extractEventFromText('Planning call\nOctober 5 @ 2pm - 3pm', { now, defaultZone: 'America/New_York' });
  assert.equal(candidate.yearAssumed, true);
});

test('unknown timezone uses the browser zone but flags the assumption', () => {
  const candidate = extractEventFromText('Team check-in\nOctober 5, 2026 @ 2pm - 3pm\nADD TO CALENDAR', { now, defaultZone: 'America/New_York' });
  assert.equal(candidate.zone, 'America/New_York');
  assert.equal(candidate.zoneAssumed, true);
});

test('impossible dates are rejected before JavaScript can normalize them', () => {
  for (const date of ['February 30', 'April 31', 'February 29']) {
    assert.equal(extractEventFromText(`Call\n${date}, 2027 @ 2pm - 3pm`, { now, defaultZone: 'UTC' }), null);
  }
  assert.equal(extractEventFromText('Call\nFebruary 28, 2027 @ 11pm - 1am', { now, defaultZone: 'UTC' }).end, '2027-03-01T01:00:00.000Z');
});

test('year inference uses the event zone at New Year', () => {
  const candidate = extractEventFromText('Call\nDecember 31 @ 10pm - 11pm\nLos Angeles time', { now: new Date('2027-01-01T02:00:00Z'), defaultZone: 'UTC' });
  assert.equal(candidate.start, '2027-01-01T06:00:00.000Z');
});

// Sanitized shapes from common sources. [source, text, start, end?, title?, browser zone?]
const oct16 = new Date('2026-10-16T14:00:00Z');
const formats = [
  ['Google Calendar invite', 'Invitation: Design review @ Mon Oct 26, 2026 2pm - 3pm (EDT)\nDesign review\nMonday Oct 26, 2026 ⋅ 2pm – 3pm (Eastern Time - New York)', '2026-10-26T18:00:00.000Z', '2026-10-26T19:00:00.000Z', 'Design review'],
  ['Eventbrite', 'Harvest Supper Club\nSaturday, October 24 · 7 - 9pm EDT\nLocation\nThe Old Mill', '2026-10-24T23:00:00.000Z', '2026-10-25T01:00:00.000Z', 'Harvest Supper Club'],
  ['Meetup', 'JS Night: Signals\nSaturday, October 24, 2026\n7:00 PM to 9:00 PM EDT', '2026-10-24T23:00:00.000Z', '2026-10-25T01:00:00.000Z', 'JS Night: Signals'],
  ['Luma', 'Founders Breakfast\nSaturday, October 24\n7:00 PM - 9:00 PM GMT-4', '2026-10-24T23:00:00.000Z', '2026-10-25T01:00:00.000Z', 'Founders Breakfast'],
  ['Zoom registration', 'Thank you for registering for "Quarterly Town Hall".\nDate & Time Oct 28, 2026 07:00 PM Eastern Time (US and Canada)', '2026-10-28T23:00:00.000Z', null, 'Quarterly Town Hall'],
  ['Zoom invite', 'Topic: Parent Council\nTime: Oct 30, 2026 03:00 PM Eastern Time (US and Canada)', '2026-10-30T19:00:00.000Z', null, 'Parent Council'],
  ['Outlook, standard offset label in summer', 'Budget sync\nWhen: Wednesday, October 28, 2026 7:00 PM-8:00 PM (UTC-05:00) Eastern Time (US & Canada).', '2026-10-28T23:00:00.000Z', '2026-10-29T00:00:00.000Z', 'Budget sync'],
  ['Calendly, time before date', 'Intro call\n10:00am - 10:30am, Thursday, October 29, 2026\nEastern Time - US & Canada', '2026-10-29T14:00:00.000Z', '2026-10-29T14:30:00.000Z', 'Intro call'],
  ['Facebook', 'Open Mic Night\nSAT, OCT 24 AT 7 PM – 9 PM EDT', '2026-10-24T23:00:00.000Z', '2026-10-25T01:00:00.000Z', 'Open Mic Night'],
  ['Ticketmaster', 'Phoebe Live\nFri • Oct 30 • 8:00 PM', '2026-10-31T00:00:00.000Z', null, 'Phoebe Live'],
  ['Events Calendar text', 'Fall Fest\nNovember 5 @ 6:30 pm - 8:00 pm', '2026-11-05T23:30:00.000Z', '2026-11-06T01:00:00.000Z', 'Fall Fest'],
  ['comma after the year', 'Board game night\nWed, Oct 28, 2026, 6:00 PM – 7:30 PM PDT', '2026-10-29T01:00:00.000Z', '2026-10-29T02:30:00.000Z'],
  ['AP style', 'Library board meeting\nThe board meets Oct. 29 at 6:30 p.m. in Room B.', '2026-10-29T22:30:00.000Z', null, 'Library board meeting'],
  ['Sept. with ET', 'Kickoff\nSept. 30, 2027 at 6pm ET', '2027-09-30T22:00:00.000Z'],
  ['AP range', 'Town forum\nWednesday, Nov. 4, 2026, 7:30–9 p.m.', '2026-11-05T00:30:00.000Z', '2026-11-05T02:00:00.000Z'],
  ['UK day-first 24-hour', 'Autumn Lecture\nThursday 29 October 2026, 18:30 – 20:00 GMT', '2026-10-29T18:30:00.000Z', '2026-10-29T20:00:00.000Z', 'Autumn Lecture'],
  ['UK dotted times', 'Supper\nNov 5th, 6.30-8pm', '2026-11-05T18:30:00.000Z', '2026-11-05T20:00:00.000Z', 'Supper', 'Europe/London'],
  ['time before day-first date', 'Choir\n6:30pm Thursday 5th November', '2026-11-05T18:30:00.000Z', null, 'Choir', 'Europe/London'],
  ['ISO', 'Deploy window\n2026-10-29 18:30 UTC', '2026-10-29T18:30:00.000Z'],
  ['ISO with T', 'Deploy\n2026-10-29T18:30 UTC', '2026-10-29T18:30:00.000Z'],
  ['US numeric', 'Recital\n11/4/2026 7:30 PM', '2026-11-05T00:30:00.000Z'],
  ['US numeric without year', 'Parent night\n10/30 at 3pm', '2026-10-30T19:00:00.000Z'],
  ['UK numeric, unambiguous', 'Clinic\nFriday 30/10/2026 15:00', '2026-10-30T15:00:00.000Z', null, 'Clinic', 'Europe/London'],
  ['dotted date', 'Next session: 11.12.2026, 18:00 CET', '2026-12-11T17:00:00.000Z'],
  ['labelled lines', 'Community Cleanup\nDate\nSaturday, October 24, 2026\nTime\n9:00 AM - 12:00 PM', '2026-10-24T13:00:00.000Z', '2026-10-24T16:00:00.000Z', 'Community Cleanup'],
  ['Date: and Time: lines', 'Potluck\nDate: Thursday, November 5, 2026\nTime: 6:30 PM - 8:00 PM (PST)', '2026-11-06T02:30:00.000Z', '2026-11-06T04:00:00.000Z', 'Potluck'],
  ['Starts: and Ends: lines', 'Hack night\nStarts: November 5, 2026 6:30 PM\nEnds: November 5, 2026 8:00 PM', '2026-11-05T23:30:00.000Z', '2026-11-06T01:00:00.000Z', 'Hack night'],
  ['UTC offset', 'Standup\nOctober 26, 2026 at 9am UTC-5', '2026-10-26T14:00:00.000Z'],
  ['IANA zone', 'Retro\nTuesday, October 27, 2026 at 2:00 PM – 3:00 PM (America/Chicago)', '2026-10-27T19:00:00.000Z', '2026-10-27T20:00:00.000Z'],
  ['European abbreviation', 'Berlin meetup\nOctober 27, 2026 at 7pm CET', '2026-10-27T18:00:00.000Z'],
  ['city in parentheses', 'Seminar\nThu 12 Nov 2026 18:00–19:30 (London)', '2026-11-12T18:00:00.000Z', '2026-11-12T19:30:00.000Z'],
  ['first of two zones', 'AMA\nOct 30, 2026 at 7pm ET / 4pm PT', '2026-10-30T23:00:00.000Z'],
  ['AEDT', 'Planning\nMonday, 16 November 2026 · 09:30-11:00 AEDT', '2026-11-15T22:30:00.000Z', '2026-11-16T00:00:00.000Z'],
  ['tonight', 'Watch party\nTonight at 8', '2026-10-17T00:00:00.000Z', null, 'Watch party'],
  ['today without at', 'Office hours\nToday, 3:00 PM - 4:00 PM', '2026-10-16T19:00:00.000Z', '2026-10-16T20:00:00.000Z'],
  ['noon', 'Lunch & learn\nOctober 27, 2026 at noon', '2026-10-27T16:00:00.000Z'],
  ['range borrowing am', 'Brunch\nOctober 25, 2026, 11 - 1pm', '2026-10-25T15:00:00.000Z', '2026-10-25T17:00:00.000Z'],
  ['overnight range', 'Countdown\nDec 31, 2026 11:30pm - 12:30am', '2027-01-01T04:30:00.000Z', '2027-01-01T05:30:00.000Z'],
  ['narrow no-break space before PM', 'Demo\nOct 28, 2026, 3:00 PM', '2026-10-28T19:00:00.000Z']
];
for (const [source, text, start, end, title, defaultZone = 'America/New_York'] of formats) {
  test(`format: ${source}`, () => {
    const found = extractEventFromText(text, { now: oct16, defaultZone, locale: 'en-US' });
    assert.ok(found, 'no event found');
    assert.equal(found.start, start);
    if (end) assert.equal(found.end, end);
    if (title) assert.equal(found.title, title);
  });
}

test('text that only looks like an event is not offered', () => {
  for (const text of [
    'Fri, Oct 16, 2026, 9:02 AM (1 hour ago)', 'Call 555-123-4567 between 9am and 5pm', 'Released v2.10.2026 at 10:00',
    'Tickets $19.00\nOct 30', 'Office hours: Mon–Fri, 9am–5pm', 'Order #10/24 shipped', 'Runtime 1:45\nRated PG',
    'Recap of our workshop\nOctober 5 @ 2pm - 3pm',
    // A date alone is a byline or a deadline, not an all-day event; a span longer than 31 days is not offered.
    'Published October 5, 2026.', 'Sale ends Oct 20', 'Updated Oct 24 by staff', 'Score 3/4 - 1/2', 'Q4 planning window Oct 1 – Dec 31, 2026'
  ]) assert.equal(extractEventFromText(text, { now: oct16, defaultZone: 'America/New_York' }), null, text);
});

// [source, text, first day, last day, title?]
const allDayFormats = [
  ['date range across months', 'Conference\nOct 30 – Nov 1, 2026', '2026-10-30', '2026-11-01', 'Conference'],
  ['days in one month', 'Harvest Fest\nNov 5–7, 2026', '2026-11-05', '2026-11-07', 'Harvest Fest'],
  ['day-first days in one month', 'Harvest Fest\n5-7 November 2026', '2026-11-05', '2026-11-07'],
  ['weekdays on both ends', 'Retreat\nFri, Oct 30 – Sun, Nov 1', '2026-10-30', '2026-11-01', 'Retreat'],
  ['day-first with to', 'Book fair\nFriday 30 October to Sunday 1 November 2026', '2026-10-30', '2026-11-01'],
  ['year written once, across New Year', 'Winter camp\nDec 30 – Jan 2, 2027', '2026-12-30', '2027-01-02'],
  ['ISO dates', 'Sprint\n2026-10-30 to 2026-11-01', '2026-10-30', '2026-11-01'],
  ['all day after the date', 'Craft Fair\nSaturday, October 24 · All day', '2026-10-24', '2026-10-24', 'Craft Fair'],
  ['all day in parentheses', 'Craft Fair\nOct 24, 2026 (all day)', '2026-10-24', '2026-10-24', 'Craft Fair'],
  ['all-day before the date', 'Field trip\nAll-day event: Saturday, October 24', '2026-10-24', '2026-10-24', 'Field trip'],
  ['all day today', 'Team offsite\nToday · All day', '2026-10-16', '2026-10-16', 'Team offsite']
];
for (const [source, text, first, last, title] of allDayFormats) {
  test(`all-day format: ${source}`, () => {
    const found = extractEventFromText(text, { now: oct16, defaultZone: 'America/New_York', locale: 'en-US' });
    assert.ok(found, 'no event found');
    assert.deepEqual([found.allDay, found.startDate, found.endDate], [true, first, last]);
    if (title) assert.equal(found.title, title);
  });
}

test('a time beside a day keeps it a timed event, even after a dash', () => {
  for (const text of ['Fall Fest\nNovember 5 - 7 pm', 'Fall Fest\nNovember 5 - 6:30 pm', 'Fall Fest\nNov 5 - 7pm']) {
    const found = extractEventFromText(text, { now: oct16, defaultZone: 'America/New_York' });
    assert.equal(found.allDay, undefined, text);
    assert.match(found.start, /^2026-11-0[56]T/, text);
  }
});

test('one date-time running to another is a single event, with the zone written once at the end', () => {
  const meetup = extractEventFromText('Hackathon\nFri, Oct 30 · 7:00 PM to Sun, Nov 1 · 5:00 PM EDT', { now: oct16, defaultZone: 'America/Los_Angeles' });
  assert.deepEqual([meetup.start, meetup.end, meetup.zone, meetup.durationAssumed], ['2026-10-30T23:00:00.000Z', '2026-11-01T22:00:00.000Z', 'America/New_York', false]);
  const zoned = extractEventFromText('Hackathon\nOct 30, 2026 7pm EDT – Nov 1, 2026 5pm EDT', { now: oct16, defaultZone: 'UTC' });
  assert.deepEqual([zoned.start, zoned.end], ['2026-10-30T23:00:00.000Z', '2026-11-01T22:00:00.000Z']);
  const ends = findTextEvents('Retreat\nStarts: Oct 30, 2026 7:00 PM\nEnds: Nov 1, 2026 5:00 PM', { now: oct16, defaultZone: 'America/New_York' });
  assert.deepEqual(ends.map((e) => [e.start, e.end]), [['2026-10-30T23:00:00.000Z', '2026-11-01T22:00:00.000Z']]);
});

test('an invitation written midnight to midnight is read as all day, and says so', () => {
  const found = extractEventFromText('Holiday\nWhen: Saturday, October 24, 2026 12:00 AM-Sunday, October 25, 2026 12:00 AM', { now: oct16, defaultZone: 'America/New_York' });
  assert.deepEqual([found.allDay, found.startDate, found.endDate, found.midnight, found.title], [true, '2026-10-24', '2026-10-24', true, 'Holiday']);
});

test('an all-day event that has started is explained, not offered', () => {
  const [found] = findTextEvents('Book fair\nOct 14 – Oct 18, 2026', { now: oct16, defaultZone: 'America/New_York' });
  assert.deepEqual([found.reason, found.startDate], ['past', '2026-10-14']);
  assert.equal(extractEventFromText('Book fair\nOct 14 – Oct 18, 2026', { now: oct16, defaultZone: 'America/New_York' }), null);
});

test('a year left unwritten comes from the weekday when only one year fits', () => {
  const found = extractEventFromText('Retreat\nTuesday, October 5 @ 2pm', { now: new Date('2027-09-20T12:00:00Z'), defaultZone: 'UTC' });
  assert.equal(found.start, '2027-10-05T14:00:00.000Z');
  assert.equal(found.yearAssumed, false);
  const wrong = extractEventFromText('Retreat\nThursday, October 30, 2026 at 2pm', { now: oct16, defaultZone: 'UTC' });
  assert.equal(wrong.weekdayMismatch, true);
});

test('an ambiguous numeric date follows the language and says so', () => {
  const us = extractEventFromText('Call\n11/05/2026 2:00 PM', { now: oct16, defaultZone: 'UTC', locale: 'en-US' });
  const uk = extractEventFromText('Call\n11/05/2027 2:00 PM', { now: oct16, defaultZone: 'UTC', locale: 'en-GB' });
  assert.equal(us.start, '2026-11-05T14:00:00.000Z');
  assert.equal(uk.start, '2027-05-11T14:00:00.000Z');
  assert.equal(us.dateOrderAssumed && uk.dateOrderAssumed, true);
});

test('a fixed offset is converted to the browser zone and flagged only when the clock differs', () => {
  const far = extractEventFromText('Sync\nOctober 26, 2026 at 9am GMT+2', { now: oct16, defaultZone: 'America/New_York' });
  assert.equal(far.zone, 'America/New_York');
  assert.equal(far.converted, true);
  const same = extractEventFromText('Sync\nOctober 26, 2026 at 9am GMT-4', { now: oct16, defaultZone: 'America/New_York' });
  assert.equal(same.converted, false);
  assert.equal(same.zoneAssumed, false);
});

test('meeting links become the location, but product pages and lone links elsewhere do not', () => {
  const join = 'https://us06web.zoom.us/j/8812345678?pwd=abc';
  assert.equal(extractEventFromText(`Sync\nOct 26, 2026 at 9am\nJoin Zoom Meeting ${join}`, { now: oct16, defaultZone: 'UTC' }).location, join);
  assert.equal(extractEventFromText('Sync\nOct 26, 2026 at 9am\nDownload https://zoom.us/download', { now: oct16, defaultZone: 'UTC' }).location, '');
  assert.equal(extractEventFromText('Sync\nOct 26, 2026 at 9am', { now: oct16, defaultZone: 'UTC', links: [join] }).location, join);
  assert.equal(extractEventFromText('Sync\nOct 26, 2026 at 9am', { now: oct16, defaultZone: 'UTC', links: [join, 'https://meet.google.com/abc-defg-hij'] }).location, '');
  assert.equal(extractEventFromText('Sync\nOct 26, 2026 at 9am\nWhere: Microsoft Teams Meeting', { now: oct16, defaultZone: 'UTC', links: ['https://teams.microsoft.com/l/meetup-join/19%3a'] }).location, 'https://teams.microsoft.com/l/meetup-join/19%3a');
  assert.equal(extractEventFromText('Sync\nOct 26, 2026 at 9am\nLocation: Room 4, Main Library', { now: oct16, defaultZone: 'UTC', links: [join] }).location, 'Room 4, Main Library');
});

test('every event in a list is found, each with its own time', () => {
  const events = findTextEvents('Office hours\n10:00am - 10:30am, Thursday, October 29, 2026\nOffice hours\n11:00am - 11:30am, Friday, October 30, 2026', { now: oct16, defaultZone: 'UTC' });
  assert.deepEqual(events.map((e) => e.start), ['2026-10-29T10:00:00.000Z', '2026-10-30T11:00:00.000Z']);
});
