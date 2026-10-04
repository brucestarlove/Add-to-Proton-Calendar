import test from 'node:test';
import assert from 'node:assert/strict';
import { readEventPage } from '../lib/page-text.js';

// Just enough of the DOM for readEventPage; shadow roots and frames are covered in a real browser.
const node = (innerText, { visible = true, links = [], headings = [] } = {}) => ({
  innerText, getClientRects: () => (visible ? [1] : []),
  querySelectorAll: (selector) => (selector === 'a[href]' ? links.map((href) => ({ href })) : /^h1\b/.test(selector) ? headings : [])
});
const doc = (selectors, { body = node('N'.repeat(30000)), selection = '', title = '' } = {}) => ({
  body, title,
  querySelectorAll: (selector) => selectors[selector] || [],
  getSelection: () => ({ toString: () => selection, rangeCount: 0 })
});
const DIALOGS = '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]';
const kinds = (page) => page.scopes.map((scope) => scope.kind);

test('Gmail capture reads the visible opened message before 30k of navigation chrome', () => {
  const main = node('Inbox chrome', { headings: [node('Gathering this weekend')] });
  const page = readEventPage({ doc: doc({ '.a3s': [node('Old message', { visible: false }), node('Reminder that "Gathering" starts October 5, 2026 @ 2pm - 3pm')], '[role="main"], main': [main] }), host: 'mail.google.com' });
  assert.deepEqual(kinds(page), ['message', 'main', 'page']);
  assert.match(page.scopes[0].text, /Gathering/);
  assert.equal(page.scopes[0].text.includes('Old message'), false);
  assert.equal(page.scopes[0].heading, 'Gathering this weekend');
});

test('Skool capture reads the visible event dialog before its calendar grid', () => {
  const page = readEventPage({ doc: doc({ [DIALOGS]: [node('New Moon Direction Setting\nOctober 5, 2026 @ 2pm - 3pm')] }), host: 'www.skool.com' });
  assert.deepEqual(kinds(page), ['dialog', 'page']);
  assert.match(page.scopes[0].text, /New Moon Direction Setting/);
});

test('every open dialog is offered newest first, so a cookie banner does not hide the event', () => {
  const page = readEventPage({ doc: doc({ [DIALOGS]: [node('Event details\nOct 5 at 2pm'), node('We use cookies')] }), host: 'example.com' });
  assert.deepEqual(page.scopes.map((scope) => scope.text), ['We use cookies', 'Event details\nOct 5 at 2pm', 'N'.repeat(30000)]);
});

test('selected text comes first, and page text is capped at 30,000 characters per area', () => {
  const page = readEventPage({ doc: doc({}, { body: node('x'.repeat(50000)), selection: '  Book club\nOct 24 at 7pm  ' }), host: 'example.com' });
  assert.deepEqual(kinds(page), ['selection', 'page']);
  assert.equal(page.scopes[0].text, 'Book club\nOct 24 at 7pm');
  assert.equal(page.scopes[1].text.length, 30000);
});

test('link targets, published event data, and the page title are collected; other link schemes are not', () => {
  const body = node('Fall Fest', { links: ['https://calendar.google.com/calendar/render?action=TEMPLATE', 'javascript:void(0)', 'mailto:a@example.test'] });
  const page = readEventPage({ doc: doc({ 'script[type="application/ld+json" i]': [{ textContent: '{"@type":"Event"}' }] }, { body, title: 'Fall Fest | Town' }), host: 'example.com' });
  assert.deepEqual(page.scopes[0].links, ['https://calendar.google.com/calendar/render?action=TEMPLATE']);
  assert.deepEqual(page.structured, ['{"@type":"Event"}']);
  assert.equal(page.title, 'Fall Fest | Town');
});
