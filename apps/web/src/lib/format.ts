// Formatting helpers. All dates render in the tenant's timezone.

export function fullName(p: { firstName: string; lastName?: string | null }) {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function fmtDate(d: Date | string | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = {}) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz, ...opts }).format(
    new Date(d),
  );
}

export function fmtDateTime(d: Date | string | null | undefined, tz: string) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz,
  }).format(new Date(d));
}

export function fmtTime(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(d));
}

export function relative(d: Date | string, now = new Date()) {
  const diff = (new Date(d).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return rtf.format(Math.round(diff / (86400 * 30)), 'month');
}

/** Offset (ms) of `tz` from UTC at instant `date`. */
function tzOffset(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - date.getTime();
}

/** Parse a `datetime-local` / `date` input value as wall-clock time in `tz`. */
export function parseLocal(value: string | null | undefined, tz: string): Date | null {
  if (!value) return null;
  const v = value.length === 10 ? `${value}T00:00` : value;
  const guess = new Date(`${v}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  return new Date(guess.getTime() - tzOffset(guess, tz));
}

/** Format a Date as a `datetime-local` value in `tz`. */
export function toLocalInput(d: Date | null | undefined, tz: string, dateOnly = false) {
  if (!d) return '';
  const shifted = new Date(d.getTime() + tzOffset(d, tz));
  const iso = shifted.toISOString();
  return dateOnly ? iso.slice(0, 10) : iso.slice(0, 16);
}

/** Start and end of "today" in `tz`, as UTC instants. */
export function dayBounds(tz: string, offsetDays = 0) {
  const nowLocal = toLocalInput(new Date(), tz, true);
  const start = parseLocal(nowLocal, tz)!;
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start.getTime() + 86400_000);
  return { start, end };
}

/**
 * An IP address as people read it: IPv6 shortened ("2401:4900:1c3a::12"), IPv4 inside
 * IPv6 unwrapped, and null when there's no real address (local development stores "::").
 */
export function displayIp(ip: string | null | undefined) {
  if (!ip) return null;
  const v4 = ip.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1] ?? (/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null);
  if (v4) return v4.startsWith('127.') || v4 === '0.0.0.0' ? null : v4;
  if (!ip.includes(':')) return ip;
  // Expand "::", drop leading zeros, then collapse the longest run of zero groups.
  const [head, tail] = ip.toLowerCase().split('::') as [string, string?];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map((g) => g.replace(/^0+(?=.)/, ''));
  if (groups.every((g) => g === '0') || (groups.slice(0, 7).every((g) => g === '0') && groups[7] === '1')) return null;
  // IPv4 stored as IPv6 hex (::ffff:7f00:1).
  if (groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff') {
    const n = (parseInt(groups[6]!, 16) << 16) >>> 0 | parseInt(groups[7]!, 16);
    return displayIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8; i++) {
    let j = i;
    while (j < 8 && groups[j] === '0') j++;
    if (j - i > best.len && j - i > 1) best = { at: i, len: j - i };
    i = j;
  }
  if (best.at < 0) return groups.join(':');
  return `${groups.slice(0, best.at).join(':')}::${groups.slice(best.at + best.len).join(':')}`;
}
