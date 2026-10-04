// Serialized by chrome.scripting.executeScript; keep this function self-contained.
// Reads the page areas most likely to describe an event, most specific first, plus the event
// data some sites publish for search engines. lib/find.js decides what to offer.
export function readEventPage({ doc = document, host = location.hostname } = {}) {
  // Bounds on what one click collects, so that a hostile page cannot stall the popup: characters
  // per area, links per area, and the number of dialogs and frames read.
  const LIMIT = 30000, LINKS = 200, DIALOGS = 5, FRAMES = 8;
  const shown = (el) => !!el?.getClientRects?.().length;
  const all = (root, selector) => [...(root?.querySelectorAll?.(selector) || [])];
  // innerText leaves out open shadow roots, where web-component sites render their content.
  const textOf = (root) => {
    const parts = [typeof root.innerText === 'string' ? root.innerText
      : [...(root.children || [])].filter((el) => shown(el) && !/^(?:STYLE|SCRIPT|TEMPLATE|LINK)$/.test(el.tagName)).map((el) => el.innerText || '').join('\n')];
    let size = parts[0].length;
    for (const el of all(root, '*')) {
      if (size >= LIMIT) break;
      if (!el.shadowRoot) continue;
      const nested = textOf(el.shadowRoot);
      parts.push(nested);
      size += nested.length;
    }
    return parts.filter((text) => text.trim()).join('\n').slice(0, LIMIT);
  };
  // Link targets carry "add to calendar" details and meeting links that the visible text omits.
  const linksOf = (root) => all(root, 'a[href]').map((a) => String(a.href || '')).filter((href) => /^https:\/\//i.test(href) && href.length <= 4000).slice(0, LINKS);
  const headingOf = (root) => all(root, 'h1, h2, [role="heading"]').find((el) => shown(el) && el.innerText?.trim())?.innerText.trim().slice(0, 300) || '';
  const scopes = [];
  const add = (kind, root, heading = headingOf(root)) => {
    const text = root ? textOf(root) : '';
    if (text.trim()) scopes.push({ kind, text, links: linksOf(root), heading });
  };
  // Same-origin frames, such as the one Proton Mail shows a message in. Others cannot be read.
  const frames = all(doc, 'iframe, frame').filter(shown).map((frame) => { try { return frame.contentDocument; } catch { return null; } }).filter((d) => d?.body).slice(0, FRAMES);

  // Selected text says exactly which event the reader means.
  for (const d of [doc, ...frames]) {
    const selection = d.getSelection?.();
    const text = selection?.toString().trim() || '';
    if (text.length < 6) continue;
    scopes.push({ kind: 'selection', text: text.slice(0, LIMIT), links: selection.rangeCount ? linksOf(selection.getRangeAt(0).cloneContents()) : [], heading: '' });
    break;
  }
  // Open dialogs, newest first. A cookie banner holds no event, so the next area is tried.
  for (const dialog of all(doc, '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"]').filter(shown).slice(-DIALOGS).reverse()) add('dialog', dialog);
  const main = all(doc, '[role="main"], main').filter(shown).at(-1);
  // The open message in webmail; its subject heading sits outside the message body.
  const message = all(doc, host === 'mail.google.com' ? '.a3s' : '[aria-label="Message body"]').filter(shown).at(-1);
  if (message) add('message', message, headingOf(main));
  for (const frame of frames) add('frame', frame.body, headingOf(frame.body));
  if (main) add('main', main);
  add('page', doc.body);

  // schema.org Event data, as JSON-LD or as microdata attributes.
  const structured = all(doc, 'script[type="application/ld+json" i]').slice(0, 40).map((script) => (script.textContent || '').slice(0, 300000));
  const prop = (item, name) => {
    const el = item.querySelector?.(`[itemprop~="${name}"]`);
    return el ? String(el.getAttribute('content') || el.getAttribute('datetime') || (name === 'url' && el.href) || el.innerText || '').trim().slice(0, 1000) : '';
  };
  const microdata = all(doc, '[itemscope][itemtype]').filter((el) => /schema\.org\/\w*Event\s*$/i.test(el.getAttribute('itemtype') || '')).slice(0, 40)
    .map((el) => ({ '@type': 'Event', name: prop(el, 'name'), startDate: prop(el, 'startDate'), endDate: prop(el, 'endDate'), location: prop(el, 'location'), url: prop(el, 'url') }));
  const ogTitle = doc.querySelector?.('meta[property="og:title"]')?.getAttribute('content');
  return {
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    lang: doc.documentElement?.lang || '',
    title: String(ogTitle || doc.title || '').trim().slice(0, 300),
    scopes, structured, microdata
  };
}
