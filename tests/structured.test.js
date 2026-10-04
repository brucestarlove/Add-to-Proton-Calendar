import test from 'node:test';
import assert from 'node:assert/strict';
import { linkEvents, structuredEvents } from '../lib/structured.js';

const now = new Date('2026-10-16T14:00:00Z');
const options = { now, defaultZone: 'America/New_York' };
const ld = (value) => JSON.stringify(value);

test('a schema.org Event with an offset gives exact times, its place, and its page', () => {
  const [event] = structuredEvents([ld({
    '@context': 'https://schema.org', '@type': 'MusicEvent', name: 'Pumpkin &amp; Pie <b>Night</b>',
    startDate: '2026-10-24T19:00:00-07:00', endDate: '2026-10-24T21:00:00-07:00', url: 'https://tickets.example.test/e/42',
    location: { '@type': 'Place', name: 'The Old Mill', address: { streetAddress: '1 Mill Rd', addressLocality: 'Portland', addressRegion: 'OR' } }
  })], options);
  assert.equal(event.title, 'Pumpkin & Pie Night');
  assert.equal(event.start, '2026-10-25T02:00:00.000Z');
  assert.equal(event.end, '2026-10-25T04:00:00.000Z');
  assert.equal(event.zone, 'America/New_York');
  assert.equal(event.converted, true); // The page shows 7 PM; the form shows 10 PM New York time.
  assert.equal(event.zoneAssumed, false);
  assert.equal(event.location, 'The Old Mill, 1 Mill Rd, Portland, OR');
  assert.equal(event.description, 'https://tickets.example.test/e/42');
});

test('events are found inside @graph, arrays, item lists and sub-events', () => {
  const events = structuredEvents([
    ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Event', name: 'A', startDate: '2026-10-20T10:00:00Z' }] }),
    ld([{ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'https://schema.org/Event', name: 'B', startDate: '2026-10-21T10:00:00Z' } }] }]),
    ld({ '@type': 'Festival', name: 'C', startDate: '2026-10-22T10:00:00Z', subEvent: [{ '@type': 'Event', name: 'D', startDate: '2026-10-22T11:00:00Z' }] })
  ], options);
  assert.deepEqual(events.map((e) => e.title), ['A', 'B', 'C', 'D']);
});

test('floating times are read in the browser zone and flagged; UTC times need no conversion note', () => {
  const [floating, utc] = structuredEvents([ld({ '@type': 'Event', name: 'F', startDate: '2026-10-24T19:00' }), ld({ '@type': 'Event', name: 'U', startDate: '2026-10-24T23:00:00.000Z' })], options);
  assert.equal(floating.start, '2026-10-24T23:00:00.000Z');
  assert.equal(floating.zoneAssumed, true);
  assert.equal(floating.durationAssumed, true);
  assert.equal(utc.converted, false);
});

test('all-day and multi-day events are offered; over-long, cancelled, and long-past ones are not', () => {
  const items = structuredEvents([
    ld({ '@type': 'Event', name: 'Fair', startDate: '2026-10-24' }),
    ld({ '@type': 'Event', name: 'Festival', startDate: '2026-10-30', endDate: '2026-11-01' }),
    ld({ '@type': 'Event', name: 'Conference', startDate: '2026-10-24T09:00:00-04:00', endDate: '2026-10-26T17:00:00-04:00' }),
    ld({ '@type': 'Event', name: 'Exhibition', startDate: '2026-11-01', endDate: '2027-01-31' }),
    ld({ '@type': 'Event', name: 'Gig', startDate: '2026-10-24T20:00:00-04:00', eventStatus: 'https://schema.org/EventCancelled' }),
    ld({ '@type': 'Event', name: 'Market', startDate: '2026-10-25', eventStatus: 'EventCancelled' }),
    ld({ '@type': 'Event', name: 'Old', startDate: '2026-01-01T10:00:00Z' }),
    '{ "@type": "Event", "name": "Broken", "startDate": "2026-10-30T10:00:00Z", }'
  ], options);
  assert.deepEqual(items.map((item) => [item.title, item.reason, item.allDay ? `${item.startDate}/${item.endDate}` : item.end]), [
    ['Fair', undefined, '2026-10-24/2026-10-24'],
    ['Festival', undefined, '2026-10-30/2026-11-01'], // schema.org end dates are inclusive.
    ['Conference', undefined, '2026-10-26T21:00:00.000Z'],
    ['Exhibition', 'too-long', '2026-11-01/undefined'],
    ['Gig', 'cancelled', undefined],
    ['Market', 'cancelled', '2026-10-25/undefined'],
    ['Broken', undefined, '2026-10-30T11:00:00.000Z']
  ]);
});

