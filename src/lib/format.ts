export function duration(ms: number): string {
  if (!ms) return '';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const FULL = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

/** "3:42 PM" today, "Sep 18, 3:42 PM" otherwise. */
export function when(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString() ? TIME.format(date) : DAY_TIME.format(date);
}

export function exactTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : FULL.format(date);
}

/** 1,234 as "1.2k", 3,400,000 as "3.4M". */
export function compact(count: number): string {
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** "claude-sonnet-5-5" as "Sonnet 5.5", for a model the server sent no name for. */
export function modelName(id: string): string {
  const [family, ...version] = id.replace(/^claude-/, '').split('-');
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim();
}
