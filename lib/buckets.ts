// token-radar-01 · board buckets
//
// Two hundred rows is a lot to hold in the head at once. This module groups the
// finished board two ways — by category and by chain — and reports the size and
// the top protocol of each group. It is a lens over the board, not a re-ranking:
// every row keeps the place the model gave it.
//
// The caller decides what to do with the buckets. Nothing here changes a score.

import type { BoardRow } from './model.ts';

/** One group of rows sharing a category or a chain. */
export interface Bucket {
  /** The shared value: a category name, or a chain name. */
  key: string;
  /** How many rows fell into the group. */
  count: number;
  /** The group's rows, in their existing board order. */
  slugs: string[];
  /** The highest-ranked row's name, or a dash when the group is empty. */
  top: string;
}

/** Group rows by the value a selector pulls from each row. */
function groupBy(board: BoardRow[], select: (row: BoardRow) => string[]): Bucket[] {
  const groups = new Map<string, BoardRow[]>();
  for (const row of board) {
    for (const key of select(row)) {
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [row]);
      else list.push(row);
    }
  }
  const buckets: Bucket[] = [];
  for (const [key, rows] of groups) {
    buckets.push({
      key,
      count: rows.length,
      slugs: rows.map((r) => r.slug),
      top: rows[0]?.name ?? '—',
    });
  }
  buckets.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return buckets;
}

/** Group the board by category, most populous first. */
export function byCategory(board: BoardRow[]): Bucket[] {
  return groupBy(board, (row) => [row.category ?? 'unclassified']);
}

/** Group the board by chain, most populous first. A multi-chain row counts once per chain. */
export function byChain(board: BoardRow[]): Bucket[] {
  return groupBy(board, (row) => (row.chains.length > 0 ? row.chains : ['unknown']));
}

/** One line describing the biggest few categories, for a run summary. */
export function bucketLine(buckets: Bucket[], take = 3): string {
  const head = buckets.slice(0, take).map((b) => `${b.key} ${b.count}`);
  return head.length > 0 ? head.join(', ') : 'none';
}