test('midnight to 23:59 or to the next midnight, as the venue writes it, is an all-day event', () => {
  const [fair, weekend, late, utc] = structuredEvents([
    ld({ '@type': 'Event', name: 'Fair', startDate: '2026-10-24T00:00:00-04:00', endDate: '2026-10-24T23:59:59-04:00' }),
    ld({ '@type': 'Event', name: 'Weekend', startDate: '2026-10-24T00:00:00+02:00', endDate: '2026-10-26T00:00:00+02:00' }),
    ld({ '@type': 'Event', name: 'Late show', startDate: '2026-10-24T00:00:00-04:00', endDate: '2026-10-24T02:00:00-04:00' }),
    ld({ '@type': 'Event', name: 'UTC', startDate: '2026-10-24T00:00:00Z', endDate: '2026-10-25T00:00:00Z' })
  ], options);
  assert.deepEqual([fair.allDay, fair.startDate, fair.endDate, fair.midnight], [true, '2026-10-24', '2026-10-24', true]);
  assert.deepEqual([weekend.startDate, weekend.endDate], ['2026-10-24', '2026-10-25']);
  assert.equal(late.allDay, undefined);
  // A UTC midnight says nothing about the venue's day, so it stays a timed event.
  assert.equal(utc.allDay, undefined);
});

test('microdata objects from the page are read like JSON-LD', () => {
  const [event] = structuredEvents([{ '@type': 'Event', name: 'Open studio', startDate: '2026-10-30T18:00-04:00', endDate: '', location: 'Studio 5\nArts Building' }], options);
  assert.equal(event.start, '2026-10-30T22:00:00.000Z');
  assert.equal(event.location, 'Studio 5 Arts Building');
});

test('Google, Outlook and Yahoo calendar links give the event, even inside a redirect', () => {
  const google = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Design+review&dates=20261026T180000Z/20261026T190000Z&location=Room+2&details=Agenda%3Cbr%3EBring+notes';
  const floating = 'https://www.google.com/calendar/event?action=TEMPLATE&text=Fall+Fest&dates=20261024T190000/20261024T210000&ctz=America/Chicago';
  const outlook = 'https://outlook.office.com/calendar/0/deeplink/compose?subject=Budget&startdt=2026-10-28T19:00:00-04:00&enddt=2026-10-28T20:00:00-04:00&location=Teams';
  const yahoo = 'https://calendar.yahoo.com/?v=60&title=Dentist&st=20261030T190000Z&dur=0130';
  const wrapped = `https://www.google.com/url?q=${encodeURIComponent(google)}&sa=D`;
  const [g, f, o, y] = linkEvents([google, floating, outlook, yahoo, wrapped, 'https://example.test/'], options);
  assert.deepEqual([g.title, g.start, g.end, g.location, g.description], ['Design review', '2026-10-26T18:00:00.000Z', '2026-10-26T19:00:00.000Z', 'Room 2', 'Agenda\nBring notes']);
  assert.deepEqual([f.start, f.zone, f.zoneAssumed, f.converted], ['2026-10-25T00:00:00.000Z', 'America/Chicago', false, false]);
  assert.deepEqual([o.title, o.start, o.end], ['Budget', '2026-10-28T23:00:00.000Z', '2026-10-29T00:00:00.000Z']);
  assert.deepEqual([y.title, y.end], ['Dentist', '2026-10-30T20:30:00.000Z']);
  assert.equal(linkEvents([google, wrapped], options).length, 1);
});

test('all-day calendar links end the day before their end date, as iCalendar does; links without dates are ignored', () => {
  const items = linkEvents([
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Holiday&dates=20261126/20261127',
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Retreat&dates=20261127/20261130',
    'https://outlook.live.com/calendar/0/action/compose?subject=Offsite&allday=true&startdt=2026-11-02T00:00:00&enddt=2026-11-04T00:00:00',
    'https://outlook.office.com/calendar/0/deeplink/compose?subject=Inventory&allday=true&startdt=2026-11-05&enddt=2026-11-05',
    'https://calendar.yahoo.com/?v=60&title=Moving+day&st=20261107&dur=allday',
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=No+dates'
  ], options);
  assert.deepEqual(items.map((item) => [item.title, item.allDay, item.startDate, item.endDate]), [
    ['Holiday', true, '2026-11-26', '2026-11-26'], ['Retreat', true, '2026-11-27', '2026-11-29'], ['Offsite', true, '2026-11-02', '2026-11-03'],
    ['Inventory', true, '2026-11-05', '2026-11-05'], ['Moving day', true, '2026-11-07', '2026-11-07']
  ]);
});
