import test from 'node:test';
import assert from 'node:assert/strict';
import { findEvents } from '../lib/find.js';

const now = new Date('2026-10-16T14:00:00Z');
const scope = (kind, text, extra = {}) => ({ kind, text, links: [], heading: '', ...extra });
const page = (scopes, extra = {}) => ({ zone: 'America/New_York', lang: 'en-US', title: '', scopes, structured: [], microdata: [], ...extra });
const event = (name, startDate, more = {}) => JSON.stringify({ '@type': 'Event', name, startDate, ...more });

test('a cookie banner or a chat with only old timestamps falls through to the event behind it', () => {
  const { events } = findEvents(page([
    scope('dialog', 'We use cookies to improve your experience. Accept all'),
    scope('dialog', 'Support chat\nToday, 9:15 AM\nHow can we help?'),
    scope('page', 'Harvest Supper Club\nSaturday, October 24 · 7 - 9pm EDT')
  ]), { now });
  assert.deepEqual(events.map((e) => e.title), ['Harvest Supper Club']);
});

test('an open dialog offers only its own events, enriched by matching page data', () => {
  const { events } = findEvents(page([
    scope('dialog', 'New Moon Direction Setting\nMonday, October 26th @ 2pm - 3pm\nNew York time'),
    scope('page', 'October 27\n5pm - Other event')
  ], { structured: [event('New Moon Direction Setting', '2026-10-26T14:00:00-04:00', { location: 'Zoom' }), event('Unrelated', '2026-10-28T10:00:00Z')] }), { now });
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].title, events[0].end, events[0].location, events[0].source], ['New Moon Direction Setting', '2026-10-26T19:00:00.000Z', 'Zoom', 'structured']);
});

test('on a listing page, published event data and page text merge into one entry per event', () => {
  const { events } = findEvents(page([scope('main', 'Fall Fest\nSaturday, October 24, 2026 at 7pm\nMore events\nPumpkin Walk\nOctober 31, 2026 at 5pm')], {
    structured: [event('Fall Fest 2026', '2026-10-24T19:00:00-04:00', { endDate: '2026-10-24T22:00:00-04:00' })]
  }), { now });
  assert.deepEqual(events.map((e) => [e.title, e.start, e.end]), [
    ['Fall Fest 2026', '2026-10-24T23:00:00.000Z', '2026-10-25T02:00:00.000Z'],
    ['Pumpkin Walk', '2026-10-31T21:00:00.000Z', '2026-10-31T22:00:00.000Z']
  ]);
});

test('text read in the wrong zone merges with the venue time the page publishes', () => {
  // The page says 7:00 PM without a zone; its event data says 7 PM Pacific.
  const { events } = findEvents(page([scope('main', 'Pop-up\nOctober 24, 2026 at 7:00 PM')], { structured: [event('Pop-up', '2026-10-24T19:00:00-07:00')] }), { now });
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].start, events[0].zoneAssumed], ['2026-10-25T02:00:00.000Z', false]);
});

test('a calendar link in an email outranks the prose around it', () => {
  const link = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Town+Hall&dates=20261028T230000Z/20261029T003000Z';
  const { events } = findEvents(page([scope('message', 'Join us Oct 28 at 7pm for the town hall.', { links: [link] })]), { now });
  assert.deepEqual(events.map((e) => [e.title, e.end, e.source]), [['Town Hall', '2026-10-29T00:30:00.000Z', 'link']]);
});

test('a selection without an event falls back to the page and says so', () => {
  const result = findEvents(page([scope('selection', 'just some words'), scope('page', 'Recital\nOctober 30, 2026 at 7pm')]), { now });
  assert.equal(result.selectionMissed, true);
  assert.equal(result.events[0].title, 'Recital');
});

test('events that cannot be offered are explained: started, too long, cancelled', () => {
  assert.equal(findEvents(page([scope('page', 'Standup\nToday at 9:00 AM')]), { now }).rejected[0].reason, 'past');
  const long = findEvents(page([scope('page', 'Exhibition')], { structured: [event('Exhibition', '2026-11-01', { endDate: '2027-01-31' })] }), { now });
  assert.deepEqual([long.events.length, long.rejected[0].reason], [0, 'too-long']);
  const cancelled = findEvents(page([scope('page', 'Gig')], { structured: [event('Gig', '2026-10-24', { eventStatus: 'EventCancelled' })] }), { now });
  assert.deepEqual([cancelled.events.length, cancelled.rejected[0].reason], [0, 'cancelled']);
});

test('an all-day event seen in the text and in published data becomes one entry with the published days', () => {
  const { events } = findEvents(page([scope('main', 'Craft Fair\nSaturday, October 24 · All day\nMore events\nPumpkin Walk\nOctober 31, 2026 at 5pm')], {
    structured: [event('Craft Fair 2026', '2026-10-24T00:00:00-04:00', { endDate: '2026-10-25T23:59:59-04:00', location: 'Town Hall' })]
  }), { now });
  assert.deepEqual(events.map((e) => [e.title, e.allDay || false, e.startDate || e.start, e.endDate || e.end, e.location]), [
    ['Craft Fair 2026', true, '2026-10-24', '2026-10-25', 'Town Hall'],
    ['Pumpkin Walk', false, '2026-10-31T21:00:00.000Z', '2026-10-31T22:00:00.000Z', '']
  ]);
});

test('an all-day event and a timed one on the same day stay separate', () => {
  const { events } = findEvents(page([scope('main', 'Fair\nOctober 24, 2026 at 7pm')], { structured: [event('Fair', '2026-10-24')] }), { now });
  assert.deepEqual(events.map((e) => e.allDay || false).sort(), [false, true]);
});

test('a page title falls back as the event name, without the site name or mail chrome', () => {
  assert.equal(findEvents(page([scope('page', 'Oct 24, 2026 at 7pm')], { title: 'Harvest Supper Club | Eventbrite' }), { now }).events[0].title, 'Harvest Supper Club');
  assert.equal(findEvents(page([scope('page', 'Oct 24, 2026 at 7pm')], { title: 'Inbox (3) - someone@example.test - Gmail' }), { now }).events[0].title, 'Untitled event');
});
