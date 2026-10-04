import { clipboardText } from './lib/clipboard.js';
import { MAX_DAYS, validateEvent } from './lib/event.js';
import { findEvents } from './lib/find.js';
import { readEventPage } from './lib/page-text.js';
import { addDays, formatDays, formatForZone, inputForZone, inputToUtc } from './lib/time.js';

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function showStep(step) {
  document.querySelector('main').dataset.step = step;
  status('');
}

function showReview(note) {
  $('review-note').textContent = note;
  showStep('review');
  $('event-title').focus();
}

// All day turns Starts and Ends into date fields. All-day events have no time zone.
function showAllDay(allDay) {
  $('event-all-day').checked = allDay;
  for (const id of ['event-start', 'event-end']) $(id).type = allDay ? 'date' : 'datetime-local';
  $('zone-row').hidden = allDay;
  $('event-zone').disabled = allDay;
}

// "Oct 24, 2026, 7:00 PM" or "Oct 30 – Nov 1, 2026, all day".
function whenText(event) {
  if (event.allDay) return `${formatDays(event.startDate, event.endDate)}, all day`;
  const when = formatForZone(event.start, event.zone);
  return `${when.date}, ${when.time}`;
}

let found = [];
// The times shown before All day was ticked, restored if it is cleared with the dates unchanged.
let timed = null;

function renderReview(event, lead = '') {
  timed = null;
  showAllDay(!!event.allDay);
  $('event-title').value = event.title;
  $('event-zone').value = event.zone || browserZone();
  $('event-start').value = event.allDay ? event.startDate : inputForZone(event.start, event.zone);
  $('event-end').value = event.allDay ? event.endDate : inputForZone(event.end, event.zone);
  $('event-location').value = event.location || '';
  $('event-description').value = event.description || '';
  const warnings = [];
  if (event.midnight) warnings.push('Midnight to midnight read as all day.');
  if (event.durationAssumed) warnings.push('End time assumed: 1 hour.');
  if (event.yearAssumed) warnings.push('Year inferred from today.');
  if (event.dateOrderAssumed) warnings.push('Day and month order assumed.');
  if (event.zoneAssumed) warnings.push('Time zone assumed from this browser.');
  if (event.converted) warnings.push('Times converted to your time zone.');
  if (event.weekdayMismatch) warnings.push('The weekday on the page does not match this date.');
  showReview([lead, warnings.length ? `${warnings.join(' ')} Please check.` : 'Check the details before copying.'].filter(Boolean).join(' '));
}

// Several events on one page: offer them all, best first.
function showFound(events, lead) {
  found = events;
  $('event-pick').replaceChildren(...events.map((event, i) => new Option(`${whenText(event)} · ${event.title}`, String(i))));
  $('pick-label').textContent = `${events.length} events found`;
  $('pick-row').hidden = events.length < 2;
  renderReview(events[0], lead);
}

$('event-pick').addEventListener('change', (e) => renderReview(found[Number(e.target.value)]));

$('event-all-day').addEventListener('change', (e) => {
  const [start, end] = [$('event-start').value, $('event-end').value];
  showAllDay(e.target.checked);
  if (e.target.checked) {
    // An event that ends at midnight ends on the day before.
    const midnight = end.endsWith('T00:00') && end.slice(0, 10) > start.slice(0, 10);
    $('event-start').value = start.slice(0, 10);
    $('event-end').value = midnight ? addDays(end.slice(0, 10), -1) : end.slice(0, 10);
    timed = { start, end, dates: `${$('event-start').value}/${$('event-end').value}` };
  } else {
    const keep = timed?.dates === `${start}/${end}`;
    $('event-start').value = keep ? timed.start : start && `${start}T09:00`;
    $('event-end').value = keep ? timed.end : start && `${end || start}T10:00`;
    timed = null;
  }
});

function explain(item) {
  const name = item.title && item.title !== 'Untitled event' ? `“${item.title}”` : 'an event';
  if (item.reason === 'past') {
    return item.allDay
      ? `Found ${name} on ${formatDays(item.startDate, item.endDate)}, but it has already started.`
      : `Found ${name} at ${whenText(item)} (${item.zone}), but it has already started.`;
  }
  if (item.reason === 'too-long') return `Found ${name}, but it lasts more than ${MAX_DAYS} days. Create it directly in Proton Calendar.`;
  if (item.reason === 'cancelled') return `Found ${name}, but the page says it was cancelled.`;
  return 'No upcoming event found. Open the event details and try again, or enter them yourself.';
}

// The page is read only here, on click, through the activeTab grant for the current tab.
$('capture-page').addEventListener('click', async () => {
  $('capture-page').disabled = true;
  $('manual-entry').disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url || '')) throw new Error('Open the page that shows the event first, or enter the details yourself.');
    status('Looking for an event…');
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readEventPage })
      .catch(() => { throw new Error('This page cannot be read. Enter the details yourself.'); });
    const { events, rejected, selectionMissed } = findEvents(result);
    if (events.length) { showFound(events, selectionMissed ? 'No upcoming event in the selected text, so this is from the rest of the page.' : ''); return; }
    throw new Error(explain(rejected[0] || {}));
  } catch (error) { status(error.message, true); }
  finally { $('capture-page').disabled = false; $('manual-entry').disabled = false; }
});

$('manual-entry').addEventListener('click', () => {
  $('review-form').reset();
  timed = null;
  showAllDay(false);
  $('pick-row').hidden = true;
  $('event-zone').value = browserZone();
  showReview('Enter a future date and time, or tick All day.');
});

$('start-over').addEventListener('click', () => showStep('start'));

// Suggestions for the time zone field, where the browser can list them.
$('zone-list').replaceChildren(...(Intl.supportedValuesOf?.('timeZone') || []).map((zone) => new Option(zone)));

// Declared content scripts only reach pages loaded after the extension was installed, so
// give any Proton Calendar tab or app window that is already open the paste helper now.
async function armOpenCalendars() {
  const tabs = await chrome.tabs.query({ url: 'https://calendar.proton.me/*' });
  const results = await Promise.allSettled(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['calendar-paste.js'] })));
  return results.every((result) => result.status === 'fulfilled');
}

$('review-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const details = { title: $('event-title').value, location: $('event-location').value, description: $('event-description').value };
    const zone = $('event-zone').value.trim();
    const event = validateEvent($('event-all-day').checked
      ? { ...details, allDay: true, startDate: $('event-start').value, endDate: $('event-end').value }
      : { ...details, zone, start: inputToUtc($('event-start').value, zone), end: inputToUtc($('event-end').value, zone) });
    await navigator.clipboard.writeText(clipboardText(event));
    status('Copied.');
    const ready = await armOpenCalendars().catch(() => false);
    if (!ready) status('Copied. Reload Proton Calendar if pasting does not fill the form.');
  } catch (error) { status(error.message, true); }
});
