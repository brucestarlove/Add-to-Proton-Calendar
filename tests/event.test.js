import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent } from '../lib/event.js';

const now = new Date('2026-10-02T12:00:00Z');
const event = { title: ' New Moon Direction Setting ', start: '2026-10-05T18:00:00.000Z', end: '2026-10-05T19:00:00.000Z', zone: 'America/New_York', location: 'https://meet.example.test/room', description: 'Private note' };

test('a reviewed event passes validation with only the copied fields', () => {
  assert.deepEqual(validateEvent({ ...event, yearAssumed: true }, now), { ...event, title: 'New Moon Direction Setting' });
});

test('events that Proton would reject or that were not reviewed properly are refused', () => {
  assert.throws(() => validateEvent({ ...event, title: '  ' }, now), /title/i);
  assert.throws(() => validateEvent({ ...event, title: 'x'.repeat(256) }, now), /255/);
  assert.throws(() => validateEvent({ ...event, end: event.start }, now), /end/i);
  assert.throws(() => validateEvent({ ...event, end: '2026-11-06T18:00:00.000Z' }, now), /31 days/);
  assert.throws(() => validateEvent({ ...event, zone: 'Mars/Olympus' }, now), /time zone/i);
  assert.throws(() => validateEvent({ ...event, start: '2026-09-05T18:00:00.000Z', end: '2026-09-05T19:00:00.000Z' }, now), /past/i);
  assert.throws(() => validateEvent({ ...event, start: '2026-10-05 18:00' }, now), /valid event dates/i);
  assert.throws(() => validateEvent({ ...event, location: 'x'.repeat(256) }, now), /255/);
  assert.throws(() => validateEvent({ ...event, description: 'x'.repeat(3001) }, now), /3000/);
  assert.throws(() => validateEvent({ ...event, title: 'Meeting\nStart: injected' }, now), /single-line/);
  assert.throws(() => validateEvent({ ...event, location: 'Room\nNotes: injected' }, now), /single-line/);
  assert.throws(() => validateEvent({ ...event, start: '2027-02-30T18:00:00.000Z', end: '2027-03-03T19:00:00.000Z' }, now), /valid event dates/);
});

test('a timed event may run over several days, up to 31', () => {
  assert.equal(validateEvent({ ...event, end: '2026-10-07T18:00:00.000Z' }, now).end, '2026-10-07T18:00:00.000Z');
  assert.equal(validateEvent({ ...event, end: '2026-11-05T18:00:00.000Z' }, now).end, '2026-11-05T18:00:00.000Z');
});

const allDay = { title: 'Craft Fair', allDay: true, startDate: '2026-10-24', endDate: '2026-10-26', location: '', description: '' };

test('an all-day event copies its dates without times or a time zone', () => {
  assert.deepEqual(validateEvent({ ...allDay, zone: 'America/New_York', start: 'ignored' }, now), allDay);
  assert.deepEqual(validateEvent({ ...allDay, endDate: '2026-10-24' }, now), { ...allDay, endDate: '2026-10-24' });
  // Today counts as upcoming for an all-day event, judged by this browser's calendar date.
  const today = new Date(2026, 9, 24, 23, 30);
  assert.equal(validateEvent(allDay, today).startDate, '2026-10-24');
});

test('all-day dates must be real, in order, upcoming, and at most 31 days', () => {
  assert.throws(() => validateEvent({ ...allDay, startDate: '2026-02-30' }, now), /valid event dates/);
  assert.throws(() => validateEvent({ ...allDay, startDate: '2026-10-24T00:00' }, now), /valid event dates/);
  assert.throws(() => validateEvent({ ...allDay, endDate: '2038-01-01' }, now), /1970–2037/);
  assert.throws(() => validateEvent({ ...allDay, startDate: '2026-10-01', endDate: '2026-10-01' }, now), /past/);
  assert.throws(() => validateEvent({ ...allDay, endDate: '2026-10-23' }, now), /last day/);
  assert.equal(validateEvent({ ...allDay, endDate: '2026-11-23' }, now).endDate, '2026-11-23'); // 31 days
  assert.throws(() => validateEvent({ ...allDay, endDate: '2026-11-24' }, now), /31 days/);
  assert.throws(() => validateEvent({ ...allDay, allDay: 'yes' }, now), /time zone/); // Only a real true makes it all-day.
});
