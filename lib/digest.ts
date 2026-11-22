// token-radar-01 · board digest
//
// A single line that answers "what changed and what matters" for someone who
// will not open the page. It gathers the counts the summary, the buckets and the
// limits already produce and joins them into one sentence the log line can carry.
//
// It ranks nothing and computes nothing new: every figure is copied from the
// board it is handed. If the board is empty it says so and stops.

import type { BoardRow } from './model.ts';
import { byCategory } from './buckets.ts';
import { summarizeBoard } from './report-summary.ts';
import { LIMITS } from './limits.ts';
import { signedPct } from './format.ts';

/** A short digest of a finished board, plus the pieces it was built from. */
export interface Digest {
  /** The one line. */
  line: string;
  /** How many rows the board holds. */
  rows: number;
  /** How many categories those rows fall into. */
  categories: number;
  /** The share of rows the model reads as a launch within the horizon, 0..1. */
  share: number;
}

/**
 * Build a one-line digest of a finished board. `prior` is the previous run's
 * row count, when the caller has one, so the line can name the change.
 */
export function digestBoard(board: BoardRow[], prior: number | null = null): Digest {
  if (board.length === 0) {
    return { line: 'board empty: nothing cleared the floor', rows: 0, categories: 0, share: 0 };
  }
  const summary = summarizeBoard(board);
  const buckets = byCategory(board);
  const share = summary.facts.confident / summary.facts.rows;
  const delta = prior === null ? '' : ` (${signedPct((board.length - prior) / prior * 100)} rows)`;
  const line =
    `${board.length} rows in ${buckets.length} categories${delta}, ` +
    `top ${buckets[0]?.key ?? '—'}, ` +
    `launch share ${Math.round(share * 100)}%, ` +
    `horizon ${LIMITS.horizonDays}d`;
  return { line, rows: board.length, categories: buckets.length, share };
}
