// token-radar-01 · input hygiene
//
// The snapshot arrives sealed, but "sealed" only means the bytes did not change
// under us — it does not mean the numbers inside are sane. This module walks the
// parsed protocols once and reports the rows that carry a value a reader would
// balk at: a negative TVL, an age that runs into the future, a 7-day change that
// is not a real percentage. It is a lens, not a filter: the caller keeps every
// protocol and uses these counts only for its own log line.
//
// Nothing here scores anything. A protocol flagged as odd still ranks exactly as
// the model ranked it; the flag exists so a human can see the input, not so the
// machine can quietly drop it.

import type { Snapshot, SnapshotProtocol } from './model.ts';

/** One protocol and the single reason it looks odd, if any. */
export interface HygieneFlag {
  /** The protocol's slug, so a reader can find it. */
  slug: string;
  /** Why it was flagged, phrased for a log line. */
  reason: string;
}

/** The whole hygiene pass: counts by kind, plus the raw flag list. */
export interface HygieneReport {
  /** Protocols examined. */
  examined: number;
  /** Protocols with a non-positive or non-finite TVL. */
  badTvl: number;
  /** Protocols whose listed_at date is in the future of the snapshot. */
  futureListing: number;
  /** Protocols whose 7-day change is outside a plausible band. */
  oddChange: number;
  /** Every flag, capped so the log line stays short. */
  flags: HygieneFlag[];
}

/** Parse a YYYY-MM-DD date to whole days since the epoch, or null. */
function dayOf(date: string | null): number | null {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000);
}

/** Flag a single protocol, or return null when it looks clean. */
function flagFor(p: SnapshotProtocol, asOfDay: number | null): string | null {
  if (!Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) {
    return 'TVL is not a positive, finite number';
  }
  const listedDay = dayOf(p.listed_at);
  if (listedDay !== null && asOfDay !== null && listedDay > asOfDay) {
    return `listed ${p.listed_at}, after the snapshot date`;
  }
  if (p.change_7d !== null && (p.change_7d < -100 || p.change_7d > 10_000)) {
    return `7-day change of ${p.change_7d}% is outside a plausible band`;
  }
  return null;
}

/**
 * Walk every protocol once and collect the ones worth a second look. Read-only:
 * the caller keeps its own list untouched.
 */
export function auditInput(snapshot: Snapshot): HygieneReport {
  const asOfDay = dayOf(snapshot.as_of);
  const flags: HygieneFlag[] = [];
  let badTvl = 0;
  let futureListing = 0;
  let oddChange = 0;

  for (const p of snapshot.protocols) {
    const reason = flagFor(p, asOfDay);
    if (reason === null) continue;
    if (reason.startsWith('TVL')) badTvl += 1;
    else if (reason.startsWith('listed')) futureListing += 1;
    else oddChange += 1;
    if (flags.length < 20) flags.push({ slug: p.slug, reason });
  }

  return {
    examined: snapshot.protocols.length,
    badTvl,
    futureListing,
    oddChange,
    flags,
  };
}

/** One line describing the hygiene pass, for the run summary. */
export function hygieneLine(report: HygieneReport): string {
  const flagged = report.badTvl + report.futureListing + report.oddChange;
  if (flagged === 0) return `input clean across ${report.examined} protocols`;
  const parts: string[] = [];
  if (report.badTvl > 0) parts.push(`${report.badTvl} bad TVL`);
  if (report.futureListing > 0) parts.push(`${report.futureListing} future listing`);
  if (report.oddChange > 0) parts.push(`${report.oddChange} odd 7-day change`);
  return `input flagged on ${flagged} of ${report.examined}: ${parts.join(', ')}`;
}
