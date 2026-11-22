// token-radar-01 · snapshot diff
//
// A radar is only useful if it changes with the world. This module compares two
// parsed snapshots — a previous one and the current one — and reports what moved:
// protocols that appeared, protocols that vanished, and protocols whose TVL
// changed by more than an order-of-magnitude threshold.
//
// It is a reporting tool, not part of the ranking. The caller may run it against
// any two snapshots it holds; the board itself is unaffected.

import type { Snapshot, SnapshotProtocol } from './model.ts';

/** One protocol that is present in one snapshot and absent from the other. */
export interface MembershipChange {
  /** The protocol's slug. */
  slug: string;
  /** Its name, so a log line reads well. */
  name: string;
  /** Its TVL in whichever snapshot held it. */
  tvl_usd: number;
}

/** One protocol whose TVL moved beyond the reporting threshold. */
export interface ValueChange {
  /** The protocol's slug. */
  slug: string;
  /** TVL in the previous snapshot. */
  before: number;
  /** TVL in the current snapshot. */
  after: number;
  /** (after - before) / before, as a fraction. */
  change: number;
}

/** Everything a diff found between two snapshots. */
export interface SnapshotDiff {
  /** When each snapshot was taken. */
  asOfBefore: string;
  asOfAfter: string;
  /** Protocols the current snapshot added. */
  added: MembershipChange[];
  /** Protocols the current snapshot dropped. */
  removed: MembershipChange[];
  /** Protocols whose TVL moved past the threshold, biggest move first. */
  moved: ValueChange[];
}

/** Index a snapshot's protocols by slug for a fast membership test. */
function indexSlugs(snapshot: Snapshot): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) index.set(p.slug, p);
  return index;
}

/**
 * Compare a previous snapshot to a current one. `threshold` is the fractional
 * TVL move worth reporting, for example 0.25 for a quarter. Read-only.
 */
export function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
  threshold = 0.25,
): SnapshotDiff {
  const beforeIndex = indexSlugs(before);
  const afterIndex = indexSlugs(after);

  const added: MembershipChange[] = [];
  const removed: MembershipChange[] = [];
  const moved: ValueChange[] = [];

  for (const [slug, p] of afterIndex) {
    const was = beforeIndex.get(slug);
    if (was === undefined) {
      added.push({ slug, name: p.name, tvl_usd: p.tvl_usd });
      continue;
    }
    if (was.tvl_usd > 0) {
      const change = (p.tvl_usd - was.tvl_usd) / was.tvl_usd;
      if (Math.abs(change) >= threshold) {
        moved.push({ slug, before: was.tvl_usd, after: p.tvl_usd, change });
      }
    }
  }

  for (const [slug, p] of beforeIndex) {
    if (!afterIndex.has(slug)) {
      removed.push({ slug, name: p.name, tvl_usd: p.tvl_usd });
    }
  }

  moved.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return {
    asOfBefore: before.as_of,
    asOfAfter: after.as_of,
    added,
    removed,
    moved,
  };
}

/** One line describing a diff, for a run summary. */
export function diffLine(diff: SnapshotDiff): string {
  return (
    `${diff.asOfBefore} -> ${diff.asOfAfter}: ` +
    `${diff.added.length} added, ${diff.removed.length} removed, ${diff.moved.length} moved`
  );
}
