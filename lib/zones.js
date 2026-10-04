// Time zone words written after an event time, resolved to an IANA zone or a fixed UTC offset.

// Short abbreviations are trusted only right after a time ("7pm ET"), and they resolve to the
// region they name, so "EST" in July still means New York time, as the writer intended.
const ABBREVIATIONS = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  AKST: 'America/Anchorage', AKDT: 'America/Anchorage', HST: 'Pacific/Honolulu',
  AST: 'America/Halifax', ADT: 'America/Halifax', NST: 'America/St_Johns', NDT: 'America/St_Johns',
  UTC: 'UTC', GMT: 'UTC', Z: 'UTC', BST: 'Europe/London', IST: 'Asia/Kolkata',
  WET: 'Europe/Lisbon', WEST: 'Europe/Lisbon', CET: 'Europe/Berlin', CEST: 'Europe/Berlin',
  EET: 'Europe/Helsinki', EEST: 'Europe/Helsinki', MSK: 'Europe/Moscow', SAST: 'Africa/Johannesburg',
  JST: 'Asia/Tokyo', KST: 'Asia/Seoul', HKT: 'Asia/Hong_Kong', SGT: 'Asia/Singapore', PHT: 'Asia/Manila', WIB: 'Asia/Jakarta',
  AEST: 'Australia/Sydney', AEDT: 'Australia/Sydney', ACST: 'Australia/Adelaide', ACDT: 'Australia/Adelaide', AWST: 'Australia/Perth',
  NZST: 'Pacific/Auckland', NZDT: 'Pacific/Auckland'
};
const KIND = String.raw`(?:\s+(?:standard|daylight|summer))?\s+time\b`;
const NAMED = [
  [String.raw`central europe(?:an)?${KIND}`, 'Europe/Berlin'], [String.raw`eastern europe(?:an)?${KIND}`, 'Europe/Helsinki'],
  [String.raw`western europe(?:an)?${KIND}`, 'Europe/Lisbon'], [String.raw`australian eastern${KIND}`, 'Australia/Sydney'],
  [String.raw`australian central${KIND}`, 'Australia/Adelaide'], [String.raw`australian western${KIND}`, 'Australia/Perth'],
  [String.raw`new zealand${KIND}`, 'Pacific/Auckland'], [String.raw`(?:greenwich mean|coordinated universal|universal) time\b`, 'UTC'],
  [String.raw`british summer time\b|\buk time\b`, 'Europe/London'], [String.raw`india(?:n)?${KIND}`, 'Asia/Kolkata'],
  [String.raw`japan${KIND}`, 'Asia/Tokyo'], [String.raw`korea(?:n)?${KIND}`, 'Asia/Seoul'], [String.raw`china${KIND}`, 'Asia/Shanghai'],
  [String.raw`singapore${KIND}`, 'Asia/Singapore'], [String.raw`(?:us )?eastern${KIND}`, 'America/New_York'],
  [String.raw`(?:us )?central${KIND}`, 'America/Chicago'], [String.raw`(?:us )?mountain${KIND}`, 'America/Denver'],
  [String.raw`(?:us )?pacific${KIND}`, 'America/Los_Angeles'], [String.raw`alaska${KIND}`, 'America/Anchorage'],
  [String.raw`hawaii(?:-aleutian)?${KIND}`, 'Pacific/Honolulu'], [String.raw`atlantic${KIND}`, 'America/Halifax'],
  [String.raw`newfoundland${KIND}`, 'America/St_Johns']
].map(([source, zone]) => [new RegExp(String.raw`\b${source}`, 'i'), zone]);
// "7pm Eastern" without the word "time" only counts right after the time.
const REGION = /^(eastern|central|mountain|pacific)\b(?!\s+europ)/i;
const REGIONS = { eastern: 'America/New_York', central: 'America/Chicago', mountain: 'America/Denver', pacific: 'America/Los_Angeles' };
const OFFSET = /\b(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?(?!\d)/gi;
const IANA = /\b(?:America|Europe|Asia|Africa|Australia|Pacific|Atlantic|Indian|Antarctica)\/[A-Za-z_]+(?:\/[A-Za-z_]+)?/g;
const CITY = /\b(\p{Lu}[\p{L}'.]*(?:[ -]\p{Lu}[\p{L}'.]*){0,2})\s+[Tt]ime\b/gu;
// Cities people name that are not the city in their zone's IANA name.
const ALIASES = {
  'san francisco': 'America/Los_Angeles', seattle: 'America/Los_Angeles', portland: 'America/Los_Angeles', 'san diego': 'America/Los_Angeles',
  boston: 'America/New_York', washington: 'America/New_York', miami: 'America/New_York', atlanta: 'America/New_York', philadelphia: 'America/New_York',
  austin: 'America/Chicago', dallas: 'America/Chicago', houston: 'America/Chicago', montreal: 'America/Toronto', ottawa: 'America/Toronto',
  delhi: 'Asia/Kolkata', 'new delhi': 'Asia/Kolkata', mumbai: 'Asia/Kolkata', bangalore: 'Asia/Kolkata', kolkata: 'Asia/Kolkata',
  beijing: 'Asia/Shanghai', kyiv: 'Europe/Kyiv', 'ho chi minh': 'Asia/Ho_Chi_Minh'
};
let cities;

