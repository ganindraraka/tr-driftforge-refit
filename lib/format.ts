// token-radar-01 · formatting helpers
//
// Small, pure formatters the readout and the log line share. Each one takes a
// number and returns a short string a person reads without effort. They are kept
// together here so the page, the terminal table and the summary all describe the
// same value the same way.
//
// Nothing here scores or ranks. A formatter that cannot make sense of its input
// returns a dash rather than guessing, so a bad value shows up as a gap.

/** One decimal place of a percentage, e.g. 12.5%, or a dash for a null. */
export function pct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '' : ''}${value.toFixed(digits)}%`;
}

/** A signed percentage for a change, e.g. +7% or -3%, or a dash. */
export function signedPct(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** A probability in 0..1 as a whole-percentage string, e.g. 51%. */
export function prob(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}

/** A dollar figure at a chosen scale: 'k', 'm', or 'b', e.g. 49.3m. */
export function money(usd: number, scale: 'k' | 'm' | 'b' = 'm'): string {
  if (!Number.isFinite(usd)) return '—';
  const divisor = scale === 'b' ? 1_000_000_000 : scale === 'm' ? 1_000_000 : 1_000;
  const suffix = scale === 'b' ? 'b' : scale === 'm' ? 'm' : 'k';
  return `${(usd / divisor).toFixed(1)}${suffix}`;
}

/** A count of days as a short span, e.g. '90d' or '2,675d'. */
export function days(count: number): string {
  if (!Number.isFinite(count)) return '—';
  return `${Math.round(count).toLocaleString('en-US')}d`;
}

/** An age as of a snapshot, in whole days between two YYYY-MM-DD dates, or null. */
export function ageInDays(from: string | null, to: string): number | null {
  if (from === null) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Truncate a chain name to a fixed width with an ellipsis, or a dash for none. */
export function chainLabel(chain: string | null, width = 12): string {
  if (chain === null || chain === '') return '—';
  if (chain.length <= width) return chain;
  return `${chain.slice(0, Math.max(0, width - 1))}…`;
}
