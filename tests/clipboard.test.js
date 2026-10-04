process.env.TZ = 'America/Los_Angeles'; // The pasting browser; the event below was copied in New York time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clipboardText } from '../lib/clipboard.js';

const event = { title: 'Review me', start: '2026-10-05T18:00:00.000Z', end: '2026-10-05T19:00:00.000Z', zone: 'America/New_York', location: 'Room 2', description: 'Bring notes\nSecond line' };

test('copied event is a readable block with wall time and UTC offset', () => {
  assert.equal(clipboardText(event), 'Title: Review me\nStart: 2026-10-05T14:00-04:00\nEnd: 2026-10-05T15:00-04:00\nLocation: Room 2\nNotes: Bring notes\nSecond line');
  assert.equal(clipboardText({ ...event, zone: 'Asia/Kolkata', location: '', description: '' }), 'Title: Review me\nStart: 2026-10-05T23:30+05:30\nEnd: 2026-10-06T00:30+05:30');
  assert.match(clipboardText({ ...event, zone: 'UTC' }), /Start: 2026-10-05T18:00\+00:00/);
});

const fair = { title: 'Craft Fair', allDay: true, startDate: '2026-10-24', endDate: '2026-10-26', location: 'Town Hall', description: '' };

test('an all-day event is copied as dates without times, ending on its last day', () => {
  assert.equal(clipboardText(fair), 'Title: Craft Fair\nStart: 2026-10-24\nEnd: 2026-10-26\nLocation: Town Hall');
});

// Like Proton's DateInput/TimeInput: typed text is only committed on blur after a focus.
const typedField = (shown) => {
  let focused = false, typed = null;
  return {
    get value() { return focused && typed !== null ? typed : shown; },
    set value(text) { typed = text; },
    focus() { focused = true; }, blur() { if (focused && typed !== null) shown = typed; focused = false; typed = null; }, dispatchEvent() {}
  };
};
const textField = () => ({ value: '', focus() {}, blur() {}, dispatchEvent() {} });
const settle = () => new Promise((resolve) => setTimeout(resolve, 1300)); // A full fill, All day box included, takes about 0.9 s.

// Like Proton's form: the All day box hides the time fields when ticked and shows them when cleared.
function protonForm({ allDay = false, disabled = false } = {}) {
  const times = { 'event-startTime': typedField('9:00 AM'), 'event-endTime': typedField('9:30 AM') };
  const fields = {
    'event-title-input': textField(), 'event-location-input': textField(), 'event-description-input': textField(),
    'event-date-input': typedField('Oct 2, 2026'), 'event-endDate': typedField('Oct 2, 2026'),
    'event-allday-checkbox': { type: 'checkbox', checked: allDay, disabled, clicks: 0, click() { this.clicks++; this.checked = !this.checked; show(); } }
  };
  const show = () => {
    for (const [id, field] of Object.entries(times)) {
      if (fields['event-allday-checkbox'].checked) delete fields[id];
      else fields[id] = field;
    }
  };
  show();
  return fields;
}