const validZone = (zone) => { try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; } };

function cityZone(name) {
  if (!cities) {
    cities = new Map();
    for (const zone of Intl.supportedValuesOf?.('timeZone') || []) cities.set(zone.split('/').at(-1).replaceAll('_', ' ').toLowerCase(), zone);
    for (const zone of ['America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Denver', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney']) cities.set(zone.split('/')[1].replaceAll('_', ' ').toLowerCase(), zone);
    for (const [city, zone] of Object.entries(ALIASES)) cities.set(city, zone);
  }
  return cities.get(name.toLowerCase()) || null;
}

/** The zone written in text that follows an event time: { zone } (IANA), { offset, label } (minutes east of UTC), or null. */
export function zoneIn(text) {
  const mentions = [];
  const lead = /^[\s,([]*/.exec(text)[0].length;
  const head = text.slice(lead);
  const abbreviation = /^([A-Z]{1,5})(?![A-Za-z])/.exec(head)?.[1];
  if (ABBREVIATIONS[abbreviation]) mentions.push({ index: lead, end: lead + abbreviation.length, zone: ABBREVIATIONS[abbreviation] });
  const region = REGION.exec(head);
  if (region) mentions.push({ index: lead, end: lead + region[0].length, zone: REGIONS[region[1].toLowerCase()] });
  for (const m of text.matchAll(OFFSET)) {
    const offset = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
    if (Number(m[2]) <= 14 && Number(m[3] || 0) < 60) mentions.push({ index: m.index, end: m.index + m[0].length, offset, label: m[0].replace(/\s+/g, '') });
  }
  for (const [pattern, zone] of NAMED) {
    const m = pattern.exec(text);
    if (m) mentions.push({ index: m.index, end: m.index + m[0].length, zone });
  }
  for (const m of text.matchAll(IANA)) if (validZone(m[0])) mentions.push({ index: m.index, end: m.index + m[0].length, zone: m[0] });
  for (const m of [...text.matchAll(CITY), ...text.matchAll(/\(\s*(\p{Lu}[\p{L}'.]*(?:[ -]\p{Lu}[\p{L}'.]*){0,2})\s*\)/gu)]) {
    // "Monday New York time": try "Monday New York", then "New York", then "York".
    const words = m[1].split(/[ -]/);
    const zone = words.map((_, i) => cityZone(words.slice(i).join(' '))).find(Boolean);
    if (zone) mentions.push({ index: m.index, end: m.index + m[0].length, zone });
  }
  if (!mentions.length) return null;
  // The first mention wins, the longest where several start together ("GMT-4" over "GMT").
  mentions.sort((a, b) => a.index - b.index || b.end - a.end);
  const [first] = mentions;
  // Outlook writes "(UTC-05:00) Eastern Time (US & Canada)" all year: the named zone is the real one.
  const named = first.offset !== undefined && mentions.find((m) => m.zone && m.index >= first.end && m.index - first.end <= 4);
  const pick = named || first;
  return pick.zone ? { zone: pick.zone } : { offset: pick.offset, label: pick.label };
}
