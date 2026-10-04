import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, formatForZone, inputForZone, inputToUtc } from '../lib/time.js';

const start = '2026-10-05T18:00:00.000Z';

test('wall time in an IANA zone converts to UTC on either side of a daylight-saving change', () => {
  assert.equal(zonedToUtc('20261005T140000', 'America/New_York'), '20261005T180000Z');
  assert.equal(zonedToUtc('20261101T180000', 'America/New_York'), '20261101T230000Z');
  assert.equal(zonedToUtc('20261005T233000', 'Asia/Kolkata'), '20261005T180000Z');
});

test('ambiguous, nonexistent, and out-of-range wall times are rejected rather than guessed', () => {
  assert.throws(() => zonedToUtc('20261101T013000', 'America/New_York'), /ambiguous/i);
  assert.throws(() => zonedToUtc('20260308T023000', 'America/New_York'), /nonexistent/i);
  assert.throws(() => zonedToUtc('20260230T100000', 'America/New_York'), /date/i);
  assert.throws(() => zonedToUtc('20380101T100000', 'America/New_York'), /1970–2037/);
  assert.throws(() => zonedToUtc('20261005T140000', 'Mars/Olympus'), /time zone/i);
});

test('review datetime inputs preserve the selected IANA zone across conversion', () => {
  assert.equal(inputForZone(start, 'America/New_York'), '2026-10-05T14:00');
  assert.equal(inputToUtc('2026-10-05T14:00', 'America/New_York'), start);
  assert.throws(() => inputToUtc('2026-11-01T01:30', 'America/New_York'), /ambiguous/i);
  assert.throws(() => inputToUtc('10/05/2026 2pm', 'America/New_York'), /valid date/i);
});

test('UTC time is formatted for a given time zone', () => {
  assert.deepEqual(formatForZone(start, 'America/New_York'), { date: 'Oct 5, 2026', time: '2:00 PM' });
  assert.deepEqual(formatForZone(start, 'America/Los_Angeles'), { date: 'Oct 5, 2026', time: '11:00 AM' });
});

test('offset sampling at supported year boundaries does not reject valid wall times', () => {
  assert.equal(zonedToUtc('19700101T100000', 'UTC'), '19700101T100000Z');
  assert.equal(zonedToUtc('20371231T100000', 'UTC'), '20371231T100000Z');
});