// One page: its listeners outlive any single injected copy of the helper.
function fakePage(fields) {
  for (const [id, field] of Object.entries(fields)) field.id = id;
  const listeners = new Map(), appended = [];
  const element = () => ({ style: {}, append(...children) { appended.push(...children); }, addEventListener() {}, setAttribute() {}, remove() {}, attachShadow() { return { append(...children) { appended.push(...children); } }; } });
  const document = {
    querySelector: (selector) => fields[selector.slice(1)] || null,
    getElementById: () => null,
    createElement: element,
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener)); },
    dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true; },
    body: { append(node) { appended.push(node); } }
  };
  const inject = () => {
    const timer = (fn, ms) => setTimeout(fn, ms).unref(); // The note's auto-dismiss must not hold the test run open.
    const sandbox = { document, console, setTimeout: timer, Intl, Date, Event, HTMLInputElement: class {}, HTMLTextAreaElement: class {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(readFileSync(new URL('../calendar-paste.js', import.meta.url), 'utf8'), sandbox);
  };
  const paste = (text, id = 'event-title-input', isTrusted = true) => {
    const e = { type: 'paste', isTrusted, target: fields[id] || { id }, clipboardData: { getData: () => text }, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
    document.dispatchEvent(e);
    return e.prevented;
  };
  return { inject, paste, appended, pasteListeners: () => (listeners.get('paste') || []).length };
}
function loadPasteHelper(fields) {
  const page = fakePage(fields);
  page.inject();
  return page;
}

test('pasting a copied event into the Proton title fills the form in the pasting browser’s zone', async () => {
  const fields = {
    'event-title-input': textField(), 'event-location-input': textField(), 'event-description-input': textField(),
    'event-date-input': typedField('Oct 2, 2026'), 'event-startTime': typedField('9:00 AM'),
    'event-endDate': typedField('Oct 2, 2026'), 'event-endTime': typedField('9:30 AM')
  };
  const { paste, appended } = loadPasteHelper(fields);
  assert.equal(paste(clipboardText(event)), true);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(fields['event-title-input'].value, 'Review me');
  assert.equal(fields['event-date-input'].value, 'Oct 5, 2026');
  assert.equal(fields['event-startTime'].value, '11:00 AM');
  assert.equal(fields['event-endDate'].value, 'Oct 5, 2026');
  assert.equal(fields['event-endTime'].value, '12:00 PM');
  assert.equal(fields['event-location-input'].value, 'Room 2');
  assert.equal(fields['event-description-input'].value, 'Bring notes\nSecond line');
  assert.ok(appended.some((el) => el.textContent === 'Filled from your clipboard'));
});

test('paste follows the date order and 24-hour clock Proton is showing', async () => {
  const fields = {
    'event-title-input': textField(),
    'event-date-input': typedField('2 Oct 2026'), 'event-startTime': typedField('09:00'),
    'event-endDate': typedField('2 Oct 2026'), 'event-endTime': typedField('09:30')
  };
  const { paste } = loadPasteHelper(fields);
  assert.equal(paste('Title: Late call\nStart: 2026-12-31 23:15\nEnd: 2027-01-01 00:45'), true); // No offset: local time.
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepEqual(['event-date-input', 'event-startTime', 'event-endDate', 'event-endTime'].map((id) => fields[id].value), ['31 Dec 2026', '23:15', '1 Jan 2027', '00:45']);
});

test('ordinary pastes and other fields are left alone', () => {
  const { paste } = loadPasteHelper({ 'event-title-input': textField() });
  assert.equal(paste('Lunch with Sam'), false);
  assert.equal(paste('Title: Backwards\nStart: 2026-10-05 15:00\nEnd: 2026-10-05 14:00'), false);
  assert.equal(paste('Title: Extra\nStart: 2026-10-05 14:00\nEnd: 2026-10-05 15:00\nSomething else'), false);
  assert.equal(paste(clipboardText(event), 'event-description-input'), false);
  assert.equal(paste(clipboardText(event), 'event-title-input', false), false);
});

test('malformed dates and oversized event blocks cannot trigger a form fill', () => {
  const { paste } = loadPasteHelper({ 'event-title-input': textField() });
  const block = (start, end, extra = '') => `Title: Test\nStart: ${start}\nEnd: ${end}${extra}`;
  for (const text of [
    block('2026-02-30 14:00', '2026-03-03 15:00'),
    block('2026-10-05 24:00', '2026-10-06 01:00'),
    block('2026-10-05T14:00+04:99', '2026-10-05T15:00+04:99'),
    block('2038-01-01 14:00', '2038-01-01 15:00'),
    block('2026-10-05 14:00', '2026-11-06 15:00'),
    block('2026-10-05', '2026-10-05 15:00'),
    block('2026-10-05 14:00', '2026-10-05'),
    block('2026-10-24', '2026-10-23'),
    block('2026-10-24', '2026-11-24'),
    block('2026-02-30', '2026-03-01'),
    block('2038-01-01', '2038-01-01'),
    block('2026-10-24T', '2026-10-24'),
    block('2026-10-05 14:00', '2026-10-05 15:00', `\nLocation: ${'x'.repeat(256)}`),
    block('2026-10-05 14:00', '2026-10-05 15:00', `\nNotes: ${'x'.repeat(3001)}`),
    clipboardText({ ...event, title: 'x'.repeat(256) }),
    clipboardText({ ...event, description: '\u0000' }),
    'x'.repeat(4001)
  ]) assert.equal(paste(text), false, text.slice(0, 100));
});

test('a changed form stops the fill before fields in the replacement event are touched', async () => {
  const fields = { 'event-title-input': textField(), 'event-date-input': typedField('Oct 2, 2026') };
  const { paste, appended } = loadPasteHelper(fields);
  assert.equal(paste(clipboardText(event)), true);
  fields['event-title-input'] = { ...textField(), id: 'event-title-input' };
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fields['event-date-input'].value, 'Oct 2, 2026');
  assert.equal(fields['event-title-input'].value, '');
  assert.ok(appended.some((el) => el.textContent === 'Could not finish filling'));
});

test('re-injection cancels an in-progress fill from the retired helper', async () => {
  const fields = { 'event-title-input': textField(), 'event-date-input': typedField('Oct 2, 2026') };
  const page = fakePage(fields);
  page.inject();
  assert.equal(page.paste(clipboardText(event)), true);
  page.inject();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(fields['event-date-input'].value, 'Oct 2, 2026');
  assert.equal(page.pasteListeners(), 1);
  assert.equal(page.appended.length, 0);
});

test('numeric date formats are reported as unsupported and blank optional fields clear previous details', async () => {
  const fields = {
    'event-title-input': textField(), 'event-location-input': { ...textField(), value: 'Old room' },
    'event-description-input': { ...textField(), value: 'Old notes' },
    'event-date-input': typedField('10/02/2026'), 'event-endDate': typedField('10/02/2026'),
    'event-startTime': typedField('09:00'), 'event-endTime': typedField('09:30')
  };
  const { paste, appended } = loadPasteHelper(fields);
  assert.equal(paste(clipboardText({ ...event, location: '', description: '' })), true);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(fields['event-date-input'].value, '10/02/2026');
  assert.equal(fields['event-location-input'].value, '');
  assert.equal(fields['event-description-input'].value, '');
  assert.ok(appended.some((el) => /start date, end date/.test(el.textContent || '')));
});

test('fields Proton does not accept are named instead of reported as filled', async () => {
  const fields = { 'event-title-input': textField(), 'event-date-input': typedField('Oct 2, 2026'), 'event-endDate': typedField('Oct 2, 2026') };
  const { paste, appended } = loadPasteHelper(fields); // An all-day form has no time fields.
  assert.equal(paste(clipboardText(event)), true);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.ok(appended.some((el) => /start time, end time, location, description/.test(el.textContent || '')));
  assert.equal(appended.some((el) => el.textContent === 'Filled from your clipboard'), false);
});

test('a newer copy of the helper replaces the one already in the page', async () => {
  let titleEdits = 0;
  const title = { ...textField(), dispatchEvent() { titleEdits++; } };
  const page = fakePage({ 'event-title-input': title, 'event-date-input': typedField('Oct 2, 2026'), 'event-startTime': typedField('9:00 AM'), 'event-endDate': typedField('Oct 2, 2026'), 'event-endTime': typedField('9:30 AM') });
  page.inject(); // Declared content script.
  page.inject(); // Injected again by the popup's Copy button, or into a new world after an extension reload.
  page.inject();
  assert.equal(page.pasteListeners(), 1);
  assert.equal(page.paste(clipboardText(event)), true);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(titleEdits, 1);
  assert.equal(title.value, 'Review me');
});

test('a timed event can run over several days', async () => {
  const fields = protonForm();
  const { paste } = loadPasteHelper(fields);
  assert.equal(paste('Title: Hackathon\nStart: 2026-10-30T19:00-07:00\nEnd: 2026-11-01T17:00-08:00'), true);
  await settle();
  assert.deepEqual(['event-date-input', 'event-startTime', 'event-endDate', 'event-endTime'].map((id) => fields[id].value), ['Oct 30, 2026', '7:00 PM', 'Nov 1, 2026', '5:00 PM']);
});

test('pasting an all-day event ticks All day, then fills the dates and leaves no time fields', async () => {
  const fields = protonForm();
  const { paste, appended } = loadPasteHelper(fields);
  assert.equal(paste(clipboardText(fair)), true);
  await settle();
  assert.equal(fields['event-allday-checkbox'].checked, true);
  assert.deepEqual([fields['event-title-input'].value, fields['event-date-input'].value, fields['event-endDate'].value, fields['event-location-input'].value], ['Craft Fair', 'Oct 24, 2026', 'Oct 26, 2026', 'Town Hall']);
  assert.equal(fields['event-startTime'], undefined);
  assert.ok(appended.some((el) => el.textContent === 'Filled from your clipboard'));
  assert.ok(appended.some((el) => /Craft Fair: Oct 24, 2026 to Oct 26, 2026 \(all day\)/.test(el.textContent || '')));
});

test('a one-day all-day event ends on the day it starts, and an all-day form is left ticked', async () => {
  const fields = protonForm({ allDay: true });
  const { paste } = loadPasteHelper(fields);
  assert.equal(paste('Title: Holiday\nStart: 2026-11-26\nEnd: 2026-11-26'), true);
  await settle();
  assert.equal(fields['event-allday-checkbox'].clicks, 0);
  assert.deepEqual([fields['event-date-input'].value, fields['event-endDate'].value], ['Nov 26, 2026', 'Nov 26, 2026']);
});

test('a timed event pasted into a form opened as all day clears All day and fills the times', async () => {
  const fields = protonForm({ allDay: true });
  const { paste, appended } = loadPasteHelper(fields);
  assert.equal(paste(clipboardText(event)), true);
  await settle();
  assert.equal(fields['event-allday-checkbox'].checked, false);
  assert.deepEqual(['event-startTime', 'event-endTime'].map((id) => fields[id].value), ['11:00 AM', '12:00 PM']);
  assert.ok(appended.some((el) => el.textContent === 'Filled from your clipboard'));
});

test('an All day box that cannot be changed is reported, not clicked', async () => {
  const fields = protonForm({ disabled: true });
  const { paste, appended } = loadPasteHelper(fields);
  assert.equal(paste(clipboardText(fair)), true);
  await settle();
  assert.equal(fields['event-allday-checkbox'].clicks, 0);
  assert.ok(appended.some((el) => /^Could not set: all day\.$/.test(el.textContent || '')));
});

test('an element with the All day id that is not a checkbox is never clicked', async () => {
  const fields = protonForm();
  const decoy = { type: 'submit', checked: false, clicks: 0, click() { this.clicks++; } };
  fields['event-allday-checkbox'] = decoy;
  const { paste, appended } = loadPasteHelper(fields);
  assert.equal(paste(clipboardText(fair)), true);
  await settle();
  assert.equal(decoy.clicks, 0);
  assert.ok(appended.some((el) => /^Could not set: all day\.$/.test(el.textContent || '')));
});
