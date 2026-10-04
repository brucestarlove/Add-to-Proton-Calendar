// Runs only on Proton Calendar. Pasting a copied event block (lib/clipboard.js) into the
// "Add title" field fills the rest of the open event form. Never saves or submits an event.
// Dates without times (Start: 2026-10-24) make an all-day event, ending on the End date.
(() => {
  // The popup re-injects this into open tabs, and an extension reload leaves the previous
  // copy listening in its old world: the newest copy takes over so only one ever fills.
  const RETIRE = 'add-to-proton-paste-retire';
  document.dispatchEvent(new Event(RETIRE));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const BLOCK = /^Title:[ \t]*(.+)\nStart:[ \t]*(.+)\nEnd:[ \t]*(.+)(?:\nLocation:[ \t]*(.*))?(?:\nNotes:[ \t]*([\s\S]*))?$/i;
  const STAMP = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?(Z|[+-]\d\d:\d\d)?$/;
  const DAY = /^(\d{4})-(\d\d)-(\d\d)$/;
  const MAX_DAYS = 31; // Matches lib/event.js.
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pad = (n) => String(n).padStart(2, '0');
  let running = false;
  let retired = false;

  // A stamp without an offset is read as this browser's local time.
  function stamp(value) {
    const m = STAMP.exec(value.trim());
    if (!m) return new Date(NaN);
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map((part) => Number(part || 0));
    const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 1970 || year > 2037 || wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day || wall.getUTCHours() !== hour || wall.getUTCMinutes() !== minute || wall.getUTCSeconds() !== second) return new Date(NaN);
    const offset = m[7] || '';
    if (offset && offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return new Date(NaN);
    const result = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}${offset}`);
    // A local timestamp in a DST gap must not silently move to a different time.
    if (!offset && (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day || result.getHours() !== hour || result.getMinutes() !== minute)) return new Date(NaN);
    return result;
  }
  // An all-day date, held at local noon so that no daylight-saving change can move it to another day.
  function day(value) {
    const m = DAY.exec(value.trim());
    if (!m) return new Date(NaN);
    const [year, month, date] = m.slice(1).map(Number);
    const result = new Date(year, month - 1, date, 12);
    return year < 1970 || year > 2037 || result.getMonth() !== month - 1 || result.getDate() !== date ? new Date(NaN) : result;
  }
  function parse(text) {
    if (text.length > 4000 || /\u0000/.test(text)) return null;
    const m = BLOCK.exec(text.replace(/\r\n?/g, '\n').trim());
    if (!m) return null;
    // Both dates, or both date-times; a mix is not an event block.
    const allDay = DAY.test(m[2].trim()) && DAY.test(m[3].trim());
    const title = m[1].trim(), start = allDay ? day(m[2]) : stamp(m[2]), end = allDay ? day(m[3]) : stamp(m[3]);
    const location = (m[4] || '').trim(), description = (m[5] || '').trim();
    // A timed event lasts up to MAX_DAYS; an all-day event covers up to MAX_DAYS dates, so it may
    // end on the day it starts. Noon to noon across a daylight-saving change is not a whole day.
    const days = (end - start) / 86400000;
    const fits = allDay ? days >= 0 && Math.round(days) < MAX_DAYS : days > 0 && days <= MAX_DAYS;
    if (!title || title.length > 255 || location.length > 255 || description.length > 3000 || !fits) return null;
    return { title, allDay, start, end, location, description };
  }

  // Proton parses date and time text with its own locale, so reuse the order and punctuation
  // of what the field shows now ("Oct 5, 2026" or "5 Oct 2026"; "2:00 PM" or "14:00").
  const dateLike = (shown, d) => {
    const month = shown.match(/\p{L}+/u)?.[0];
    // Do not guess the order of numeric dates or rewrite an unsupported locale.
    if (!month || !MONTHS.some((name) => name.toLowerCase() === month.slice(0, 3).toLowerCase()) || (shown.match(/\d+/g) || []).length !== 2 || !/\b\d{4}\b/.test(shown)) return '';
    const name = month.length > 3 ? d.toLocaleString('en-US', { month: 'long' }) : MONTHS[d.getMonth()];
    return shown.replace(/\d{4}|\d{1,2}|\p{L}+/gu, (part) => /^\d{4}$/.test(part) ? d.getFullYear() : /^\d/.test(part) ? d.getDate() : name);
  };
  const timeLike = (shown, d) => {
    if (!/^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(shown.trim())) return '';
    return /[AP]M/i.test(shown)
      ? `${d.getHours() % 12 || 12}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
      : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  function setValue(el, value) {
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function fill(event, titleField) {
    const checkForm = () => {
      if (retired || titleField.isConnected === false || document.querySelector('#event-title-input') !== titleField) throw new Error('The event form changed.');
    };
    const same = (a, b) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
    const allDayShown = () => document.querySelector('#event-allday-checkbox')?.checked === true;
    const failed = [], wanted = [];
    const put = async ([id, label, text, typed]) => {
      checkForm();
      const el = document.querySelector(`#${id}`);
      const value = String(text(el?.value || ''));
      if (!el && !value && !typed) return;
      if (!el || (!value && typed)) { failed.push(label); return; }
      wanted.push([id, label, value, typed]);
      // Proton's date and time inputs only parse typed text on blur, after a real focus.
      if (typed) { el.focus(); await pause(40); }
      checkForm();
      setValue(el, value);
      await pause(40);
      if (typed) { el.blur(); await pause(40); }
    };
    await put(['event-title-input', 'title', () => event.title]);
    // Proton's All day box shows or hides the time fields and keeps the dates, so it is set to match
    // the event before them, in either direction: a form opened from the all-day row may need clearing.
    checkForm();
    // Only a real, enabled checkbox is clicked: a click on anything else could do something else.
    const box = document.querySelector('#event-allday-checkbox');
    if (box?.type === 'checkbox' && !box.disabled && box.checked !== event.allDay) { box.click(); await pause(60); }
    // Start before end: Proton moves the end along with the start to keep the duration.
    for (const field of [
      ['event-date-input', 'start date', (shown) => dateLike(shown, event.start), true],
      ...(event.allDay ? [] : [['event-startTime', 'start time', (shown) => timeLike(shown, event.start), true]]),
      ['event-endDate', 'end date', (shown) => dateLike(shown, event.end), true],
      ...(event.allDay ? [] : [['event-endTime', 'end time', (shown) => timeLike(shown, event.end), true]]),
      ['event-location-input', 'location', () => event.location],
      ['event-description-input', 'description', () => event.description]
    ]) await put(field);
    await pause(250); // Let Proton re-render before reading the fields back.
    checkForm();
    document.querySelector('#event-title-input')?.focus();
    if (allDayShown() !== event.allDay) failed.unshift('all day');
    for (const [id, label, value, typed] of wanted) {
      const actual = document.querySelector(`#${id}`)?.value ?? '';
      if (typed ? !same(actual, value) : actual !== value) failed.push(label);
    }
    return failed;
  }

  function note(heading, lines, sticky) {
    document.getElementById('add-to-proton-paste-note')?.remove();
    const host = document.createElement('div'); host.id = 'add-to-proton-paste-note';
    host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = '.box{width:min(345px,calc(100vw - 40px));padding:16px;background:#241b35;color:#f9f3ff;border:1px solid #9478bd;border-radius:13px;box-shadow:0 12px 45px #0007;font:13px/1.5 system-ui}h3{margin:0;font-size:16px}p{margin:8px 0 0;color:#e4daef}button{border:0;background:none;color:#fff;font-size:21px;cursor:pointer;float:right}button:focus-visible{outline:2px solid #d0b7fa}';
    const box = document.createElement('div'); box.className = 'box'; box.setAttribute('role', 'status');
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss'); close.addEventListener('click', () => host.remove());
    const title = document.createElement('h3'); title.textContent = heading;
    box.append(close, title);
    for (const line of lines) { const p = document.createElement('p'); p.textContent = line; box.append(p); }
    root.append(style, box); document.body.append(host);
    if (!sticky) setTimeout(() => host.remove(), 9000);
  }

  function report(event, failed) {
    const when = (d) => d.toLocaleString([], event.allDay ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' });
    const span = event.allDay && when(event.start) === when(event.end) ? when(event.start) : `${when(event.start)} to ${when(event.end)}`;
    const zone = event.allDay ? 'all day' : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const intended = `${event.title}: ${span} (${zone}).`;
    if (failed.length) note('Some fields were not filled', [`Could not set: ${failed.join(', ')}.`, intended, 'Finish those by hand; nothing was saved.'], true);
    else note('Filled from your clipboard', [intended, event.allDay ? 'Check the fields, then click Save yourself.' : 'Check the fields and Proton’s time zone, then click Save yourself.'], false);
  }

  const onPaste = (e) => {
    if (!e.isTrusted || e.target?.id !== 'event-title-input' || e.target !== document.querySelector('#event-title-input')) return;
    const event = parse(e.clipboardData?.getData('text/plain') || '');
    if (!event) return; // Anything else pastes normally.
    e.preventDefault(); e.stopPropagation();
    if (running) return;
    running = true;
    fill(event, e.target).then((failed) => report(event, failed))
      .catch(() => { if (!retired) note('Could not finish filling', ['The event form changed or rejected a field. Check every field before saving, or open a new event and paste again. Nothing was saved by the extension.'], true); })
      .finally(() => { running = false; });
  };
  document.addEventListener('paste', onPaste, true);
  document.addEventListener(RETIRE, () => { retired = true; document.removeEventListener('paste', onPaste, true); }, { once: true });
})();
