// token-radar-01 · board audit
//
// A read-only pass over the finished board that reports how the ranking holds
// together before anything is published. It changes nothing: the caller keeps
// the board it already built and uses these numbers only for its own log line.
//
// The audit answers three questions the model cannot answer about itself from
// the inside:
//
//   1. Spread. Does the implied value actually separate the rows, or did the
//      fit collapse everything onto one number?
//   2. Coverage. How much of the watchlist and of the early field is present,
//      and how many rows came from each source?
//   3. Confidence. How wide is the bootstrap band on the median row, and does
//      the ranking survive when the band is taken seriously?
//
// None of this feeds back into the score. It is a mirror held up to the board.

import type { BoardRow, Snapshot } from './model.ts';

/** A compact description of how one numeric column is spread across the rows. */
export interface ColumnSpread {
  /** Smallest value seen in the column. */
  min: number;
  /** Largest value seen in the column. */
  max: number;
  /** Arithmetic mean of the column. */
  mean: number;
  /** Median of the column. */
  median: number;
  /** The max divided by the min, or null when the min is not positive. */
  ratio: number | null;
}

/** Where each row in the board came from: the watchlist or the early field. */
export interface BoardCoverage {
  /** Rows in the board. */
  rows: number;
  /** Rows whose slug is named in the watchlist. */
  fromWatchlist: number;
  /** Rows taken from the early field, below the floor. */
  fromEarly: number;
  /** Watchlist slugs that never reached the board. */
  watchlistMissing: string[];
  /** Share of the watchlist that made it onto the board, in 0..1. */
  watchlistCovered: number;
}

/** How safe the ordering is when the bootstrap band is taken at face value. */
export interface RankingRobustness {
  /** Rows whose whole [p10, p90] band sits above the next row's top band. */
  cleanGaps: number;
  /** Rows whose band overlaps the row beneath them. */
  overlaps: number;
  /** Rows where the point estimate alone still orders them correctly. */
  pointOrdered: number;
}

/** The whole audit, safe to serialize beside the board. */
export interface BoardAudit {
  spread: ColumnSpread;
  coverage: BoardCoverage;
  robustness: RankingRobustness;
  /** A one-line human summary of the audit. */
  summary: string;
}

/** Compute the spread of one column of numbers. */
function spreadOf(values: number[]): ColumnSpread {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, ratio: null };
  }
  const ordered = [...values].sort((a, b) => a - b);
  const min = ordered[0]!;
  const max = ordered[ordered.length - 1]!;
  const mean = ordered.reduce((acc, v) => acc + v, 0) / ordered.length;
  const mid = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 === 0
    ? (ordered[mid - 1]! + ordered[mid]!) / 2
    : ordered[mid]!;
  return { min, max, mean, median, ratio: min > 0 ? max / min : null };
}

/** Count how the board lines up with the watchlist and the early field. */
function coverageOf(board: BoardRow[], snapshot: Snapshot): BoardCoverage {
  const onBoard = new Set(board.map((r) => r.slug));
  const watch = snapshot.watchlist;
  const fromWatchlist = watch.filter((slug) => onBoard.has(slug)).length;
  const watchlistMissing = watch.filter((slug) => !onBoard.has(slug));
  const fromEarly = board.length - fromWatchlist;
  return {
    rows: board.length,
    fromWatchlist,
    fromEarly,
    watchlistMissing,
    watchlistCovered: watch.length > 0 ? fromWatchlist / watch.length : 0,
  };
}

/**
 * Walk the ordered board and check how the bootstrap bands behave. A row has a
 * clean gap when its lowest plausible value still beats the highest plausible
 * value of the row below it; otherwise the two overlap and the order is soft.
 */
function robustnessOf(board: BoardRow[]): RankingRobustness {
  let cleanGaps = 0;
  let overlaps = 0;
  let pointOrdered = 0;
  for (let i = 1; i < board.length; i++) {
    const above = board[i - 1]!;
    const below = board[i]!;
    if (below.p90_usd < above.p10_usd) cleanGaps += 1;
    else overlaps += 1;
    if (above.implied_value_usd >= below.implied_value_usd) pointOrdered += 1;
  }
  return { cleanGaps, overlaps, pointOrdered };
}

/**
 * Audit a finished board against the snapshot it came from. Read-only: it never
 * mutates the board, and the caller may ignore the result entirely.
 */
export function auditBoard(board: BoardRow[], snapshot: Snapshot): BoardAudit {
  const spread = spreadOf(board.map((r) => r.implied_value_usd));
  const coverage = coverageOf(board, snapshot);
  const robustness = robustnessOf(board);

  const ratio = spread.ratio === null ? 'n/a' : `${spread.ratio.toFixed(1)}x`;
  const covered = Math.round(coverage.watchlistCovered * 100);
  const summary =
    `${coverage.rows} rows · spread ${ratio} · watchlist ${covered}% · ` +
    `${robustness.cleanGaps} clean gaps, ${robustness.overlaps} soft`;

  return { spread, coverage, robustness, summary };
}
